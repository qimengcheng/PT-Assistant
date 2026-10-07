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
