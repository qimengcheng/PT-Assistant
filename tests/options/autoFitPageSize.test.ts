/**
 * 「每页条数按面板实高算」那半截算术（判据在 `src/options/directives/useAutoFitPageSize.ts`）。
 *
 * 为什么要单独钉：那一圈是**读写同源自带反馈**的 —— 它写回的条数决定渲染多少行，渲染多少行
 * 又决定下一次量的行高与可用高。这种结构坏起来的形状不是「差一档」，是**永远来回写**：
 * 用户 2026-10-18 在辅种任务页点了一下展开，标签页直接报 Out of Memory，台架量到的就是
 * 每页条数在 11 ↔ 12 之间一路写下去、每写一次重画一整张表。
 *
 * **这一圈只吃「记录行」一种单位**（v0.109.6）。树形数据（条目挂在任务行下面）时子行也排在
 * 同一个 `<tbody>` 里，v0.109.3 那版让子行参与「超没超、缝隙够不够」的判定，代价是他每展开
 * 一条、这一页就少排一条任务；用户 2026-10-18 撤掉了这一半：「如果是因为展开造成的高度变化
 * 出现的滚动条也不用管」。于是子行整个不进输入 —— `展开不参与` 那一族断言钉的就是它，
 * 而它同时意味着 v0.109.4 为「收起之后容量要涨回来」写的那套上限过期已经没有必要（没退过
 * 就没有要涨回来的东西），那半截一并删掉了。
 *
 * 剩下的两族：
 * - **收敛**：① 按记录行的平均高定初值、② 写回之后按真实累计高退/加；退过一次就记成本轮上限，
 *   同一轮不再往上涨回去（没有那条会在 12 ↔ 13 之间一路跳）。
 * - **换轮判据**：avail 里减掉了横向滚动条厚度、那个厚度随行数取整，实测晃 1px，
 *   原先拿它的等值变化当「重开一轮」就等于用输出解开自己的守卫。现在改成比差值，
 *   阈值 24px 卡在「1px 抖动」与「分页器 56px」之间。
 *
 * DOM 那半截（量 rect、把子行滤掉、挂观察者）Node 里造不出来，归台架 `.tmp-build/bench-taskexpand`；
 * 这里只测纯算术，所以夹具用的是台架量到的真实数（行高 59、可用高 672）。
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { isNewEpoch, nextAutoFitOf, SUB_ROW_FLAG } from "@/options/directives/useAutoFitPageSize.ts";

/** 一行的实测高（辅种任务那一页 59px 那一档） */
const H = 59;
/** 面板实高 793 减掉内衬 16、表头 38、分页器 56、横滚条 11 之后剩下的那一截 */
const AVAIL = 672;

/** 9 条 50px + 1 条 90px：平均 54、最高 90 —— 用来把「按平均」与「按最高」分开的夹具 */
const MIXED = [50, 50, 50, 50, 50, 50, 50, 50, 50, 90];

/**
 * 记录行的取样：给条数就每条 `recordHeight` 高，给数组就逐条自定义。
 * 展开出来的子行不在这一列里 —— 调用点就把它们滤掉了，这一圈从头到尾没见过它们。
 */
function sample(records: number | number[], recordHeight = H) {
  const heights = Array.isArray(records) ? records : Array.from({ length: records }, () => recordHeight);
  return { recordHeights: heights };
}

/** 从 fitted 起把 ② 连着跑，直到它自己停下来；返回写过的每一档 */
function runUntilStill(
  start: number,
  sam: (fitted: number) => ReturnType<typeof sample>,
  avail = AVAIL,
  seeded = true,
  ceiling = Number.POSITIVE_INFINITY,
) {
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

  it("记录行不等高时按平均定，不按最高的那一行（按最高会白留将近一行）", () => {
    // floor(672 / 54) = 12；照最高的 90 只给 7，白留半屏 —— 而他报上来的就是「下面空一大片」
    const out = nextAutoFitOf({ avail: AVAIL, sample: sample(MIXED), fitted: 0, seeded: false, ceiling: Infinity, min: 1 });
    expect(out.next).toBe(12);
  });

  it("空表 / 算不出可用高时什么都不写，也不把本轮标成已量过", () => {
    const empty = nextAutoFitOf({ avail: AVAIL, sample: sample([]), fitted: 0, seeded: false, ceiling: Infinity, min: 1 });
    expect(empty).toEqual({ next: null, seeded: false, ceiling: Infinity });
    const noAvail = nextAutoFitOf({ avail: 0, sample: sample(11), fitted: 0, seeded: false, ceiling: Infinity, min: 1 });
    expect(noAvail.seeded).toBe(false);
  });
});

