/**
 * 把异步操作排成一条串行队列（前一个失败不堵住后面的）。
 *
 * 这里要的不是「同一个函数别并发」，而是「几次**读—改—写**之间不许插进别人」：
 * `keepUploadTask` 的每条任务都存在同一个 blob 里，而更新那一步是「读整份 → 改一条 → 写回整份」。
 * 一次删除若落在某次更新的读与写之间，更新写回的那份旧快照就把刚删掉的任务又带回来了
 * （用户 2026-10-25 报的「删除之后又自己跑出来了」）。
 *
 * 判据只保证「按调用顺序一个跑完再跑下一个」；失败只影响它自己那一项，
 * 队列继续往下走 —— 否则一次存储异常会让这个键此后再也写不进去。
 */
export function createSerialQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task);
    tail = run.catch(() => undefined);
    return run;
  };
}
