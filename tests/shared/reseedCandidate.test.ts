/**
 * 「下载器里这一条值不值得拿去辅种」的判据（`src/shared/reseedCandidate.ts`）。
 *
 * 为什么这一条要进 Vitest：它给界面上那枚「待辅 N 站」供货，而那个 N 是一句**看起来像事实**的话。
 * 判错的方向有两种，都得钉住：把「不知道挂在哪个站」读成「还差一整片站」（虚报缺口），
 * 以及把「已经挂满」读成「还能辅」（让人白搜一遍）。
 * 站点 id 与数字一律合成，不写真实账号的流量。
 */
import { describe, expect, it } from "vitest";

import { judgeReseedCandidate } from "@/shared/reseedCandidate.ts";

/** 三个已添加的站点，其中这份内容只挂在 siteA 上 */
const oneCovered = { completed: true, coveredSites: ["siteA"], usableSites: ["siteA", "siteB", "siteC"] };

describe("judgeReseedCandidate：四档各管一件事", () => {
  it("内容完整、已挂一站、还有两站没挂 → 报缺口 2", () => {
    expect(judgeReseedCandidate(oneCovered)).toEqual({ kind: "candidate", pending: 2, covered: 1 });
  });

  it("已挂的那一站不算进缺口（同一份内容不该被自己顶掉一格）", () => {
    const verdict = judgeReseedCandidate({ ...oneCovered, usableSites: ["siteA", "siteB"] });
    expect(verdict).toEqual({ kind: "candidate", pending: 1, covered: 1 });
  });

  it("同内容的另一份副本挂在别处 → 并集进来，缺口跟着变小（折叠看不见的那些副本也要算）", () => {
    expect(judgeReseedCandidate({ ...oneCovered, coveredSites: ["siteA", "siteB"] })).toEqual({
      kind: "candidate",
      pending: 1,
      covered: 2,
    });
  });

  it("没下完排第一：哪怕缺口最大，也不许给出「可辅」", () => {
    expect(judgeReseedCandidate({ completed: false, coveredSites: ["siteA"], usableSites: ["siteA", "siteB", "siteC"] })).toEqual({
      kind: "incomplete",
    });
  });

  it("一份都认不出站 → no-site，不许读成「还差全部站点」", () => {
    const verdict = judgeReseedCandidate({ completed: true, coveredSites: [], usableSites: ["siteA", "siteB"] });
    expect(verdict.kind).toBe("no-site");
    // 对照：真去算缺口会虚报成 2 —— 那是把「不知道」说成了事实
    expect(verdict).not.toEqual({ kind: "candidate", pending: 2, covered: 0 });
  });

  it("认不出站这一档压在下完之后：没下完就报没下完，不报认不出", () => {
    expect(judgeReseedCandidate({ completed: false, coveredSites: [], usableSites: ["siteA"] })).toEqual({ kind: "incomplete" });
  });

  it("已添加的站点全挂上了 → all-covered，界面上那枚标记不该出现", () => {
    expect(judgeReseedCandidate({ completed: true, coveredSites: ["siteA", "siteB"], usableSites: ["siteA", "siteB"] })).toEqual({
      kind: "all-covered",
      covered: 2,
    });
  });

  it("只添加了一个站且已挂上 → all-covered（没有第二个站，谈不上辅）", () => {
    expect(judgeReseedCandidate({ completed: true, coveredSites: ["siteA"], usableSites: ["siteA"] })).toEqual({
      kind: "all-covered",
      covered: 1,
    });
  });

  it("挂在一张已从表里消失的站上，也不算缺口：缺口只按「已添加且可用」那一侧数", () => {
    // covered 里有 siteZ（用户删掉了这个站 / 或反查表还没更新），usable 里没有它
    expect(judgeReseedCandidate({ completed: true, coveredSites: ["siteZ"], usableSites: ["siteA", "siteB"] })).toEqual({
      kind: "candidate",
      pending: 2,
      covered: 1,
    });
  });

  it("脏数据里的空站点 id 丢掉：空串既不算已挂，也不该被数进缺口", () => {
    expect(judgeReseedCandidate({ completed: true, coveredSites: ["", "siteA"], usableSites: ["", "siteA", "siteB"] })).toEqual({
      kind: "candidate",
      pending: 1,
      covered: 1,
    });
  });

  it("一个站都没添加时不说「可辅」：缺口无从谈起", () => {
    expect(judgeReseedCandidate({ completed: true, coveredSites: ["siteA"], usableSites: [] })).toEqual({
      kind: "all-covered",
      covered: 1,
    });
  });
});
