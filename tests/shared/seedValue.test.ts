/**
 * 「这条种子还值不值得继续做种」的判据（`src/shared/seedValue.ts`）。
 *
 * 为什么进 Vitest：它给界面上那句「时魔产出低」供货，而那句话的下游动作是删种 —— 判错的代价是
 * 删掉一条要重下、还会掉站点考核的种子。方向两种都要钉：把不产出的算成产出（诱导他留），
 * 和把在产出的算成不产出（诱导他删）。
 *
 * 大小、时间、人数一律合成。期望值是按 NexusPHP 那套公式手算出来的常数，不在测试里再抄一遍实现。
 */
import { describe, expect, it } from "vitest";

import { judgeSeedValue, SEED_VALUE_TIERS, type ISeedValueCopy } from "@/shared/seedValue.ts";

const WEEK = 7 * 24 * 3600;
const GIB = 1024 ** 3;
const now = 1_800_000_000;

/** 一份「50 GiB、3 个做种者、已经做种半年、正在做种」的副本：公式的期望值约 82.82 */
function copy(over: Partial<ISeedValueCopy> = {}): ISeedValueCopy {
  return {
    siteId: "siteA",
    completed: true,
    seeding: true,
    totalSize: 50 * GIB,
    swarmSeeders: 3,
    seedingSince: now - 26 * WEEK,
    totalUploaded: 100 * GIB,
    uploadSpeed: 0,
    ...over,
  };
}

const judge = (...copies: ISeedValueCopy[]) => judgeSeedValue({ copies, now });

describe("时魔公式的三个因子", () => {
  it("50 GiB · 3 个做种者 · 半年 → 权重约 82.82（三个因子各按公式折一次）", () => {
    const verdict = judge(copy());
    expect(verdict.weight).toBeCloseTo(82.82, 1);
    expect(verdict.tier).toBe("high");
  });

  it("只有你一个人在做种 → 权重最高（1 + √2 那一档，约 120.71）", () => {
    expect(judge(copy({ swarmSeeders: 1 })).weight).toBeCloseTo(120.71, 1);
  });

  it("做种人数越多权重越低，但只低到贴着 1 为止（约 50.05，不会掉到一半）", () => {
    expect(judge(copy({ swarmSeeders: 20 })).weight).toBeCloseTo(50.05, 1);
  });

  it("同样大小同样人数，刚满一周的新种明显低于半年老种（Ci 那一档就是「越老越值」）", () => {
    const young = judge(copy({ seedingSince: now - WEEK }));
    expect(young.weight).toBeCloseTo(36.26, 1);
    expect(young.weight).toBeLessThan(judge(copy()).weight);
  });

  it("大小翻倍 → 权重翻倍（Si 是线性项，别的地方偷偷开根号就会被这条抓到）", () => {
    expect(judge(copy({ totalSize: 100 * GIB })).weight).toBeCloseTo(judge(copy()).weight * 2, 1);
  });
});

describe("一份内容挂多个站 = 多份产出（用户 2026-10-19 纠正的那条，方向不许再翻回去）", () => {
  it("同一份内容在两个站做种 → 权重相加，不是「冗余所以可删」", () => {
    const one = judge(copy()).weight;
    const two = judge(copy({ siteId: "siteA" }), copy({ siteId: "siteB" }));
    expect(two.weight).toBeCloseTo(one * 2, 1);
    expect(two.seedingCopies).toBe(2);
    expect(two.siteCount).toBe(2);
  });

  it("同一站挂两份（两个下载器各一份）：站数 1、份数 2、权重仍算两份", () => {
    // 这三个数各有各的单位，混成一个就必然有一个是错的（`siteCount` 答的是「几个站」，
    // 而魔力是各站按副本分别发的，所以 `weight` 跟 `seedingCopies` 走）
    const verdict = judge(copy({ siteId: "siteA" }), copy({ siteId: "siteA" }));
    expect(verdict.siteCount).toBe(1);
    expect(verdict.seedingCopies).toBe(2);
    expect(verdict.weight).toBeCloseTo(judge(copy({ siteId: "siteA" })).weight * 2, 1);
  });

  it("磁盘占用取的是去重后的大小，不是各份相加（一份内容挂 5 个站也只占一份）", () => {
    const verdict = judge(copy(), copy({ siteId: "siteB" }), copy({ siteId: "siteC" }));
    expect(verdict.bytes).toBe(50 * GIB);
    // 上传量反过来是要相加的：各站各自统计它的上传
    expect(verdict.uploaded).toBe(300 * GIB);
  });

  it("认不出站点的那一份照算进产出，只是站点那一栏少一个", () => {
    const verdict = judge(copy({ siteId: "siteA" }), copy({ siteId: undefined }));
    expect(verdict.seedingCopies).toBe(2);
    expect(verdict.siteCount).toBe(1);
    expect(verdict.unknownSiteCopies).toBe(1);
    expect(verdict.weight).toBeGreaterThan(0);
  });
});

