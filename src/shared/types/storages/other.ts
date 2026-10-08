/**
 * 本处存放未使用 pinia 管理的其他 chrome.storage.local 使用到的存储结构类型
 */
import type { TSiteID } from "@ptd/site";
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
}
