/**
 * 「每页条数按面板实高算」那半截算术（判据在 `src/options/directives/useAutoFitPageSize.ts`）。
 *
 * 为什么要单独钉：那一圈是**读写同源自带反馈**的 —— 它写回的条数决定渲染多少行，渲染多少行
 * 又决定下一次量的行高与可用高。这种结构坏起来的形状不是「差一档」，是**永远来回写**：
 * 用户 2026-10-18 在辅种任务页点了一下展开，标签页直接报 Out of Memory，台架量到的就是
 * 每页条数在 11 ↔ 12 之间一路写下去、每写一次重画一整张表。
 *
 * 两半各有各的错形，所以各有一族断言：
 * - **单位**：树形数据（条目挂在任务行下面）时子行也在同一个 `<tbody>` 里，
 *   「渲染行数」比「这一页的记录数」多出子行那一截。退行那一支原先拿的是渲染行数 − 1，
 *   展开两条子行时它比当前档还大 —— 退变成了涨。占竖向空间的判据数全部行，写回和记上限
 *   数记录行，这一族断言钉的就是这条分界。
 * - **换轮判据**：原先把 avail 本身摆进轮次身份做等值比较，而 avail 里减掉了横向滚动条
 *   厚度、那个厚度随行数取整，实测晃 1px 就把「退过一次就不再涨回去」的上限清空。
 *   现在改成比差值，阈值 24px 卡在「1px 抖动」与「分页器 56px」之间。
 *
 * DOM 那半截（量 rect、挂观察者）Node 里造不出来，归台架 `.tmp-build/bench-taskexpand`；
 * 这里只测纯算术，所以夹具用的是台架量到的真实数（行高 59、可用高 672）。
 */
import { describe, expect, it } from "vitest";

import { isNewEpoch, nextAutoFitOf } from "@/options/directives/useAutoFitPageSize.ts";

/** 一行的实测高（辅种任务那一页 59px 那一档） */
const H = 59;
/** 面板实高 793 减掉内衬 16、表头 38、分页器 56、横滚条 11 之后剩下的那一截 */
const AVAIL = 672;

/** 记录行 + 子行造一份取样：`records` 条任务、`subs` 条挂开的条目 */
function sample(records: number, subs = 0, recordHeight = H, subHeight = H) {
  return {
    heights: [...Array.from({ length: records }, () => recordHeight), ...Array.from({ length: subs }, () => subHeight)],
    recordHeights: Array.from({ length: records }, () => recordHeight),
  };
}

/** 从 fitted 起把 ② 连着跑，直到它自己停下来；返回写过的每一档 */
function runUntilStill(start: number, sam: (fitted: number) => ReturnType<typeof sample>, avail = AVAIL, seeded = true, ceiling = Number.POSITIVE_INFINITY) {
  const trail: number[] = [];
  let fitted = start;
  let wasSeeded = seeded;
  let wasCeiling = ceiling;
  for (let i = 0; i < 30; i++) {
    const out = nextAutoFitOf({ avail, sample: sam(fitted), fitted, seeded: wasSeeded, ceiling: wasCeiling, min: 1 });
    wasSeeded = out.seeded;
    wasCeiling = out.ceiling;
    if (out.next === null) return { trail, fitted };
    trail.push(out.next);
    fitted = out.next;
  }
  return { trail, fitted, ranAway: true };
}

describe("① 定初值", () => {
  it("平铺表按平均行高铺满", () => {
    const out = nextAutoFitOf({ avail: AVAIL, sample: sample(25), fitted: 0, seeded: false, ceiling: Infinity, min: 1 });
    expect(out.next).toBe(11); // floor(672 / 59)
    expect(out.seeded).toBe(true);
  });

  it("子行比记录行高时，初值按记录行的平均高算，不把两种行混在一起平均", () => {
    // 11 条 59px 的任务 + 2 条 120px 的条目：混在一起平均会把初值压到 9，
    // 而「一页放几条」的单位是任务条数；超没超由 ② 去退。
    const out = nextAutoFitOf({ avail: AVAIL, sample: sample(11, 2, H, 120), fitted: 0, seeded: false, ceiling: Infinity, min: 1 });
    expect(out.next).toBe(11);
  });

  it("空表 / 算不出可用高时什么都不写，也不把本轮标成已量过", () => {
    const empty = nextAutoFitOf({ avail: AVAIL, sample: { heights: [], recordHeights: [] }, fitted: 0, seeded: false, ceiling: Infinity, min: 1 });
    expect(empty).toEqual({ next: null, seeded: false, ceiling: Infinity });
    const noAvail = nextAutoFitOf({ avail: 0, sample: sample(11), fitted: 0, seeded: false, ceiling: Infinity, min: 1 });
    expect(noAvail.seeded).toBe(false);
  });
});

