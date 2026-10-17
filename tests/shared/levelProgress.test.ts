/**
 * 升级进度那张表的排序判据（`src/shared/levelProgress.ts`）。
 *
 * 这份从 `.tmp-build/level-progress-test.mjs` 搬进来，条数一字未减。
 * 搬的时候最该保住的是**分档先后顺序**和「差几项 → 还差的绝对量」这两条 ——
 * 前者是 v0.83.0 定下的，后者是用户 2026-10-17 驳回旧口径（原为「瓶颈完成度」）之后重选的。
 * 改判据的人看不见界面，只能靠这里拦住。
 */
import { describe, expect, it } from "vitest";

import {
  LEVEL_STATE_ORDER,
  alternativeGap,
  classifyLevelProgress,
  compareLevelProgress,
  fieldGap,
  groupGap,
  rankLevelProgress,
  type ILevelFacts,
  type ILevelGap,
  type ILevelProgressRank,
  type IProgressField,
} from "@/shared/levelProgress.ts";

const f = (key: string, current: number, required: number, direction?: "gt" | "lt"): IProgressField =>
  direction ? { key, current, required, direction } : { key, current, required };
const g = (count: number, fields: IProgressField[] = []) => ({ count, fields });
const gp = (key: string, value: number): ILevelGap => ({ key, value });
const r = (state: ILevelProgressRank["state"], unmetCount: number, gap: ILevelGap | null): ILevelProgressRank => ({
  state,
  unmetCount,
  gap,
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

describe("fieldGap：单项还差多少（该字段自己的量纲，不折成百分比）", () => {
  it("gt 方向按 要求 − 当前", () => {
    expect(fieldGap(f("uploaded", 100, 200))).toBe(100);
  });
  it("当前已反超给 0 而不是负数（负缺口会把这一行排到所有站前面）", () => {
    expect(fieldGap(f("uploaded", 300, 200))).toBe(0);
  });
  it("要求 0 视为已满足", () => {
    expect(fieldGap(f("uploaded", 0, 0))).toBe(0);
  });
  it("当前是 -1 那种「报不出」哨兵 → null，不变成一个看着像真数的缺口", () => {
    expect(fieldGap(f("ratio", -1, 2))).toBeNull();
  });
  it("lt 方向按 当前 − 要求（H&R 那一类是超得越多越差）", () => {
    expect(fieldGap(f("hnrUnsatisfied", 5, 0, "lt"))).toBe(5);
  });
  it("lt 方向：要求 2 条而当前 4 条 → 还差 2 条", () => {
    expect(fieldGap(f("hnrUnsatisfied", 4, 2, "lt"))).toBe(2);
  });
  it("方向该给 lt 却给了 gt → 整个缺口塌成 0（所以 direction 必须由调用方点名）", () => {
    expect(fieldGap(f("hnrUnsatisfied", 5, 0))).toBe(0);
  });
  it("分享率那种小数按原值给，不换算", () => {
    expect(fieldGap(f("ratio", 0.8, 1.5))).toBeCloseTo(0.7, 10);
  });
  it("current 不是数字 → null 而不是 0（不替数据源编一个「只差临门一脚」）", () => {
    expect(fieldGap(f("bonus", Number.NaN, 1000))).toBeNull();
  });
  it("required 不是数字 → null", () => {
    expect(fieldGap({ key: "bonus", current: 10, required: undefined as unknown as number })).toBeNull();
  });
  it("current 是 Infinity → null（fixRatio 在「有上传量、下载量 0」时就是这么报的）", () => {
    expect(fieldGap(f("ratio", Number.POSITIVE_INFINITY, 2))).toBeNull();
  });
});

describe("groupGap / alternativeGap：一组取哪一项", () => {
  it("组里没有可算项 → null", () => {
    expect(groupGap(g(2, []))).toBeNull();
  });
  it("组里取缺口最大的那一项，并把字段名一起带出去（界面要靠它画「还差」）", () => {
    expect(groupGap(g(3, [f("bonus", 10, 1000), f("uploaded", 100, 200), f("ratio", 1, 2)]))).toEqual(gp("bonus", 990));
  });
  it("拿不出数字的项不掺进缺口（它在「差几项」里已经计过数了）", () => {
    expect(groupGap(g(2, [f("uploaded", 100, 200), f("bonus", Number.NaN, 900)]))).toEqual(gp("uploaded", 100));
  });
  it("标成不可比的项不供缺口（海胆那一格是等级积分，35 分跟 35 GiB 不是一个东西）", () => {
    expect(groupGap(g(1, [{ key: "seedingBonus", current: 4965, required: 5000, comparable: false }]))).toBeNull();
  });
  it("一组里既有不可比项也有可算项时，缺口由可算项供", () => {
    expect(
      groupGap(g(2, [{ key: "seedingBonus", current: 4965, required: 5000, comparable: false }, f("uploaded", 100, 200)])),
    ).toEqual(gp("uploaded", 100));
  });
  it("comparable 缺省（undefined）照旧可比", () => {
    expect(groupGap(g(1, [{ key: "seedingBonus", current: 4965, required: 5000 }]))).toEqual(gp("seedingBonus", 35));
  });
  it("可选要求各方案取最省那一条", () => {
    expect(alternativeGap([g(1, [f("uploaded", 10, 100)]), g(1, [f("seeding", 80, 100)])])).toEqual(gp("seeding", 20));
  });
  it("方案内部仍按自己的最大缺口算（一条方案要全满足才算过）", () => {
    expect(alternativeGap([g(2, [f("uploaded", 90, 100), f("posts", 0, 30)])])).toEqual(gp("posts", 30));
  });
  it("所有方案都拿不出数字 → null", () => {
    expect(alternativeGap([g(1, []), g(1, [f("x", Number.NaN, 1)])])).toBeNull();
  });
  it("压根没有可选要求 → null", () => {
    expect(alternativeGap([])).toBeNull();
  });
});

describe("rankLevelProgress：整行的差几项与还差多少", () => {
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
  it("主要求与可选要求两条都要办 → 这一行的缺口取更大那一边", () => {
    expect(
      rankLevelProgress({
        state: "rankable",
        primary: g(1, [f("uploaded", 10, 100)]),
        alternatives: [g(1, [f("seeding", 80, 100)])],
      }).gap,
    ).toEqual(gp("uploaded", 90));
  });
  it("可选要求那一边更沉时，缺口由它供", () => {
    expect(
      rankLevelProgress({
        state: "rankable",
        primary: g(1, [f("uploaded", 90, 100)]),
        alternatives: [g(1, [f("bonus", 1, 100)])],
      }).gap,
    ).toEqual(gp("bonus", 99));
  });
  it("主要求全是拿不出数字的项时，缺口由可选要求供一个", () => {
    expect(
      rankLevelProgress({ state: "rankable", primary: g(1, []), alternatives: [g(1, [f("bonus", 50, 100)])] }).gap,
    ).toEqual(gp("bonus", 50));
  });
  it("两边都拿不出数字 → null", () => {
    expect(rankLevelProgress({ state: "rankable", primary: g(1, []), alternatives: [g(1, [])] }).gap).toBeNull();
  });
  it("已达标那一行：差 0 项、无缺口", () => {
    expect(rankLevelProgress({ state: "rankable", primary: g(0, []) })).toEqual({
      state: "rankable",
      unmetCount: 0,
      gap: null,
    });
  });
  it("不可比项照计入「差几项」，只是不供缺口", () => {
    expect(
      rankLevelProgress({
        state: "rankable",
        primary: g(2, [{ key: "seedingBonus", current: 4965, required: 5000, comparable: false }, f("ratio", 6, 1)]),
      }),
    ).toEqual({ state: "rankable", unmetCount: 2, gap: gp("ratio", 0) });
  });
});

describe("compareLevelProgress：先分档，档内差几项，再比还差的绝对量", () => {
  it("五档的先后顺序就是 LEVEL_STATE_ORDER", () => {
    expect([...LEVEL_STATE_ORDER]).toEqual(["rankable", "maxed", "special", "noLevel", "noRequirements"]);
  });
  it.each([
    ["rankable 排在 maxed 前", r("rankable", 5, gp("posts", 2)), r("maxed", 0, null)],
    ["maxed 排在 special 前", r("maxed", 0, null), r("special", 0, null)],
    ["special 排在 noLevel 前", r("special", 0, null), r("noLevel", 0, null)],
    ["noLevel 排在 noRequirements 前", r("noLevel", 0, null), r("noRequirements", 0, null)],
  ])("%s", (_label, a, b) => {
    expect(compareLevelProgress(a, b)).toBeLessThan(0);
  });
  it("同档先比差几项 —— 项数赢缺口", () => {
    expect(compareLevelProgress(r("rankable", 1, gp("posts", 2)), r("rankable", 3, gp("uploaded", 1)))).toBeLessThan(0);
  });
  it("差项数相同时比绝对量，小的在前（用户 2026-10-17 明确要的那一档）", () => {
    expect(compareLevelProgress(r("rankable", 2, gp("posts", 2)), r("rankable", 2, gp("posts", 50)))).toBeLessThan(0);
  });
  it("跨量纲：还差 2 个帖子排在还差 3 GiB 之前", () => {
    // 这条不是在判对错，是把**代价钉住**：字节、秒、点数、分享率没有共同尺度，
    // 按原始数值排必然让计数类靠前、流量类靠后。用户选定这个口径时已读过这句（文件头）。
    // 哪天要退回可比口径，动的是判据本身，不是把这条用例改个方向。
    expect(compareLevelProgress(r("rankable", 1, gp("posts", 2)), r("rankable", 1, gp("uploaded", 3 * 1024 ** 3)))).toBeLessThan(
      0,
    );
  });
  it("算不出缺口排在缺口 0 之后（不知道 ≠ 只差一步）", () => {
    expect(compareLevelProgress(r("rankable", 2, gp("posts", 0)), r("rankable", 2, null))).toBeLessThan(0);
  });
  it("已达标（差 0 项）永远在最前，哪怕算不出缺口", () => {
    expect(compareLevelProgress(r("rankable", 0, null), r("rankable", 1, gp("posts", 0)))).toBeLessThan(0);
  });
  it("非 rankable 档内不比缺口（都是 null，交给站点名兜底）", () => {
    expect(compareLevelProgress(r("maxed", 0, null), r("maxed", 0, null))).toBe(0);
  });
  it("完全并列返回 0", () => {
    expect(compareLevelProgress(r("rankable", 1, gp("posts", 5)), r("rankable", 1, gp("posts", 5)))).toBe(0);
  });
});

it("整批混排：单条都对不等于整批排得对", () => {
  const GiB = 1024 ** 3;
  const rows = [
    { n: "已到底级", ...r("maxed", 0, null) },
    { n: "差 1 项·还差 3 GiB", ...r("rankable", 1, gp("uploaded", 3 * GiB)) },
    { n: "已达标", ...r("rankable", 0, null) },
    { n: "站点没给等级表", ...r("noRequirements", 0, null) },
    { n: "差 1 项·还差 2 个帖子", ...r("rankable", 1, gp("posts", 2)) },
    { n: "差 2 项·等级积分不可比", ...r("rankable", 2, null) },
    { n: "差 3 项·还差 1 GiB", ...r("rankable", 3, gp("downloaded", GiB)) },
    { n: "贵宾", ...r("special", 0, null) },
    { n: "差 1 项·算不出", ...r("rankable", 1, null) },
    { n: "没取到等级", ...r("noLevel", 0, null) },
  ];
  const order = [...rows]
    .sort((a, b) => compareLevelProgress(a, b) || a.n.localeCompare(b.n, "zh"))
    .map((x) => x.n);
  // 「差 3 项·还差 1 GiB」不该插到任何「差 1 项」前面 —— 「离升级更近」的第一层仍是差几项。
  // 差 2 项·等级积分不可比落在所有「有缺口」的差 2 项位置之后、差 3 项之前：
  // 那一格是复合分（还差 35 分 = 7000 点魔力值），把 35 摆进字节堆里比大小是假信号，所以它不供缺口。
  // 同一档内 2 个帖子排在 3 GiB 之前 —— 这是绝对量口径的形状，不是缺陷（见上一条用例）。
  expect(order).toEqual([
    "已达标",
    "差 1 项·还差 2 个帖子",
    "差 1 项·还差 3 GiB",
    "差 1 项·算不出",
    "差 2 项·等级积分不可比",
    "差 3 项·还差 1 GiB",
    "已到底级",
    "贵宾",
    "没取到等级",
    "站点没给等级表",
  ]);
});
