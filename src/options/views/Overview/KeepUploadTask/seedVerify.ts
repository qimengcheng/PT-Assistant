/**
 * 「这条辅种真的在做种吗」的判据 —— 拿下载器那边报的状态，折成一个能直接决定动作的结论。
 *
 * 单独成模块只为了能直接跑断言（`.tmp-build/keep-upload-seed-verify-test.mjs` 用 Node 直接
 * import，不用 loader）：住在组件里时验它得起台架挂真页面 + 假消息层。
 *
 * 为什么需要这一层：发送时带了「跳过校验」（`sendOptions.ts`），下载器**不会**去读盘核对，
 * 于是「数据其实不在」这件事不会以校验失败的形式冒出来，只会以状态的形式：要么变成正在
 * 下载（它其实没有）、要么 `missingFiles` / `error`。界面要在这时候替用户盯住并把种子暂停。
 */

/** 下载器那边一条种子的最小输入：归一状态 + 客户端原样的状态串 */
export interface IReseedProbe {
  /** 归一后的 7 值状态（`CTorrentState`，见 `packages/downloader/types.ts:109`） */
  state?: string;
  /**
   * 客户端原样的状态串。只有 qBittorrent 那条能分辨 UP/DL 两半（`pausedUP` vs `pausedDL`），
   * 而这一半之差正是「有全部数据但被暂停」和「根本没数据」的区别。
   */
  rawState?: string;
}

export type TReseedVerdict =
  /** 正常做种中（含排队等上传、没人来连的 stalledUP） */
  | "seeding"
  /** 明确没在做种：文件缺失 / 客户端报错 / 变成在下载 → 要暂停并警示用户 */
  | "wrong"
  /** 暂停着但内容齐全（下载器设了「添加后不自动开始」时就是这个） */
  | "paused"
  /** 还没定：正在校验 / 排队 / 状态不认识 → 不动它，稍后再查 */
  | "pending"
  /** 下载器的列表里查不到这条 */
  | "notFound";

export interface IReseedItemStatus {
  verdict: TReseedVerdict;
  /** 折之前的原样状态，界面上悬停要显示 —— 判据出错时人能自己看出是哪一条 */
  rawState: string;
}

/**
 * qBittorrent 那批状态里，对辅种来说就是失败的。含 `*DL` 那一半（downloading/stalledDL/
 * forcedDL/metaDL/allocating/queuedDL/pausedDL）—— 辅种的数据本来就该在全量那一侧，
 * 出现「还在往下下」= 盘上那份不对；`missingFiles`/`error` 是客户端自己承认读不到。
 */
const WRONG_RAW = new Set([
  "missingFiles",
  "error",
  "pausedDL",
  "downloading",
  "stalledDL",
  "forcedDL",
  "metaDL",
  "allocating",
  "queuedDL",
]);

/** qBittorrent 里算「正常做种」的（`queuedUP` 只是排队等上传，数据是齐的） */
const SEEDING_RAW = new Set(["uploading", "stalledUP", "forcedUP", "queuedUP"]);

/** 「有全部数据但停着」 */
const PAUSED_RAW = new Set(["pausedUP", "stoppedUP"]);

/** 判不准，等一等再说：正在校验、在读 resume、认不认识的状态都归这一档 */
const PENDING_RAW = new Set([
  "checkingUP",
  "checkingDL",
  "queuedForChecking",
  "checkingResumeData",
  "moving", // 换目录中，此刻的状态不作数
]);

/**
 * 折成一个结论。
 *
 * **原样串优先**：归一那 7 值把 `error`/`missingFiles`/`unknown` 折成一坨、又把
 * `pausedUP`/`pausedDL` 折成同一个 `paused`（`qBittorrent.ts:555-590`），拿它判会把
 * 「没数据」和「有数据但停着」混成一件事。原样串只有 qBittorrent 有，别的客户端走到归一那一档。
 */
export function judgeReseedTorrent(probe: IReseedProbe | undefined): IReseedItemStatus {
  if (!probe) return { verdict: "notFound", rawState: "" };

  const raw = String(probe.rawState ?? "").trim();
  const status: IReseedItemStatus = { verdict: "pending", rawState: raw };

  if (PENDING_RAW.has(raw)) return { ...status, verdict: "pending" };
  if (WRONG_RAW.has(raw)) return { ...status, verdict: "wrong" };
  if (SEEDING_RAW.has(raw)) return { ...status, verdict: "seeding" };
  if (PAUSED_RAW.has(raw)) return { ...status, verdict: "paused" };

  switch (String(probe.state ?? "").trim()) {
    case "seeding":
      return { ...status, verdict: "seeding" };
    case "downloading":
    case "error":
      // 归一层没有 UP/DL 之分，只能连「客户端报错」一起当失败；unknown 不在此列（留给 pending）
      return { ...status, verdict: "wrong" };
    case "paused":
      return { ...status, verdict: "paused" };
    case "checking":
    case "queued":
    case "unknown":
      return { ...status, verdict: "pending" };
    default:
      return { ...status, verdict: raw ? "pending" : "notFound" };
  }
}

/**
 * 「立刻暂停该种子」只给 wrong。
 * 为什么 pending / notFound 不暂停：qBittorrent 那边的列表 **15 秒才刷一次**
 * （`qBittorrent.ts:419-420` 的 `lastSyncTimestamp + 15e3`，而实例是带缓存复用的），
 * 刚发出去那一次查不到、或还在 checking，都是正常的中间态，据此暂停就是误伤。
 */
export function shouldPauseReseed(verdict: TReseedVerdict): boolean {
  return verdict === "wrong";
}

/** 任务级汇总：界面那一列只显示这一个数 */
export interface IReseedTaskSummary {
  total: number;
  seeding: number;
  wrong: number;
  paused: number;
  pending: number;
  notFound: number;
  /** 老任务没记 infoHash，连查都没法查 */
  untracked: number;
}

export function summarizeReseed(
  statuses: readonly (IReseedItemStatus | undefined)[],
  untracked: number,
): IReseedTaskSummary {
  const sum: IReseedTaskSummary = {
    total: statuses.length + untracked,
    seeding: 0,
    wrong: 0,
    paused: 0,
    pending: 0,
    notFound: 0,
    untracked,
  };
  for (const s of statuses) {
    if (!s) continue;
    sum[s.verdict] += 1;
  }
  return sum;
}
