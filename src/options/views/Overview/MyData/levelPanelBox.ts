/**
 * 「我的数据 → 等级」那一格悬停浮层的可用画幅、它朝哪一头长，以及展开动画的时长。
 *
 * 单独立一份是为了让它能被 Node 断言引用：判据住在 .vue 里就进不了用例，也进不了反证，
 * 而下面这几个数每一个都是量出来的，改错了会直接回到用户报的那个形状。
 *
 * 来由（用户 2026-10-20 三轮）：
 * ① 「点击这个地方的时候会弹一个新的框，但是鼠标没有在框上，所以框会马上消失…应该是在原地展开」
 *    —— 台架（固定高度的 iframe 里挂逐字同参的复刻浮层）量到展开瞬间浮层**上边缘没动、下边缘长了
 *    235.4px**，视口 900 那一档底边落到 1113.4 ⇒ 那颗键和新长出来的等级一起跑到窗口外面；
 * ② 「这个还是会换方向，你统一到右边不就不会跳变了」—— 收起态实测挂在触发元素**左边**
 *    （x 60→630），展开后挂到**右边**（x 590→1500）：那是 antd 的横向避让在换边，
 *    因为它只按**当下**那一份宽度判。所以这里把左右上下一起按真实剩余算，浮层自己关掉避让，
 *    宽度也就没有换边的余地；
 * ③ 「下面的肯定一开始就是往上的啊」—— ②那一版我把上下也一并「统一」成了朝下：贴着窗口底的
 *    那几行照旧往下长，只把画幅压到最低 120px。那条取向被驳回。现在改成**开合那一刻**比一次
 *    上下两侧的真实剩余、取宽的那一侧，方向从此整场不变（避让仍然关着，所以没人会在展开时
 *    替我们翻面 —— 那正是「跳变」的来处）。
 */

/** 高度上限：原本 CSS 里写死的那一条，保留成「再高也不给」的顶 */
export const LEVEL_PANEL_MAX_HEIGHT = 420;
/** 两侧都不宽时（矮窗口 / 桌面缩放很大）仍要留一截能读的框，宁可伸出视口也不画成一格 */
export const LEVEL_PANEL_MIN_HEIGHT = 120;
/** 宽度上限：同 CSS 里那条 860 */
export const LEVEL_PANEL_MAX_WIDTH = 860;
/** 再窄也留一截：低于这个数等级串（不换行）就整段读不全了 */
export const LEVEL_PANEL_MIN_WIDTH = 320;
/** 浮层与触发元素的间距 + 箭头，再加一截留白，才不会贴着窗口边沿 */
export const LEVEL_PANEL_EDGE_RESERVE = 24;

/** 展开/收起的高度动画时长。再长就开始觉得「等一下」，再短就看不出是长出来的 */
export const LEVEL_LIST_MOTION_MS = 200;

export interface ILevelPanelBox {
  maxWidth: number;
  maxHeight: number;
  /** true = 朝上长（placement 走 topLeft，浮层的**下**边缘被钉住）；false = 朝下长（bottomLeft，上边缘被钉住） */
  growUp: boolean;
}

/**
 * @param trigger triggerRect 的三个边 —— 触发元素在视口坐标里的位置
 * @param viewportWidth / viewportHeight 视口尺寸
 *
 * 横向两个方向都锚**左**边缘，所以可用宽度就是「视口右边缘减触发元素的左边」。
 * 纵向两侧各算一份剩余（各自扣掉留白），哪边宽就朝哪边长，画幅按**选中的那一侧**收 ——
 * 「朝哪边」与「多高」必须是同一次判断的两个输出，不许各判各的：分成两次判就会又出现
 * 「框朝下开却被压成一截短框」那种形状（③驳回的就是这个）。
 */
export function levelPanelBoxSize(
  trigger: { left: number; top: number; bottom: number },
  viewportWidth: number,
  viewportHeight: number,
): ILevelPanelBox {
  const below = viewportHeight - trigger.bottom - LEVEL_PANEL_EDGE_RESERVE;
  const above = trigger.top - LEVEL_PANEL_EDGE_RESERVE;
  const growUp = above > below;

  return {
    maxWidth: Math.min(
      LEVEL_PANEL_MAX_WIDTH,
      Math.max(LEVEL_PANEL_MIN_WIDTH, viewportWidth - trigger.left - LEVEL_PANEL_EDGE_RESERVE),
    ),
    maxHeight: Math.min(
      LEVEL_PANEL_MAX_HEIGHT,
      Math.max(LEVEL_PANEL_MIN_HEIGHT, growUp ? above : below),
    ),
    growUp,
  };
}
