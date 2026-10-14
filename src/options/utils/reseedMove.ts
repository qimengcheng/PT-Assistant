/**
 * 「把本地文件移到任务目录」那一颗开关的副作用那一半（判据那一半在 `@/shared/reseedMoveCohort.ts`）。
 *
 * 拆成两份是因为：判据要能在 Node 里当场跑（那份不能 import 消息层），而这里这圈要发消息。
 * 辅种任务页与辅种检测弹窗两处共用这一份 —— 那两处原先各自抄了一遍「只发基准一条」。
 */
import { sendMessage } from "@/messages.ts";

/**
 * 把除基准以外那几条的落点改成目标目录，返回**没改成**的条数。
 *
 * 逐条发：各下载器的"改目录"请求只吃一条种子。一条失败不中断其余 —— 那几条彼此无关，
 * 而基准此刻已经发出去了，中断只会让剩下的永远指着旧目录（那正是用户 2026-10-14 报的形状）。
 */
export async function moveReseedCohort(
  downloaderId: string,
  hashes: string[],
  location: string,
): Promise<{ sent: number; failed: number }> {
  let failed = 0;
  for (const hash of hashes) {
    try {
      await sendMessage("setClientTorrentLocation", { downloaderId, id: hash, location });
    } catch {
      failed += 1;
    }
  }
  return { sent: hashes.length - failed, failed };
}
