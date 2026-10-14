/**
 * 海胆那类「把等级积分存进 seedingBonus」的站点，缺口换算判据（`src/shared/levelScoreSites.ts`）。
 *
 * 用例里的分数都是拿站点公布的公式凑的整数例子，不含任何真实账号数据。
 * 公式：`等级积分 = 发种数 × 10 + 上传量 × 0.01 + 下载量 × 0.2 + 魔力值 × 0.005`
 */
import { describe, expect, it } from "vitest";

import {
  COMPOSITE_LEVEL_SCORES,
  convertLevelScoreGap,
  isCompositeLevelScore,
  LEVEL_SCORE_CURRENCIES,
} from "@/shared/levelScoreSites.ts";

const GB = 1024 ** 3;

describe("isCompositeLevelScore：只点名的站、只 seedingBonus 这一个字段", () => {
  it("海胆的 seedingBonus 是复合分", () => {
    expect(isCompositeLevelScore("haidan", "seedingBonus")).toBe(true);
  });
  it("同站的别的字段不算（bonus 就是魔力值，单一维度）", () => {
    expect(isCompositeLevelScore("haidan", "bonus")).toBe(false);
  });
  it("没点名的站照旧按做种积分处理", () => {
    expect(isCompositeLevelScore("hdarea", "seedingBonus")).toBe(false);
    expect(isCompositeLevelScore(undefined, "seedingBonus")).toBe(false);
  });
});

describe("convertLevelScoreGap：按站点公式把「还差 N 分」摊成四种等价物", () => {
  // 100 分 → 上传 100 ÷ 0.01 = 10000 GB、下载 100 ÷ 0.2 = 500 GB、
  // 魔力值 100 ÷ 0.005 = 20000 点、活种 100 ÷ 10 = 10 个
  it("流量类返回字节（界面交给 formatSize 画）", () => {
    expect(convertLevelScoreGap("haidan", "uploaded", 100)).toBe(10000 * GB);
    expect(convertLevelScoreGap("haidan", "downloaded", 100)).toBe(500 * GB);
  });
  it("点数与个数返回原值", () => {
    expect(convertLevelScoreGap("haidan", "bonus", 100)).toBe(20000);
    expect(convertLevelScoreGap("haidan", "seeding", 100)).toBe(10);
  });
  it("除不尽时不取整（取整是显示层的事：活种要凑得齐，那里向上取整）", () => {
    expect(convertLevelScoreGap("haidan", "seeding", 3)).toBeCloseTo(0.3, 10);
  });
  it("没点名的站 → null，不替它编一个换算率", () => {
    for (const currency of LEVEL_SCORE_CURRENCIES) {
      expect(convertLevelScoreGap("hdarea", currency, 100)).toBeNull();
    }
  });
  it("分数为 0 / 负 / 非有限数 → null（没有缺口就没有换算）", () => {
    expect(convertLevelScoreGap("haidan", "bonus", 0)).toBeNull();
    expect(convertLevelScoreGap("haidan", "bonus", -5)).toBeNull();
    expect(convertLevelScoreGap("haidan", "bonus", Number.NaN)).toBeNull();
  });
  it("四种维度一个都不缺（少一种就是界面上一处说不清的缺口）", () => {
    for (const currency of LEVEL_SCORE_CURRENCIES) {
      expect(convertLevelScoreGap("haidan", currency, 100)).not.toBeNull();
    }
  });
  it("系数表里每一站都齐四个系数", () => {
    for (const coefficients of Object.values(COMPOSITE_LEVEL_SCORES)) {
      for (const currency of LEVEL_SCORE_CURRENCIES) {
        expect(coefficients?.[currency]).toBeGreaterThan(0);
      }
    }
  });
});
