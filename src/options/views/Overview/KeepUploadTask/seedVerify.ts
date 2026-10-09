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
import { normalizeTitle } from "@/shared/fingerprint/title.ts";

/** 下载器那边一条种子的最小输入：归一状态 + 客户端原样的状态串 + 进度 */
export interface IReseedProbe {
  /** 归一后的 7 值状态（`CTorrentState`，见 `packages/downloader/types.ts:109`） */
  state?: string;
  /**
   * 客户端原样的状态串。只有 qBittorrent 那条能分辨 UP/DL 两半（`pausedUP` vs `pausedDL`），
   * 而这一半之差正是「有全部数据但被暂停」和「根本没数据」的区别。
   */
  rawState?: string;
  /** 0~100（`CTorrent.progress` 那边已经是百分数，qBittorrent 乘过 100） */
  progress?: number;
  /** 下载器自己说「下完了」—— 判「基准已下完」用它，不拿 progress 猜（100 也可能是差一字节） */
  isCompleted?: boolean;
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
  /** 0~100，回查时从下载器带回来；查不到那条就没有 */
  progress?: number;
  /** 下载器报的「已下完」。判进度阶段要用它，见 `reseedStage` */
  completed?: boolean;
}

/**
 * qBittorrent 那批状态里，对辅种来说就是失败的。含 `*DL` 那一半（downloading/stalledDL/
 * forcedDL/metaDL/allocating/queuedDL/pausedDL）—— 辅种的数据本来就该在全量那一侧，
 * 出现「还在往下下」= 盘上那份不对；`missingFiles`/`error` 是客户端自己承认读不到。
 *
 * ⚠️ `*DL` 那一半对**基准那条不成立**：基准本来就是要下全量的那一条（v0.59.1 起发基准
 * 不再跳过校验），它在下是进度不是故障。见下面 `isBase` 那一档。
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

/** `WRONG_RAW` 里「数据不全」那一半：对基准来说正常，对辅种那条才是故障 */
const INCOMPLETE_RAW = new Set(["pausedDL", "downloading", "stalledDL", "forcedDL", "metaDL", "allocating", "queuedDL"]);

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
export function judgeReseedTorrent(
  probe: IReseedProbe | undefined,
  opts: { isBase?: boolean } = {},
): IReseedItemStatus {
  if (!probe) return { verdict: "notFound", rawState: "" };

  const raw = String(probe.rawState ?? "").trim();
  const status: IReseedItemStatus = {
    verdict: "pending",
    rawState: raw,
    progress: typeof probe.progress === "number" ? probe.progress : undefined,
    completed: !!probe.isCompleted,
  };

  if (PENDING_RAW.has(raw)) return { ...status, verdict: "pending" };
  // 基准那条「还在下」是进度不是故障：判成 wrong 会一路带到界面上那颗自动暂停 ——
  // 而基准恰恰是最不该被暂停的一条（其余每条都是拿它的数据去挂的）。v0.59.1 起发基准
  // 不再跳过校验，这条路径就从"没人在下"变成了"经常在下"。
  if (opts.isBase && INCOMPLETE_RAW.has(raw)) return { ...status, verdict: "pending" };
  if (WRONG_RAW.has(raw)) return { ...status, verdict: "wrong" };
  if (SEEDING_RAW.has(raw)) return { ...status, verdict: "seeding" };
  if (PAUSED_RAW.has(raw)) return { ...status, verdict: "paused" };

  switch (String(probe.state ?? "").trim()) {
    case "seeding":
      return { ...status, verdict: "seeding" };
    case "downloading":
      // 同上：归一这一档也只有基准那条能翻成进度
      return { ...status, verdict: opts.isBase ? "pending" : "wrong" };
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

/** 下载器列表里用来认亲的那几个字段（`CTorrent` 的窄切片，断言可以直接构造） */
export interface ILocalTorrentForLink {
  infoHash: string;
  name: string;
  totalSize?: number;
}

export type TLinkOutcome =
  | { kind: "linked"; infoHash: string }
  | { kind: "none" }
  /** 同名（或同名同大小）的有好几条 —— 猜错就是把 A 站的状态记到 B 站种子头上 */
  | { kind: "ambiguous"; count: number };

/**
 * 任务里没记 infoHash 的那一条，拿它去下载器列表中找唯一匹配。
 *
 * 两档，先严后松：先要「归一化标题 + 字节数」都对得上；那一档一条都没有才退到只看标题 ——
 * 站点列表页报的 size 有时是取整过的，和客户端那份精确字节数对不上，只看标题这一档要有，
 * 否则绝大多数旧任务永远关联不上。
 *
 * 两档都**要求唯一**：一部片子的两个压制组在下载器里常常归一成同一个标题，
 * 那种情况宁可报「找不到唯一匹配」，也不替用户挑一个。
 */
export function linkItemToTorrent(
  item: { title: string; size?: number },
  torrents: readonly ILocalTorrentForLink[],
): TLinkOutcome {
  const title = normalizeTitle(item.title);
  if (!title) return { kind: "none" };

  const byName = torrents.filter((t) => t.infoHash && normalizeTitle(t.name) === title);
  if (byName.length === 0) return { kind: "none" };

  const size = Math.round(item.size ?? 0);
  const both = size > 0 ? byName.filter((t) => Math.round(t.totalSize ?? 0) === size) : [];
  const pool = both.length > 0 ? both : byName;

  // 去重按小写比（infoHash 是十六进制，大小写两份是同一个种子），但**写回的是下载器原样那串** ——
  // 任务里存的东西要能和那边一字不差地对上，别自己造一个规范化值
  const seen = new Map<string, string>();
  for (const t of pool) {
    const k = t.infoHash.toLowerCase();
    if (!seen.has(k)) seen.set(k, t.infoHash);
  }
  if (seen.size > 1) return { kind: "ambiguous", count: seen.size };
  return { kind: "linked", infoHash: [...seen.values()][0] };
}

/**
 * 任务级的「辅种走到哪一步了」（他 2026-10-09：「要能看到辅种进度，比如现在是已发基准
 * 还是基准已下完还是辅种中」）。
 *
 * 那一列原先只有折出来的结论（异常优先），报的是「有没有问题」，不是「走到哪」——
 * 「基准还在下 40%」和「基准早下完了、只剩其余在挂」在结论那一档里长得一模一样。
 *
 * 判据按顺序走，第一条命中就定档：
 * 1. 没回查过 → `idle`。不许猜。
 * 2. 任何一条判成 wrong → `wrong`（有问题先说问题，进度往后放）。
 * 3. 基准不在下载器里 → `baseMissing`。「没发出」「刚发出还没进列表」「认不出」三种都归这一档，
 *    界面老实说「还没在下载器里看到基准」，不替用户断言是哪一种。
 * 4. 基准还没下完 → `baseDownloading`（带百分比）。认的是下载器报的 `isCompleted`，
 *    不是「状态看着像做种」—— `checkingUP` 就是还没判完。
 * 5. 基准下完了再看其余：一条都没进列表 → `baseReady`；全在做种/停着 → `done`；否则 `reseeding`。
 *
 * `baseLocal` 那种任务的基准是下载器里已有的另一条，本来就在、也不用发，所以第 3、4 档整个跳过。
 * 有「没记 infoHash、压根没法查」的条目时不许报 `done`：那不是一个已完成的进度，
 * 降一档报 `reseeding`，具体是哪几条由界面上那行「另有 N 条没认出」去说。
 */
export type TReseedStage =
  | "idle"
  | "wrong"
  | "baseMissing"
  | "baseDownloading"
  | "baseReady"
  | "reseeding"
  | "done";

export interface IReseedStageInfo {
  stage: TReseedStage;
  /** 其余条目里已经正常做种的条数（含「有全量数据但停着」） */
  doneCount: number;
  /** 其余条目的总数。分母不含基准 —— 基准是前提，不是辅种进度的一部分 */
  totalCount: number;
  /** 判成 wrong 的条数（含基准那条），`wrong` 那一档界面要报数 */
  wrongCount: number;
  /** `baseDownloading` 时给界面显示的 0~100 */
  progress?: number;
}

export function reseedStage(input: {
  /** 这一条任务回查过没有（`reseedStatuses[task.id]` 在不在） */
  checked: boolean;
  baseLocal?: unknown;
  /** 基准那条的结论；`baseLocal` 时传 undefined（任务里没有这一条） */
  base?: IReseedItemStatus;
  /** 除基准外的每一条；查不到的那些传 undefined，别塞假对象 */
  others: readonly (IReseedItemStatus | undefined)[];
  /** 没记 infoHash、连查都没法查的条数 */
  untracked?: number;
}): IReseedStageInfo {
  const others = input.others;
  const doneCount = others.filter((s) => s?.verdict === "seeding" || s?.verdict === "paused").length;
  const wrongCount = (input.base?.verdict === "wrong" ? 1 : 0) + others.filter((s) => s?.verdict === "wrong").length;
  const info = (stage: TReseedStage, extra?: Partial<IReseedStageInfo>): IReseedStageInfo => ({
    stage,
    doneCount,
    totalCount: others.length,
    wrongCount,
    ...extra,
  });

  if (!input.checked) return info("idle");
  if (input.base?.verdict === "wrong" || others.some((s) => s?.verdict === "wrong")) return info("wrong");

  if (!input.baseLocal) {
    const base = input.base;
    if (!base || base.verdict === "notFound") return info("baseMissing");
    if (!base.completed) return info("baseDownloading", { progress: base.progress });
  }

  if (others.length === 0) return (input.untracked ?? 0) > 0 ? info("reseeding") : info("done");
  if (others.every((s) => !s || s.verdict === "notFound")) return info("baseReady");
  if (doneCount === others.length && (input.untracked ?? 0) === 0) return info("done");
  return info("reseeding");
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
