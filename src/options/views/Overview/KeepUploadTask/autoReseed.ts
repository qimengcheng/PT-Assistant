/**
 * 「自动辅种」这一条链上**不需要浏览器、也不需要下载器**的那两半：
 *  1. `planAutoReseed` —— 这一分钟该做什么（发基准？发辅种？暂停哪几条？要不要通知？）；
 *  2. `buildReseedAddTorrentOptions` —— 发一条种子时那份 `addTorrentOptions` 怎么拼。
 *
 * 单独成模块的理由和 `seedVerify.ts` / `sendOptions.ts` 一样：能直接拿 Node 跑断言
 * （`.tmp-build/auto-reseed-test.mjs`，不 import 任何带 chrome 依赖的东西），而后台那条
 * 和设置页那颗手动按钮必须走同一份拼选项的算式 —— 抄第二份的话，改一处漏一处，
 * 表现就是「手动发出去的能挂上、自动发出去的挂不上」这种最难查的分叉。
 *
 * 整条链的分工：
 *   设置页弹窗开关 → 任务上记 `autoReseed: true`
 *   后台 `entrypoints/background/utils/autoReseed.ts` 每分钟醒一次 → 取下载器列表、
 *   调这里的 `planAutoReseed` 决定动作、执行发送/暂停、写回进度、必要时弹系统通知
 *   设置页那一列读后台写回来的 `autoState.stage` / `statuses`（没人手动回查时不至于显示「没查过」）
 */
import { format } from "date-fns";

import type { CAddTorrentOptions } from "@ptd/downloader";
import type {
  IKeepUploadTask,
  IKeepUploadTaskAutoState,
  IKeepUploadTaskItem,
} from "@/shared/types.ts";

import { skipCheckingFor, withReseedSkipChecking } from "./sendOptions.ts";
import { reseedStage, type IReseedItemStatus, type TReseedStage } from "./seedVerify.ts";

/** 发基准失败到几次就不再自动重试（没网 / 种子链接失效那种，重试一百次也不会成） */
export const AUTO_RESEED_BASE_SEND_FAIL_MAX = 3;

/**
 * 发出去多久之后下载器列表里还查不到基准，就算那次发送没成、允许再发一次。
 *
 * 为什么要有这一条：`downloadTorrent` 回的是「已经交给下载器」，不等于那条真的进了列表
 * （.torrent 下载失败、add 被客户端拒掉，都会安静地什么都不留）。只记一次 `baseSentAt`
 * 就永远等下去，用户看到的是「还没在下载器里看到基准」挂到天荒地老。
 * 5 分钟 = 后台每分钟醒 5 次，比 qBittorrent 那份 15 秒列表缓存闸宽两个数量级，
 * 不会把「刚发出去、还没刷进列表」误判成失败。
 */
export const AUTO_RESEED_BASE_RESEND_MS = 5 * 60 * 1000;

export interface IAutoReseedTickInput {
  /** 基准是下载器里已有的那一条（不在 items 里） */
  baseLocal: boolean;
  /** 除基准之外还有几条要发 */
  otherCount: number;
  /**
   * 除基准之外**还没成功发出去**的还剩几条（判据在调用方，见 `othersStillPending`）。
   * 不传就当 `otherCount`（一条都没发过）。
   *
   * 为什么不让判据自己看 `othersSentAt`：那个标记是「整批都发完了」的意思，而一批里可能
   * 只有一颗发失败（站点接口挂了、链接失效）。用它当闸，那颗坏的会把整批的进度冻住。
   */
  othersPending?: number;
  /** 这一轮下载器连上了没有。连不上时**什么都不做** —— 不许把「没查到」读成「不在下载器里」 */
  reachable: boolean;
  /** 基准那一条的结论。查不到就是 `verdict: "notFound"`；认不出是哪条 / 连不上时传 undefined */
  base?: IReseedItemStatus;
  /** 除基准外每一条的结论，顺序与 `otherCount` 对齐；没记 infoHash 的那条是 undefined */
  others: readonly (IReseedItemStatus | undefined)[];
  /** 任务上存的那一份进度（第一次跑传 `{}`） */
  state: IKeepUploadTaskAutoState;
  /** 本轮的时刻（调用方传 Date.now()，判据自己不取时间，断言才好写） */
  now: number;
  /** 没记下 infoHash、连查都没法查的条数 */
  untracked?: number;
}

export interface IAutoReseedTick {
  /** 这一轮要把基准发出去（不跳过校验） */
  sendBase: boolean;
  /** 这一轮要把其余几条发出去（跳过校验） */
  sendOthers: boolean;
  /** `others` 里这一轮该暂停的下标（判据见 `shouldPauseReseed`：只有 wrong 会进来） */
  pauseIndexes: number[];
  /** 基准那条该不该暂停（它也可能报 missingFiles / error） */
  pauseBase: boolean;
  /** 这一轮要不要弹一次系统通知（条数没再变多就不重复轰炸） */
  notify: boolean;
  /** 界面上那一列读的进度阶段 */
  stage: TReseedStage;
  /** 这一轮判出来的、要写回任务的那一份进度（发送成功与否由调用方补） */
  next: IKeepUploadTaskAutoState;
}

