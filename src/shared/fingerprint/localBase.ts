/**
 * 「基准种子在下载器里」时的候选挑选。
 *
 * 场景：只勾中一颗站点种子来辅种 —— 数据早就在下完的那颗种子里了，本任务里没有第二条
 * 可以拿来当基准，所以基准只能去下载器里找。这一步挑的就是「下载器里哪几条有可能是这份数据」。
 *
 * 判据沿用 src/shared/fingerprint/types.ts 顶上那张分层表的口径，**保守优先**：
 * 误判基准的代价不对称 —— 拿错数据去挂这一站，校验要么重下（分享率打负）要么报做种失败。
 * 所以：
 * - 只有第 2 层（文件清单指纹）命中才允许**自动**选中；
 * - 只到第 1 层（标题+大小 / 单大小）的一律列出来给人看、由人挑，脚本不替人决定；
 * - 目标侧算得出文件清单指纹时，本地那些「算得出但不同」的条目直接排除（确定不是同一份），
 *   而「算不出」（客户端不支持导出文件清单 / 请求失败）的不能排除，只能降级成第 1 层候选。
 */

import type { IFingerprintComparable, ILocalFingerprintIndex, ILocalTorrentFingerprintEntry, TPieceCompareResult } from "./types.ts";
import { comparePieceSamples } from "./pieces.ts";

/** 候选是靠哪一层被挑进来的；强度 files > titleSize > size */
export type TLocalBaseMatchTier = "files" | "titleSize" | "size";

export interface ILocalBaseCandidate {
  entry: ILocalTorrentFingerprintEntry;
  tier: TLocalBaseMatchTier;
  /** 两边都有 piece 抽样时的比对结果；只有一边有 = undefined */
  pieces?: TPieceCompareResult;
  /** 与目标大小的字节差（绝对值），用于同档内排序与界面提示 */
  sizeDelta: number;
}

export interface IPickLocalBaseOptions {
  /**
   * 大小容差比例，默认 0.02。
   *
   * 为什么要有容差：站点列表页给的大小往往是约数（2.43 GiB 这种），和种子真实
   * info.length 差几 MB。容差只用来**筛候选**，不用来下结论 —— 下结论靠第 2 层。
   */
  sizeToleranceRatio?: number;
}

const TIER_ORDER: Record<TLocalBaseMatchTier, number> = { files: 0, titleSize: 1, size: 2 };

function toEntries(
  index: ILocalFingerprintIndex | ILocalTorrentFingerprintEntry[] | null | undefined,
): ILocalTorrentFingerprintEntry[] {
  return Array.isArray(index) ? index : (index?.entries ?? []);
}

/**
 * 从下载器的本地索引里挑出「可能就是要辅的那份数据」的条目，按证据强度排好。
 *
 * 未完成的一律不进：progress 不到 100 的种子没有全套数据，拿它当基准就是必爆仓。
 */
export function pickLocalBaseCandidates(
  target: IFingerprintComparable,
  index: ILocalFingerprintIndex | ILocalTorrentFingerprintEntry[] | null | undefined,
  options: IPickLocalBaseOptions = {},
): ILocalBaseCandidate[] {
  const targetFp = target.files?.fingerprint;
  const targetSize = Math.round(target.size ?? 0);
  const tolerance = Math.max(1, targetSize * Math.max(0, options.sizeToleranceRatio ?? 0.02));

  const out: ILocalBaseCandidate[] = [];

  for (const entry of toEntries(index)) {
    if (!entry.isCompleted) continue;

    const sizeDelta = Math.abs(Math.round(entry.size ?? 0) - targetSize);
    const entryFp = entry.files?.fingerprint;

    // 两边都算得出文件清单：这是唯一能定案的一层，不同就是不同
    if (targetFp && entryFp) {
      if (entryFp !== targetFp) continue;
      out.push({
        entry,
        tier: "files",
        pieces: target.pieces && entry.pieces ? comparePieceSamples(target.pieces, entry.pieces) : undefined,
        sizeDelta,
      });
      continue;
    }

    // 走到这里 = 至少一边算不出文件清单，只能退到第 1 层
    if (sizeDelta > tolerance) continue;
    const tier: TLocalBaseMatchTier = target.titleKey && entry.titleKey === target.titleKey ? "titleSize" : "size";
    out.push({
      entry,
      tier,
      pieces: target.pieces && entry.pieces ? comparePieceSamples(target.pieces, entry.pieces) : undefined,
      sizeDelta,
    });
  }

  return out.sort(
    (a, b) =>
      TIER_ORDER[a.tier] - TIER_ORDER[b.tier] ||
      a.sizeDelta - b.sizeDelta ||
      a.entry.name.localeCompare(b.entry.name),
  );
}

/**
 * 该不该替用户选中某一条。
 *
 * 只有第 2 层命中、且 piece 抽样没有反证时才自动选中；抽样对不上（mismatch）说明
 * 文件清单相同只是巧合（同一套目录结构、不同内容），这种连自动选中都不许。
 * 第 1 层的候选一律返回 null —— 由人在下拉里自己挑。
 */
export function autoSelectLocalBase(candidates: ILocalBaseCandidate[]): ILocalBaseCandidate | null {
  return candidates.find((c) => c.tier === "files" && c.pieces !== "mismatch") ?? null;
}

