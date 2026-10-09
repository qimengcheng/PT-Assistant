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