describe("哪些副本不许进合计", () => {
  it("暂停着的那一份不产出时魔：只有它在做种时判 idle，不判 low", () => {
    const verdict = judge(copy({ seeding: false }));
    expect(verdict.tier).toBe("idle");
    expect(verdict.weight).toBe(0);
    expect(verdict.seedingCopies).toBe(0);
    expect(verdict.siteCount).toBe(0);
  });

  it("只勾选下载了部分文件的那一份同样不进（数据不全，站点按整条算）", () => {
    expect(judge(copy({ completed: false })).tier).toBe("idle");
  });

  it("同内容里「在做种的 + 暂停着的」混着：只折在做种那一份，份数仍报 2", () => {
    const verdict = judge(copy(), copy({ siteId: "siteB", seeding: false }));
    expect(verdict.seedingCopies).toBe(1);
    expect(verdict.copies).toBe(2);
    expect(verdict.weight).toBeCloseTo(82.82, 1);
  });

  it("暂停着的那一份：siteId 仍在明细里，但 counted 必须是 false（界面列「在做种的站点」只认这一个）", () => {
    // 这一条钉的是显示层的一处 tempting shortcut：拿 `weight !== null` 筛明细。
    // 那一档会把「在做种、但大小或时间报不出」的那份一起漏掉，站点名就少一个。
    const verdict = judge(copy({ seeding: false }), copy({ siteId: "siteB", seedingSince: undefined }));
    expect(verdict.details[0]!.siteId).toBe("siteA");
    expect(verdict.details[0]!.counted).toBe(false);
    expect(verdict.details[1]!.counted).toBe(true);
    expect(verdict.details[1]!.weight).toBeNull();
    expect(verdict.seedingCopies).toBe(1);
    expect(verdict.siteCount).toBe(1);
  });
});

describe("数据报不出时不许编", () => {
  it("缺开始做种时间 → 这一份不产权重（Ci 凭空取 1 是把昨天刚下的当老年种）", () => {
    const verdict = judge(copy({ seedingSince: undefined }));
    expect(verdict.tier).toBe("unknown");
    expect(verdict.incomplete).toBe(1);
    expect(verdict.details[0]!.notes).toEqual(["no-since"]);
    expect(verdict.details[0]!.weight).toBeNull();
  });

  it("缺大小 → no-size，同样不产权重", () => {
    const verdict = judge(copy({ totalSize: 0 }));
    expect(verdict.details[0]!.notes).toEqual(["no-size"]);
    expect(verdict.tier).toBe("unknown");
  });

  it("缺做种人数 → Di 取下界 1（低估），这一份仍然产权重并标 no-seeders", () => {
    const verdict = judge(copy({ swarmSeeders: undefined }));
    expect(verdict.details[0]!.notes).toEqual(["no-seeders"]);
    expect(verdict.details[0]!.weight).not.toBeNull();
    expect(verdict.weight).toBeCloseTo(50, 0);
    expect(verdict.incomplete).toBe(0);
  });

  it("一条算得出、一条算不出 → 合计只数算得出的那份，但 incomplete 要报出来", () => {
    const verdict = judge(copy(), copy({ siteId: "siteB", seedingSince: undefined }));
    expect(verdict.weight).toBeCloseTo(82.82, 1);
    expect(verdict.incomplete).toBe(1);
  });
});

describe("分档的两个边界", () => {
  /**
   * 造一条权重**逐字等于大小（GiB 数）**的副本：`Ci` 那一项在 1000 周时是 `1 - 1e-250`，
   * 双精度下就是 1；`Di` 在做种人数报不出时取下界 1。两个因子都精确为 1，边界才钉得准 ——
   * 否则「刚好等于阈值」那一档会被浮点误差推到边界另一侧，测出来的是误差不是判据。
   */
  const copyWithWeight = (target: number) =>
    copy({ swarmSeeders: undefined, seedingSince: now - 1000 * WEEK, totalSize: target * GIB });

  it(`低于 ${SEED_VALUE_TIERS.lowBelow} 判 low，等于它判 normal（阈值是取向，边界要钉住）`, () => {
    expect(judge(copyWithWeight(SEED_VALUE_TIERS.lowBelow - 1)).tier).toBe("low");
    expect(judge(copyWithWeight(SEED_VALUE_TIERS.lowBelow)).tier).toBe("normal");
  });

  it(`等于 ${SEED_VALUE_TIERS.highFrom} 就判 high，差一点判 normal`, () => {
    expect(judge(copyWithWeight(SEED_VALUE_TIERS.highFrom - 1)).tier).toBe("normal");
    expect(judge(copyWithWeight(SEED_VALUE_TIERS.highFrom)).tier).toBe("high");
  });

  it("当前有没有在传：任一份速度 > 0 就算活跃，暂停着的那份速度再高也不算", () => {
    expect(judge(copy({ uploadSpeed: 512_000 }), copy({ siteId: "siteB", seeding: false, uploadSpeed: 9e6 })).active).toBe(true);
    expect(judge(copy({ seeding: false, uploadSpeed: 9e6 })).active).toBe(false);
  });
});
