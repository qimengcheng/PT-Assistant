/**
 * 「下载器里这一条值不值得拿去辅种」的判据（`src/shared/reseedCandidate.ts`）。
 *
 * 为什么这一条要进 Vitest：它给界面上那枚「待辅 N 站」供货，而那个 N 是一句**看起来像事实**的话。
 * 判错的两种方向都得钉住：把「已经挂满」读成「还能辅」（让人白搜一遍），以及反过来把一条
 * 明明能查的内容判成「说不了」而整行静默（v0.117.1 改掉的那一档，见判据文件头）。
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
      partial: false,
    });
  });

  it("进度报满而数据没下完 → partial（界面上那一枚「只下载了部分文件」就是它）", () => {
    expect(judgeReseedCandidate({ completed: false, progress: 100, coveredSites: ["siteA"], usableSites: ["siteA", "siteB"] })).toEqual({
      kind: "incomplete",
      partial: true,
    });
  });

  it("还在下（进度没满）不算 partial：那一档界面上不标，标出来就是把噪声铺满列表", () => {
    expect(judgeReseedCandidate({ completed: false, progress: 60, coveredSites: ["siteA"], usableSites: ["siteA"] })).toEqual({
      kind: "incomplete",
      partial: false,
    });
    expect(judgeReseedCandidate({ completed: false, coveredSites: ["siteA"], usableSites: ["siteA"] })).toEqual({
      kind: "incomplete",
      partial: false,
    });
  });

  it("一份都认不出站 → 照算缺口、covered 报 0（v0.117.1：这一档不再静默）", () => {
    // 原先这一档提前返回 `no-site`、界面上什么都不画。代价不只是「少一枚标记」：
    // `pendingRowKeys` 只认 candidate，于是那一类行连「待查的 N 条」扫描范围都进不去 = 永久看不见。
    // 「待查 N 站」在这一档是真话（N 个站确实一个都没查过），假话只有「已挂 0 站」那半 —— 交给界面换掉。
    expect(judgeReseedCandidate({ completed: true, coveredSites: [], usableSites: ["siteA", "siteB"] })).toEqual({
      kind: "candidate",
      pending: 2,
      covered: 0,
    });
  });

  it("认不出站的那一条查完全部站点 → 出 scanned，那份结论不许在缺口那一步之前就被丢掉", () => {
    const verdict = judgeReseedCandidate({
      completed: true,
      coveredSites: [],
      usableSites: ["siteA", "siteB"],
      scannedSites: ["siteA", "siteB"],
      scannedVerdicts: [
        { siteId: "siteA", verdict: "hasIt" },
        { siteId: "siteB", verdict: "noMatch" },
      ],
    });
    expect(verdict).toEqual({ kind: "scanned", scanned: 2, covered: 0, tally: { hasIt: 1, suspect: 0, noMatch: 1, failed: 0 } });
  });

  it("认不出站这一档压在下完之后：没下完就报没下完，不报缺口", () => {
    expect(judgeReseedCandidate({ completed: false, coveredSites: [], usableSites: ["siteA"] })).toEqual({ kind: "incomplete", partial: false });
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
    // 认不出站 + 一个站都没添加：走的是同一条「没有可辅目标」，不许退成「待查 0 站」
    expect(judgeReseedCandidate({ completed: true, coveredSites: [], usableSites: [] })).toEqual({
      kind: "all-covered",
      covered: 0,
    });
  });
});

/**
 * 「查过了」这一档（v0.109.8）。
 *
 * 用户 2026-10-18 那句话是这一族的来由：「已经查过的在下载器里要标记出来，不再显示有多少站待查了」。
 * 两条方向都要钉：查过一半的**不许再算进待查数**（否则那个数永远不减），
 * 一条都没查过的**不许被当成查过**（否则扫描还没跑就把人挡在门外）。
 */
describe("judgeReseedCandidate：查过的站不再算待查", () => {
  it("没给扫描事实时照旧按「未挂的全部站点」报缺口（结论还没读到 ≠ 已经查过）", () => {
    expect(judgeReseedCandidate(oneCovered)).toEqual({ kind: "candidate", pending: 2, covered: 1 });
  });

  it("两站里查过一站 → 待查只剩一站", () => {
    expect(judgeReseedCandidate({ ...oneCovered, scannedSites: ["siteB"] })).toEqual({ kind: "candidate", pending: 1, covered: 1 });
  });

  it("没挂的那两站都查过 → 出 scanned 档，不再报待查", () => {
    const verdict = judgeReseedCandidate({
      ...oneCovered,
      scannedSites: ["siteB", "siteC"],
      scannedVerdicts: [
        { siteId: "siteB", verdict: "noMatch" },
        { siteId: "siteC", verdict: "hasIt" },
      ],
    });
    expect(verdict).toEqual({
      kind: "scanned",
      scanned: 2,
      covered: 1,
      tally: { hasIt: 1, suspect: 0, noMatch: 1, failed: 0 },
    });
  });

  it("已经挂在的那个站即使出现在扫描结论里，也不占「已查」那一格", () => {
    // 那些站本来就不该被排进查询计划（查了也是白查），但结论表里可能留着旧记录
    expect(judgeReseedCandidate({ ...oneCovered, scannedSites: ["siteA", "siteB"] })).toEqual({ kind: "candidate", pending: 1, covered: 1 });
  });

  it("「这次没查成」与「没搜到」不许并档：前者过一会儿还要再查", () => {
    const verdict = judgeReseedCandidate({
      completed: true,
      coveredSites: ["siteA"],
      usableSites: ["siteA", "siteB", "siteC"],
      scannedSites: ["siteB", "siteC"],
      scannedVerdicts: [
        { siteId: "siteB", verdict: "failed" },
        { siteId: "siteC", verdict: "noMatch" },
      ],
    });
    expect(verdict.kind === "scanned" && verdict.tally).toEqual({ hasIt: 0, suspect: 0, noMatch: 1, failed: 1 });
  });

  it("结论表里没有的站不算查过：只有 scannedSites 报了、四档没记，也不许凭空造一档", () => {
    const verdict = judgeReseedCandidate({
      completed: true,
      coveredSites: ["siteA"],
      usableSites: ["siteA", "siteB"],
      scannedSites: ["siteB"],
    });
    expect(verdict).toEqual({ kind: "scanned", scanned: 1, covered: 1, tally: { hasIt: 0, suspect: 0, noMatch: 0, failed: 0 } });
  });

  it("同一个站被记了两次结论，只数一次", () => {
    const verdict = judgeReseedCandidate({
      completed: true,
      coveredSites: ["siteA"],
      usableSites: ["siteA", "siteB"],
      scannedSites: ["siteB", "siteB"],
      scannedVerdicts: [
        { siteId: "siteB", verdict: "hasIt" },
        { siteId: "siteB", verdict: "noMatch" },
      ],
    });
    expect(verdict.kind === "scanned" && verdict.scanned).toBe(1);
    expect(verdict.kind === "scanned" && verdict.tally.hasIt).toBe(1);
    expect(verdict.kind === "scanned" && verdict.tally.noMatch).toBe(0);
  });

  it("没下完的那条压住一切：站点全查过了也照样只报「没下完」", () => {
    expect(
      judgeReseedCandidate({
        completed: false,
        coveredSites: ["siteA"],
        usableSites: ["siteA", "siteB"],
        scannedSites: ["siteB"],
      }).kind,
    ).toBe("incomplete");
  });
});

