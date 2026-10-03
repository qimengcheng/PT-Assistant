/**
 * 指纹匹配与保守决策。
 *
 * 三层证据的强度完全不同，所以判定顺序也是固定的：
 *
 *   第 3 层 piece 抽样（能比就比，是权威证据）
 *     ↓ 没有 piece 证据
 *   第 2 层 文件清单指纹（主力；命中 = 本地已有同一份数据）
 *     ↓ 算不出文件清单指纹
 *   第 1 层 标题 + 大小（只算候选）
 *
 * **误判代价是不对称的**：把 B 站的种子加进去，qBittorrent 校验发现数据不对
 * → 重新下载 → 在 PT 站直接把分享率打到负数，比少辅一个种子的伤害大得多。
 * 所以这里的每一条规则都朝着「宁可判不出来」的方向写。
 */

import { comparePieceSamples } from "./pieces.ts";
import { buildTitleSizeKey, parseTitleSizeKey } from "./title.ts";
import type {
  IFingerprintComparable,
  IFingerprintMatchResult,
  IFingerprintPolicyDecision,
  IFingerprintPolicyInput,
  ILocalFingerprintIndex,
  ILocalTorrentFingerprintEntry,
  TFingerprintMatchedBy,
  TFingerprintVerdict,
} from "./types.ts";

/** 本地索引的查找结构（构建一次，之后每次匹配都是纯查表） */
export interface IFingerprintIndexLookup {
  entries: ILocalTorrentFingerprintEntry[];
  /** 第 2 层：文件清单指纹 → 本地种子 */
  byFiles: Map<string, ILocalTorrentFingerprintEntry[]>;
  /** 第 1 层：标题+大小 key → 本地种子 */
  byTitleKey: Map<string, ILocalTorrentFingerprintEntry[]>;
  /** 退化用：大小 → 本地种子 */
  bySize: Map<number, ILocalTorrentFingerprintEntry[]>;
  /** 算出了第 2 层指纹的条目数（为 0 说明客户端不支持，只能退化到第 1 层） */
  comparableCount: number;
}

function pushTo<T>(map: Map<T, ILocalTorrentFingerprintEntry[]>, key: T, entry: ILocalTorrentFingerprintEntry) {
  const list = map.get(key);
  if (list) {
    list.push(entry);
  } else {
    map.set(key, [entry]);
  }
}

/**
 * 为本地条目建立查找表。
 *
 * 传索引对象（`ILocalFingerprintIndex`）或直接传条目数组都行 —— 拿单个已知的
 * 种子当「比对基准」时（辅种检测里拿基准种子去比其它站点）传数组更方便。
 */
export function buildFingerprintIndexLookup(
  index: ILocalFingerprintIndex | ILocalTorrentFingerprintEntry[] | null | undefined,
): IFingerprintIndexLookup {
  const lookup: IFingerprintIndexLookup = {
    entries: Array.isArray(index) ? index : (index?.entries ?? []),
    byFiles: new Map(),
    byTitleKey: new Map(),
    bySize: new Map(),
    comparableCount: 0,
  };

  for (const entry of lookup.entries) {
    if (entry.files?.fingerprint) {
      pushTo(lookup.byFiles, entry.files.fingerprint, entry);
      lookup.comparableCount++;
    }
    if (entry.titleKey) {
      pushTo(lookup.byTitleKey, entry.titleKey, entry);
    }
    pushTo(lookup.bySize, Math.round(entry.size ?? 0), entry);
  }

  return lookup;
}

export interface IFingerprintMatchOptions {
  /** 只拿「已完成」的本地条目参与匹配（默认 false） */
  requireCompleted?: boolean;
  /** 只拿挂在这些站点上的本地条目参与匹配 */
  sites?: string[];
}

