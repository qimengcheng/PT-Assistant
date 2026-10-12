/**
 * 辅种任务的「整条写回」合并规则。
 *
 * 抽出来的原因是一条重复通知（用户 2026-10-12 报：「已经选过搬到新的了，但是还提示这个」）：
 * 界面上每次改任务（处置一「用基准所在目录」、处置二「把数据移到任务目录」、换基准、编辑…）
 * 走的都是 `updateKeepUploadTask`，它把**整条任务**盖回存储 —— 包括 `autoState`。
 * 而 `autoState` 是后台那一分钟的**专属字段**（那些「这件事已经提醒过没有」的标记全在里面：
 * `notifiedPathMismatch` / `notifiedBaseStarted` / `notifiedHalfway` / `notifiedBaseDone` /
 * `baseSentAt` / `othersSent` / `othersResent`）。页面手里那份是上一次刷新时读的快照
 * （那一页 60 秒刷一次），所以只要后台在「页面读快照」之后写过一次标记，用户这一点击就把
 * 那个标记抹掉 —— 下一轮后台读到 `undefined`，于是同一件事又提醒一次。
 * 重复的「辅种已停止发送」只是最显眼的一种；同一机制也能让进展通知重发，
 * 严重时把 `othersSent` 抹掉 → 已经发出去的那几条被算成没发过、再发一次。
 *
 * 后台那一侧早就防着反方向的同类问题了（`patchKeepUploadTaskAutoState` 只 patch 这一块、
 * 不整条写回，理由写在那处注释里）。这里补上另一侧：**页面无事要写 autoState，就别带覆盖它**。
 */

/** 只需要 `autoState` 这一块结构，所以写成泛型 —— 也让这个模块在 Node 里直接可测（不 import 任何东西）。 */
export interface IAutoStateBearing {
  autoState?: unknown;
}

/**
 * 整条写回时的合并：**存储里那份 `autoState` 赢**，只有存储里没有它时才接受带来的那份。
 * 其余字段照用来写的（那才是用户在界面上改的东西）。
 *
 * 为什么不是反过来（带 autoState 就整块保留带来的）：带来的那份可能更旧，
 * 而后台是唯一写者 —— 让更旧的一份盖掉更新的一份，就是这个 bug 的形状。
 */
export function mergeTaskPreservingAutoState<T extends IAutoStateBearing>(stored: T, incoming: T): T {
  return { ...incoming, autoState: stored.autoState ?? incoming.autoState };
}