describe("展开不参与：子行压根不进这一圈", () => {
  it("11 条记录行放得下就一个字都不写 —— 哪怕他这一屏挂着两条条目、真占 767px", () => {
    // v0.109.3 那版在这里会退到 9（13 行 × 59 = 767 > 672），界面上是「点开一条条目，
    // 列表自己往上缩一行」。现在子行根本不在输入里，11 × 59 = 649 ≤ 672 → 收敛。
    const out = nextAutoFitOf({ avail: AVAIL, sample: sample(11), fitted: 11, seeded: true, ceiling: Infinity, min: 1 });
    expect(out.next).toBeNull();
  });

  it("连着跑也不落档，所以收起之后没有什么要涨回来", () => {
    const { trail, fitted } = runUntilStill(11, (n) => sample(n));
    expect(trail).toEqual([]);
    expect(fitted).toBe(11);
  });

  it("退与加只由记录行的总高决定：同样这 11 条，可用高变矮了才退", () => {
    // 可用高压到 600（11 × 59 = 649 > 600）→ 退一条。这是「记录行自己放不下」，与展开无关
    const out = nextAutoFitOf({ avail: 600, sample: sample(11), fitted: 11, seeded: true, ceiling: Infinity, min: 1 });
    expect(out.next).toBe(10);
    expect(out.ceiling).toBe(10);
  });
});

describe("②a 往回退", () => {
  it("平铺表退到「渲染记录数 − 1」并把它记成上限", () => {
    const out = nextAutoFitOf({ avail: AVAIL, sample: sample(25), fitted: 25, seeded: true, ceiling: Infinity, min: 1 });
    expect(out.next).toBe(24);
    expect(out.ceiling).toBe(24);
  });

  it("退的基准是渲染出来的记录数，不是上一轮那个 fitted（否则要空转好几轮才落档）", () => {
    // 数据只有 12 条而档位仍写着 25：12 × 59 = 708 > 672 → 该退到 11，而不是 24
    const out = nextAutoFitOf({ avail: AVAIL, sample: sample(12), fitted: 25, seeded: true, ceiling: Infinity, min: 1 });
    expect(out.next).toBe(11);
  });

  it("一行都放不下时也不再往下写（min 兜住，不会出现每页 0 条）", () => {
    // 可用高 40 连一条 59px 的记录行都装不下：退到 0 被 min 夹回 1，而 1 就是当前档 → 什么都不写
    const out = nextAutoFitOf({ avail: 40, sample: sample(1), fitted: 1, seeded: true, ceiling: Infinity, min: 1 });
    expect(out.next).toBeNull();
    expect(out.ceiling).toBe(0);
  });
});

