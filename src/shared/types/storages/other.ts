/**
 * 本处存放未使用 pinia 管理的其他 chrome.storage.local 使用到的存储结构类型
 */
import type { TSiteID } from "@ptd/site";
import type { IDownloadTorrentOption } from "../common/download.ts";
import type { IStoredUserInfo, TSearchSnapshotKey } from "./metadata.ts";
import type { ISearchData } from "./runtime.ts";

export type TUserInfoStorageSchema = Record<TSiteID, Record<string, IStoredUserInfo>>; // 用于存储用户信息
export type TSearchResultSnapshotStorageSchema = Record<TSearchSnapshotKey, ISearchData>; // 用于存储搜索结果快照

/**
 * 各站点「最近一次自动延长 cookie」的时间（毫秒）。
 *
 * 键是 cookie 域的 URL，不是 siteId —— 延长动作（background/utils/cookies.ts 的
 * checkAndExtendCookies）只拿得到 URL，而站点管理表格用的也是
 * `userConfig.url ?? metadata.urls[0]` 这同一个值，两边对得上。
 *
 * 单独一个键而不是塞进 metadata.sites：写它的是 service worker，读它的是选项页，
 * 而 metadata 那个 blob 由选项页的 pinia 持久化独占写入（不经 background），
 * SW 去 patch 它会和选项页的整键写互相覆盖。
 */
export type TCookieRenewalStorageSchema = Record<string, number>;

/**
 * 站内信的「本地已读」记账：siteId → { msgid → 读的时间戳 }。
 *
 * 只记扩展自己的状态，不去改站点侧的已读标记 —— 后者要每站一个带 authkey 的 POST，
 * 没有可验证的通用实现，写错了就是拿用户登录态往未知接口发请求。
 * 它解决的是「点开读完数字还挂着」：徽章数 = messageCount − 本地已读数（不小于 0），
 * 下一次刷新数据时以站点给的数字为准。
 */
export type TSiteMessageReadStorageSchema = Record<TSiteID, Record<string, number>>;

/**
 * 一条正在等「站点最小重下载间隔」到点的重推任务。
 *
 * 存的是**绝对到点时刻**而不是剩余毫秒：这份存档的唯一用途就是让 SW 重启之后还能把等待中的
 * 任务认领回来（判据在 @/shared/reDownloadWait.ts），剩余额度那种写法一重启就把「什么时候下的」
 * 丢了，只能从重启那一刻重新等一整轮。
 */
export interface IPendingReDownload {
  /** 到点原样重发的那份下载参数（含 downloadId，所以到点能对上那条下载历史） */
  downloadOption: IDownloadTorrentOption;
  /** 什么时候该真的重推（毫秒时间戳） */
  retryAt: number;
}

/**
 * 等待中的重推任务：键是 downloadId（`String()` 化，chrome.storage 的键只能是字符串）。
 *
 * 单独一个键而不是塞进 metadata / 下载历史：写它的只有 service worker，而下载历史在
 * IndexedDB 里 —— MV3 的 SW 根本没有 `indexedDB`，读一次要绕 offscreen 一条消息，
 * 而这条存档恰恰是「SW 醒来第一件事就要读」的。
 * 它是转瞬即逝的运行状态（到点就销账），所以不进备份清单（同 cookieRenewals / updateCheck）。
 */
export type TPendingReDownloadStorageSchema = Record<string, IPendingReDownload>;

/** 检查更新的失败原因。存的是码不是句子：界面按码取当前语言的文案（§3.5 内部标识符不进 UI）。 */
export type TUpdateCheckError = "" | "network" | "http" | "badData" | "rateLimited";

/**
 * 这次版本号是从哪条路拿到的。
 *
 * `api` = REST 接口（信息最全：带发布时间与按浏览器分好的 zip 直链）；
 * `html` = 退到 `releases/latest` 那条 302 跳转（见 @/shared/updateCheck.ts 里 fetchLatestViaHtml
 * 的注释：GitHub 的匿名配额按**出口 IP** 算，共享代理出口几乎必然已被别人用完，那条路会 403）。
 * 界面按它解释「为什么这次没有发布时间、下载按钮开的是 Release 页」，不让人以为数据坏了。
 */
export type TUpdateCheckVia = "" | "api" | "html";

/**
 * 第二条路（`releases/latest` 那条 302）这次为什么没给出版本号。
 *
 * 只在两条都没成时才有意义：界面原先一句「两条路都没能拿到版本号」把三种完全不同的事揉在一起 ——
 * 第二条路根本没试（第一条就抛错了）、试了但跳转里没有 tag（被网关改写、或仓库一条 Release 都没有）、
 * 试了但那一跳自己失败了（代理只放行了 api 那台）。这三种要他做的事不一样，所以分开记。
 */
export type TUpdateCheckFallback = "" | "noTag" | "threw";

/** 这次那份 sha256 摘要是从哪条路拿到的 —— 决定它能不能当校验锚（见 IUpdateCheckState.digestFrom）。 */
export type TUpdateDigestSource = "" | "github" | "mirror" | "html";

/**
 * 自动下载这一路停在哪一步。存的还是码不是句子（§3.5），界面按键名取当前语言的文案。
 *
 * 前两档是「压根不该开始下」：`noDigest` = 这次没拿到摘要；`untrustedDigest` = 摘要也是镜像送的，
 * 拿它去验同一个镜像送来的字节不构成独立保证。后面五档是下了但没成。
 */
