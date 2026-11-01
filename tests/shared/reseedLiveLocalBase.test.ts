/**
 * 建辅种任务那一刻问的一句：界面上选中的那条基准，**此刻还在下载器里吗**（用户 2026-11-01：
 * 「基准不在，一开始建立任务的时候就不在……建任务的时候缓存就是错的」）。
 *
 * 这一族要钉的是"什么算证据"，因为换基准是**替用户改他挑的东西**：
 * - 只认第 2 层（文件清单指纹）相同，且第 3 层没有反证 —— 与 `autoSelectLocalBase` 自动选中
 *   用的同一档，不在此处另判一套；
 * - 同内容在场副本不止一条 ⇒ 拦下来交回给人，不替他挑（选哪一条决定「基准在哪个目录」）；
 * - 基准自己算不出第 2 层 ⇒ 拦下来，**不许**拿"标题+大小相同"当证据换。
 *
 * 每种 `blocked` 都要有用例，因为它们给用户的出路不一样；而 `kept` 那一档是存量正常路径，
 * 它坏了等于把所有「基准取自下载器」的任务建不出来。
 */
import { describe, expect, it } from "vitest";

import { resolveLiveLocalBase } from "@/shared/fingerprint/localBase.ts";
import type {
  IFilesFingerprint,
  ILocalFingerprintIndex,
  ILocalTorrentFingerprintEntry,
  IPieceSample,
} from "@/shared/fingerprint/types.ts";

/** 造一条本地索引条目：只填这一族用得上的字段，其余按索引构建时一定会写的给默认值 */
function entry(over: Partial<ILocalTorrentFingerprintEntry> & { hash: string }): ILocalTorrentFingerprintEntry {
  return {
    name: `torrent-${over.hash}`,
    size: 1000,
    progress: 100,
    isCompleted: true,
    trackerHosts: [],
    sites: [],
    ratioLimit: -1,
    seedingTimeLimit: -1,
    ...over,
  };
}

/** 第 2 层指纹：同串 = 同一份数据 */
const FP = "f".repeat(64);
const fp = (value = FP): IFilesFingerprint => ({ kind: "multi", fileCount: 3, totalSize: 1000, fingerprint: value });

/** 第 3 层抽样：给足 comparePieceSamples 要的四个字段 */
const sample = (first: string): IPieceSample => ({
  hashes: [first, "b".repeat(40)].sort(),
  piecesNum: 4,
  head: 2,
  tail: 2,
});

const chosen = entry({ hash: "aaaa", name: "已删的那条", files: fp() });

/** 在场列表：判据只吃 infoHash 那些串 */
function live(...hashes: string[]): string[] {
  return hashes;
}

describe("基准此刻还在下载器里 → 原样用，一个字不改", () => {
  it("在场（列表报的是小写、索引里存的原样也算同一条）", () => {
    expect(resolveLiveLocalBase(chosen, [chosen], live("AAAA"))).toEqual({ kind: "kept" });
  });

  it("两侧都剥过空白", () => {
    const a = entry({ hash: "AAaa  ", files: fp() });
    expect(resolveLiveLocalBase(a, [a], live(" aaaa")).kind).toBe("kept");
  });

  it("基准没记 hash → 判不了在场，也不许拿它去换一条（那是凭猜换）", () => {
    const blank = entry({ hash: "", files: fp() });
    expect(resolveLiveLocalBase(blank, [blank], live("")).kind).toBe("blocked");
  });
});

