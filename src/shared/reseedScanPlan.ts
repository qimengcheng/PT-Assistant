/**
 * 「可辅种扫描」的**计划与判据**（纯函数，不碰网络、不碰存储）。
 *
 * 为什么要切成这一份：这一层决定「哪几站要查、用什么词查、查回来算什么结论」，
 * 判错的代价是界面对一条种子说「那个站上有 / 没有」——那是给人做决定用的话。
 * 切成零依赖的纯函数就能在 Node 里被 Vitest 直接断言（同 `reseedCandidate.ts`、
 * `fingerprint/match.ts` 的分法）， IO 那一半留在 `entrypoints/offscreen/utils/reseedScan.ts`。
 *
 * 这一层最要紧的一条是**四档不许并成两档**：
 * `no-match`（搜过、没搜到相符条目）与 `failed`（这次没查成）是两种事实，
 * 把它们都说成「没有」会把「站点挂了 / 要凭据 / 解析歪了」读成「那个站确实没这条」，
 * 于是人就不去那儿辅了 —— 那是假阴性，比不报更糟。
 */
import { buildTitleSizeKey, normalizeTitle } from "./fingerprint/title.ts";
import { toSizeBytes } from "./torrentSize.ts";
import type { ILocalTorrentFingerprintEntry } from "./fingerprint/types.ts";
import { RESEED_SCAN_FAILED_RETRY_MS, RESEED_SCAN_TTL_MS, type IReseedScanJob, type IReseedScanResult, type IReseedScanTarget, type TReseedScanVerdict } from "./types/storages/reseedScan.ts";

/** 一次要查的一对：某条内容 × 某个站 */
export interface IReseedScanPair {
  contentKey: string;
  siteId: string;
  name: string;
  /** 本地那份的字节数：候选粗筛的大小容差按它算 */
  size: number;
  /** 按顺序试的搜索词（见 `reseedScanKeywords`） */
  keywords: string[];
}

export interface IReseedScanPlan {
  pairs: IReseedScanPair[];
  /** 因为「上次查过且还在新鲜期」而跳过多少对 */
  cached: number;
  /** 计划条数超过上限被砍掉多少对 */
  truncated: number;
}

/** 内容键：与本地指纹索引那第 1 层同一个算法，两边不许各折一套 */
export function reseedScanContentKey(name: string, size: number): string {
  return buildTitleSizeKey(name, size);
}

/**
 * 把下载器里的种子名折成**按顺序试**的搜索词，最多两档，去重、去空。
 *
 * ① 原样：多数站对发布名（点分隔那串）容忍得好，先按原串试，命中率最高；
 * ② 归一核心词：`normalizeTitle` 去噪（分辨率 / 编码 / 组名 / 声道那一串）。
 *    这一档是给「站点那边写的是干净片名、下载器里是发布名」那种形状准备的。
 *
 * 第一档搜到相符条目就不再发第二档（省一次请求）；两档都没结果才敢记 `no-match` ——
 * 只按一档词判「没搜到」是把「我的词不对」说成「那个站没有」。
 */
export function reseedScanKeywords(name: string): string[] {
  const raw = (name ?? "").trim();
  const folded = normalizeTitle(raw);
  const out: string[] = [];
  if (raw) out.push(raw);
  // 第二档只在「真的折掉了东西」时才发：`normalizeTitle` 必然转小写，所以光差大小写的两串
  // 是同一次查询（站点搜索不分大小写），发出去就是白烧一次请求配额。
  if (folded && folded !== raw.toLowerCase()) out.push(folded);
  return out;
}

/** 缓存键：一对内容 × 站一条记录 */
export function reseedScanResultId(contentKey: string, siteId: string): string {
  return `${contentKey}\u0000${siteId}`;
}

