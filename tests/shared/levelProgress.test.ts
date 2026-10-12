/**
 * 升级进度那张表的排序判据（`src/shared/levelProgress.ts`）。
 *
 * 这份从 `.tmp-build/level-progress-test.mjs` 搬进来，条数一字未减。
 * 搬的时候最该保住的是**分档先后顺序**和「差几项 → 瓶颈完成度」这两条 ——
 * 它们都是用户当场选定的口径（v0.83.0），改判据的人看不见界面，只能靠这里拦住。
 */
import { describe, expect, it } from "vitest";

import {
  LEVEL_STATE_ORDER,
  alternativeBottleneck,
  classifyLevelProgress,
  compareLevelProgress,
  fieldFraction,
  groupBottleneck,
  rankLevelProgress,
  type ILevelFacts,
  type ILevelProgressRank,
  type IProgressField,
} from "@/shared/levelProgress.ts";

const f = (key: string, current: number, required: number, direction?: "gt" | "lt"): IProgressField =>
  direction ? { key, current, required, direction } : { key, current, required };
const g = (count: number, fields: IProgressField[] = []) => ({ count, fields });
const r = (state: ILevelProgressRank["state"], unmetCount: number, bottleneck: number | null): ILevelProgressRank => ({
  state,
  unmetCount,
  bottleneck,
});

describe("classifyLevelProgress：状态分档，先后顺序是判据的一部分", () => {
  const facts = (over: Partial<ILevelFacts>): ILevelFacts => ({
    hasRequirements: true,
    hasLevelInfo: true,
    groupType: "user",
    atMaxUserLevel: false,
    hasNextLevel: true,
    ...over,
  });

  it("站点没给等级表 → noRequirements，且这一条优先于「没取到等级」", () => {
    expect(
      classifyLevelProgress(facts({ hasRequirements: false, hasLevelInfo: false, groupType: null, hasNextLevel: false })),
    ).toBe("noRequirements");
  });
  it("有等级表但没取到等级 → noLevel", () => {
    expect(classifyLevelProgress(facts({ hasRequirements: true, hasLevelInfo: false, groupType: "user" }))).toBe("noLevel");
  });
  it.each(["vip", "manager"])("%s 组 → special", (groupType) => {
    expect(classifyLevelProgress(facts({ groupType: groupType as ILevelFacts["groupType"] }))).toBe("special");
  });
  it("组别猜不出来（null）不按 special 处理", () => {
    expect(classifyLevelProgress(facts({ groupType: null }))).toBe("rankable");
  });
  it("已在最高普通级 → maxed", () => {
    expect(classifyLevelProgress(facts({ atMaxUserLevel: true, hasNextLevel: false }))).toBe("maxed");
  });
  it("等级表里没有更高的一级 → maxed（与 atMaxUserLevel 同义，但两条都可能由站点数据给出来）", () => {
    expect(classifyLevelProgress(facts({ hasNextLevel: false }))).toBe("maxed");
  });
  it("都正常 → rankable", () => {
    expect(classifyLevelProgress(facts({}))).toBe("rankable");
  });
});

describe("fieldFraction：单项完成度", () => {
  it("gt 方向按 当前 ÷ 要求", () => {
    expect(fieldFraction(f("uploaded", 100, 200))).toBe(0.5);
  });
  it("超过要求夹到 1", () => {
    expect(fieldFraction(f("uploaded", 300, 200))).toBe(1);
  });
  it("要求 0 视为已满足", () => {
    expect(fieldFraction(f("uploaded", 0, 0))).toBe(1);
  });
  it("当前为负不算负进度", () => {
    expect(fieldFraction(f("ratio", -1, 2))).toBe(0);
  });
  it("lt 方向：要求 0 条而当前有 N 条 → 0（没有任何完成度可言）", () => {
    expect(fieldFraction(f("hnrUnsatisfied", 5, 0, "lt"))).toBe(0);
  });
  it("lt 方向：要求 2 条而当前 4 条 → 0.5（超得越多越小）", () => {
    expect(fieldFraction(f("hnrUnsatisfied", 4, 2, "lt"))).toBe(0.5);
  });
  it("current 不是数字 → null 而不是 0（不替数据源编一个「一点没动」）", () => {
    expect(fieldFraction(f("bonus", Number.NaN, 1000))).toBeNull();
  });
  it("required 不是数字 → null", () => {
    expect(fieldFraction({ key: "bonus", current: 10, required: undefined as unknown as number })).toBeNull();
  });
  it("current 是 Infinity → null", () => {
    expect(fieldFraction(f("bonus", Number.POSITIVE_INFINITY, 1000))).toBeNull();
  });
});

describe("groupBottleneck / alternativeBottleneck：组内最短板", () => {
  it("组里没有可算项 → null", () => {
    expect(groupBottleneck(g(2, []))).toBeNull();
  });
  it("组里取最卡那一项", () => {
    expect(groupBottleneck(g(3, [f("uploaded", 190, 200), f("bonus", 10, 1000), f("ratio", 1, 2)]))).toBeCloseTo(0.01, 10);
  });
  it("拿不出数字的项不掺进最短板（它在「差几项」里已经计过数了）", () => {
    expect(groupBottleneck(g(2, [f("uploaded", 100, 200), f("bonus", Number.NaN, 900)]))).toBe(0.5);
  });
  it("可选要求各方案取最好那条", () => {
    expect(alternativeBottleneck([g(1, [f("uploaded", 10, 100)]), g(1, [f("seeding", 80, 100)])])).toBe(0.8);
  });
  it("方案内部仍按自己的最短板算", () => {
    expect(alternativeBottleneck([g(2, [f("uploaded", 90, 100), f("posts", 0, 10)])])).toBe(0);
  });
  it("所有方案都拿不出数字 → null", () => {
    expect(alternativeBottleneck([g(1, []), g(1, [f("x", Number.NaN, 1)])])).toBeNull();
  });
});

