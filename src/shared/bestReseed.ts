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
 *
 * 对外两个出口：{@link findBestReseedGroup} 给工具条那颗 chip（只要最值得的那一档），
 * {@link findAllReseedGroups} 给「更多」那一屏（把每一档都列出来让人挑 —— 最佳那档
 * 常常是体积最大的一份，重下一次代价太高时用户想换小一档）。
 */

/** 一行结果里这一判据要吃的字段（ISearchResultTorrent 的结构子集，方便单测造夹具） */
export interface IReseedGroupRow {
  site?: string;
  size?: number | string | null;
  /**
   * 站点报的做种状态（`ETorrentStatus` 那几个字符串值）。
   * 类型留 `unknown`：这是解析层从页面文本来的，缺字段 / 空串 / `"unknown"` 都是常态
   * （全仓只有 37/340 个站点定义报得出这一列），判据不许拿它当 boolean。
   */
  status?: unknown;
}

/** `ETorrentStatus.seeding` 的字面值。不 import 那个枚举：它在 `@ptd/site` 根入口那条桶链上 */
export const SEEDING_STATUS = "seeding";

/** 这一条被站点报成「正在做种」吗 —— 只认这一个值，`completed`（完成未做种）不算 */
export function isSeedingStatus(status: unknown): boolean {
  return status === SEEDING_STATUS;
}

/** `ETorrentStatus` 里那四个「报得出内容」的值（`unknown` 不在内） */
const KNOWN_STATUSES = new Set(["downloading", "seeding", "inactive", "completed"]);

/**
 * 这一条报得出做种状态吗。`unknown` 是枚举里那个「状态不明」，认不出的值同理 —— 都不算报得出，
 * 否则界面上会出现「这一组 0 条在做种」这种其实什么都没查到的读数。
 */
export function isStatusKnown(status: unknown): boolean {
  return typeof status === "string" && KNOWN_STATUSES.has(status);
}

export interface IReseedGroup<T> {
  /** 这一组的字节数 */
  size: number;
  /** 组内结果，顺序沿用传进来的顺序（界面上就是列表顺序，不重排） */
  items: T[];
  /** 去重后的站点数 */
  siteCount: number;
  /**
   * 组里有几条被站点报成「正在做种」。>0 意味着这份数据已经在盘上、且我们已经在给某一站做种 ——
   * 挑这一档辅种时其余各站都是纯辅，不用重下一次（用户 2026-10-11 要求把这种档排在前面）。
   */
  seedingCount: number;
  /** 这一组有没有**任何**一条报得出状态；false 时界面上那一格留空，不画 0 */
  statusKnown: boolean;
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
 * 所有可辅种的一档一档，按「最值得辅」从前往后排在第一位。
 *
 * 排序就是 {@link findBestReseedGroup} 原来那套并列判据（站点数 → 条数 → 大小），
 * 完全并列时保留输入顺序 —— 与旧版「先遇到者赢」一字不差，所以 `[0]` 恒等于旧版的最佳那档。
 * 界面上「更多」列的是这整个数组，chip 上写的是它的第 0 项。
 */
export function findAllReseedGroups<T extends IReseedGroupRow>(rows: T[] | null | undefined): IReseedGroup<T>[] {
  const bySize = new Map<number, T[]>();
  for (const row of rows ?? []) {
    if (!row || typeof row !== "object") continue;
    const size = toSizeBytes(row.size);
    if (size === null) continue;
    const list = bySize.get(size);
    if (list) list.push(row);
    else bySize.set(size, [row]);
  }

  const groups: IReseedGroup<T>[] = [];
  for (const [size, items] of bySize) {
    const sites = new Set<string>();
    let seedingCount = 0;
    let statusKnown = false;
    for (const item of items) {
      const site = String(item.site ?? "");
      if (site) sites.add(site);
      if (isSeedingStatus(item.status)) seedingCount++;
      // 「报得出」要按整组求或：一条报得出、另一条缺字段，这一档仍然判得出有没有在做种
      if (isStatusKnown(item.status)) statusKnown = true;
    }
    // 只有一站收录的没有辅种价值（辅的是别的站），不进列表
    if (sites.size < 2) continue;
    groups.push({ size, items, siteCount: sites.size, seedingCount, statusKnown });
  }

  return groups.sort((a, b) => b.siteCount - a.siteCount || b.items.length - a.items.length || b.size - a.size);
}

/**
 * 找出被最多站点共有的一份；没有任何一档被 ≥2 个站点共有时返回 null（没得辅种，提示就不出）。
 * 并列时先比条数、再比大小（大的那份重下一次的代价更高，更值得辅）。
 */
export function findBestReseedGroup<T extends IReseedGroupRow>(rows: T[] | null | undefined): IReseedGroup<T> | null {
  return findAllReseedGroups(rows)[0] ?? null;
}