/** 与下载器里那条基准比对的结论。只有 same 才算「同一份数据」 */
export type TBaseCompareVerdict = "same" | "different" | "unknown";

/**
 * 基准换成下载器里那条之后，逐条判「这条站点种子是不是同一份数据」。
 *
 * 口径和 [[autoSelectLocalBase]] 一致，只是方向反过来（那边是「挑哪条当基准」，
 * 这边是「拿着基准判条目」）：
 * - 任何一边算不出文件清单指纹 → `unknown`。**没有证据不等于不同**，界面要把它留给
 *   人确认（对话框里那颗「添加到辅种列表」就是给出路），不能判死。
 * - 第 3 层有反证（piece 抽样对不上）时把第 2 层的相同推翻成 `different` ——
 *   同一套目录结构装不同内容是常事（换封面的再发布）。
 */
export function compareAgainstLocalBase(
  target: IFingerprintComparable,
  base: IFingerprintComparable,
): { verdict: TBaseCompareVerdict; pieces: TPieceCompareResult } {
  const pieces = comparePieceSamples(target.pieces, base.pieces);
  const a = target.files?.fingerprint;
  const b = base.files?.fingerprint;
  if (!a || !b) return { verdict: "unknown", pieces };
  if (a !== b) return { verdict: "different", pieces };
  return { verdict: pieces === "mismatch" ? "different" : "same", pieces };
}

/** 建任务那一刻，「基准那条本地副本」的三种下场 */
export type TLiveLocalBase =
  | { kind: "kept" }
  | { kind: "replaced"; entry: ILocalTorrentFingerprintEntry }
  | { kind: "blocked"; reason: TLiveLocalBaseBlock; liveCopies?: number };

/**
 * 拦下来的三种原因，界面要分开说 —— 它们给用户的出路不一样。
 *
 * - `no-evidence`：基准那条自己算不出第 2 层指纹，插件**没有任何依据**认另一条副本是同一份数据，
 *   只能由人重挑（自动换 = 拿猜的当证据，误判的代价是挂错站重下整份）；
 * - `no-live-copy`：算得出指纹，但下载器里此刻没有一条与它相同；
 * - `ambiguous`：同内容的在场副本不止一条，取哪一条会影响「基准在哪个目录」那道判定，不替人挑。
 */
export type TLiveLocalBaseBlock = "no-evidence" | "no-live-copy" | "ambiguous";

/**
 * 建任务之前问一句：所选的那条基准**此刻还在下载器里吗**。
 *
 * 为什么必须有这一问（用户 2026-11-01：「基准不在，一开始建立任务的时候就不在……建任务的时候
 * 缓存就是错的」）：界面上那条「本地已有」来自 IndexedDB 里那份本地指纹索引，它存 30 分钟，
 * 而种子被删时过去没有任何一步让它作废。于是已删的那条会被继续列出来、被选中、被写进任务的
 * `baseLocal.hash`；而任务上那条 hash **此后再也刷不回来** —— `refreshBaseLocalPaths` 在下载器里
 * 找不到它就静默跳过，界面上会永久挂着一句基于旧快照的「目录不一致」，发送闸一直按着。
 * 所以这一问要发生在**写入之前**，不是指望写入之后有人纠。
 *
 * 不在场时按用户定的口径换用**此刻在场的同内容副本**，但只认硬证据：
 * 「同一份数据」的判据仍只有第 2 层文件清单指纹（`compareAgainstLocalBase` 的 `same`），
 * 标题+大小那种第 1 层相似一律算「没有证据」—— 那条口径与 `pickLocalBaseCandidates` 只自动选中
 * `files` 档是同一套，不在此处另判一套。
 */
export function resolveLiveLocalBase(
  chosen: ILocalTorrentFingerprintEntry,
  index: ILocalFingerprintIndex | ILocalTorrentFingerprintEntry[] | null | undefined,
  liveHashes: Iterable<string>,
): TLiveLocalBase {
  const live = new Set<string>();
  for (const raw of liveHashes) {
    const key = String(raw ?? "").trim().toLowerCase();
    if (key) live.add(key);
  }
  const chosenHash = String(chosen.hash ?? "").trim().toLowerCase();
  if (chosenHash && live.has(chosenHash)) return { kind: "kept" };

  const matches: ILocalTorrentFingerprintEntry[] = [];
  for (const entry of toEntries(index)) {
    if (!entry.isCompleted) continue;
    const hash = String(entry.hash ?? "").trim().toLowerCase();
    // 不写「也要排除基准自己」那一半：基准在场时上面已经 return kept，不在场时 `live.has` 就把它挡住了，
    // 这一条结构上没有可达的场景（反证过一次：去掉它 18 条用例一条都不红）。
    if (!hash || !live.has(hash)) continue;
    if (compareAgainstLocalBase(chosen, entry).verdict === "same") matches.push(entry);
  }
  if (matches.length === 1) return { kind: "replaced", entry: matches[0] };
  if (matches.length > 1) return { kind: "blocked", reason: "ambiguous", liveCopies: matches.length };
  return { kind: "blocked", reason: chosen.files?.fingerprint ? "no-live-copy" : "no-evidence" };
}