describe("rankLevelProgress：整行的差几项与最卡那档", () => {
  it("没有可选要求 → 条数就是主要求的条数", () => {
    expect(rankLevelProgress({ state: "rankable", primary: g(2, [f("uploaded", 100, 200)]) }).unmetCount).toBe(2);
  });
  it("带可选要求 → 整组只算差一项，两条加起来差两项", () => {
    expect(
      rankLevelProgress({
        state: "rankable",
        primary: g(1, []),
        alternatives: [g(1, [f("uploaded", 10, 100)]), g(1, [f("seeding", 80, 100)])],
      }).unmetCount,
    ).toBe(2);
  });
  it("整体最短板 = 主要求与可选要求里更卡的那一边", () => {
    expect(
      rankLevelProgress({
        state: "rankable",
        primary: g(1, [f("uploaded", 10, 100)]),
        alternatives: [g(1, [f("seeding", 80, 100)])],
      }).bottleneck,
    ).toBe(0.1);
  });
  it("可选要求更卡时它成为瓶颈", () => {
    expect(
      rankLevelProgress({
        state: "rankable",
        primary: g(1, [f("uploaded", 90, 100)]),
        alternatives: [g(1, [f("bonus", 1, 100)])],
      }).bottleneck,
    ).toBeCloseTo(0.01, 10);
  });
  it("主要求全是拿不出数字的项时，瓶颈先由可选要求供一个数", () => {
    expect(
      rankLevelProgress({ state: "rankable", primary: g(1, []), alternatives: [g(1, [f("bonus", 50, 100)])] }).bottleneck,
    ).toBe(0.5);
  });
  it("两边都拿不出数字 → null", () => {
    expect(rankLevelProgress({ state: "rankable", primary: g(1, []), alternatives: [g(1, [])] }).bottleneck).toBeNull();
  });
  it("已达标那一行：差 0 项、无瓶颈", () => {
    expect(rankLevelProgress({ state: "rankable", primary: g(0, []) })).toEqual({
      state: "rankable",
      unmetCount: 0,
      bottleneck: null,
    });
  });
});

describe("compareLevelProgress：先分档，档内差几项，再比完成度", () => {
  it("五档的先后顺序就是 LEVEL_STATE_ORDER", () => {
    expect([...LEVEL_STATE_ORDER]).toEqual(["rankable", "maxed", "special", "noLevel", "noRequirements"]);
  });
  it.each([
    ["rankable 排在 maxed 前", r("rankable", 5, 0), r("maxed", 0, null)],
    ["maxed 排在 special 前", r("maxed", 0, null), r("special", 0, null)],
    ["special 排在 noLevel 前", r("special", 0, null), r("noLevel", 0, null)],
    ["noLevel 排在 noRequirements 前", r("noLevel", 0, null), r("noRequirements", 0, null)],
  ])("%s", (_label, a, b) => {
    expect(compareLevelProgress(a, b)).toBeLessThan(0);
  });
  it("同档先比差几项", () => {
    expect(compareLevelProgress(r("rankable", 1, 0.1), r("rankable", 3, 0.9))).toBeLessThan(0);
  });
  it("差项数相同时比完成度（用户明确要的那一档）", () => {
    expect(compareLevelProgress(r("rankable", 2, 0.9), r("rankable", 2, 0.2))).toBeLessThan(0);
  });
  it("完成度为 null 排在 0 之后（不知道 ≠ 一点没动）", () => {
    expect(compareLevelProgress(r("rankable", 2, 0), r("rankable", 2, null))).toBeLessThan(0);
  });
  it("已达标（差 0 项）永远在最前，哪怕完成度是 null", () => {
    expect(compareLevelProgress(r("rankable", 0, null), r("rankable", 1, 0.99))).toBeLessThan(0);
  });
  it("非 rankable 档内不比条数（都是 0，交给站点名兜底）", () => {
    expect(compareLevelProgress(r("maxed", 0, null), r("maxed", 0, null))).toBe(0);
  });
  it("完全并列返回 0", () => {
    expect(compareLevelProgress(r("rankable", 1, 0.5), r("rankable", 1, 0.5))).toBe(0);
  });
});

it("整批混排：单条都对不等于整批排得对", () => {
  const rows = [
    { n: "已到底级", ...r("maxed", 0, null) },
    { n: "差 1 项·完成 50%", ...r("rankable", 1, 0.5) },
    { n: "已达标", ...r("rankable", 0, null) },
    { n: "站点没给等级表", ...r("noRequirements", 0, null) },
    { n: "差 1 项·完成 90%", ...r("rankable", 1, 0.9) },
    { n: "差 3 项·完成 99%", ...r("rankable", 3, 0.99) },
    { n: "贵宾", ...r("special", 0, null) },
    { n: "差 1 项·算不出", ...r("rankable", 1, null) },
    { n: "没取到等级", ...r("noLevel", 0, null) },
  ];
  const order = [...rows]
    .sort((a, b) => compareLevelProgress(a, b) || a.n.localeCompare(b.n, "zh"))
    .map((x) => x.n);
  // 差 3 项·99% 不该插到差 1 项·50% 前面 —— 「离升级最近」看的是差几项，不是百分比
  expect(order).toEqual([
    "已达标",
    "差 1 项·完成 90%",
    "差 1 项·完成 50%",
    "差 1 项·算不出",
    "差 3 项·完成 99%",
    "已到底级",
    "贵宾",
    "没取到等级",
    "站点没给等级表",
  ]);
});
