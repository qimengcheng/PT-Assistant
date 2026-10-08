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
export type TUpdateCheckError = "" | "network" | "http" | "badData";

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
}
