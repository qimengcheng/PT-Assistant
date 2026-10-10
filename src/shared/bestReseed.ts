/**
 * 「最佳辅种」的挑法：一批搜索结果里，被**最多站点同时收录**的那一份。
 *
 * 为什么要这一层：一次搜索同一个内容会在几十个站点上各出一条，站点之间是**同一份数据**
 * （同一批 .torrent 转发的），下载任意一条就能给其余各站辅种。用户要自己按大小列排序、
 * 扫一遍看哪一档重复最多、再逐条勾上 —— 这一步替他做掉。
 *
 * 判据是**字节数完全相同**，不是"差不多大"：
 *  - 同一份数据在不同站上大小报得一模一样（都是那串 bytes），这是辅种的前提；
 *  - 同一片内容的不同压制（56.72 GiB / 56.58 GiB）大小必然不同，而它们**不是**同一份数据，
 *    放一起辅种会被第 2 层指纹判成数据不符。所以这里宁可漏，不许近似。
 *
 * 站点数要**去重**：同一次搜索里一个站点可能经多个入口返回同一条（不同 key 的搜索入口、
 * 或结果被合并进来两次），不去重会把「1 个站发了 3 条」报成「3 个站都有」。
 *
 * 纯判据，不碰界面也不碰浏览器 API —— 行为断言直接 import 这个文件跑（见 .tmp-build 里的
 * best-reseed-test.mjs），同族先例 `src/shared/reseedRecommend.ts`。
 */

/** 一行结果里这一判据要吃的字段（ISearchResultTorrent 的结构子集，方便单测造夹具） */
export interface IReseedGroupRow {
  site?: string;
  size?: number | string | null;
}

export interface IReseedGroup<T> {
  /** 这一组的字节数 */
  size: number;
  /** 组内结果，顺序沿用传进来的顺序（界面上就是列表顺序，不重排） */
  items: T[];
  /** 去重后的站点数 */
  siteCount: number;
}

/**
 * 站点报的大小：类型写的是 `size?: number`，但解析层是从页面文本来的，运行时可能是数字串。
 * 只认能落成正有限数的值，其余（缺字段 / 0 / NaN / "56.58 GiB" 这种带单位的）一律不参与分组。
 */
export function toSizeBytes(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * 找出被最多站点共有的一份；没有任何一档被 ≥2 个站点共有时返回 null（没得辅种，提示就不出）。
 * 并列时先比条数、再比大小（大的那份重下一次的代价更高，更值得辅）。
 */
export function findBestReseedGroup<T extends IReseedGroupRow>(rows: T[] | null | undefined): IReseedGroup<T> | null {
  const bySize = new Map<number, T[]>();
  for (const row of rows ?? []) {
    if (!row || typeof row !== "object") continue;
    const size = toSizeBytes(row.size);
    if (size === null) continue;
    const list = bySize.get(size);
    if (list) list.push(row);
    else bySize.set(size, [row]);
  }

  let best: IReseedGroup<T> | null = null;
  for (const [size, items] of bySize) {
    const sites = new Set<string>();
    for (const item of items) {
      const site = String(item.site ?? "");
      if (site) sites.add(site);
    }
    const siteCount = sites.size;
    if (siteCount < 2) continue;
    if (
      !best ||
      siteCount > best.siteCount ||
      (siteCount === best.siteCount &&
        (items.length > best.items.length || (items.length === best.items.length && size > best.size)))
    ) {
      best = { size, items, siteCount };
    }
  }
  return best;
}