/**
 * 上次查过的结论还在新鲜期里吗。
 *
 * `failed` 那一档单独用一条短得多的间隔（`RESEED_SCAN_FAILED_RETRY_MS`）：它没有产出任何结论，
 * 拿七天那份新鲜期冻住 = 一个站今天坏了，这批条目在它那儿七天都不会再被问一次。
 * 调用方给的 `ttlMs` 只用来**收紧**（取 min），不许把它放宽成比七天更长。
 *
 * 另外两档「该站有这条」/「标题相符」**必须带着可发送的那一半才算新鲜**：v0.109.0 之前的记录
 * 只存了标题与大小，拿它建不出任务（缺站点条目号与下载链接）。判成新鲜就会留下一屏查得到、
 * 却点不动的「一键辅种」—— 让它不新鲜，下一次扫描就自动重查那几对、把缺的那半补上。
 */
export function isReseedScanFresh(result: IReseedScanResult | undefined, now: number, ttlMs = RESEED_SCAN_TTL_MS): boolean {
  if (!result) return false;
  if ((result.verdict === "has-it" || result.verdict === "suspect") && !result.site?.title) return false;
  const limit = result.verdict === "failed" ? Math.min(ttlMs, RESEED_SCAN_FAILED_RETRY_MS) : ttlMs;
  return now - result.at < limit;
}

/**
 * 排出这一轮要发哪些查询。
 *
 * 跳过三类：已经挂在的那个站（查了也是白查）、用户没添加 / 标了离线的站（不在目标集里）、
 * 新鲜期内查过的对子（直接复用上次结论）。
 * 上限那条是硬闸：一次扫描发的请求数是要吃站点频率限制的，不能让人一口气点出几千次。
 */
export function planReseedScan(input: {
  targets: IReseedScanTarget[];
  usableSites: string[];
  cache: Map<string, IReseedScanResult>;
  now?: number;
  maxPairs?: number;
  ttlMs?: number;
}): IReseedScanPlan {
  const { targets, usableSites, cache } = input;
  const now = input.now ?? Date.now();
  const ttlMs = input.ttlMs ?? RESEED_SCAN_TTL_MS;
  const maxPairs = input.maxPairs;

  const pairs: IReseedScanPair[] = [];
  let cached = 0;

  for (const target of targets) {
    const keywords = reseedScanKeywords(target.name);
    // 一个词都折不出来（空标题之类）就别发请求：发了只会得到一个假的「没搜到」
    if (keywords.length === 0) continue;
    for (const siteId of usableSites) {
      if (target.knownSites.includes(siteId)) continue;
      const id = reseedScanResultId(target.contentKey, siteId);
      if (isReseedScanFresh(cache.get(id), now, ttlMs)) {
        cached++;
        continue;
      }
      pairs.push({ contentKey: target.contentKey, siteId, name: target.name, size: target.size, keywords });
    }
  }

  // 上限是硬闸，砍掉的数量要如实报给界面（「还有 N 对没查」），不能让人以为查完了
  const kept = maxPairs === undefined ? pairs : pairs.slice(0, maxPairs);
  return { pairs: kept, cached, truncated: pairs.length - kept.length };
}

/**
 * 从本地指纹索引里找出「和这一条是同一份内容」的全部副本。
 *
 * 先按第 1 层 key 收一遍，再把这些副本的文件清单指纹并进来捞第二遍 —— 因为同一份内容
 * 在不同站点发布时**标题写法不一样**（v0.105.4 那条同族：一份内容在下载器里往往有好几份副本），
 * 只按 key 收会漏掉改了名的副本，于是候选验文件时对不上、把一个真实存在的辅种机会报成「没搜到」。
 * 没有文件清单指纹的副本只可能由第一遍收进来（不能凭「大小差不多」认领）。
 */
