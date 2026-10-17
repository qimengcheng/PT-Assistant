/**
 * 升级进度那张表的排序判据（`src/shared/levelProgress.ts`）。
 *
 * 最该被这里拦住的是三件事，它们都是用户当场定的口径，改判据的人看不见界面：
 * 1) 分档的先后顺序（v0.83.0）；
 * 2) 同档内「差几项」赢「还差多少」（v0.83.0）；
 * 3) 「还差多少」= 读达标判据折好的差额、按「上传为主下载打折」折成上传代价（用户 2026-10-17 连定两层，
 *    先推翻完成度百分比，再指出分享率本身就能把下载折成上传 —— 见文件头那两条）。
 */
import { describe, expect, it } from "vitest";

import {
  LEVEL_STATE_ORDER,
  alternativeCost,
  classifyLevelProgress,
  compareLevelProgress,
  fieldGap,
  groupCost,
  rankLevelProgress,
  type ILevelFacts,
  type ILevelGap,
  type ILevelProgressRank,
  type IProgressField,
} from "@/shared/levelProgress.ts";

const GiB = 1024 ** 3;

const f = (key: string, over: Partial<IProgressField> = {}): IProgressField => ({ key, ...over });
/** 上传档（权重 1）与下载档（权重 0.1）—— 这里自己写死这两个数，不复用调用侧的表，免得失改一处两边都绿 */
const up = (key: string, gap: number): IProgressField => ({ key, gap, weight: 1 });
const down = (key: string, gap: number): IProgressField => ({ key, gap, weight: 0.1 });
/** 没有兑换率的项（点数、帖子、时长、海胆等级积分）：计入差几项，不进综合分 */
const plain = (key: string, gap: number): IProgressField => ({ key, gap });
const g = (count: number, fields: IProgressField[] = []) => ({ count, fields });
const gp = (key: string, value: number): ILevelGap => ({ key, value });
const r = (
  state: ILevelProgressRank["state"],
  unmetCount: number,
  cost: number | null,
  gap: ILevelGap | null = null,
): ILevelProgressRank => ({ state, unmetCount, cost, gap });

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

describe("fieldGap：单项还差多少 —— 优先读达标判据折好的差额", () => {
  it("给了折好的差额就用它，哪怕「要求 − 当前」是另一个数", () => {
    // 实测形状：等级要求上传 ≥ 100 GiB（已有 200 GiB，这一项本身够），但分享率不足把需要的
    // 上传抬到 300 GiB，packages 写进 unmet 的是 100 GiB。自己减会得到 0 —— v0.106.11 就漏在这里。
    expect(fieldGap(f("uploaded", { gap: 100 * GiB, current: 200 * GiB, required: 100 * GiB }))).toBe(100 * GiB);
  });
  it("没给差额时 gt 按 要求 − 当前", () => {
    expect(fieldGap(f("uploaded", { current: 100, required: 200 }))).toBe(100);
  });
  it("没给差额时 lt 按 当前 − 要求（H&R 那一类是超得越多越差）", () => {
    expect(fieldGap(f("hnrUnsatisfied", { current: 5, required: 0, direction: "lt" }))).toBe(5);
  });
  it("方向该给 lt 却给了 gt → 缺口塌成 0（所以 direction 必须由调用方点名）", () => {
    expect(fieldGap(f("hnrUnsatisfied", { current: 5, required: 0 }))).toBe(0);
  });
  it("当前已反超给 0 而不是负数（负代价会把这一行排到所有站前面）", () => {
    expect(fieldGap(f("uploaded", { current: 300, required: 200 }))).toBe(0);
  });
  it("折好的差额是 0 就用 0（packages 确实会把「已够」的那一项写成 0）", () => {
    expect(fieldGap(f("uploaded", { gap: 0 }))).toBe(0);
  });
  it("差额不是数字 → null", () => {
    expect(fieldGap(f("bonus", { gap: Number.NaN }))).toBeNull();
  });
  it("回退时当前值是 -1 那种「报不出」哨兵 → null，不变成一个看着像真数的缺口", () => {
    expect(fieldGap(f("ratio", { current: -1, required: 2 }))).toBeNull();
  });
  it("回退时当前值是 Infinity → null（fixRatio 在「有上传量、下载量 0」时就是这么报的）", () => {
    expect(fieldGap(f("ratio", { current: Number.POSITIVE_INFINITY, required: 2 }))).toBeNull();
  });
  it("既没差额又缺当前值/要求值 → null", () => {
    expect(fieldGap(f("uploaded"))).toBeNull();
    expect(fieldGap(f("uploaded", { current: 10 }))).toBeNull();
  });
});

