/**
 * 「可辅种扫描」的数据形状。
 *
 * 为什么要这一份扫描（用户 2026-10-18 的话）：「你得挨着去查有没有这个种子才有意义啊」——
 * v0.107.0 那版给的是本地按 tracker 反查算出的「你添加的站点里还没挂上这份内容」的数量，
 * 那个数**没有回答**「那个站上到底有没有这条种子」，而辅种要成立必须先有那条种子。
 * 所以这里存的每一个结论都是**真的向那个站发过一次搜索**换来的。
 *
 * 类型住 `src/shared` 而不是 offscreen 里：结果要进 IndexedDB、要被 options 页读、要被纯函数判据吃，
 * 三处共用一份定义（同 `keepUploadTask.ts` 的摆法）。
 */
import type { TSiteID } from "@ptd/site";

/** 一次「内容 × 站点」查询的结论。四档，彼此不互推 */
export type TReseedScanVerdict =
  /** 那个站上确有这条种子：文件清单指纹对上了（证据最强的一档） */
  | "has-it"
  /** 标题与大小相符，但没能验文件（下载失败、或本地这一条压根算不出文件清单）*/
  | "suspect"
  /**
   * 搜过了，页面上没有与这条内容相符的条目。
   * ⚠️ 这不等于「那个站上肯定没有」：搜索词是按下载器里的标题折的，站点写法不一致时会搜不到。
   * 所以界面上这一档写「没搜到相符条目」而不是「没有」。
   */
  | "no-match"
  /** 这一次没查成（超时、要凭据、解析失败）。与 no-match 是两件事，界面必须分开 */
  | "failed";

/** 扫描任务的进度状态 */
export type TReseedScanStatus = "idle" | "running" | "stopped" | "done";

/**
 * 一条结论。`id` 是 IndexedDB `reseed_scan` 表的键（`contentKey` 与 `siteId` 拼出来），
 * 存的就是「这对组合上次查的结果」——下一次扫描据此跳过，不必再发一次请求。
 */
export interface IReseedScanResult {
  id: string;
  /** 内容键：本地指纹的标题+大小 key（剥不出标题时退化成只按大小） */
  contentKey: string;
  siteId: TSiteID;
  verdict: TReseedScanVerdict;
  /** unix 毫秒。新鲜期由 `RESEED_SCAN_TTL_MS` 定，过期的会重查 */
  at: number;
  /** 站上那条种子的标题与大小（`has-it` / `suspect` 才有），界面点名到具体条目 */
  siteTitle?: string;
  siteSize?: number;
  /** 一句话原因。`failed` 必须带，`suspect` 带「为什么没验成文件」 */
  note?: string;
}

/** 待扫的一行内容（由调用方从下载器条目 + 本地指纹索引折出来，扫描器自己不再去读下载器） */
export interface IReseedScanTarget {
  contentKey: string;
  /** 下载器里这条的名字，搜索词由它折出来（见 `reseedScanKeywords`） */
  name: string;
  /** 字节 */
  size: number;
  /** 已经挂在哪些站上：那些站不必再查（查了也是白查），由 tracker 反查得来 */
  knownSites: string[];
}

/** 一轮扫描的请求 */
export interface IReseedScanRequest {
  /**
   * 这些下载器的本地指纹索引用来做文件清单比对（按 contentKey 去里面找那条本地种子）。
   * 扫描器不自己决定读谁 —— 范围是人在界面上挑的。
   */
  downloaderIds: string[];
  targets: IReseedScanTarget[];
  /** 可辅目标站点（已添加、没标离线）；已经挂在的那些由 `targets[].knownSites` 跳过 */
  usableSites: string[];
  /** true = 不吃上次结论，全部重查 */
  refresh?: boolean;
}

/** 扫描进度。整个任务只有这一份状态，落 chrome.storage 的 `reseedScan` 键 */
export interface IReseedScanJob {
  status: TReseedScanStatus;
  startedAt: number;
  finishedAt?: number;
  /** 这一轮计划要发多少次站点查询（跳过缓存之后的真实条数；0 且 status=running = 还在排计划） */
  total: number;
  done: number;
  /** 因为「上次查过且还在新鲜期内」跳过的对数（它们的结论仍在结果表里，界面照旧显示） */
  skipped?: number;
  /** 被 `RESEED_SCAN_MAX_PAIRS` 砍掉、这一轮没查的对数。界面要如实写「还有 N 对没查」 */
  remaining?: number;
  /** 正在查哪个站（人话，界面直接摆出来） */
  currentSite?: TSiteID;
  /** 内容标题，配合 `currentSite` 说「正在查哪一条的哪个站」 */
  currentName?: string;
}

/**
 * 缓存新鲜期：7 天。
 *
 * 为什么要有个期而不是永久复用：站点上今天没有这条种子，下个月可能就有人发布了；
 * 永久缓存等于第一次查完就把结论冻死，而这一族结论的**用途**是「要不要去辅」——
 * 冻久了就是让人错过。7 天是拍的（与站点图标那套 30 分钟 TTL 不同量级，因为这里一次查询很贵）。
 */
export const RESEED_SCAN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 一次扫描最多发多少次站点查询。超出的留给人再点一次 */
export const RESEED_SCAN_MAX_PAIRS = 400;

/** 同时在查的站点查询数上限。站点侧自己有 requestDelay 闸，这里只压总并发 */
export const RESEED_SCAN_CONCURRENCY = 2;
