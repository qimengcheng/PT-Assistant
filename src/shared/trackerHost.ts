/**
 * tracker 主机名与站点主机名之间的关系判据。
 *
 * 为什么要单独一份、且写成纯函数：下载器里那条种子挂在哪个站上，只能拿 announce 的主机名去反查
 * 站点（见 `src/entrypoints/offscreen/utils/fingerprint.ts` 的 `matchSitesByTrackerHosts`）。
 * 原先那一步是**精确等值**，而 PT 站的 announce 常常不在站点首页那个域名上，而在它的子域里 ——
 * 实测形状：PandaPT 首页是 `pandapt.net`，announce 是 `tracker.pandapt.net`（用户 2026-10-15 的
 * 「种子详情 → Tracker 列表」）。于是那一份副本反解出的站点是空的，辅种检测里它这一行就不标「做种中」，
 * 站点名那一行也少一个站（同一个形状在 NovaHD 上不存在，因为它的定义里已经把 `tracker.novahd.top`
 * 一起列进 `urls` 了）。
 *
 * 这条判据不许 import 任何东西：反查发生在 offscreen，而行为断言要能在 Node 里直接跑。
 */

/**
 * 两个主机名是不是「同一个域名的父子关系」（含相等）。
 *
 * 必须按 **label 边界** 比，不能拿子串比：`evilpandapt.net` 不是 `pandapt.net` 的子域，
 * 而 `tracker.pandapt.net` 是。所以补的是前面那个点，不是 `endsWith(host)` 了事。
 * 反方向同样要认：站点存的是 `pt.novahd.top` 而 announce 是 `novahd.top` 时也是同一个站。
 */
export function isSameSiteHostRelation(a: string, b: string): boolean {
  if (!a || !b) return false;
  return a === b || b.endsWith(`.${a}`) || a.endsWith(`.${b}`);
}

/**
 * 从「主机名 → 站点」表里反查一个 tracker 主机名属于哪个站。
 *
 * 两档，顺序固定：
 * 1. 精确等值 —— 认得上就直接是它，不进入歧义判断；
 * 2. 父子域兜底 —— **只有唯一一个站点认得上时才认**。两个站点的域名都跟这个主机名有父子关系时
 *    （同域站群、或有人把同一个域名的两个子域加成两个站）不猜，返回 null。
 *
 * 方向是刻意的：认不出只是少标一条「做种中」（假阴性），认错站会把「这一站已经在做种」的结论
 * 安到另一个站头上，那才是不能犯的错。
 */
export function resolveTrackerHostSite<TSiteId>(
  host: string,
  hostSiteEntries: Iterable<readonly [string, TSiteId]>,
): TSiteId | null {
  const exact = new Map<string, TSiteId>();
  const parents = new Set<TSiteId>();
  for (const [knownHost, siteId] of hostSiteEntries) {
    if (!knownHost) continue;
    exact.set(knownHost, siteId);
    if (knownHost !== host && isSameSiteHostRelation(host, knownHost)) parents.add(siteId);
  }
  const direct = exact.get(host);
  if (direct !== undefined) return direct;
  return parents.size === 1 ? [...parents][0] : null;
}