export function reseedScanLocalGroup(
  entries: ILocalTorrentFingerprintEntry[],
  target: { name: string; size: number },
): ILocalTorrentFingerprintEntry[] {
  const key = reseedScanContentKey(target.name, target.size);
  const byKey = entries.filter((entry) => (entry.titleKey || reseedScanContentKey(entry.name, entry.size)) === key);
  const fingerprints = new Set(byKey.map((entry) => entry.files?.fingerprint).filter(Boolean) as string[]);
  if (fingerprints.size === 0) return byKey;
  return entries.filter(
    (entry) =>
      (entry.titleKey || reseedScanContentKey(entry.name, entry.size)) === key ||
      (entry.files?.fingerprint !== undefined && fingerprints.has(entry.files.fingerprint)),
  );
}

/** 候选是靠哪一层被筛进来的；强度 titleSize > title > size */
export type TReseedScanScreenTier = "titleSize" | "title" | "size";

/** 站点列表页上的一条（只需要这两列，别的字段这一层不碰） */
export interface IReseedScanSiteItem {
  title?: string;
  size?: number;
}

export interface IReseedScanCandidate<T> {
  item: T;
  tier: TReseedScanScreenTier;
}

/**
 * 大小容差比例 0.02 —— 与 `fingerprint/localBase.ts` 那条同一个数，两处不许各定一套：
 * 站点列表页那一格是约数（`2.43 GiB` 这种），和种子真实字节差几 MB 是常态。
 * ⚠️ 容差**只用来筛候选**，不用来下结论；下结论靠文件清单指纹那一步。
 */
export const RESEED_SCAN_SIZE_TOLERANCE_RATIO = 0.02;

/** 一轮最多下几条候选的 .torrent 去验文件（每条都要真下载一次种子，不能敞开） */
export const RESEED_SCAN_VERIFY_MAX = 2;

/**
 * 列表页粗筛：把搜索回来的条目折成候选。
 *
 * 为什么不用 `fingerprint/match.ts` 的 `screenByTitleSizeKey`：那条按「归一标题 + **字节精确**」
 * 比第 1 层 key，站点那一格给的是约数，字节对不上就整个不命中 —— 用在辅种检测那种「本地已有一条
 * 基准、要比指纹」的场景是对的，用在这里会把「有这条」大面积筛成「没搜到」。
 * 这里改成标题归一相等**或**大小在容差内，两种信号任一命中即进候选，判定仍然交给文件清单那一步。
 */
export function reseedScanScreen<T extends IReseedScanSiteItem>(
  items: T[],
  target: { name: string; size: number },
  options: { toleranceRatio?: number; max?: number } = {},
): IReseedScanCandidate<T>[] {
  const targetTitle = normalizeTitle(target.name);
  const targetSize = toSizeBytes(target.size);
  const tolerance = Math.max(1, (targetSize ?? 0) * Math.max(0, options.toleranceRatio ?? RESEED_SCAN_SIZE_TOLERANCE_RATIO));
  const max = options.max ?? RESEED_SCAN_VERIFY_MAX;

  const scored: { item: T; tier: TReseedScanScreenTier }[] = [];
  for (const item of items) {
    const titleHit = targetTitle !== "" && normalizeTitle(item.title) === targetTitle;
    const itemSize = toSizeBytes(item.size);
    const sizeHit = targetSize !== null && itemSize !== null && Math.abs(itemSize - targetSize) <= tolerance;
    if (titleHit && sizeHit) scored.push({ item, tier: "titleSize" });
    else if (titleHit) scored.push({ item, tier: "title" });
    else if (sizeHit) scored.push({ item, tier: "size" });
  }

  const order: Record<TReseedScanScreenTier, number> = { titleSize: 0, title: 1, size: 2 };
  return scored.sort((a, b) => order[a.tier] - order[b.tier]).slice(0, max);
}

