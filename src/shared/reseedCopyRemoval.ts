/**
 * 「删除辅种任务时，要不要把它在下载器里的那些副本连数据文件一起删掉」的判据。
 *
 * 单独一份是为了让它能被 Node 断言引用（判据住在 .vue 里就进不了用例，也进不了反证）。
 *
 * 来由（用户 2026-11-01）：「删除辅种任务时的确认框里增加一个把下载器里的任务也删除、
 * 文件也删除的开关，默认关闭」。**默认关闭是口径的一部分** —— 不勾时这一整条链与改前一字不差。
 *
 * 三条判据：
 * ① **只对 infoHash，不猜标题**。任务里每条待发副本记着自己的 `hash`，基准那条记在
 *    `baseLocal.hash`；只有这些串能与下载器列表对上。没记 hash 的旧条目**不猜**（同名条目
 *    可能零条也可能多条，v0.68 那条「无法唯一匹配就不动」同族），单独数一个数交回界面。
 * ② 同一份内容在下载器里通常有 **N 条副本**（一站一条，正是辅种辅出来的形状），而它们挂的是
 *    **同一份数据** —— 删第一条时文件就没了，其余各条跟着变 0%。所以这里交回的是列表里
 *    **所有**命中的条目而不是第一条；而这一点界面必须自己说出来（勾选框救不了别的任务，
 *    这里也没有跨任务的守卫：真要保住数据，唯一的办法是别勾）。
 * ③ **连不上（列表没拿到）一律不删**：那种情况下连「有哪些副本」都不知道，删错了无从收拾。
 *    任务记录照删 —— 那是用户点的那一下；这一半单独说一句，不许和「删成功」混成一句。
 */

import type { IKeepUploadTask } from "./types/storages/keepUploadTask.ts";

/** 下载器报回来的条目里，这一族用得到的那两样 */
export interface IReseedClientEntryRef {
  /** 那一条的 infoHash（各家报的大小写不一，比对前统一小写） */
  hash?: string;
  /** 删除要用的那个 id：qBittorrent 与 infoHash 同值，Aria2 是数字 gid，两者不能互换 */
  id: string | number;
}

export interface IReseedCopyPlan {
  /** 这一组任务的下载器连不上（列表压根没拿到）—— 这一档一条都不删 */
  unreachable: boolean;
  /** 要删的那些条目的 id（同一份内容的多条副本全在里头） */
  matched: Array<string | number>;
  /** 任务里没记 infoHash、因而认不出是下载器里哪一条的条数 */
  noHash: number;
  /** 记了 infoHash、下载器列表里却没有的条数（多半已经删过了） */
  notFound: number;
}

/** 归一化：与 `reseedTaskDup.ts` 同一口径，hash 只认去空白后的小写 */
const normHash = (v: unknown): string => (typeof v === "string" ? v.trim().toLowerCase() : "");

/**
 * 把这一组任务（同一台下载器）对回下载器里的那些副本。
 *
 * `entries` 给 `null` 表示那台连不上、列表压根没拿到，而不是「拿到了空列表」—— 这两档在判据里
 * 必须分开：空列表意味着「记过的那几条都不在场」（→ notFound，不用删），连不上意味着「不知道」。
 */
export function planReseedCopyRemoval(tasks: IKeepUploadTask[], entries: IReseedClientEntryRef[] | null): IReseedCopyPlan {
  const wanted = new Set<string>();
  let noHash = 0;

  for (const task of tasks) {
    for (const item of task.items) {
      const hash = normHash(item.hash);
      if (hash) wanted.add(hash);
      else noHash += 1;
    }
    if (task.baseLocal) {
      const baseHash = normHash(task.baseLocal.hash);
      if (baseHash) wanted.add(baseHash);
      else noHash += 1;
    }
  }

  if (entries === null) return { unreachable: true, matched: [], noHash, notFound: 0 };

  const matched: Array<string | number> = [];
  const found = new Set<string>();
  for (const one of entries) {
    const hash = normHash(one.hash);
    if (!hash || !wanted.has(hash)) continue;
    matched.push(one.id);
    found.add(hash);
  }

  let notFound = 0;
  for (const hash of wanted) if (!found.has(hash)) notFound += 1;

  return { unreachable: false, matched, noHash, notFound };
}

/**
 * 这两家的 `removeTorrent` **不读第二个参数**，勾上那个勾选框也只会删任务、文件照旧留在盘上：
 * - 群晖（`packages/downloader/entity/synologyDownloadStation.ts:792`）只调 `Task` 那一个 delete，
 *   它自己的注释就写着「removeData 配置项不会起作用」；
 * - Aria2（`packages/downloader/entity/Aria2.ts:456`）调的是 `aria2.remove` +
 *   `aria2.removeDownloadResult`，那两个 RPC 都不碰磁盘，aria2 也没有删文件的 RPC。
 *
 * 界面上那句「有些下载器删不了文件」按这一条出：事后说等于让他以为几十 GB 已经没了。
 * 其余六家（qBittorrent / Transmission / uTorrent / ruTorrent / Deluge / Flood）都读这一参。
 */
export function ignoresRemoveData(type?: string): boolean {
  return type === "synologyDownloadStation" || type === "Aria2";
}
