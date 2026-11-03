/**
 * 「把这条任务的那份数据搬到某个目录」这一趟的**搬运本体**（判据那两半在
 * `@/shared/reseedMoveCohort.ts` 与 `@/shared/reseedMoveTarget.ts`）。
 *
 * 拆成三份是因为：判据要能在 Node 里当场跑（那两份不能 import 消息层），而这里这圈要发消息。
 * 这一趟 `relocateTaskBase` 现在有两个调用点，都在 `KeepUploadTask/Index.vue`：
 * - `moveLocalBaseToTaskPath`（方向写死 = 任务目录）；
 * - `moveTaskToChosenPath`（方向由人填，搬完任务的保存路径也跟着改）。
 *
 * ⚠️ `SearchEntity/KeepUploadDialog.vue` 那一屏的同名键**没并进来**，是刻意的：它筛 cohort 用的是
 * 本地指纹索引那份（`localIndex.entries`），不是下载器列表 —— 方向像、参数也像，但取数的来源
 * 不同形（同一形状的判断见 `@/shared/reseedScanPlan.ts` 为什么不复用 `fingerprint/match.ts`）。
 * 它继续直接调下面的 `moveReseedCohort` + 自己的那一份 cohort。
 *
 * 抄两遍的成本本仓付过一次（v0.110.2「少搬一个字段」）：这一趟里「基准必须先发」
 * 「`moved === false` 是没能力不是搬输了」这两条都是判据，漏一条就是另一种坏法。
 */
import { sendMessage } from "@/messages.ts";
import { pickRelocateCohort, type ICohortTorrent, type IRelocateCohort } from "@/shared/reseedMoveCohort.ts";

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

/** {@link relocateTaskBase} 的两种结论：没能力搬 / 已经发出去（发出去不等于已经挪完，见下） */
export type TRelocateOutcome =
  | { kind: "unsupported" }
  | { kind: "sent"; cohort: IRelocateCohort; failed: number };

/**
 * 让下载器把基准那条搬到 `newPath`，并**带上会被这一次搬运连带抽走的那几条同内容副本**。
 *
 * 哪些算相关由 `@/shared/reseedMoveCohort.ts` 判（同目录 + 同种子名，外加这条任务自己记着的那几条）。
 * 只搬基准那一条会把那个文件夹从其余那几条脚下抽走 —— 用户 2026-10-14 报的
 * 「今天重新打开 qbittorrent 这些种子就因为找不到文件报错了」就是这个。
 *
 * `oldPath` 由调用方给：`Index.vue` 那一颗给的是任务上记的基准快照目录，新入口给的是**现查**
 * 下载器报的实时目录。两者可能不同（快照会过期），所以「这一趟到底带走了谁」必须由当下那一份定，
 * 否则会把已经挪走过的一批再按旧目录牵连一遍。
 *
 * ⚠️ 「发出去」不等于「已经挪完」：qBittorrent 的 `setLocation` 只对**已下完**的种子真去
 * moveStorage，还在下的只改 savePath、文件不动（上游 `torrentimpl.cpp::setSavePath` 的分支）。
 * 所以调用方**不许**把这里的成功报成"搬好了"，落地与否只有 `refreshBaseLocalPaths` 那一条判据。
 */
export async function relocateTaskBase(input: {
  downloaderId: string;
  baseHash: string;
  oldPath: string;
  newPath: string;
  itemHashes?: readonly (string | number | null | undefined)[];
}): Promise<TRelocateOutcome> {
  const cohort = await pickTaskCohort(input);

  // 基准先走：真挪文件的是它，后面那几条只是把落点改过来。顺序反了基准的源就没了，
  // 发送那道闸会永远不放行。
  const moved = await sendMessage("setClientTorrentLocation", {
    downloaderId: input.downloaderId,
    id: cohort.hashes[0],
    location: input.newPath,
  });
  // false 只表示这台客户端没有移动数据的能力（各驱动的默认实现），不是搬输了
  if (moved === false) return { kind: "unsupported" };

  const { failed } = await moveReseedCohort(input.downloaderId, cohort.hashes.slice(1), input.newPath);
  return { kind: "sent", cohort, failed };
}

/**
 * 这一条任务该带上哪几条种子。列表拿不到时退回「只搬基准」—— 那等于今天的老行为，
 * 比猜一批不相干的 hash 出去改路径安全。
 */
async function pickTaskCohort(input: {
  downloaderId: string;
  baseHash: string;
  oldPath: string;
  newPath: string;
  itemHashes?: readonly (string | number | null | undefined)[];
}): Promise<IRelocateCohort> {
  const only = { hashes: input.baseHash ? [input.baseHash] : [], outsideTaskCount: 0 };
  try {
    const torrents = await sendMessage("getClientTorrents", input.downloaderId);
    return pickRelocateCohort({
      torrents: torrents.map((x): ICohortTorrent => ({ hash: x.infoHash ?? "", name: x.name, savePath: x.savePath })),
      baseHash: input.baseHash,
      oldPath: input.oldPath,
      newPath: input.newPath,
      itemHashes: input.itemHashes,
    });
  } catch {
    return only;
  }
}

