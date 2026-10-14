/**
 * 辅种「哪一条能当基准」的判据（`src/shared/reseedRecommend.ts`）。
 *
 * 为什么这份测试现在补：v0.82.0 立这条规则时是「达标优先 + 全都低于 1 就退让」，界面上只是
 * 少个推荐；v0.105.2 按用户口径（「辅种任务不能让分享率低于 1 的站点当基准种子」）把退让那半
 * 关掉 —— 全都低于 1 时**停掉「创建任务」**。判据从「挑得更好」变成「能不能建」之后，
 * 一条误判的代价是整批辅种建不出来，所以每条边界都要能从 Node 侧断言。
 *
 * 判据本体不抄第二份：这里直接 import 源码那一份（AGENTS §2.1 的 `pnpm test` 口径）。
 */
import { describe, expect, it } from "vitest";

import {
  allBasesTooLow,
  canBeReseedBase,
  pickBaseRecommendations,
  pickDefaultBaseId,
  reseedRatioVerdict,
  type IReseedBaseCandidate,
} from "@/shared/reseedRecommend.ts";

const cand = (id: string, ratio?: unknown, seeders?: unknown, free = false): IReseedBaseCandidate => ({
  id,
  ratio,
  seeders,
  tags: free ? [{ name: "Free" }] : [],
});

describe("reseedRatioVerdict：三档分界与哨兵值", () => {
  it("低于 1 才算低，等于 1 算达标（不亏）", () => {
    expect(reseedRatioVerdict(0.99)).toBe("low");
    expect(reseedRatioVerdict(1)).toBe("ok");
    expect(reseedRatioVerdict(2.5)).toBe("ok");
  });

  it("0 是真实的低，不是缺失", () => {
    expect(reseedRatioVerdict(0)).toBe("low");
  });

  it("`-1` / `-Infinity` 是 fixRatio 的「报不出」哨兵，不许读成低", () => {
    expect(reseedRatioVerdict(-1)).toBe("unknown");
    expect(reseedRatioVerdict(-Infinity)).toBe("unknown");
  });

  it("`+Infinity`（有上传没下载）是达标里最好的一档，不是缺失", () => {
    expect(reseedRatioVerdict(Infinity)).toBe("ok");
  });

  it("没刷过用户信息 / NaN / 不是数字 → unknown", () => {
    expect(reseedRatioVerdict(undefined)).toBe("unknown");
    expect(reseedRatioVerdict(null)).toBe("unknown");
    expect(reseedRatioVerdict(NaN)).toBe("unknown");
    // 类型声明是 number，串一律按「判不出」处理（不做 parseFloat，那是 ratioGuard 那条预估的事）
    expect(reseedRatioVerdict("0.5")).toBe("unknown");
  });
});

describe("canBeReseedBase / allBasesTooLow", () => {
  it("只有明确低于 1 才拦，报不出的照旧可当", () => {
    expect(canBeReseedBase(cand("a", 0.5))).toBe(false);
    expect(canBeReseedBase(cand("b", undefined))).toBe(true);
    expect(canBeReseedBase(cand("c", -1))).toBe(true);
    expect(canBeReseedBase(cand("d", 3))).toBe(true);
  });

  it("空列表不算「全都不达标」—— 没有候选可判时不该停建", () => {
    expect(allBasesTooLow([])).toBe(false);
  });

  it("全部明确低于 1 才是 true，混进一条达标或一条报不出就都不是", () => {
    expect(allBasesTooLow([cand("a", 0.2), cand("b", 0.9)])).toBe(true);
    expect(allBasesTooLow([cand("a", 0.2), cand("b", 1)]))
      .toBe(false);
    expect(allBasesTooLow([cand("a", 0.2), cand("b", undefined)])).toBe(false);
  });
});

describe("pickDefaultBaseId", () => {
  it("取第一条能当基准的，而不是第一条", () => {
    expect(pickDefaultBaseId([cand("a", 0.4), cand("b", 2), cand("c", 1)])).toBe("b");
  });

  it("全都低于 1 时返回 null —— v0.105.2 起不再退让挑一条低的", () => {
    expect(pickDefaultBaseId([cand("a", 0.4), cand("b", 0.1)])).toBeNull();
  });

  it("报不出的当「可当」，所以有 undefined 时不会走到 null 那一档", () => {
    expect(pickDefaultBaseId([cand("a", 0.4), cand("b", undefined)])).toBe("b");
  });

  it("空列表返回 null", () => {
    expect(pickDefaultBaseId([])).toBeNull();
  });
});

describe("pickBaseRecommendations", () => {
  it("做种最多的一条、免费里做种最多的一条，各占一组", () => {
    const list = [cand("a", 2, 90), cand("b", 3, 10, true), cand("c", 1, 50)];
    expect(pickBaseRecommendations(list).map((r) => `${r.kind}:${r.id}`)).toEqual([
      "mostSeeders:a",
      "mostSeedersFree:b",
    ]);
  });

  it("两组指向同一条时只报一组（一行里两个词指的是同一份数据，读起来像有两个答案）", () => {
    // 做种最多的那条自己就是免费的 → 第二组没有另一个答案
    expect(pickBaseRecommendations([cand("a", 2, 90, true), cand("b", 3, 10)]).map((r) => r.kind)).toEqual([
      "mostSeeders",
    ]);
  });

  it("没有任何免费条目时只出第一组", () => {
    expect(pickBaseRecommendations([cand("a", 2, 90), cand("b", 3, 10)]).map((r) => r.kind)).toEqual(["mostSeeders"]);
  });

  it("低于 1 的那条不参与推荐，哪怕它做种最多", () => {
    const recs = pickBaseRecommendations([cand("bad", 0.2, 999), cand("ok", 2, 1)]);
    expect(recs.map((r) => r.id)).toEqual(["ok"]);
  });

  it("全部低于 1 → 一条都不推荐（v0.105.2 的硬闸，界面上那一整行不出）", () => {
    expect(pickBaseRecommendations([cand("a", 0.2, 999), cand("b", 0.4, 5)])).toEqual([]);
  });

  it("达标的那几条都拿不出做种数时不回头去推荐不达标的", () => {
    expect(pickBaseRecommendations([cand("ok", 2, undefined), cand("bad", 0.3, 40)])).toEqual([]);
  });
});
