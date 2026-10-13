/**
 * 「我的下载器」列表里做种数 / 下载数 / 剩余时间三格，以及名称下面那行「分类 + 标签」的
 * 取值口径（`src/options/views/Overview/MyClient/columnText.ts`）。
 *
 * 为什么这一份要进 Vitest 而不是像 `toPercent` 那样把函数文本抠出来 eval：
 * 那三格吃的是**各家下载器报出来的原值**，而它们对「没有这个数」的表达并不统一 ——
 * qBittorrent / Transmission / Deluge / Flood 用 -1 表示算不出 ETA、用 0 表示已经下完，
 * Aria2 / 群晖 干脆没有这些字段（映射出来是 undefined）。这一页的旧写法 `record.seeds || "-"`
 * 会把「0 个做种」画成横杠，那是假消息：横杠说的是「不知道」，0 说的是「没有源」。
 * `labelChips` 同理：`label` 在 qBittorrent 上是分类、在 Transmission / Flood 上是 tags[0]，
 * 不去重就会在同一行里出现两颗一模一样的标签。判据住在 columnText.ts（它除了
 * `@/shared/reseedNotice.ts` 什么都不依赖），这里只验它。
 */
import { describe, expect, it } from "vitest";

import { countText, etaText, labelChips } from "@/options/views/Overview/MyClient/columnText.ts";

describe("countText：做种数 / 下载数", () => {
  it("0 是「没有源」，必须画成 0，不能退成横杠", () => {
    expect(countText(0)).toBe("0");
  });

  it("有值就照原样报", () => {
    expect(countText(1)).toBe("1");
    expect(countText(1234)).toBe("1234");
  });

  it("下载器没报这个字段才是横杠", () => {
    expect(countText(undefined)).toBe("-");
  });

  it("非有限数（NaN / Infinity）也算没报", () => {
    expect(countText(Number.NaN)).toBe("-");
    expect(countText(Number.POSITIVE_INFINITY)).toBe("-");
  });
});

describe("etaText：剩余时间", () => {
  it("算不出（各家回 -1）与已下完（回 0）都收成横杠，不编一个假倒计时", () => {
    expect(etaText(-1, true)).toBe("-");
    expect(etaText(0, true)).toBe("-");
    expect(etaText(undefined, true)).toBe("-");
    expect(etaText(Number.NaN, true)).toBe("-");
    expect(etaText(Number.POSITIVE_INFINITY, true)).toBe("-");
  });

  it("档位与辅种通知那份 `formatDurationSec` 一致（两处各写一套就会出现两种说法）", () => {
    expect(etaText(30, true)).toBe("不足 1 分钟");
    expect(etaText(1800, true)).toBe("30 分钟");
    expect(etaText(3725, true)).toBe("1 小时 2 分");
    expect(etaText(7200, true)).toBe("2 小时");
    expect(etaText(90000, true)).toBe("1 天 1 小时");
    expect(etaText(86400, true)).toBe("1 天");
  });

  it("英文档走英文的说法，不会漏语种", () => {
    expect(etaText(30, false)).toBe("under a minute");
    expect(etaText(3725, false)).toBe("1h 2m");
  });
});

describe("labelChips：名称下面那行的「分类 + 标签」", () => {
  it("分类排在前，标签跟在后面", () => {
    expect(labelChips("纪录片", ["华语电影", "2024"])).toEqual(["纪录片", "华语电影", "2024"]);
  });

  it("只有分类时还是一行，不会因为 tags 缺失就整个不出", () => {
    expect(labelChips("纪录片", undefined)).toEqual(["纪录片"]);
  });

  it("只有标签没有分类时也出（Aria2 那类没有分类概念的、或 qBittorrent 没挂分类）", () => {
    expect(labelChips(undefined, ["剧集"])).toEqual(["剧集"]);
    expect(labelChips("", ["剧集"])).toEqual(["剧集"]);
  });

  it("去重：Transmission 与 Flood 的 label 本来就是 labels[0] / tags[0]，不去重会重复一颗", () => {
    expect(labelChips("电影", ["电影", "2024"])).toEqual(["电影", "2024"]);
  });

  it("空串与只含空格的丢掉，全空返回空数组（界面据此决定这一行出不出）", () => {
    expect(labelChips("", ["  ", ""])).toEqual([]);
    expect(labelChips(undefined, undefined)).toEqual([]);
  });
});
