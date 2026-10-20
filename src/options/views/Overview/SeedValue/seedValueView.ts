/**
 * 「做种价值」那一屏的取数与拼法（判据本体在 `@/shared/seedValue`）。
 *
 * 为什么单独成一份而不是写在 `.vue` 里：这一层出错不报错，只会让某一类内容整个从清单上消失
 * （分组并错、站点反查折错、状态认歪），而这一屏的用途恰恰是「哪些还该留」—— 少一条就是
 * 一次没人看见的判断。住在 `.vue` 里就进不了 Node 断言（AGENTS 记过这条），所以拆出来。
 *
 * 三条取数口径：
 * ① **一份内容一行**，用的是「我的下载器」折叠那套同一个分组判据（`assignGroups` + 辅种台账）——
 *    两边各折一套就会出现「列表里说这两条同内容、这一屏把它们当两条算」；
 * ② 每份副本的站点走 Tracker 反查（与行上那枚可辅种标记同一份判据），认不出站点的照算进产出，
 *    只是那一栏报不出；
 * ③ 「在做种」吃的是下载器报的状态，不是「数据下完了」—— 下完但暂停着的不产出魔力。
 */
import { CTorrentState, type CTorrent } from "@ptd/downloader/types.ts";
import { judgeSeedValue, type ISeedValueCopy, type ISeedValueVerdict } from "@/shared/seedValue.ts";
import { resolveTrackerHostSite, trackerFieldToHost } from "@/shared/trackerHost.ts";
import type { IReseedTaskForGroup, IRowForGroup } from "../MyClient/reseedGroups.ts";
import { assignGroups, buildTaskGroups } from "../MyClient/reseedGroups.ts";

/** 参与这一屏的一行：分组要的字段 + 时魔公式与状态各样 */
export interface ISeedValueRow extends IRowForGroup {
  tracker?: string;
  /** 数据完整（只勾了部分文件的那一份不算） */
  completed: boolean;
  /** 当前在做种 */
  seeding: boolean;
  /** 全网做种人数，报不出留 undefined */
  swarmSeeders?: number;
  /** 开始做种的 unix 秒：有完成时间用完成时间，否则用添加时间 */
  seedingSince?: number;
  totalUploaded: number;
  uploadSpeed: number;
}

/**
 * 下载器报的那一份 → 这一屏吃的那一份。
 *
 * 特意放在这一层而不是页面里：这一段是纯折叠，错了一格不报错、只让某一类内容安静地算歪
 * （把暂停的当在做种、把 0 当 1970 年），而住在 `.vue` 里就进不了 Node 断言。
 * 三条口径：
 * ① `seeding` 只认下载器报的状态，**不认「数据下完了」** —— 下完但暂停着的不产出魔力；
 * ② 开始做种的时间优先取完成时间，没有才退回添加时间；两者都是 0/非数字时给 `undefined`
 *    （qBittorrent 对没下完的种子把 `completion_on` 报成 0，那是「没有」不是 1970 年 ——
 *    当成真数的话 `Ci` 会算成 1，等于把一条昨天刚下的种子吹成年老种）；
 * ③ `completed` 用 `isCompleted`（v0.110.4 起 qBittorrent 那一路已按「选定文件全下完」判）。
 */
export function toSeedValueRows(torrents: readonly CTorrent[]): ISeedValueRow[] {
  return torrents.map((row) => {
    const completedAt = Number.isFinite(row.completedDate) && (row.completedDate ?? 0) > 0 ? row.completedDate : undefined;
    const addedAt = Number.isFinite(row.dateAdded) && row.dateAdded > 0 ? row.dateAdded : undefined;
    const seedingSince = completedAt ?? addedAt;
    return {
      key: `${row.clientId}:${row.id}`,
      clientId: row.clientId,
      name: row.name,
      totalSize: row.totalSize,
      savePath: row.savePath,
      infoHash: row.infoHash,
      tracker: row.tracker,
      completed: row.isCompleted === true,
      seeding: row.state === CTorrentState.seeding,
      swarmSeeders: row.swarmSeeders,
      ...(seedingSince === undefined ? {} : { seedingSince }),
      totalUploaded: row.totalUploaded,
      uploadSpeed: row.uploadSpeed,
    };
  });
}

/** 一行 = 一份内容 */
export interface ISeedValueItem {
  /** 组键（用于回查这一组包含哪些行） */
  key: string;
  /** 代表行的名称 */
  name: string;
  /** 合计大小（字节，取组内最大值 —— 同一份内容不重复占磁盘） */
  bytes: number;
  verdict: ISeedValueVerdict;
  /** 这一组在下载器列表里的行键，供「跳回去删」那类动作用 */
  memberKeys: string[];
}

export function buildSeedValueItems(
  rows: ISeedValueRow[],
  hostSiteEntries: Iterable<readonly [string, string]>,
  tasks: IReseedTaskForGroup[],
  now: number,
): ISeedValueItem[] {
  const groupOf = assignGroups(rows, buildTaskGroups(tasks));
  const entries = hostSiteEntries instanceof Map ? hostSiteEntries : new Map(hostSiteEntries);

  const grouped = new Map<string, ISeedValueRow[]>();
  for (const row of rows) {
    const key = groupOf.get(row.key) ?? row.key;
    const bucket = grouped.get(key);
    if (bucket) bucket.push(row);
    else grouped.set(key, [row]);
  }

  const items: ISeedValueItem[] = [];
  for (const [key, members] of grouped) {
    const copies: ISeedValueCopy[] = members.map((row) => {
      const host = trackerFieldToHost(row.tracker);
      const siteId = host ? resolveTrackerHostSite(host, entries) : undefined;
      return {
        ...(siteId ? { siteId } : {}),
        completed: row.completed,
        seeding: row.seeding,
        totalSize: row.totalSize,
        ...(row.swarmSeeders === undefined ? {} : { swarmSeeders: row.swarmSeeders }),
        ...(row.seedingSince === undefined ? {} : { seedingSince: row.seedingSince }),
        totalUploaded: row.totalUploaded,
        uploadSpeed: row.uploadSpeed,
      };
    });
    items.push({
      key,
      name: members[0]!.name,
      bytes: Math.max(...members.map((row) => (Number.isFinite(row.totalSize) ? row.totalSize : 0))),
      verdict: judgeSeedValue({ copies, now }),
      memberKeys: members.map((row) => row.key),
    });
  }
  return items;
}

/**
 * 默认序：**时魔权重从低到高**（最该考虑的排最前），同值再按名称。
 *
 * 为什么不是从高到低：这一屏的用途是「哪些可以不再做种」，人进来是来找要处理的那几条的，
 * 不是来欣赏自己保了多少好种的。要反过来看，点那一列的排序键就行。
 */
export function sortSeedValueItems(items: readonly ISeedValueItem[]): ISeedValueItem[] {
  return [...items].sort((a, b) => a.verdict.weight - b.verdict.weight || a.name.localeCompare(b.name));
}
