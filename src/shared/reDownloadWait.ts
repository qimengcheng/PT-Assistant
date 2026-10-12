/**
 * 「站点最小重下载间隔」没到点时，这一条重推任务该怎么等。
 *
 * 判据只这一份，两个下游共用：`background/utils/alarms.ts`（真的排程）与 Node 侧断言。
 * 之所以单独成模块：两条出路（在 SW 里睡完 / 交给闹钟）选错**都不报错**，而后果是「那条种子
 * 永远不再重下」，只有真等过一整个冷却期才看得出来 —— 靠读代码判不出来，只能钉住断言。
 */
import type { IPendingReDownload } from "./types/storages/other.ts";

/**
 * 短到可以直接在 SW 里睡完的上限。沿用改造前那条 30 秒界，不是随手挑的：
 * `chrome.alarms` 的 `when` 有下限（Chrome 120 起为 30 秒，更早的版本是 1 分钟），
 * 5 秒的等待排给闹钟会被一路拖到下限，所以短等待只能就地等。
 */
export const SLEEP_IN_SW_MAX_MS = 30_000;

/**
 * 这一次要等多久、用哪条路等。
 *
 * `leftInterval` 是 offscreen 报回来的**剩余毫秒**。不是正数（缺失 / 0 / NaN / Infinity）
 * 就判成「不用等」：宁可立刻重推，也不拿一个算不出来的数去排一个永远不会到的闹钟 ——
 * 用户点下那颗按钮要的是「把它下下来」，不是「等一个怪数」。
 */
export function planReDownload(
  leftInterval: number | undefined,
  now: number,
): { retryAt: number; via: "sleep" | "alarm" } {
  const wait =
    typeof leftInterval === "number" && Number.isFinite(leftInterval) && leftInterval > 0 ? leftInterval : 0;
  return { retryAt: now + wait, via: wait < SLEEP_IN_SW_MAX_MS ? "sleep" : "alarm" };
}

/**
 * 把存档里的等待任务按「现在该不该动」分成两拨 —— SW 每次醒来都要过一遍。
 *
 * 过期那拨要**当场补跑**而不是重新排闹钟：`once` 型闹钟烧掉就不再回来，SW 没起来的那段时间里
 * 到过的点，错过就是错过了（这正是改造前那条链断掉的地方，详见 alarms.ts 的 recoverPendingReDownload）。
 */
export function splitPendingReDownload(
  pending: Record<string, IPendingReDownload> | null | undefined,
  now: number,
): { due: IPendingReDownload[]; waiting: IPendingReDownload[] } {
  const due: IPendingReDownload[] = [];
  const waiting: IPendingReDownload[] = [];
  for (const entry of Object.values(pending ?? {})) {
    // 认不出到点时刻的条目直接丢：留着它，下一次唤醒还是认不出，等于让这条键永久长东西
    if (!entry || typeof entry.retryAt !== "number" || !Number.isFinite(entry.retryAt)) continue;
    (entry.retryAt <= now ? due : waiting).push(entry);
  }
  // 到点的按先后排：同一批里最该早发的那条不该排在后面
  due.sort((a, b) => a.retryAt - b.retryAt);
  return { due, waiting };
}