/** 按条件筛出参与比对的本地条目（同时给出可快速判断「有没有可比条目」的数量） */
function pickComparableEntries(lookup: IFingerprintIndexLookup, options: IFingerprintMatchOptions) {
  const { requireCompleted = false, sites } = options;

  const entries = lookup.entries.filter((entry) => {
    if (requireCompleted && !entry.isCompleted) {
      return false;
    }
    if (sites?.length) {
      return (entry.sites ?? []).some((site) => sites.includes(site));
    }
    return true;
  });

  return {
    entries,
    entrySet: new Set(entries),
    comparableCount: entries.reduce((count, entry) => count + (entry.files?.fingerprint ? 1 : 0), 0),
  };
}

/**
 * 把一个站点侧种子与本地索引做比对。
 *
 * 判定规则（保守版）：
 * - 有第 2 层指纹且命中 → `identical`（若 piece 抽样反而不同，降级为 `different`）
 * - 有第 2 层指纹、本地也有可比条目但没命中 → `different`
 * - 算不出第 2 层 → 退化到第 1 层，命中也只是 `candidate`
 * - 本地一条可比条目都没有 → `unavailable`（拿不到证据，不构成任何结论）
 */
export function matchLocalFingerprint(
  target: IFingerprintComparable,
  lookup: IFingerprintIndexLookup,
  options: IFingerprintMatchOptions = {},
): IFingerprintMatchResult {
  const { entries, entrySet, comparableCount } = pickComparableEntries(lookup, options);

  const empty = (verdict: TFingerprintVerdict, matchedBy: TFingerprintMatchedBy = "none"): IFingerprintMatchResult => ({
    verdict,
    matchedBy,
    comparedCount: comparableCount,
  });

  if (entries.length === 0) {
    return empty("unavailable");
  }

  // ── 第 2 层（有文件清单指纹才走这条路）──
  const filesFingerprint = target.files?.fingerprint;
  if (filesFingerprint) {
    const matched = (lookup.byFiles.get(filesFingerprint) ?? []).filter((entry) => entrySet.has(entry));
    if (matched.length > 0) {
      const match = matched[0] as ILocalTorrentFingerprintEntry;
      // 能比 piece 就比：抽样都对不上，文件清单相同也只能算巧合
      const pieces = target.pieces && match.pieces ? comparePieceSamples(target.pieces, match.pieces) : undefined;
      return {
        verdict: pieces === "mismatch" ? "different" : "identical",
        matchedBy: "files",
        match,
        comparedCount: comparableCount,
        pieces,
      };
    }
    // 本地有第 2 层数据却没命中 → 确定不是同一份数据
    return comparableCount > 0 ? empty("different", "files") : empty("unavailable");
  }

  // ── 第 1 层（退化：只有标题 + 大小）──
  if (target.titleKey) {
    const { titleKey } = parseTitleSizeKey(target.titleKey);
    const matched = (lookup.byTitleKey.get(target.titleKey) ?? []).filter((entry) => entrySet.has(entry));
    if (matched.length > 0) {
      return {
        verdict: "candidate",
        matchedBy: "titleSize",
        match: matched[0],
        comparedCount: comparableCount,
      };
    }
    // 标题里没有可用信息（如全中文名被剥空）时，退化成「只按大小」
    if (titleKey === "" && target.size) {
      const sizeMatched = (lookup.bySize.get(Math.round(target.size)) ?? []).filter((entry) => entrySet.has(entry));
      if (sizeMatched.length > 0) {
        return {
          verdict: "candidate",
          matchedBy: "size",
          match: sizeMatched[0],
          comparedCount: comparableCount,
        };
      }
    }
  }

  // 本地一条可比条目都没有：没有证据可用，不构成任何结论
  return comparableCount > 0 ? empty("absent") : empty("unavailable");
}

/**
 * 列表页粗筛：只用第 1 层（标题 + 大小）挑出候选。
 *
 * 这是唯一能在**不下载 .torrent** 的前提下工作的层，用来做「先别急着把这几百条
 * 都下载下来算指纹」的预筛。命中的只是候选，能不能辅还要看第 2 层。
 */
export interface ITitleScreenCandidate<T> {
  item: T;
  matchedBy: TFingerprintMatchedBy;
  /** 命中的本地条目（可能不止一条） */
  matched: ILocalTorrentFingerprintEntry[];
}