describe("groupCost：一组（要全满足才算过）的代价与代表项", () => {
  it("加权项的代价相加，不是取最大 —— 升这一级这些差额都得补", () => {
    expect(groupCost(g(2, [up("uploaded", 100), down("downloaded", 100)]))).toEqual({ cost: 110, worst: gp("uploaded", 100) });
  });
  it("代表项取代价最大的那一项，但给的是它的**原始缺口**（折过权重的数不上界面）", () => {
    expect(groupCost(g(2, [up("uploaded", 30), down("downloaded", 500)])).worst).toEqual(gp("downloaded", 500));
  });
  it("没有兑换率的项一项都不加权 → 代价 null（不是 0：0 意味着「只差一步」）", () => {
    expect(groupCost(g(2, [plain("posts", 18), plain("seedingBonus", 35)]))).toEqual({ cost: null, worst: null });
  });
  it("算不出缺口的加权项不掺进总分", () => {
    expect(groupCost(g(2, [up("uploaded", 100), f("trueUploaded", { current: Number.NaN, required: 50, weight: 1 })]))).toEqual(
      { cost: 100, worst: gp("uploaded", 100) },
    );
  });
  it("权重给 0 是「不计代价」，仍然算有数（与不给权重=不知道两档）", () => {
    expect(groupCost(g(1, [f("downloaded", { gap: 100, weight: 0 })])).cost).toBe(0);
  });
  it("组里没有可算项 → null", () => {
    expect(groupCost(g(2, []))).toEqual({ cost: null, worst: null });
  });
});

describe("alternativeCost：可选要求取最省那一条", () => {
  it("各方案里挑代价最小的那条", () => {
    expect(alternativeCost([g(1, [up("uploaded", 100)]), g(1, [down("downloaded", 500)])])).toEqual({
      cost: 50,
      worst: gp("downloaded", 500),
    });
  });
  it("一条方案内部仍是各项相加", () => {
    expect(alternativeCost([g(2, [up("uploaded", 100), down("downloaded", 100)])])).toEqual({
      cost: 110,
      worst: gp("uploaded", 100),
    });
  });
  it("所有方案都算不出代价 → null", () => {
    expect(alternativeCost([g(1, []), g(1, [plain("bonus", 900)])])).toBeNull();
  });
  it("压根没有可选要求 → null", () => {
    expect(alternativeCost([])).toBeNull();
  });
});

describe("rankLevelProgress：整行的差几项、代价与那句「还差」", () => {
  it("没有可选要求 → 条数就是主要求的条数", () => {
    expect(rankLevelProgress({ state: "rankable", primary: g(2, [up("uploaded", 100)]) }).unmetCount).toBe(2);
  });
  it("带可选要求 → 整组只算差一项，两条加起来差两项", () => {
    expect(
      rankLevelProgress({
        state: "rankable",
        primary: g(1, []),
        alternatives: [g(1, [up("uploaded", 10)]), g(1, [up("seeding", 80)])],
      }).unmetCount,
    ).toBe(2);
  });
  it("主要求与可选要求两条都要办 → 代价相加", () => {
    expect(
      rankLevelProgress({
        state: "rankable",
        primary: g(1, [up("uploaded", 100)]),
        alternatives: [g(1, [up("totalTraffic", 20)])],
      }).cost,
    ).toBe(120);
  });
  it("有一句「还差」取代价更大的那一边", () => {
    expect(
      rankLevelProgress({
        state: "rankable",
        primary: g(1, [up("uploaded", 10)]),
        alternatives: [g(1, [up("uploaded", 500)])],
      }).gap,
    ).toEqual(gp("uploaded", 500));
  });
  it("算不出代价的那一边按下界 0 计，已称出重量的那半照旧供分与那句「还差」", () => {
    // 主要求只有魔力点数（没兑换率），可选要求是 500 GiB 上传：把整行报成「不知道」就把那 500 GiB
    // 的证据抹掉了，而这一行确实还差它。另一边只能记 0 —— 这是下界，不是「那一遍不要钱」。
    expect(
      rankLevelProgress({
        state: "rankable",
        primary: g(1, [plain("bonus", 50)]),
        alternatives: [g(1, [up("uploaded", 500 * GiB)])],
      }),
    ).toEqual({ state: "rankable", unmetCount: 2, cost: 500 * GiB, gap: gp("uploaded", 500 * GiB) });
  });
  it("两边一个加权项都没有 → 代价与缺口都是 null（没有任何依据可比远近）", () => {
    expect(
      rankLevelProgress({
        state: "rankable",
        primary: g(1, [plain("bonus", 50)]),
        alternatives: [g(1, [plain("snatches", 27)])],
      }),
    ).toEqual({ state: "rankable", unmetCount: 2, cost: null, gap: null });
  });
  it("已达标那一行：差 0 项、无代价、无缺口", () => {
    expect(rankLevelProgress({ state: "rankable", primary: g(0, []) })).toEqual({
      state: "rankable",
      unmetCount: 0,
      cost: null,
      gap: null,
    });
  });
  it("分享率折进上传的那一站：代价按折好的差额算，界面上那句「还差」说的是上传", () => {
    expect(
      rankLevelProgress({
        state: "rankable",
        primary: g(2, [f("uploaded", { gap: 100 * GiB, current: 200 * GiB, required: 100 * GiB, weight: 1 }), plain("ratio", 0.67)]),
      }),
    ).toEqual({ state: "rankable", unmetCount: 2, cost: 100 * GiB, gap: gp("uploaded", 100 * GiB) });
  });
});

