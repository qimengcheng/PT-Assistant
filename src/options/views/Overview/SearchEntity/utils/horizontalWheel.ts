/**
 * 「把滚轮的一格折成这一排的横向位移」的判据。
 *
 * 浏览器不会替我们做这件事：普通滚轮的 deltaY 永远走纵向，能横滚的只有「Shift + 滚轮」和
 * 触控板的横向手势。所以一排 `overflow-x: auto` 的 chip 不自己接一下 deltaY，就只有那两种
 * 手法能动 —— 搜索页那一排站点筛选就是这个情况。
 *
 * 判据单拎出来（不留在组件里）是为了能在 Node 里断言那三条边界；组件只负责把算出来的
 * scrollLeft 写回去、并在真接管了的时候 preventDefault。
 */
export interface IHorizontalWheelState {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
}

export interface IHorizontalWheelEvent {
  deltaX: number;
  deltaY: number;
  /** 0 = 像素（Chromium），1 = 行（Firefox 的口径，一格只有个位数） */
  deltaMode: number;
}

/** 一行按「行」计时的像素当量：Firefox 一格 3 行 × 这一档 ≈ 48px，与 Chromium 一格滚轮同量级 */
const LINE_TO_PX = 16;

/**
 * @returns 该滚到的 scrollLeft；返回 null 表示**不接管**（把这次滚轮留给页面）。
 */
export function planHorizontalWheel(
  state: IHorizontalWheelState,
  event: IHorizontalWheelEvent,
): number | null {
  // 触控板已经报了 deltaX：浏览器正在横滚，再接一次就是滚两倍
  if (event.deltaX !== 0) return null;
  const max = state.scrollWidth - state.clientWidth;
  // 没溢出就别拦
  if (max <= 0) return null;
  const step = event.deltaMode === 1 ? event.deltaY * LINE_TO_PX : event.deltaY;
  const next = Math.min(max, Math.max(0, state.scrollLeft + step));
  // 已经滚在这一头的边缘还往同方向推 → 放行给页面，否则整页滚不动
  if (next === state.scrollLeft) return null;
  return next;
}