/**
 * 这一分钟该做什么。纯函数：同样的输入永远给同样的输出，不碰 chrome / 网络 / 存储。
 *
 * 五档判据按顺序走：
 * 1. 下载器连不上 → 整轮什么都不做（`next` 只推进 `lastRunAt` 和阶段），也不把「查不到」当事实。
 * 2. 基准不在列表里、又还没发过（或上一次发送已超过 `AUTO_RESEED_BASE_RESEND_MS` 没落地）
 *    → 发基准，**不跳过校验**（这一条是要下全量的那一条，跳过就等于让它挂着不完整的数据被当成 100%）。
 * 3. 基准在列表里但没下完 → 等。
 * 4. 基准下完了（含「一开始就已下完」和 `baseLocal` 那种本来就在的）→ 把**还没成功发出去**的那几条
 *    发出去，跳过校验。哪些算发过了看 `othersPending`（调用方按逐条记录算，见 `othersStillPending`）。
 * 5. 之后每轮盯做种状态：判成 wrong 的就暂停，条数比上次通知过的多就再弹一次通知。
 */
export function planAutoReseed(input: IAutoReseedTickInput): IAutoReseedTick {
  const { baseLocal, otherCount, reachable, base, others, state, now } = input;
  const othersPending = input.othersPending ?? otherCount;

  const wrongIndexes = others
    .map((s, i) => (s && s.verdict === "wrong" ? i : -1))
    .filter((i) => i >= 0);
  const pauseBase = base?.verdict === "wrong";
  const wrongCount = wrongIndexes.length + (pauseBase ? 1 : 0);

  // —— 第 2 档：那次「已发出」有没有落地 ——
  let baseSentAt = state.baseSentAt;
  let baseSendFails = state.baseSendFails ?? 0;
  if (
    reachable &&
    baseSentAt !== undefined &&
    base?.verdict === "notFound" &&
    now - baseSentAt >= AUTO_RESEED_BASE_RESEND_MS
  ) {
    // 发出去 5 分钟了列表里还没有它 —— 那次发送算失败，记一笔并放开重发（封顶见下）
    baseSendFails += 1;
    baseSentAt = undefined;
  }
  const sendBase =
    reachable &&
    !baseLocal &&
    baseSentAt === undefined &&
    baseSendFails < AUTO_RESEED_BASE_SEND_FAIL_MAX &&
    base?.verdict === "notFound";

  // —— 第 4 档：基准下完没有 ——
  // 认的是下载器报的 isCompleted，不是「状态看着像做种」（checkingUP 就是还没判完），见 seedVerify。
  // `baseLocal` 那种任务走的是同一条：基准是下载器里已有的那条，查它下完没下完，
  // 下完了才把 items 里那几条挂上去（不然挂的是不完整的数据）。
  const baseReady = reachable && base?.completed === true;
  const sendOthers = reachable && baseReady && othersPending > 0;

  // 连不上下载器时不许把阶段改写成 idle —— 那会把上一轮查到的真进度抹掉，界面上看着像没查过
  const stage: TReseedStage = reachable
    ? reseedStage({
        checked: true,
        baseLocal,
        base,
        others,
        untracked: input.untracked ?? 0,
      }).stage
    : (state.stage ?? "idle");

  const notify = reachable && wrongCount > (state.notifiedWrong ?? 0);

  // 「完成时间」那一列读这一条：只在真的走到 `done` 那一档时留下时刻，离开就清掉。
  // 连不上下载器的那一轮不改它（阶段本身也没重算，见上）—— 不然一次断网就把已完成任务的完成时间抹了。
  const completedAt = reachable ? (stage === "done" ? (state.completedAt ?? now) : undefined) : state.completedAt;

  const next: IKeepUploadTaskAutoState = {
    ...state,
    baseSentAt,
    baseSendFails,
    lastRunAt: now,
    completedAt,
    stage,
    notifiedWrong: notify ? wrongCount : (state.notifiedWrong ?? 0),
  };

  return {
    sendBase,
    sendOthers,
    pauseIndexes: reachable ? wrongIndexes : [],
    pauseBase: reachable && pauseBase,
    notify,
    stage,
    next,
  };
}

/** 一条种子在「逐条发送记录」里的键：有 infoHash 就认 hash（小写），老任务没记 hash 的退到标题 */
export function reseedItemKey(item: { hash?: string; title?: string }): string {
  const hash = String(item.hash ?? "").trim().toLowerCase();
  return hash !== "" ? hash : `t:${String(item.title ?? "").trim()}`;
}

/**
 * 这一批里「已经成功发出去」的那几条，返回 `键 → 时刻`。
 *
 * 旧任务（这份逐条记录之前建的）只有整批的 `othersSentAt`，那种情况**认它全发过**：
 * 否则升级到这一版的第一分钟，后台会把那一批原样重发一遍 —— 对 qBittorrent 是幂等的
 * （add 同一条只会返回已在那儿的那份），但对站点是白打 N 次种子下载请求。
 */
