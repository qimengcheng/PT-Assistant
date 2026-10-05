/**
 * 站点用户信息**按天存档**的唯一读写入口。
 *
 * 存放位置从 chrome.storage.local 的 `userInfo` 键迁到了 IndexedDB `ptd` 库的 `user_info`
 * store（复合主键 [site, date]）。迁移动机见 src/shared/types/storages/indexdb.ts 里
 * 该 store 的注释：chrome.storage 没有记录粒度，那份「每天 × 每站点」只增不减的时序
 * 每次改一条都要整块读改写，成本随使用年限线性上涨。
 *
 * 为什么单独成模块而不是留在 offscreen/utils/userInfo.ts：
 * background 的 fixer.ts（安装/升级时修历史脏数据）也要遍历这份存档，而两个上下文
 * 必须用同一份实现 —— 各写一遍的话，将来 store 结构一变就会只改一边，
 * 那种不一致是静默的（IndexedDB 读不到就是空，不报错）。
 *
 * 迁移：首次访问时惰性执行，由 ensureMigrated() 统一挡在前面。
 * 动作是「读旧键 → 逐条 put → 清空旧键」，put 以 [site,date] 为主键天然幂等，
 * 中途崩溃下次会重跑，不会产生重复或半截数据。旧键清空后本模块不再碰它。
 */
import { ptdIndexDb } from "./indexdb.ts";
import { extStore } from "@/storage.ts";
import type { IStoredUserInfo, TUserInfoStorageSchema } from "./types.ts";

/** 复合主键里 date 的上界哨兵："\uffff" 排在任何日期字符串之后 */
const DATE_UPPER_BOUND = "\uffff";

function siteKeyRange(siteId: string): IDBKeyRange {
  return IDBKeyRange.bound([siteId, ""], [siteId, DATE_UPPER_BOUND]);
}

let migration: Promise<void> | null = null;

/** 幂等：并发调用共享同一个 promise，只搬一次 */
export function ensureMigrated(): Promise<void> {
  migration ??= (async () => {
    const db = await ptdIndexDb;
    const legacy = ((await extStore.getItem("userInfo")) ?? {}) as TUserInfoStorageSchema;

    let moved = 0;
    for (const [siteId, byDate] of Object.entries(legacy)) {
      for (const [date, userInfo] of Object.entries(byDate ?? {})) {
        // 旧数据里可能缺 site 字段（早期版本按外层键组织），补齐后才能对上 keyPath
        await db.put("user_info", { ...userInfo, site: siteId, date });
        moved++;
      }
    }

    if (moved > 0) {
      await extStore.setItem("userInfo", {});
      console.debug(`[PTD] userInfo 按天存档已迁入 IndexedDB user_info，共 ${moved} 条`);
    }
  })().catch((e) => {
    // 迁移失败不能永久缓存失败态：置空让下次访问重试，否则本次会话所有存档读写全废
    migration = null;
    console.error("[PTD] userInfo 存档迁移失败，将在下次访问时重试", e);
    throw e;
  });

  return migration;
}

/** 取某站点的全部按天历史（date → userInfo） */
export async function readSiteArchive(siteId: string): Promise<Record<string, IStoredUserInfo>> {
  await ensureMigrated();
  const db = await ptdIndexDb;
  const rows = await db.getAll("user_info", siteKeyRange(siteId));

  const result: Record<string, IStoredUserInfo> = {};
  for (const row of rows) {
    result[row.date] = row;
  }
  return result;
}

/** 取整份存档（备份导出、脏数据修复用）。返回结构与迁移前的 chrome.storage 版本完全一致 */
export async function readAllArchive(): Promise<TUserInfoStorageSchema> {
  await ensureMigrated();
  const db = await ptdIndexDb;
  const rows = await db.getAll("user_info");

  const result: TUserInfoStorageSchema = {};
  for (const row of rows) {
    result[row.site] ??= {};
    result[row.site][row.date] = row;
  }
  return result;
}

/** 写入/覆盖单条。这是本次迁移的主要收益点：O(1)，不再整块读改写 */
export async function putArchiveEntry(siteId: string, date: string, userInfo: IStoredUserInfo): Promise<void> {
  await ensureMigrated();
  const db = await ptdIndexDb;
  await db.put("user_info", { ...userInfo, site: siteId, date });
}

/** 逐条删除（历史数据管理界面用） */
export async function deleteArchiveEntries(siteId: string, dates: string[]): Promise<void> {
  if (dates.length === 0) return;
  await ensureMigrated();
  const db = await ptdIndexDb;
  const tx = db.transaction("user_info", "readwrite");
  for (const date of dates) {
    await tx.store.delete([siteId, date]);
  }
  await tx.done;
}

/** 删掉某站点的全部历史（调试页「清空指定站点数据」用）。主键前缀范围一次删完，O(该站点条数) */
export async function clearSiteArchive(siteId: string): Promise<void> {
  await ensureMigrated();
  const db = await ptdIndexDb;
  await db.delete("user_info", siteKeyRange(siteId));
}

/** 清空整份存档（调试页「清空所有站点数据」用） */
export async function clearArchive(): Promise<void> {
  await ensureMigrated();
  const db = await ptdIndexDb;
  await db.clear("user_info");
}

/**
 * 用一份完整存档覆盖现有存档 —— 备份恢复专用。
 *
 * 语义与迁移前保持一致：迁移前是 `extStore.setItem("userInfo", fieldData)` 整键覆盖，
 * 所以这里也必须先 clear 再写，否则恢复后本机多出来的条目会残留。
 * `keepExistUserInfo` 的合并是在调用方（backup.ts）对**对象**做的，不在这层。
 */
export async function replaceArchive(data: TUserInfoStorageSchema): Promise<void> {
  await ensureMigrated();
  const db = await ptdIndexDb;
  const tx = db.transaction("user_info", "readwrite");
  await tx.store.clear();
  for (const [siteId, byDate] of Object.entries(data ?? {})) {
    for (const [date, userInfo] of Object.entries(byDate ?? {})) {
      await tx.store.put({ ...userInfo, site: siteId, date });
    }
  }
  await tx.done;
}