export function screenByTitleSizeKey<T extends { title?: string; size?: number }>(
  items: T[],
  lookup: IFingerprintIndexLookup,
  options: { sizeTolerance?: number; requireCompleted?: boolean } = {},
): ITitleScreenCandidate<T>[] {
  const sizeTolerance = Math.max(0, options.sizeTolerance ?? 0);
  const pool = lookup.entries.filter((entry) => !options.requireCompleted || entry.isCompleted);
  if (pool.length === 0) {
    return [];
  }

  const candidates: ITitleScreenCandidate<T>[] = [];

  for (const item of items) {
    const titleKey = buildTitleSizeKey(item.title, item.size);
    const matched = pool.filter((entry) => entry.titleKey === titleKey);
    if (matched.length > 0) {
      candidates.push({ item, matchedBy: "titleSize", matched });
      continue;
    }

    // 标题完全对不上（不同站点的标题写法差异很大）时，再退化到「只按大小」
    const size = Math.round(item.size ?? 0);
    if (size > 0) {
      const sizeMatched = pool.filter((entry) => Math.abs(Math.round(entry.size ?? 0) - size) <= sizeTolerance);
      if (sizeMatched.length > 0) {
        candidates.push({ item, matchedBy: "size", matched: sizeMatched });
      }
    }
  }

  return candidates;
}

/**
 * 把匹配结论翻译成「加 / 人工确认 / 排除」。
 *
 * 与需求里的三条规则一一对应：
 * - 第 1 层命中 → `review`（只算候选，绝不直接加）
 * - 第 2 层命中 → `exclude` + `suggestPieceVerify`（高度可信，但仍建议抽样验 piece）
 * - 只有本地没有任何可比指纹时才可能落到 `add`（`no-local-fingerprint`）
 *
 * 另外单独看 tracker：`match.sites` 里有目标站点，说明这份数据已经挂在那个站上，
 * 从根上避免把同一站的东西再辅一遍。
 */
export function decideFingerprintAction(input: IFingerprintPolicyInput): IFingerprintPolicyDecision {
  const { match, site, existingSites, piecesPolicy = "trust-files" } = input;

  // tracker 已经挂在同一站点上了 —— 无论指纹结论如何，都不必再辅一遍
  const sites = existingSites ?? match.match?.sites ?? [];
  if (site && sites.includes(site)) {
    return { action: "exclude", reason: "same-site-already", suggestPieceVerify: false };
  }

  switch (match.verdict) {
    case "identical": {
      // piece 抽样都对不上，文件清单相同只能是巧合 → 判为「不是同一份数据」
      if (match.pieces === "mismatch") {
        return { action: "add", reason: "verified-different", suggestPieceVerify: false };
      }
      if (match.pieces === "match") {
        return { action: "exclude", reason: "local-identical", suggestPieceVerify: false };
      }
      // 第 2 层命中但没有 piece 证据：默认相信第 2 层，但要提示可以抽样验
      if (piecesPolicy === "review") {
        return { action: "review", reason: "local-identical", suggestPieceVerify: true };
      }
      return { action: "exclude", reason: "local-identical", suggestPieceVerify: true };
    }
    case "different":
      return { action: "add", reason: "verified-different", suggestPieceVerify: false };
    case "candidate":
      // 第 1 层命中：只算候选 —— 既不加，也不排除
      return { action: "review", reason: "title-only-candidate", suggestPieceVerify: true };
    case "absent":
      return { action: "add", reason: "no-local-fingerprint", suggestPieceVerify: false };
    case "unavailable":
    default:
      return { action: "review", reason: "no-local-fingerprint", suggestPieceVerify: false };
  }
}

/**
 * 收益评估：swarm 里已经一堆种的冷门种，辅它收益低、还占带宽。
 *
 * 只做提示，不参与 add/exclude 判定 —— 让用户自己决定。
 */
export function isLowValueCrossSeed(
  entry: ILocalTorrentFingerprintEntry | undefined,
  threshold: number = 5,
): boolean {
  if (!entry || entry.seedsInSwarm === undefined) {
    return false;
  }
  return entry.seedsInSwarm >= threshold;
}