describe("②b 往上加", () => {
  it("满页而缝隙还放得下最高那一行才加", () => {
    const out = nextAutoFitOf({ avail: AVAIL, sample: sample(9), fitted: 9, seeded: true, ceiling: Infinity, min: 1 });
    expect(out.next).toBe(10); // 672 − 531 = 141 ≥ 59
  });

  it("缝隙要装得下**最高的那条记录行**，不是平均那一档", () => {
    // 9×50 + 1×90 = 540，可用 600 → 缝隙 60：比平均（54）大、比最高（90）小 → 不加，
    // 因为加进来的那一条可能恰好是 90 那一档，一出滚动条就回来了
    const out = nextAutoFitOf({ avail: 600, sample: sample(MIXED), fitted: 10, seeded: true, ceiling: Infinity, min: 1 });
    expect(out.next).toBeNull();
  });

  it("缝隙只够半行就不加（这就是「不出滚动条」那一半）", () => {
    const out = nextAutoFitOf({ avail: AVAIL, sample: sample(11), fitted: 11, seeded: true, ceiling: Infinity, min: 1 });
    expect(out.next).toBeNull(); // 672 − 649 = 23 < 59
  });

  it("不满的一页没有「还能不能再塞」可判，直接收敛", () => {
    // 末页只剩 3 条时缝隙恒常很大，不加这条会一路加到把整份数据并成一页
    const out = nextAutoFitOf({ avail: AVAIL, sample: sample(3), fitted: 11, seeded: true, ceiling: Infinity, min: 1 });
    expect(out.next).toBeNull();
  });

  it("退到过的那一档就是本轮上限，同一轮不再涨回去", () => {
    const out = nextAutoFitOf({ avail: AVAIL, sample: sample(10), fitted: 10, seeded: true, ceiling: 10, min: 1 });
    expect(out.next).toBeNull(); // 缝隙够，但 10 已经是本轮退到的位置
  });

  it("换轮之后上限作废：面板变高那一档要能重新涨上去", () => {
    // 同一批数：这一轮 ceiling=10 按住不加；换轮由 measure() 把 ceiling 放回 ∞，那就该加
    const held = nextAutoFitOf({ avail: AVAIL, sample: sample(10), fitted: 10, seeded: true, ceiling: 10, min: 1 });
    expect(held.next).toBeNull();
    const newEpoch = nextAutoFitOf({ avail: AVAIL, sample: sample(10), fitted: 10, seeded: true, ceiling: Infinity, min: 1 });
    expect(newEpoch.next).toBe(11);
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

/**
 * 接线形状。上面那句「DOM 那半截 Node 里造不出来」仍然成立 —— 这几条**钉的是源码，不是行为**，
 * 它们只保证三种静默坏法当场报红：滤掉非记录行那一半被删掉、两边各写一份字面量串而漂掉、
 * 以及这一页的分页被交回 a-table（那样表格会对已经切好的那一页**再切一遍**，
 * 「展开一组只画出一半」就回来了，而且不报错、不进 vue-tsc）。
 * 真行为（展开一组画全没画全、这一页有没有少排一条）只有台架量得到：`.tmp-build/bench-myclientpage`。
 */
describe("非记录行那一半的接线", () => {
  /** 读源码文本前先归一换行符：这一条钉的是形状，不是「谁最后存盘」（工作区 LF/CRLF 不是常量） */
  const read = (rel: string) =>
    readFileSync(new URL(rel, new URL("../../", import.meta.url)), "utf8").replace(/\r\n/g, "\n");
  const directive = read("src/options/directives/useAutoFitPageSize.ts");
  const page = read("src/options/views/Overview/MyClient/Index.vue");

  it("算式里那道过滤同时认 rc-table 的子行标记与自有标记", () => {
    const filter = /const recordHeights = Array\.from[\s\S]*?\.map\(/.exec(directive);
    expect(filter, "找不到 recordHeights 那一段过滤").not.toBe(null);
    expect(filter![0]).toContain("SUB_ROW_CLASS");
    expect(filter![0]).toContain("SUB_ROW_FLAG");
  });

  it("调用点用导出来的那个串，不自己再写一份字面量", () => {
    expect(page).toContain("${SUB_ROW_FLAG}");
    // 自己写一份就会漂：改了导出那处，界面只是「每展开一组少排一条」，什么错都不报
    expect(page).not.toContain('" table-row-not-a-record"');
    expect(SUB_ROW_FLAG).toBe("table-row-not-a-record");
  });

  it("这一页交给表格的是切好的那一页，且不再让表格自己分页", () => {
    expect(page).toContain(':data-source="pageRows"');
    expect(page).toContain(':pagination="false"');
    expect(page).toContain("<a-pagination");
  });

  /** 「共几页」吃的必须是单位数：写成摊平行数就回到「展开一组、页数自己涨」那个形状 */
  it("分页总数用单位数而不是摊平行数", () => {
    expect(page).toContain("totalRows: unitCount.value");
    expect(page).toContain("total: unitCount.value");
  });

  /**
   * 独立挂的那条分页条会让表格那条「撑满面板」的链把可用高整个吃掉（台架量到 wrapper 502 +
   * 分页条 36 = 538 > 502，**没展开也多出一条滚动条**）。这一条就是那条 flex 判据的接线，
   * 删掉它的表现不是报错，是折叠态凭空多一条滚动条 —— 所以他定的「铺满且不出滚动条」会被悄悄破掉。
   */
  it("分页条在场时面板补了那条让格的 flex 判据（两边名字对得上）", () => {
    expect(page).toContain("'page-panel-own-pager'");
    expect(page).toMatch(/\.page-panel\.page-panel-own-pager\s*>\s*:deep\(\.ant-table-wrapper\)\s*\{\s*flex:\s*0 1 auto/);
  });
});