describe("compareLevelProgress：先分档，档内差几项，再比折成上传代价的总分", () => {
  it("五档的先后顺序就是 LEVEL_STATE_ORDER", () => {
    expect([...LEVEL_STATE_ORDER]).toEqual(["rankable", "maxed", "special", "noLevel", "noRequirements"]);
  });
  it.each([
    ["rankable 排在 maxed 前", r("rankable", 5, 100), r("maxed", 0, null)],
    ["maxed 排在 special 前", r("maxed", 0, null), r("special", 0, null)],
    ["special 排在 noLevel 前", r("special", 0, null), r("noLevel", 0, null)],
    ["noLevel 排在 noRequirements 前", r("noLevel", 0, null), r("noRequirements", 0, null)],
  ])("%s", (_label, a, b) => {
    expect(compareLevelProgress(a, b)).toBeLessThan(0);
  });
  it("同档先比差几项 —— 项数赢代价", () => {
    expect(compareLevelProgress(r("rankable", 1, 100 * GiB), r("rankable", 3, 1))).toBeLessThan(0);
  });
  it("差项数相同时比代价，小的在前", () => {
    expect(compareLevelProgress(r("rankable", 2, 5 * GiB), r("rankable", 2, 50 * GiB))).toBeLessThan(0);
  });
  it("综合而不是字典序：还差 5 GiB 上传排在还差 100 GiB 下载之前", () => {
    // 下载折成 0.1 档 ⇒ 100 GiB 下载 = 10 GiB 上传代价 > 5。若改成「先只看上传缺口」的字典序，
    // 那个只差下载的站会排到前面（它上传缺口是 0），不是用户 2026-10-17 要的形状。
    expect(compareLevelProgress(r("rankable", 1, 5 * GiB, gp("uploaded", 5 * GiB)), r("rankable", 1, 10 * GiB, gp("downloaded", 100 * GiB)))).toBeLessThan(0);
  });
  it("算不出代价排在代价 0 之后（不知道 ≠ 只差一步）", () => {
    expect(compareLevelProgress(r("rankable", 2, 0), r("rankable", 2, null))).toBeLessThan(0);
  });
  it("已达标（差 0 项）永远在最前，哪怕算不出代价", () => {
    expect(compareLevelProgress(r("rankable", 0, null), r("rankable", 1, 5 * GiB))).toBeLessThan(0);
  });
  it("非 rankable 档内不比代价（都是 null，交给站点名兜底）", () => {
    expect(compareLevelProgress(r("maxed", 0, null), r("maxed", 0, null))).toBe(0);
  });
  it("完全并列返回 0", () => {
    expect(compareLevelProgress(r("rankable", 1, 5 * GiB), r("rankable", 1, 5 * GiB))).toBe(0);
  });
});

it("整批混排：单条都对不等于整批排得对", () => {
  const rows = [
    { n: "已到底级", ...r("maxed", 0, null) },
    { n: "差 1 项·还差 10 GiB 上传", ...r("rankable", 1, 10 * GiB, gp("uploaded", 10 * GiB)) },
    { n: "已达标", ...r("rankable", 0, null) },
    { n: "站点没给等级表", ...r("noRequirements", 0, null) },
    { n: "差 2 项·还差 100 GiB 下载", ...r("rankable", 2, 10 * GiB, gp("downloaded", 100 * GiB)) },
    { n: "差 1 项·只欠 2 个帖子（不进综合分）", ...r("rankable", 1, null, null) },
    { n: "差 2 项·还差 5 GiB 上传", ...r("rankable", 2, 5 * GiB, gp("uploaded", 5 * GiB)) },
    { n: "差 1 项·还差 1 GiB 上传", ...r("rankable", 1, 1 * GiB, gp("uploaded", 1 * GiB)) },
    { n: "贵宾", ...r("special", 0, null) },
    { n: "没取到等级", ...r("noLevel", 0, null) },
  ];
  const order = [...rows]
    .sort((a, b) => compareLevelProgress(a, b) || a.n.localeCompare(b.n, "zh"))
    .map((x) => x.n);
  // 「差 2 项·还差 5 GiB」不该插到任何「差 1 项」前面 —— 第一层仍是差几项。
  // 「只欠 2 个帖子」那一行代价算不出，落在所有「有代价」的差 1 项之后：那一格是次数，
  // 站点没公布它折多少上传，硬编汇率就是替数据源编数。
  expect(order).toEqual([
    "已达标",
    "差 1 项·还差 1 GiB 上传",
    "差 1 项·还差 10 GiB 上传",
    "差 1 项·只欠 2 个帖子（不进综合分）",
    "差 2 项·还差 5 GiB 上传",
    "差 2 项·还差 100 GiB 下载",
    "已到底级",
    "贵宾",
    "没取到等级",
    "站点没给等级表",
  ]);
});