describe("不在场 → 只在硬证据下换一条此刻在场的同内容副本", () => {
  it("在场副本恰好一条、第 2 层相同 → 换成它，交回的是**那一条**而不是索引里第一条", () => {
    const copy = entry({ hash: "bbbb", name: "另一站的那条", files: fp() });
    const other = entry({ hash: "cccc", files: fp("e".repeat(64)) });
    expect(resolveLiveLocalBase(chosen, [other, copy], live("cccc", "bbbb"))).toEqual({
      kind: "replaced",
      entry: copy,
    });
  });

  it("传整封索引（{ entries }）与传条目数组同一条判据", () => {
    const copy = entry({ hash: "bbbb", files: fp() });
    const index: ILocalFingerprintIndex = {
      downloaderId: "d1",
      updatedAt: 0,
      totalTorrents: 2,
      unresolved: 0,
      entries: [chosen, copy],
    };
    expect(resolveLiveLocalBase(chosen, index, live("bbbb"))).toEqual({ kind: "replaced", entry: copy });
  });

  it("没下完的那条不算：拿它当基准就是必爆仓（与 pickLocalBaseCandidates 同一道闸）", () => {
    const half = entry({ hash: "bbbb", files: fp(), isCompleted: false, progress: 40 });
    expect(resolveLiveLocalBase(chosen, [half], live("bbbb"))).toEqual({ kind: "blocked", reason: "no-live-copy" });
  });

  it("索引里那条其实没在场（下载器里此刻是别的种子）→ 不换", () => {
    const stale = entry({ hash: "dddd", files: fp() });
    expect(resolveLiveLocalBase(chosen, [stale], live("eeee"))).toEqual({ kind: "blocked", reason: "no-live-copy" });
  });

  it("索引里留着的就是基准那一条、而它已不在场 → 不许「换成它自己」（那等于把这条已删的继续当基准）", () => {
    // 这一档正是本轮那个 bug 的形状：界面从缓存里选出它，写进任务的 hash 却在下载器里找不到
    expect(resolveLiveLocalBase(chosen, [chosen], live("bbbb"))).toEqual({
      kind: "blocked",
      reason: "no-live-copy",
    });
    // 同一条索引里另有在场副本时，换的是副本而不是它自己
    const copy = entry({ hash: "bbbb", files: fp() });
    expect(resolveLiveLocalBase(chosen, [chosen, copy], live("bbbb"))).toEqual({ kind: "replaced", entry: copy });
  });

  it("在场副本自己算不出第 2 层 → 不算证据（那一条到底是不是这份数据没人知道）", () => {
    const unresolved = entry({ hash: "bbbb", name: chosen.name, size: chosen.size, files: undefined });
    expect(resolveLiveLocalBase(chosen, [unresolved], live("bbbb"))).toEqual({
      kind: "blocked",
      reason: "no-live-copy",
    });
  });

  it("第 3 层抽样对不上就把第 2 层推翻成不同：同一套目录结构装不同内容是常事", () => {
    const target = entry({ hash: "ffff", files: fp(), pieces: sample("a".repeat(40)) });
    const copy = entry({ hash: "bbbb", files: fp(), pieces: sample("9".repeat(40)) });
    expect(resolveLiveLocalBase(target, [copy], live("bbbb")).kind).toBe("blocked");
  });
});

describe("拦下来的三档各说清一个原因", () => {
  it("同内容在场副本不止一条 → ambiguous，并把几条一起交回去（界面要说这个数）", () => {
    const copies = [entry({ hash: "bbbb", files: fp() }), entry({ hash: "cccc", files: fp() })];
    expect(resolveLiveLocalBase(chosen, copies, live("bbbb", "cccc"))).toEqual({
      kind: "blocked",
      reason: "ambiguous",
      liveCopies: 2,
    });
  });

  it("基准自己算不出第 2 层 → no-evidence：此刻在场、标题+大小都相同的副本也不许换", () => {
    const noFp = entry({ hash: "aaaa", files: undefined });
    const lookalike = entry({ hash: "bbbb", name: noFp.name, size: noFp.size, titleKey: "x|1000" });
    expect(resolveLiveLocalBase(noFp, [noFp, lookalike], live("bbbb"))).toEqual({
      kind: "blocked",
      reason: "no-evidence",
    });
  });

  it("算得出指纹但在场没有相同的那条 → no-live-copy（与上一条出路不同，所以必须分开）", () => {
    const other = entry({ hash: "bbbb", files: fp("e".repeat(64)) });
    expect(resolveLiveLocalBase(chosen, [chosen, other], live("bbbb"))).toEqual({
      kind: "blocked",
      reason: "no-live-copy",
    });
  });

  it("索引整个没拿到（null / undefined / 空数组）→ no-live-copy，不报错", () => {
    for (const index of [null, undefined, []]) {
      expect(resolveLiveLocalBase(chosen, index as ILocalFingerprintIndex | ILocalTorrentFingerprintEntry[], live("bbbb"))).toEqual({
        kind: "blocked",
        reason: "no-live-copy",
      });
    }
  });
});
