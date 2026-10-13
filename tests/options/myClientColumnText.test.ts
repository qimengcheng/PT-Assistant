/**
 * 「我的下载器」列表里做种数 / 下载数 / 剩余时间三格的取值口径
 * （`src/options/views/Overview/MyClient/columnText.ts`）。
 *
 * 为什么这一份要进 Vitest 而不是像 `toPercent` 那样把函数文本抠出来 eval：
 * 那三格吃的是**各家下载器报出来的原值**，而它们对「没有这个数」的表达并不统一 ——
 * qBittorrent / Transmission / Deluge / Flood 用 -1 表示算不出 ETA、用 0 表示已经下完，
 * Aria2 / 群晖 干脆没有这些字段（映射出来是 undefined）。这一页的旧写法 `record.seeds || "-"`
 * 会把「0 个做种」画成横杠，那是假消息：横杠说的是「不知道」，0 说的是「没有源」。
 * 判据住在 columnText.ts（它除了 `@/shared/reseedNotice.ts` 什么都不依赖），这里只验它。
 */
import { describe, expect, it } from "vitest";

import { countText, etaText } from "@/options/views/Overview/MyClient/columnText.ts";

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