export function othersAlreadySent(
  state: IKeepUploadTaskAutoState,
  items: readonly { hash?: string; title?: string }[],
): Record<string, number> {
  if (state.othersSent) return state.othersSent;
  if (state.othersSentAt !== undefined) {
    const at = state.othersSentAt;
    return Object.fromEntries(items.map((item) => [reseedItemKey(item), at]));
  }
  return {};
}

/** 还没成功发出去的那几条（`sendOthers` 的判据就是它非空） */
export function othersStillPending<T extends { hash?: string; title?: string }>(
  state: IKeepUploadTaskAutoState,
  items: readonly T[],
): T[] {
  const sent = othersAlreadySent(state, items);
  return items.filter((item) => sent[reseedItemKey(item)] === undefined);
}

export interface IReseedBatchFailure {
  key: string;
  title: string;
  message: string;
}

/**
 * 逐条发送，**一条失败不许挡住后面的**。
 *
 * 为什么不把 try/catch 罩在循环外面（v0.65.7 之前那样写）：一颗种子的站点接口报错
 * （他 2026-10-10 那条 yemapt）会让整个循环当场跳出，排在它后面的每一条本轮都不再尝试；
 * 而那次「整批发成功」的标记又没写上，下一分钟又从同一颗重开 —— 表现就是「基准下完
 * 七分钟了，一条都没推」，而且永远推不动。日志里那句还只报任务标题，看不出是**哪一颗**坏。
 *
 * 串行（不并发）是故意的：并发会一次打出 N 个站点请求，站点侧有速率限制和账号风险。
 */
export async function sendReseedBatch<T>(params: {
  items: readonly T[];
  keyOf: (item: T) => string;
  titleOf: (item: T) => string;
  send: (item: T) => Promise<void>;
  /** 每失败一条调一次（后台用它写日志）；这里不直接 import 消息层，判据才好在 Node 里跑 */
  onFailure?: (fail: IReseedBatchFailure) => void;
}): Promise<{ sentKeys: string[]; failed: IReseedBatchFailure[] }> {
  const sentKeys: string[] = [];
  const failed: IReseedBatchFailure[] = [];
  for (const item of params.items) {
    const key = params.keyOf(item);
    try {
      await params.send(item);
      sentKeys.push(key);
    } catch (e) {
      const fail: IReseedBatchFailure = { key, title: params.titleOf(item), message: e instanceof Error ? e.message : String(e) };
      failed.push(fail);
      params.onFailure?.(fail);
    }
  }
  return { sentKeys, failed };
}

/**
 * 发一条种子时的 `addTorrentOptions`：任务上存的那一份 + 辅种特有的两件事。
 *
 * 1. **跳过校验**按「是不是列表第一条基准那条」分档（判据在 `sendOptions.ts`）；
 * 2. `$torrent.title$` / `$torrent.siteName$` 那批模板要展开 —— 保存路径和标签里写宏是
 *    常规用法，不展开的话种子会直接落到一个叫 `$torrent.title$` 的目录里。
 *
 * `siteName` 由调用方给：设置页拿的是 pinia store 的 `getSiteName()`，后台拿的是
 * `metadata.siteNameMap`（那份就是它的缓存，缺失时同样退回站点 id —— 见 contextMenus.ts 那几处）。
 */
export function buildReseedAddTorrentOptions(params: {
  task: IKeepUploadTask;
  item: IKeepUploadTaskItem;
  /** 列表第一条（=基准）；`baseLocal` 那种任务传 null */
  baseEntry: IKeepUploadTaskItem | null;
  /** 下载器那一份配置，只用 `feature.DefaultAutoStart` */
  downloader: { feature?: { DefaultAutoStart?: boolean } } | undefined;
  siteName: string;
  now?: Date;
}): CAddTorrentOptions {
  const { task, item, baseEntry, downloader, siteName } = params;
  const now = params.now ?? new Date();
  const replacements: Record<string, string> = {
    "torrent.title": item.title,
    "torrent.subTitle": item.subTitle ?? "",
    "torrent.category": String(item.category ?? ""),
    "torrent.site": item.site,
    "torrent.siteName": siteName,
    "date:YYYY": format(now, "yyyy"),
    "date:MM": format(now, "MM"),
    "date:DD": format(now, "dd"),
  };
  const plainOptions: CAddTorrentOptions = {
    localDownload: true,
    // 与普通下载保持一致：是否暂停由下载器的「自动开始」设置决定。
    addAtPaused: !(downloader?.feature?.DefaultAutoStart ?? true),
    savePath: task.downloadOptions.savePath || "",
    ...task.downloadOptions.addTorrentOptions,
  };
  const addTorrentOptions: CAddTorrentOptions = skipCheckingFor(task, item, baseEntry)
    ? withReseedSkipChecking(plainOptions)
    : plainOptions;

  for (const key of ["savePath", "label"] as const) {
    if (!addTorrentOptions[key]) continue;
    for (const [templateKey, value] of Object.entries(replacements)) {
      addTorrentOptions[key] = addTorrentOptions[key]!.replaceAll(`$${templateKey}$`, value);
    }
  }
  return addTorrentOptions;
}