export type TUpdateDownloadError =
  | ""
  | "noDigest"
  | "untrustedDigest"
  | "allSourcesFailed"
  | "sizeMismatch"
  | "digestMismatch"
  | "notZip"
  | "saveFailed";

/** 自动下载那个安装包走到哪一步了（"" = 从没下过） */
export type TUpdateDownloadState = "" | "downloading" | "done" | "failed";

/**
 * 「检查更新」的结果缓存。
 *
 * 单独一个键而不是塞进 config：写它的是 service worker，而 config 那个 blob 由选项页的
 * pinia 持久化独占写入 —— 理由与 TCookieRenewalStorageSchema 相同，SW 去 patch 它会和
 * 选项页的整键写互相覆盖。
 *
 * 这里**不存**「有没有新版本」：那是 `latestVersion` 与当前 manifest 版本的比较结果，
 * 存下来就成了两份真源 —— 用户升级之后、下一次检查之前，界面会拿着旧的
 * 「有新版本」继续提醒。判据统一由 @/shared/updateCheck.ts 的 deriveUpdateStatus 现算。
 */
export interface IUpdateCheckState {
  /** 最近一次**发起**检查的毫秒时间戳；0 = 从没检查过（也是自动检查的限速依据） */
  lastCheckAt: number;
  /** 最近一次成功检查到的版本号（已去掉 v 前缀）；"" = 还没有可信结果 */
  latestVersion: string;
  /** 那条 Release 的网页 */
  releaseUrl: string;
  /** 与当前浏览器匹配的 zip 直链；取不到资产时回落到 releaseUrl */
  downloadUrl: string;
  /** Release 的发布时间（GitHub 给的 UTC ISO，界面转本地时区展示）；"" = 未知 */
  publishedAt: string;
  /** 最近一次失败的错误码；成功时为空串 */
  errorCode: TUpdateCheckError;
  /** 失败时 HTTP 状态码（0 = 不是 HTTP 层的问题），用于区分限流 403 与仓库不存在 404 */
  httpStatus: number;
  /** 已经为哪个版本发过系统通知 —— 同一版本只提醒一次 */
  notifiedFor: string;
  /** 这次结果走的是哪条通道（见 TUpdateCheckVia）；"" = 还没成功过 */
  via: TUpdateCheckVia;
  /**
   * 匿名配额什么时候恢复（毫秒时间戳）；0 = 不知道。
   * 来自 GitHub 那条 `x-ratelimit-reset`（unix 秒）。按出口 IP 算，所以这个数对整条代理
   * 出口上的所有人都一样 —— 给他是为了把「稍后再试」换成「几点之后再点」。
   */
  rateLimitResetsAt: number;
  /** 第二条路这次的失败形状（见 TUpdateCheckFallback）；成功或没试都为 "" */
  fallbackOutcome: TUpdateCheckFallback;
  /**
   * 已经为哪个版本自动下载过安装包（同一版本只下一次，不然每天查一次就每天下一个）。
   * "" = 从没下过。
   */
  downloadedFor: string;
  /**
   * GitHub 那条 API 记录里这个包的字节数；0 = 这次没拿到（走的是发布页跳转或镜像代理的旧响应）。
   * 与 assetSha256 一起构成下载前的校验依据。
   */
  assetSize: number;
  /**
   * GitHub 发布记录里这条资产的 SHA-256（小写 hex，已剥掉 `sha256:` 前缀）；"" = 没拿到。
   * 这是**唯一的校验锚**：镜像只许送字节，摘要取自 api.github.com 原链，
   * 否则「镜像给坏包 + 镜像给假摘要」检不出来 —— 那一档记成 untrustedDigest，不自动下。
   */
  assetSha256: string;
  /** 上面那份摘要这次是从哪条路拿到的（见 TUpdateDigestSource） */
  digestFrom: TUpdateDigestSource;
  /**
   * GitHub 记录里这个包的文件名（`PT-Assistant-<版本>-chrome.zip`）。
   * 校验过的字节是自己从内存交给下载管理器的，**没有服务器给的名字可用**，
   * 所以名字必须跟着摘要一起存下来 —— 拿 infoHash 或版本号现拼一个就是替发布物编名字。
   */
  assetName: string;
  /** 这次取包成在哪一档：`ghproxy.net` / `gh-proxy.com` / `github`；"" = 还没下过 */
  downloadSource: string;
  /** 校验通过并交给下载管理器时的字节数（用来在界面上说「整包 6.8 MB 取满」而不是「下过」） */
  downloadBytes: number;
  /** 这一路停在哪一步（见 TUpdateDownloadError）；界面按它取文案 */
  downloadFailCode: TUpdateDownloadError;
  /** `chrome.downloads` 给那次下载的 id；0 = 没有（没下过，或发起就失败了） */
  downloadId: number;
  /** 那次自动下载到哪一步了（见 TUpdateDownloadState） */
  downloadState: TUpdateDownloadState;
  /**
   * 失败原因原文（`chrome.downloads` 的 error 枚举，如 `SERVER_NOT_FOUND`）。
   * **只进日志不进界面** —— 那是浏览器给的英文枚举名，端给用户就是内部标识进 UI；
   * 界面按 downloadState 取本地化文案，要查因看运行日志。
   */
  downloadError: string;
}
