/**
 * 种子大小的取数与「读不出」那一档（`src/shared/torrentSize.ts` + `sizeText` 的显示口径）。
 *
 * 为什么要进 Vitest：用户 2026-10-15 报「1ptbar 的是你获取的种子大小不正确，你显示的是 0」。
 * 站点那一列是从搜索结果页那一格的**文本**解析的，而解析层读不懂时回的是 0
 * （`packages/site/utils/filesize.ts` 的 `parseSizeString`：不匹配 `sizePattern` 就 `return 0`），
 * 界面那侧再写 `formatSize(size ?? 0)`，「读不出」与「这个站说这份种子是 0 字节」就画成了同一个字，
 * 建任务落库也记 0。0 字节不是任何一份真实内容 —— 这条判据（`<= 0` 一律算未知）此前只住在
 * `shared/bestReseed.ts` 的分档那一步，界面没共用，所以三处各说一套。
 *
 * 每条都配一个「老写法会得到什么」的对照。数值一律合成，不写真实站点的流量。
 */
import { describe, expect, it } from "vitest";

import { pickTorrentSizeBytes, toSizeBytes } from "@/shared/torrentSize.ts";
import { sizeText } from "@/options/utils.ts";

/** 48.42 GiB 的真实字节数（站点那一格常见的写法） */
const GIB = Math.pow(2, 30);
const REAL = 48.42 * GIB;

describe("toSizeBytes：什么算读不出", () => {
  it("0 算读不出（老口径把它当真实大小，界面就画成 0 B）", () => {
    expect(toSizeBytes(0)).toBeNull();
    // 对照：老写法 `formatSize(size ?? 0)` 对 0 印的是 "0 B"
    expect(sizeText(0)).toBe("-");
  });

  it("缺字段 / null / 空串算读不出", () => {
    expect(toSizeBytes(undefined)).toBeNull();
    expect(toSizeBytes(null)).toBeNull();
    expect(toSizeBytes("")).toBeNull();
  });

  it("负数、NaN、Infinity 算读不出", () => {
    expect(toSizeBytes(-1)).toBeNull();
    expect(toSizeBytes(Number.NaN)).toBeNull();
    expect(toSizeBytes(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("带单位的串不是字节数（`\"56.58 GiB\"` 要挡掉，不能 Number() 出个 NaN 蒙过去）", () => {
    expect(toSizeBytes("56.58 GiB")).toBeNull();
  });

  it("正数与纯数字串都认（类型写 number，运行时两类都出现过）", () => {
    expect(toSizeBytes(REAL)).toBe(REAL);
    expect(toSizeBytes(String(REAL))).toBe(REAL);
  });
});

describe("pickTorrentSizeBytes：已经有 .torrent 就不再用页面那个数", () => {
  it("页面读不出（0）而 .torrent 有真数时，用真数 —— 这次那一行就是这个形状", () => {
    expect(pickTorrentSizeBytes({ torrentLength: REAL, pageShownSize: 0 })).toBe(REAL);
    // 对照：老写法读的是 `item.data.size`，那一行画的是 "0 B"、建任务落库也是 0
    expect(pickTorrentSizeBytes({ torrentLength: REAL, pageShownSize: 0 }) ?? 0).toBe(REAL);
  });

  it(".torrent 还没回来时退回页面值", () => {
    expect(pickTorrentSizeBytes({ torrentLength: undefined, pageShownSize: REAL })).toBe(REAL);
  });

  it(".torrent 自己也算不出（length 为 0）时不算真数，仍退回页面值", () => {
    expect(pickTorrentSizeBytes({ torrentLength: 0, pageShownSize: REAL })).toBe(REAL);
  });

  it("两个都读不出时返回 null，不返回 0（0 会被下游当成「这一条 0 字节」）", () => {
    expect(pickTorrentSizeBytes({ torrentLength: 0, pageShownSize: 0 })).toBeNull();
    expect(pickTorrentSizeBytes({})).toBeNull();
  });
});

describe("sizeText：那一格的文字", () => {
  it("读得出时按原来的字节档印（与全站 formatSize 同一个口径）", () => {
    expect(sizeText(REAL)).toBe("48.42 GiB");
  });

  it("读不出画 `-`，不画 0 B、也不画键路径", () => {
    expect(sizeText(undefined)).toBe("-");
    expect(sizeText(Number.NaN)).toBe("-");
  });
});
