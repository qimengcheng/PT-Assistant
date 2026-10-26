/**
 * `toPagination` 里「实测容量」与「他手动挑的那一档」谁说了算（判据在 `src/options/components/tableSorters.ts`）。
 *
 * 为什么单独钉：这一条口径在 2026-10-08 与 2026-10-18 两个方向上各被驳回过一次。
 * - 最早是「挑过一档就永久让位」→ 他挑的 20 条在一屏只放得下 15 时把面板撑出滚动条
 *   （用户 2026-10-08：「没有分页的时候当然是可以有滚动条，但是有分页的时候不要出现滚动条」），
 *   于是改成「实测容量是硬上限，挑过的档被 min(挑的, 容量) 压着」。
 * - 那条上限跟着又坏了一次：收起条目之后容量停在退下去的那一档，把他挑的 50 一路压成 9
 *   （用户 2026-10-18：「现在手动选择每页的条数没有效果了」）。上限本身已单独修好（见
 *   autoFitPageSize.test.ts），但**「压得住」这件事本身也被他推翻了** ——
 *   「是的用户如果手动调整过就按手动调整的来。但是每次重新进去还是默认是不出滚动条的条目数」。
 *
 * 所以两头都要钉住：挑过档 ⇒ 照他挑的（容量不再参与，放不下就出滚动条）；
 * 没挑过 ⇒ 就等于实测容量（一进这一页就铺满、不出滚动条）。
 * 「挑过」现在是**本次进入这一页之内**的事，由调用方那份页内状态以 `picked` 传进来，
 * 不再从存下来的档里猜 —— 所以「重新进来」在这套判据里就是同一份档配 `picked: false` 那一次调用。
 */
import { describe, expect, it } from "vitest";
import type { TablePaginationConfig } from "@zboson/ui";

import { toPagination } from "@/options/components/tableSorters.ts";

/** 辅种任务那一页台架量到的形状：容量 11 条、一共 45 条任务 */
const FIT = 11;
const TOTAL = 45;

/** 取「分页条出来了」的那一档；没出来就抛，让断言直接红而不是悄悄比到 undefined */
function sizeOf(pag: TablePaginationConfig | false) {
  if (pag === false) throw new Error("分页条没出来");
  return pag.pageSize;
}

describe("挑过档 ⇒ 照他挑的", () => {
  it("挑了一档比容量大的，容量压不住它（50 就画 50，放不下就出滚动条）", () => {
    expect(sizeOf(toPagination(50, 25, { totalRows: TOTAL, fitSize: FIT, picked: true }))).toBe(50);
  });

  it("挑了一档比容量小的，也照他挑的", () => {
    expect(sizeOf(toPagination(5, 25, { totalRows: TOTAL, fitSize: FIT, picked: true }))).toBe(5);
  });

  it("挑的正好是本页默认档时也认（旧版从存下来的档反推，这一档会被判成「没挑过」）", () => {
    expect(sizeOf(toPagination(25, 25, { totalRows: TOTAL, fitSize: FIT, picked: true }))).toBe(25);
  });

  it("挑过档之后分页条常驻：条目全在一页里放得下也要留着他切回小档", () => {
    expect(toPagination(50, 25, { totalRows: 9, fitSize: FIT, picked: true })).not.toBe(false);
  });

  it("挑过档也压过 maxSinglePage 那条硬档（那一页 50 条以内整页放完，但他既然挑了就要切得回来）", () => {
    expect(toPagination(50, 50, { totalRows: 19, fitSize: 13, picked: true, maxSinglePage: 50 })).not.toBe(false);
  });
});

describe("没挑过档 ⇒ 就等于实测容量", () => {
  it("一进这一页就是铺满、不出滚动条那一档", () => {
    expect(sizeOf(toPagination(-1, 25, { totalRows: TOTAL, fitSize: FIT, picked: false }))).toBe(FIT);
  });

  it("重新进来回到实测档：同一份存下来的 50，picked 变回 false 就不再是 50", () => {
    expect(sizeOf(toPagination(50, 25, { totalRows: TOTAL, fitSize: FIT, picked: true }))).toBe(50);
    expect(sizeOf(toPagination(50, 25, { totalRows: TOTAL, fitSize: FIT, picked: false }))).toBe(FIT);
  });

  it("实测容量放得下全部条目 ⇒ 整条分页条不出", () => {
    expect(toPagination(-1, 25, { totalRows: 9, fitSize: FIT, picked: false })).toBe(false);
  });

  it("maxSinglePage 排在 fitSize 前面：19 条而容量只有 13，也照样整页放完、由面板自己滚", () => {
    expect(toPagination(-1, 50, { totalRows: 19, fitSize: 13, picked: false, maxSinglePage: 50 })).toBe(false);
  });

  it("还没量到容量（fitSize 为 0）时退回存下来的档，Vuetify 的 -1 兜底成默认档", () => {
    expect(sizeOf(toPagination(-1, 25, { totalRows: TOTAL, fitSize: 0, picked: false }))).toBe(25);
  });
});

describe("没开实测的那几页一个字不变", () => {
  it("不传 fitSize / picked ⇒ 仍按「存的正数 ≠ 默认档」判挑没挑过", () => {
    // 搜索页、下载器设置那几页没接 useAutoFitPageSize，走的还是持久化那一档
    expect(sizeOf(toPagination(50, 25, { totalRows: TOTAL }))).toBe(50);
    expect(toPagination(25, 25, { totalRows: 9 })).toBe(false);
    expect(toPagination(50, 25, { totalRows: 9 })).not.toBe(false);
  });
});