/** 一次查询的产出 → 四档结论的输入 */
export interface IReseedScanOutcome {
  /** 这一对到底发出了几次搜索（0 = 一次都没发成，属于查不成而不是没搜到） */
  requestsSent: number;
  /**
   * 这一对**有没有一次都没查成**。
   *
   * 由调用方折好：搜索请求报错、或解析层回了不可信的状态（要登录 / 要凭据 / 被 CF 挡 / 解析失败）
   * 都算没查成；只要有一档词查成了（哪怕结果里没有相符条目），这里就是 false。
   */
  requestFailed: boolean;
  /** 标题+大小对上的候选条数 */
  candidates: number;
  /** 有没有把候选的 .torrent 拿下来比过文件清单 */
  filesCompared: boolean;
  /** 比过的话，是不是同一份数据 */
  filesMatched?: boolean;
  /** 没验成文件时的一句话原因 */
  note?: string;
}

/**
 * 把事实折成人读的那一档。
 *
 * 输入是调用方（offscreen 那一层）已经做完的事：搜过哪些词、有没有候选、有没有下 .torrent 验成；
 * 这个函数只负责折档，**不许在这里补新判据**。
 */
export function reseedScanVerdict(input: IReseedScanOutcome): { verdict: TReseedScanVerdict; note?: string } {
  if (input.requestsSent === 0 || input.requestFailed) {
    return { verdict: "failed", note: input.note };
  }
  if (input.candidates === 0) {
    return { verdict: "no-match", note: input.note };
  }
  // 有候选：验过文件就按验的结果说话
  if (input.filesCompared) {
    return input.filesMatched ? { verdict: "has-it", note: input.note } : { verdict: "no-match", note: input.note };
  }
  // 没验成文件（本地算不出清单、或候选那条下不下来）：只能说「相符，未验文件」
  return { verdict: "suspect", note: input.note };
}

/**
 * 「存储里写着在跑」与「这一份 offscreen 里真的有一轮在跑」两件事的**对账**。
 *
 * 为什么要这一处（用户 2026-10-19：「现在一打开这个界面这里就转圈圈，点停止也没反应」）：
 * 一轮扫描的**身份**（谁在跑、怎么叫停）是 offscreen 模块里的一个变量，而**进度**落在
 * `chrome.storage` 的 `reseedScan` 键上 —— 一份事实写两处，其中一处没人回收。插件更新 / 重载
 * （他今天就装了 v0.113.1 与 v0.114.0 两次）会把 offscreen 连内存一起清掉，那一轮真的没了，
 * 存储里那句 `running` 却永远留着。于是这一屏死锁：界面读到 running 就以为在跑 ⇒「开始扫描」
 * 转圈且点下去直接早退，「停止」把 `cancel()` 发给一个已经不存在的对象 ⇒ 什么都不动。
 * 不是「进度慢」：站点请求本身有 30 秒上限（`AbstractBittorrentSite` 给 axios 兜的 timeout），
 * 真在跑的一轮不会长时间一格不动。
 *
 * 判据是**单向**的：只有「存储说 running **且**场上确实没有那一轮」才改判，改完写成
 * `stopped + interrupted`（那句「已中断」是给界面看的，不许写成「已停止」—— 那不是人叫停的）；
 * 其余一切情况**原样返回同一个对象**，让调用方拿引用相等就能判「有没有改过」。
 * 反过来（场上有轮、存储说没跑）不在这条路上：那种状态下一轮自己会写回来。
 */
export function reconcileReseedScanJob(
  stored: IReseedScanJob | null,
  liveRound: boolean,
  now: number,
): IReseedScanJob | null {
  if (!stored || stored.status !== "running" || liveRound) return stored;
  // 一份新对象，不许就地改传进来那一份：调用方靠「引用变了没有」决定要不要写回存储
  const healed: IReseedScanJob = { ...stored };
  healed.status = "stopped";
  healed.interrupted = true;
  healed.finishedAt = now;
  // 那两格说的是「正在查哪一对」，轮次已经没了，留着会让界面继续点名一个不存在的查询
  healed.currentSite = undefined;
  healed.currentName = undefined;
  return healed;
}
