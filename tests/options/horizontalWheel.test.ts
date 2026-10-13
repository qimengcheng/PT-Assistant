/**
 * 搜索页那一排站点 chip 的滚轮横滚判据（`src/options/views/Overview/SearchEntity/utils/horizontalWheel.ts`）。
 *
 * 为什么要有这一份：那一排是 `overflow-x: auto`，v0.75.1 收口「chip 满了往上偏移」时把滚动条
 * 轨道去掉了，同时在注释和首页「最近更新」里写下「超出的部分照旧能滚轮」—— 那句不成立。
 * 浏览器不会把 deltaY 折成横向，普通滚轮永远走纵向，能横滚的只有「Shift + 滚轮」和触控板横向
 * 手势。所以滚轮要能滚，必须我们自己接 deltaY，而接了之后最容易坏的是**抢走页面的滚**：
 * 这一排没溢出、触控板本来就在横滚、已经滚到头还往同方向推 —— 这三种都必须放行。
 * 判据住在 horizontalWheel.ts（它零依赖），这里只验它。
 */
import { describe, expect, it } from "vitest";

import {
  planHorizontalWheel,
  type IHorizontalWheelEvent,
  type IHorizontalWheelState,
} from "@/options/views/Overview/SearchEntity/utils/horizontalWheel.ts";

/** 一排 462px 内容装在 289px 的容器里（台架 .tmp-build/bench-chips 那两个实测数） */
const overflowing: IHorizontalWheelState = { scrollLeft: 0, scrollWidth: 462, clientWidth: 289 };
const wheel = (deltaY: number, over: Partial<IHorizontalWheelEvent> = {}): IHorizontalWheelEvent => ({
  deltaX: 0,
  deltaY,
  deltaMode: 0,
  ...over,
});

describe("planHorizontalWheel：接管", () => {
  it("普通滚轮向下滚一格 = 往右移同样的量", () => {
    expect(planHorizontalWheel(overflowing, wheel(100))).toBe(100);
  });

  it("向上滚是往左移", () => {
    expect(planHorizontalWheel({ ...overflowing, scrollLeft: 120 }, wheel(-50))).toBe(70);
  });

  it("滚过界要夹住，不能滚出不存在的距离", () => {
    // 可滚距离 = 462 - 289 = 173
    expect(planHorizontalWheel(overflowing, wheel(500))).toBe(173);
    expect(planHorizontalWheel({ ...overflowing, scrollLeft: 173 }, wheel(-500))).toBe(0);
  });

  it("夹到边缘那次仍然算接管（下一次同方向才放行）", () => {
    expect(planHorizontalWheel({ ...overflowing, scrollLeft: 150 }, wheel(100))).toBe(173);
  });

  it("Firefox 的「行」口径换算成像素，不然一格只挪几像素、看着像没动", () => {
    expect(planHorizontalWheel(overflowing, wheel(3, { deltaMode: 1 }))).toBe(48);
  });
});

describe("planHorizontalWheel：放行给页面", () => {
  it("这一排没溢出（内容放得下）→ 不接管", () => {
    expect(planHorizontalWheel({ scrollLeft: 0, scrollWidth: 289, clientWidth: 289 }, wheel(100))).toBeNull();
    expect(planHorizontalWheel({ scrollLeft: 0, scrollWidth: 120, clientWidth: 289 }, wheel(100))).toBeNull();
  });

  it("触控板已经报了 deltaX → 浏览器正在横滚，不重复接管", () => {
    expect(planHorizontalWheel(overflowing, wheel(100, { deltaX: 40 }))).toBeNull();
  });

  it("已经在最左还往左推 → 放行（否则整页滚不动）", () => {
    expect(planHorizontalWheel(overflowing, wheel(-100))).toBeNull();
  });

  it("已经在最右还往右推 → 放行", () => {
    expect(planHorizontalWheel({ ...overflowing, scrollLeft: 173 }, wheel(100))).toBeNull();
  });

  it("一格没滚动（deltaY 为 0）→ 不接管", () => {
    expect(planHorizontalWheel(overflowing, wheel(0))).toBeNull();
  });
});