describe("②a 往回退", () => {
  it("平铺表退到「渲染记录数 − 1」并把它记成上限", () => {
    const out = nextAutoFitOf({ avail: AVAIL, sample: sample(25), fitted: 25, seeded: true, ceiling: Infinity, min: 1 });
    expect(out.next).toBe(24);
    expect(out.ceiling).toBe(24);
  });

  it("树形数据退的是记录条数，不是渲染行数（这一条钉住那次 OOM 的单位混淆）", () => {
    // 11 条任务 + 2 条挂开的条目 = 13 行超了可用高。旧写法给 13 − 1 = 12，比当前档还大，
    // 于是「退」变成「涨」，而涨完又超 —— 按记录数是 11 − 1 = 10。
    const out = nextAutoFitOf({ avail: AVAIL, sample: sample(11, 2), fitted: 11, seeded: true, ceiling: Infinity, min: 1 });
    expect(out.next).toBe(10);
    expect(out.ceiling).toBe(10);
  });

  it("展开两条子行之后连着退，必须自己落到一个不再动的档位（旧写法在这一步永远不落）", () => {
    const { trail, fitted } = runUntilStill(11, (n) => sample(n, 2));
    expect(trail).toEqual([10, 9]);
    expect(fitted).toBe(9); // 9 条任务 + 2 条目 = 11 行 × 59 = 649 ≤ 672
    expect(fitted).toBeLessThan(11); // 条数只许往低走
  });

  it("退到只剩一条就不再往下写（min 兜住，不会出现每页 0 条）", () => {
    const out = nextAutoFitOf({ avail: 100, sample: sample(1, 2), fitted: 1, seeded: true, ceiling: Infinity, min: 1 });
    expect(out.next).toBeNull();
    expect(out.ceiling).toBe(0);
  });
});

describe("②b 往上加", () => {
  it("满页而缝隙还放得下最高那一行才加", () => {
    const out = nextAutoFitOf({ avail: AVAIL, sample: sample(9), fitted: 9, seeded: true, ceiling: Infinity, min: 1 });
    expect(out.next).toBe(10); // 672 − 531 = 141 ≥ 59
  });

  it("缝隙只够半行就不加（这就是「不出滚动条」那一半）", () => {
    const out = nextAutoFitOf({ avail: AVAIL, sample: sample(11), fitted: 11, seeded: true, ceiling: Infinity, min: 1 });
    expect(out.next).toBeNull(); // 672 − 649 = 23 < 59
  });

  it("不满的一页没有「还能不能再塞」可判，直接收敛", () => {
    const out = nextAutoFitOf({ avail: AVAIL, sample: sample(3), fitted: 11, seeded: true, ceiling: Infinity, min: 1 });
    expect(out.next).toBeNull();
  });

  it("「满页」也按记录数判：子行不能把不满的一页遮成满页", () => {
    // 这一屏只有 9 条记录 + 3 条子行 = 12 行，而容量档是 11。按渲染行数判满不满，
    // 12 ≥ 11 会把它当成满页，于是缝隙够就一直加 —— 加到把整份数据并成一页，
    // 那正是文件头写的「末页只剩三行时缝隙恒常很大」那一族。
    const out = nextAutoFitOf({ avail: 800, sample: sample(9, 3), fitted: 11, seeded: true, ceiling: Infinity, min: 1 });
    expect(out.next).toBeNull();
  });

  it("退到过的那一档就是本轮上限，同一轮不再涨回去", () => {
    const out = nextAutoFitOf({ avail: AVAIL, sample: sample(10), fitted: 10, seeded: true, ceiling: 10, min: 1 });
    expect(out.next).toBeNull(); // 缝隙够，但 10 已经是本轮退到的位置
  });

  it("缝隙要装得下**含子行**的最高那一行才加", () => {
    // 11 条 59px + 2 条 300px：sum 1249 ≤ avail 1360，剩 111px。
    // 111 比一条记录行（59）高，但比最高的那一行（300 的条目行）矮 —— 按「全部行里最高的」判就不加，
    // 保守一档是故意的：加进去的是一条任务，而它可能带着子行一起把这一屏顶出去。
    const out = nextAutoFitOf({ avail: 1360, sample: sample(11, 2, H, 300), fitted: 11, seeded: true, ceiling: Infinity, min: 1 });
    expect(out.next).toBeNull();
    // 同一批行换个放不下的高度：走退行那一支，仍按记录数退
    const shrink = nextAutoFitOf({ avail: 700, sample: sample(11, 2, H, 300), fitted: 11, seeded: true, ceiling: Infinity, min: 1 });
    expect(shrink.next).toBe(10);
  });
});

describe("换轮判据：avail 只当「结构变了」的信号，不当等值判据", () => {
  it("首轮必定重开（prevKey 是空串，prevAvail 是 NaN）", () => {
    expect(isNewEpoch({ key: "793|45|10", prevKey: "", avail: AVAIL, prevAvail: Number.NaN })).toBe(true);
  });

  it("自己写回条数带出来的那 1px 抖动不算换轮", () => {
    expect(isNewEpoch({ key: "793|45|10", prevKey: "793|45|10", avail: 673.2, prevAvail: 672.2 })).toBe(false);
  });

  it("分页器出现/消失那 56px 要算换轮", () => {
    expect(isNewEpoch({ key: "793|45|10", prevKey: "793|45|10", avail: 728, prevAvail: 672 })).toBe(true);
  });

  it("面板变高 / 数据换了一批 / 显示列增减都算换轮", () => {
    for (const key of ["900|45|10", "793|6|10", "793|45|12"]) {
      expect(isNewEpoch({ key, prevKey: "793|45|10", avail: AVAIL, prevAvail: AVAIL })).toBe(true);
    }
  });
});
