/// <reference types="chrome" />
import { defineExtensionMessaging } from "@webext-core/messaging";

import type {
  IAdvancedSearchRequestConfig,
  ISearchResult,
  ISiteMessageContentResult,
  ISiteMessageActionResult,
  ISiteMessagesResult,
  ISiteUserConfig,
  ITorrent,
  IUserInfo,
  TSiteID,
  getFaviconMetadata,
} from "@ptd/site";
import type {
  ISocialInformation,
  ISocialRecommendationItem,
  ISocialRecommendationsResult,
  TSupportSocialSite$1,
} from "@ptd/social";
import type { IMediaServerId, IMediaServerSearchOptions, IMediaServerSearchResult } from "@ptd/mediaServer";
import type {
  TorrentClientStatus,
  TorrentClientMetaData,
  CTorrent,
  CTorrentFile,
  CTorrentFileSelection,
  CTorrentPeer,
  CTorrentTracker,
  TorrentQueueDirection,
  TorrentSpeedLimit,
} from "@ptd/downloader";
import type { IBackupData, IBackupFileInfo } from "@ptd/backupServer";

// type-only：编译期擦除，不会与 storage.ts → messages.ts 的运行时导入形成循环依赖
import type { IExtensionStorageSchema, TExtensionStorageKey } from "@/storage.ts";

import type { IFilesFingerprint, IPieceSample, ILocalFingerprintIndex } from "@/shared/fingerprint/index.ts";
// type-only：图床转存（纯数据，可结构化克隆；实现住 offscreen）
import type { IImageHostTestResult, IImageHostUploadItem, IImageHostUploadRequest } from "@/shared/imageHost/types.ts";
// type-only：站点等级祝贺那条消息的载荷（判据与措辞都住在这一份文件里）
import type { ILevelUpItem } from "@/shared/levelUp.ts";
// type-only：转载发布的表单描述（纯数据，可结构化克隆；实现住 offscreen）
import type {
  ISourceDescription,
  ISourceDescriptionRequest,
  ITransferDuplicateCheck,
  ITransferSourceLocateRequest,
  ITransferUploadRequest,
  ITransferUploadResult,
  IUploadFormDescriptor,
} from "@/shared/upload/types.ts";
import type {
  IDownloaderMetadata,
  IDownloadTorrentOption,
  IDownloadTorrentResult,
  ILoggerItem,
  ISearchData,
  ITorrentDownloadMetadata,
  IKeepUploadTask,
  IKeepUploadTaskAutoState,
  IKeepUploadTaskLocalBase,
  IKeepUploadTaskVerify,
  TKeepUploadTaskKey,
  TSearchSnapshotKey,
  TTorrentDownloadKey,
  TTorrentDownloadStatus,
  IRestoreOptions,
  TBackupFields,
  BridgeStatus,
  IUpdateCheckState,
  IReseedScanJob,
  IReseedScanRequest,
  IReseedScanResult,
  IReseedScanTarget,
} from "@/shared/types.ts";
import type { IReseedScanSeed } from "@/shared/reseedScanPlan.ts";
import { isDebug } from "~/helper.ts";

/** `probePageInTab` 的返回：全部是「可能拿不到」的观测值，缺什么就是 undefined */
export interface IPageInTabResult {
  /** 加载完成后整页序列化出来的 HTML */
  html?: string;
  /** 最终地址（跳转后可能不是请求的那一条） */
  finalUrl?: string;
  /** 页面标题（后台用它判「是不是挑战页，要不要再等一拍」） */
  title?: string;
  /** 打不开 / 超时 / 标签页被关掉 */
  error?: string;
}

/**
 * 一条请求头读数（`getHeaderTrace`）。值已由后台按隐私口径遮过：
 * Cookie 只留条数、扩展 Origin 只留 `chrome-extension://…`、Referer 去掉 query 与 hash。
 */
export interface IHeaderTraceRecord {
  /** `xmlhttprequest` / `main_frame` 等 */
  type: string;
  method: string;
  /** host + path，不含 query */
  hostPath: string;
  /** XHR 来自扩展上下文时是 -1 */
  tabId: number;
  headers: Record<string, string>;
  /** 记录时刻（毫秒），读的时候只留最近三分钟那一批 */
  at: number;
}

/**
 * 消息协议（对齐 PT-depiler messages.ts 的全量协议）：
 * 1. background —— chrome cookies / DNR / storage
 * 2. offscreen —— 站点解析、搜索、下载器、用户信息、社交信息、辅种
 *
 * 注意：不要给本接口加 `[key: string]: ...` 索引签名——那会让
 * sendMessage("拼错的消息名") 全部通过类型检查（曾因此静默漏掉 30+ 条未声明消息）。
 * 新增消息时必须在此显式声明签名。
 */
export interface ProtocolMap {
  ping(data?: null): { version: string; definitionCount: number };

  /**
   * offscreen 就绪探针：在 offscreen main.ts 末尾（全部业务 onMessage 注册完成后）注册。
   * background 新建 offscreen 后靠它轮询等待，避免在处理器注册窗口期发出的消息被静默丢弃。
   * 不能复用 ping —— 那个是 background 自己注册给 options 探测存活用的。
   */
  offscreenPing(): "pong";

  // ===== 1. chrome.storage =====
  // 这三条代理消息**必须存在**：Chrome 对 offscreen document 只开放 chrome.runtime
  // （且只是消息通信子集，连 runtime.getManifest 都没有），chrome.storage 在
  // offscreen 里根本不存在 —— 官方文档原文：
  //   "the chrome.runtime API is the only extension API supported by offscreen documents"
  // offscreen 里直连 wxt/storage 会抛 "You must add the 'storage' permission to your
  // manifest"（v0.19.4 备份恢复失败的根因，当时一度误删本 RPC）。
  // @/storage.ts 的 extStore 在检测到无 chrome.storage 的上下文时会自动改走这三条消息，
  // 调用方无感知。SW / options / content script 仍直连本地 chrome.storage。
  getExtStorage<T extends TExtensionStorageKey>(data: T): IExtensionStorageSchema[T] | null;
  setExtStorage<T extends TExtensionStorageKey>(data: {
    key: T;
    value: IExtensionStorageSchema[T];
  }): void;
  patchExtStorage<T extends TExtensionStorageKey>(data: {
    key: T;
    path: string;
    value: unknown;
  }): void;

  // ===== 1.1 chrome.declarativeNetRequest（供 unsafe header 替换使用）=====
  updateDNRSessionRules(data: { rule: chrome.declarativeNetRequest.Rule; extOnly?: boolean }): void;
  removeDNRSessionRuleById(data: chrome.declarativeNetRequest.Rule["id"]): void;

  // ===== 1.2 chrome.cookies（供 Cloudflare 重试与站点登录态使用）=====
  getAllCookies(data: chrome.cookies.GetAllDetails): chrome.cookies.Cookie[];
  /**
   * force=true 时跳过「cookie 已存在且未过期就不写」的检查，强行覆盖。
   * Cloudflare 重试必须用它：cf_clearance 通常已存在且有效，
   * 不强制写入的话重试请求仍然不带 clearance，会被再次拦截。
   */
  setCookie(data: chrome.cookies.SetDetails & { force?: boolean }): void;
  getCookie(data: chrome.cookies.CookieDetails): chrome.cookies.Cookie | null;
  removeCookie(data: chrome.cookies.CookieDetails | chrome.cookies.SetDetails): chrome.cookies.CookieDetails | null;
  checkAndExtendCookies(arg: { url: string; siteId?: string }): void;

  /**
   * 在本机浏览器里**真正打开一次标签页**，等它加载完再把 DOM 交回来。
   *
   * 为什么需要它：有的站点会把 `userdetails.php` / `mybonus.php` 这类用户页对「扩展发起的
   * XHR」换成一张 200 + 137 字节的 nginx 403 假页（PTzone 2026-10-24 的现场：换 Referer /
   * Origin / Sec-Fetch / 请求体六种形状全一字不差，而同一会话请求 `/index.php` 正常拿到
   * 196 个 td）。拦截认的是「这次请求是不是顶层导航」这个上下文，XHR 侧改头过不去。
   *
   * 边界：只在 `isBlockShellPage()` 判定为拦截页时兜底调用；标签页 `active: false`、
   * 读完立刻关；实现见 `background/utils/pageInTab.ts`。
   */
  probePageInTab(data: { url: string; timeoutMs?: number }): IPageInTabResult;

  /**
   * 读走后台记下的最近若干条 `userdetails.php` / `mybonus.php` 请求头（读一次清空）。
   *
   * 只用来回答「同一会话里 XHR 被拦、标签页导航能过，两边实际发出去的头差在哪一项」——
   * 它是一份观测读数，不参与取数判据；值已在后台遮过（见 `IHeaderTraceRecord`）。
   */
  getHeaderTrace(): IHeaderTraceRecord[];

  // ===== 1.3 检查更新（background）=====
  /**
   * 立刻查一次仓库的最新 Release 并写回结果，返回写进去的那一份。
   *
   * 为什么这件事必须由 SW 做而不是选项页自己 fetch：`updateCheck` 这个键只有一个写者
   * （extStore 的写队列不跨上下文互斥），实现也只有一份，自动检查与手动检查走同一条路。
   */
  checkForUpdate(): IUpdateCheckState;

  // ===== 1.4 立刻跑一轮自动辅种（background）=====
  /**
   * 催后台马上走一轮「自动辅种」的判据，不等那每分钟一次的定时器。**回包等这一轮真的跑完。**
   *
   * 为什么要有这一条：刚建好的任务要等下一轮才被看到，用户视角就是「我勾了自动辅种，
   * 基准却过了一分钟才推下去」。三个催点：辅种检测建完任务（`autoReseed === true` 时）、
   * 辅种任务页点「回查做种状态」之后、点「把本地文件移到任务目录」之后。
   * 判据本身仍只有一份（后台那个 tick），这里只是把它的**触发时刻**提前，不另起一条发送路径。
   *
   * 为什么回包要等：调用点拿它当「已经推进过了」的证据 —— 回得太早，它随后拉回来的还是
   * 上一轮的状态，界面表现仍旧是「我点了回查，什么都没发生」。
   */
  runAutoReseedTick(): void;

  // ===== 1.5 站点等级提升的祝贺（background）=====
  /**
   * offscreen 取完用户信息、判出「这一站升了一级」之后报上来，由后台攒批并选通道投递
   * （人在插件页面 → 界面放烟花；不在 → 系统通知）。判据在 `@/shared/levelUp.ts`，
   * 攒批与投递在 `background/utils/levelUpNotice.ts`。
   *
   * 为什么要绕这一道而不是 offscreen 自己投：offscreen 里只有 `chrome.runtime` 的消息子集，
   * 没有 `chrome.storage`，也没有 `chrome.notifications`（见 `src/storage.ts:57-59`）——
   * 在那儿投是**静默什么都不发生**。不等回包：祝贺不该拖住这次取数。
   */
  notifyLevelUp(item: ILevelUpItem): void;

  // ===== 2. offscreen：站点基础 ( utils/site ) =====
  getSiteList(): Array<{ id: string; name: string; url: string; offline: boolean }>;
  getSiteUserConfig(data: { siteId: TSiteID; flush?: boolean }): ISiteUserConfig;
  getSiteFavicon(data: { site: TSiteID | getFaviconMetadata; flush?: boolean }): string;
  clearSiteFaviconCache(): void;

  // ===== 2.1 offscreen：站点搜索、搜索快照 ( utils/search ) =====
  getSiteSearchResult(data: {
    siteId: TSiteID;
    keyword?: string;
    searchEntry?: IAdvancedSearchRequestConfig;
    /**
     * 结果取前几页（1 起）。缺省 = 1 页。
     * 只有声明了翻页规则的站点会真的多发几次请求，其余站点这个值不起作用（见
     * `packages/site/utils/pagination.ts`）。
     */
    pageCount?: number;
  }): ISearchResult;
  getMediaServerSearchResult(data: {
    mediaServerId: IMediaServerId;
    keywords?: string;
    options?: IMediaServerSearchOptions;
  }): IMediaServerSearchResult;
  getSearchResultSnapshotData(snapshotId: TSearchSnapshotKey): ISearchData;
  saveSearchResultSnapshotData(data: { snapshotId: TSearchSnapshotKey; data: ISearchData }): void;
  removeSearchResultSnapshotData(snapshotId: TSearchSnapshotKey): void;

  // ===== 2.2 offscreen：下载器、下载历史 ( utils/download ) =====
  getDownloaderConfig(downloaderId: string): IDownloaderMetadata;
  getDownloaderVersion(downloaderId: string): string;
  getDownloaderStatus(downloaderId: string): TorrentClientStatus;
  getTorrentDownloadLink(torrent: ITorrent): string;
  getTorrentInfoForVerification(torrent: ITorrent): ITorrentInfoForVerification;
  downloadTorrent(data: IDownloadTorrentOption): IDownloadTorrentResult;

  // ===== 2.2.0 offscreen：转载发布（utils/torrentUpload）=====
  /**
   * 抓目标站上传页，返回可渲染的表单描述。
   *
   * 抓不到会抛错（不是返回空表单）：「站点没有上传字段」与「你没有发布权限」
   * 在界面上必须能分清，见 offscreen/utils/torrentUpload.ts 的 explainMissingForm。
   */
  getSiteUploadForm(siteId: TSiteID): IUploadFormDescriptor;
  /**
   * 回到源站把「下载器里的这一条」认出来，返回可以直接拿去下载种子的站点条目。
   *
   * 认的判据是 infoHash 逐字相等（不是文件指纹）—— 转种要交原始那颗 .torrent，
   * 认错一颗就是转出去另一颗种子。认不出会抛错并带上试过哪些搜索词。
   */
  locateTransferSource(data: ITransferSourceLocateRequest): ITorrent;
  /**
   * 去源站详情页抓这颗种子的简介素材（简介 HTML / 截图 URL / mediainfo 文本）。
   *
   * 只抓**页面原样给出的**，不生成 mediainfo 与截图 —— 扩展拿不到媒体文件本体也没有
   * ffmpeg，本地拼出来的技术参数是假的。抓不到会抛错并说明卡在哪一步（登录页 / 没有简介区）。
   */
  getSourceDescription(data: ISourceDescriptionRequest): ISourceDescription;
  /** 提交一颗种子到目标站。种子本体由 offscreen 现取现洗，界面只传字段值 */
  submitTransferUpload(data: ITransferUploadRequest): ITransferUploadResult;
  /**
   * 提交前在目标站查重：同一 infoHash 是否已经有人发过。
   *
   * 与 `locateTransferSource` 是同一条判据（infoHash 逐字相等）的另一次调用，区别在
   * 「查不到」的语义 —— 这里查不到不等于没有（目标站改过标题、搜索分词不同），
   * 所以结果里带 `note` 说明搜过什么，界面不能把它说成「确认可以发」。
   * 查不动（未登录 / 站点报错）也不抛错，走 `note`：查重只是尽力而为，不该挡住发布。
   */
  checkTransferDuplicate(data: ITransferSourceLocateRequest): ITransferDuplicateCheck;

  // ===== 2.2.0b offscreen：图床（utils/imageHost）=====
  /**
   * 把一张源图转存到指定图床，返回可替换的新地址。
   *
   * **失败不抛错**：返回值的 `error` 里带原因。一次转存是十几张图的循环，
   * 抛错会让调用方丢掉「哪几张已经成功」，而部分成功恰恰是最常见的结果。
   */
  uploadImageToHost(data: IImageHostUploadRequest): IImageHostUploadItem;
  /** 设置页的「测试上传」：拿内置的 1×1 PNG 试一次地址与凭证，不碰用户的任何真实图片 */
  testImageHost(hostId: string): IImageHostTestResult;

  getDownloadHistory(): ITorrentDownloadMetadata[];
  getDownloadHistoryById(downloadId: TTorrentDownloadKey): ITorrentDownloadMetadata;
  setDownloadHistoryStatus(data: { downloadId: TTorrentDownloadKey; status: TTorrentDownloadStatus }): void;
  deleteDownloadHistoryById(downloadId: TTorrentDownloadKey): void;
  clearDownloadHistory(): void;

  // ===== 2.2.1 offscreen：下载器列表与能力元数据 =====
  getDownloaderList(): Array<{ id: string; name: string; type: string; enabled: boolean; address: string }>;
  // 下载器能力元数据（feature 声明，UI 据此渲染文件/peers/tracker 面板）
  getDownloaderMetaData(downloaderId: string): TorrentClientMetaData | undefined;

  // ===== 2.2.2 offscreen：客户端任务操作（MyClient 页面）=====
  /**
   * 种子在某台下载器里的主键。各家客户端用的形状不一样 —— qBittorrent / Transmission 是
   * infoHash 字符串，Aria2 是数字 gid —— 所以它是 `string | number`，取自 `CTorrent["id"]`
   * 而不是各写一份（原先这八个消息的 `id` 都标 `any`，等于把「传错主键」这件事从编译期挪到了运行时）。
   */
  getClientTorrents(downloaderId: string): CTorrent[];
  getClientTorrentTrackers(data: { downloaderId: string; torrent: CTorrent }): string[];
  deleteClientTorrent(data: { downloaderId: string; id: CTorrent["id"]; removeData?: boolean }): boolean;
  pauseClientTorrent(data: { downloaderId: string; id: CTorrent["id"] }): boolean;
  resumeClientTorrent(data: { downloaderId: string; id: CTorrent["id"] }): boolean;
  recheckClientTorrent(data: { downloaderId: string; id: CTorrent["id"] }): boolean;
  moveClientTorrentInQueue(data: { downloaderId: string; id: CTorrent["id"]; direction: TorrentQueueDirection }): boolean;
  setClientTorrentSpeedLimit(data: { downloaderId: string; id: CTorrent["id"]; limits: TorrentSpeedLimit }): boolean;
  setClientTorrentLabel(data: { downloaderId: string; id: CTorrent["id"]; label: string }): boolean;
  /**
   * 给单条种子**追加**标签（qBittorrent 的 tags，与 `setClientTorrentLabel` 那个分类是两格）。
   * false = 这台客户端没有这个能力（基类默认实现），请求本身失败走抛错。
   */
  addClientTorrentTags(data: { downloaderId: string; id: CTorrent["id"]; tags: string[] }): boolean;
  /** 把种子已在盘上的数据搬到别的目录（只有部分客户端支持，判据见 `src/shared/reseedPath.ts`） */
  setClientTorrentLocation(data: { downloaderId: string; id: CTorrent["id"]; location: string }): boolean;
  /**
   * 该下载器的分类表（分类名 → 真正的落盘目录）。辅种那两处要用它把 `category:电影` 这种
   * 分类假路径翻成目录 —— 翻不出就是判不出，不许拿分类名当路径去比或去搬。
   * null = 这台客户端没有分类概念（基类默认），或压根没连上。
   */
  getClientTorrentCategories(downloaderId: string): Record<string, { name: string; savePath: string }> | null;

  /**
   * 在该下载器上新建一个分类（名字 + 落盘目录）。辅种检测那一栏的「增加分类」用它 ——
   * 那一格选的是 `category:xxx`，而候选只列下载器已有的分类。
   * false = 这台客户端没有分类概念（基类默认实现）；请求失败走抛错，两种说法界面分开给。
   */
  createTorrentCategory(data: { downloaderId: string; name: string; savePath: string }): boolean;

  // ===== 2.2.3 offscreen：文件级 / peers / tracker 管理 =====
  /**
   * `torrent` 允许直接给 infoHash：驱动那层的 `getTorrentHash(string | CTorrent)` 本来就吃两种
   * （`packages/downloader/types.ts:488`）。一键辅种手上只有基准那一条的 hash，
   * 拿它去要文件清单是最短的一条路（见 `src/shared/reseedTargetDir.ts`）。
   */
  getClientTorrentFiles(data: { downloaderId: string; torrent: CTorrent | string }): CTorrentFile[];
  setClientTorrentFilePriority(data: {
    downloaderId: string;
    torrent: CTorrent;
    selections: CTorrentFileSelection[];
  }): boolean;
  getClientTorrentPeers(data: { downloaderId: string; torrent: CTorrent }): CTorrentPeer[];
  getClientTorrentTrackersDetail(data: { downloaderId: string; torrent: CTorrent }): CTorrentTracker[];
  addClientTorrentTracker(data: { downloaderId: string; torrent: CTorrent; url: string }): boolean;
  removeClientTorrentTracker(data: { downloaderId: string; torrent: CTorrent; url: string }): boolean;

  // ===== 2.3 offscreen：用户信息 ( utils/userInfo ) =====
  getSiteUserInfoResult(siteId: TSiteID): IUserInfo;
  setSiteLastUserInfo(userInfo: IUserInfo): void;
  cancelUserInfoQueue(): void;
  getSiteUserInfo(siteId: TSiteID): Record<string, IUserInfo>;
  removeSiteUserInfo(data: { siteId: TSiteID; date: string[] }): void;

  // ===== 2.3.1 offscreen：站内信 ( utils/siteMessages ) =====
  /**
   * 读该站的信箱列表。`supported: false` 表示这个 schema 没实现解析（界面给「去网页看」），
   * 与「支持但你现在没有消息」区分开 —— 后者才该显示空列表。
   */
  getSiteMessages(siteId: TSiteID): ISiteMessagesResult;
  getSiteMessageContent(data: { siteId: TSiteID; messageId: string; url?: string }): ISiteMessageContentResult;
  /**
   * 批量删除某站的站内信（会改站点侧数据）。调用方跑完必须重拉列表，以站点给的为准 ——
   * 删不动的站返回 `supported:false`，界面要说「这个站删不了」而不是「已删除」。
   */
  deleteSiteMessages(data: { siteId: TSiteID; messageIds: string[] }): ISiteMessageActionResult;

  // ===== 2.4 offscreen：社交信息 ( utils/socialInformation ) =====
  getSocialInformation(data: { site: TSupportSocialSite$1; sid: string }): ISocialInformation;
  // 判断 URL 命中的社交站点（供 content-script 引导做轻量预筛，见上游 issue #1467）
  matchSocialPage(url: string): TSupportSocialSite$1 | null;
  getSocialRecommendations(data?: {
    flush?: boolean;
    enrichment?: "all" | "none" | "visible";
  }): ISocialRecommendationsResult;
  getSocialRecommendationItem(data: { item: ISocialRecommendationItem; enrichment?: "all" | "visible" }): {
    item: ISocialRecommendationItem;
  };
  clearSocialInformationCache(): void;

  // ===== 2.5 offscreen：辅种任务 ( utils/keepUploadTask ) =====
  getKeepUploadTasks(): IKeepUploadTask[];
  getKeepUploadTaskById(taskId: TKeepUploadTaskKey): IKeepUploadTask;
  createKeepUploadTask(task: IKeepUploadTask): void;
  updateKeepUploadTask(task: IKeepUploadTask): void;
  /**
   * 只写任务里 `autoState` 那一块（后台自动辅种每分钟的判据快照）。
   * 故意不传整条任务：见 offscreen/utils/keepUploadTask.ts 里那条注释 —— 整条写回会把用户
   * 在这一分钟里改的「自动辅种」开关盖回旧值。
   */
  patchKeepUploadTaskAutoState(data: { taskId: TKeepUploadTaskKey; autoState: IKeepUploadTaskAutoState }): void;
  /**
   * 只写任务里 `verify` 那一块（后台每分钟对账查到的结论）。
   * 和上面那条同样的理由：不拿整条任务写回，就不盖用户这一分钟里改的开关。
   */
  patchKeepUploadTaskVerify(data: { taskId: TKeepUploadTaskKey; verify: IKeepUploadTaskVerify }): void;
  /**
   * 只写任务里 `baseLocal` 那一块（基准那份数据**此刻**在哪个目录，以及「用户要搬过去」那位意图）。
   * 后台每分钟那一轮从下载器读到的是实时路径，不写回来的话界面上那条「目录不一致」会一直挂在
   * 建任务时的快照上。同上面两条：不拿整条任务写回，任务不在了也不凭空造一条。
   */
  patchKeepUploadTaskBaseLocal(data: { taskId: TKeepUploadTaskKey; baseLocal: IKeepUploadTaskLocalBase }): void;
  deleteKeepUploadTask(taskId: TKeepUploadTaskKey): void;
  clearKeepUploadTasks(): void;

  // ===== 2.5.1 offscreen：本地种子指纹索引 ( utils/fingerprint ) =====
  /**
   * 取某个下载器的本地种子指纹索引（标题+大小 / 文件清单 / piece 抽样 / tracker）。
   * 30 分钟内命中 IndexedDB 缓存；refresh=true 强制重建（下载器变动后用）。
   */
  getLocalFingerprintIndex(data: { downloaderId: string; refresh?: boolean }): ILocalFingerprintIndex | null;
  clearLocalFingerprintIndex(data?: { downloaderId?: string }): void;

  // ===== 2.5.2 offscreen：可辅种扫描 ( utils/reseedScan ) =====
  /**
   * 发起一轮「挨个站到站点上查这条种子在不在」。
   *
   * 不等它跑完就返回（一次扫描是几十到几百次站点请求），进度靠 `getReseedScanJob` 轮询，
   * 结论落在 IndexedDB 的 `reseed_scan` 表、由 `getReseedScanResults` 读。
   */
  startReseedScan(data: IReseedScanRequest): IReseedScanJob;
  getReseedScanJob(): IReseedScanJob | null;
  stopReseedScan(): IReseedScanJob | null;
  getReseedScanResults(data?: { contentKeys?: string[] }): IReseedScanResult[];
  /**
   * 只清**给的那些内容**的结论。
   *
   * 原先这条整表 `clear()`，而弹窗里那句确认写的是「删除 N 条」（N = 当前范围内查过的条数）——
   * 从辅种任务那一行进来时范围只有 1 条，按下去却把「我的下载器」攒下的几百条结论一起清了。
   * 确认框说什么就删什么，不是新取向，是把实现补成它自己承诺的那样。
   */
  clearReseedScanCache(data: { contentKeys: string[] }): void;
  /**
   * 把一条辅种任务给的线索**对回下载器里那一份**，折成一个扫描目标（v0.128.0 任务行那颗查询键）。
   *
   * 为什么这一步不能在界面里算：本地指纹索引只有 offscreen 读得到（那份 30 分钟缓存），
   * 而内容键**必须由本地那一份折** —— 界面手上只有站点报的约数大小与发布名，两边各折一套会让
   * 同一颗种子得到两个 key，于是与「我的下载器」那一屏查过的结论互不复用、且这一路永远到不了
   * 「确有这条」那一档。判据与后果都写在 `reseedScanPlan.ts` 的 `reseedScanTargetOfSeed` 头上。
   * `resolved: false` = 本地没找到那一份（数据已删 / 不在给的那几台里 / 任务没记下 hash），
   * 目标照任务那一份原样折，界面要据此说一句「最多只能到标题与大小相符」。
   */
  resolveReseedScanTarget(data: { seed: IReseedScanSeed; downloaderIds: string[] }): {
    target: IReseedScanTarget;
    resolved: boolean;
  };

  // ===== 1.2 background：打开扩展选项页（content-script 搜索跳转等使用）=====
  openOptionsPage(data?: string | { path: string; query?: Record<string, unknown> }): void;

  // ===== 1.3 chrome.downloads（供备份本地导出等使用）=====
  downloadFile(downloadOptions: chrome.downloads.DownloadOptions): number;

  // ===== 1.4 background：下载冷却结束后重新推送种子（offscreen download 发起，alarms 处理）=====
  reDownloadTorrent(data: IDownloadTorrentOption): void;

  // ===== 1.5 background：原生通信桥（nativeMessaging，可选权限；CLI ptd 本地调用）=====
  nativeBridgeGetStatus(): BridgeStatus;
  nativeBridgeSetEnabled(data: boolean): BridgeStatus;
  nativeBridgeReconnect(): BridgeStatus;

  // ===== 1.6 background：右键菜单（content-script 请求 background 重建/移除菜单项）=====
  addContextMenu(data: chrome.contextMenus.CreateProperties): string;
  removeContextMenu(data: string): void;
  clearContextMenus(): void;

  // ===== 2.6 日志 ( utils/logger ) =====
  logger(data: ILoggerItem): void;
  getLogger(): ILoggerItem[];
  clearLogger(): void;

  // ===== 2.7 备份与恢复 ( utils/backup ) =====
  exportBackupData(data: { backupServerId: string | "local"; backupFields: TBackupFields[] }): boolean;
  getBackupHistory(backupServerId: string): IBackupFileInfo[];
  deleteBackupHistory(data: { backupServerId: string; path: string }): boolean;
  applyBackupRetention(data: { backupServerId: string; keepFilename?: string }): IBackupFileInfo[];
  /**
   * `cookieFailedCount` 是「没能写回浏览器的 cookie 条数」，0 表示全成功。
   *
   * 为什么单独返回而不是只给 boolean：cookie 写回里只要有一条失败（站点已注销、
   * 权限被拒、值格式不对），剩下的就都不该算「恢复成功」—— 而 metadata /
   * settings / downloadHistory 等字段已经真的写进去了，一并作废反而更糟。
   * 所以成功仍算成功，但把失败条数如实带回，由界面给一句「恢复完成，但有 N 个
   * cookie 没写进去」。原先只有 boolean，这条信息一路丢在日志里。
   */
  restoreBackupData(data: {
    restoreData: IBackupData;
    restoreOptions?: IRestoreOptions;
  }): { success: boolean; cookieFailedCount: number };
  getRemoteBackupData(data: { backupServerId: string; path: string; decryptKey?: string }): IBackupData;
}

/**
 * 可序列化的种子信息，用于辅种检测（与 PT-depiler messages.ts 定义一致）
 *
 * 除了原有的 infoHash / name / length / files，这里还带上三层指纹：
 * - titleKey      第 1 层：归一化标题 + 大小（列表页就能算，只用于粗筛候选）
 * - filesFingerprint 第 2 层：文件清单指纹（主力判定）
 * - piecesSample  第 3 层：piece 哈希抽样（权威但贵，所以只带抽样）
 *
 * 注意 piece 只传抽样结果：100 GB 的种子 ≈ 2.5 万个 piece ≈ 500 KB，
 * 整串塞进消息通道既慢又没必要。
 */
export interface ITorrentInfoForVerification {
  infoHash: string;
  name: string;
  length: number;
  /**
   * 规范化后的文件清单（多文件种的 path 含顶层目录名，用的是平台分隔符）。
   *
   * 比对前必须先按 `name` 剥掉顶层目录 —— 跨站同一个数据集的根目录名不一定相同，
   * 直接比字符串会永远比不上。用 `diffFileLists()` 之类的封装即可。
   */
  files: Array<{
    path: string;
    length: number;
  }>;
  /** 第 1 层 key：`normalizeTitle(title) + "|" + size` */
  titleKey?: string;
  /** 第 2 层：文件清单指纹 */
  filesFingerprint?: IFilesFingerprint;
  /** 第 3 层：piece 哈希抽样（seed 侧才有；下载器侧通常拿不到） */
  piecesSample?: IPieceSample | null;
}

// 全局消息处理函数映射
const messageMaps: Partial<ProtocolMap> = {};

/**
 * 仅取协议中「值为函数」的键。ProtocolMap 去掉字符串索引签名后，
 * 泛型里的 PM[K] 不再被隐式约束为函数，需要用这个条件类型显式收窄。
 *
 * ⚠️ 这里的 `any` 是**量过才留下的**，不是懒得改：换成 `(...args: never[]) => unknown`
 * 之后，`PM[K]` 在泛型还没代入时这条条件类型会落到 **false 分支** → `THandler` 变成 `never`，
 * 于是下面 wrapper 里 `Parameters<THandler<PM, K>>[0]` 是 `never`，两处调用当场报
 * TS2322 / TS2345（实测）。`any` 在参数位是双向兼容的，这条判据要的就是那个宽松度。
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
type TMessageKey<PM> = {
  [K in keyof PM]: PM[K] extends (...args: any[]) => any ? K : never;
}[keyof PM];

/**
 * 取键 K 对应的处理器函数类型。必须逐点用条件类型——
 * 光靠 `K extends TMessageKey<PM>` 不会让泛型内部的 PM[K] 被收窄成函数
 * （TS 不会跨聚合条件类型传递约束）。同上面那条：`any` 是实测换不掉的。
 */
type THandler<PM, K extends keyof PM> = PM[K] extends (...args: any[]) => any ? PM[K] : never;
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * 为 sendMessage 和 onMessage 创建一个包装器（移植自 PT-depiler）：
 * - 同一上下文内注册的 handler 直接本地调用，避免 MV3 service worker +
 *   offscreen / firefox background script 的 chrome.runtime.sendMessage 无响应问题
 * - 统一 JSON 深拷贝，避免 Vue 响应式 Proxy 等不可序列化对象进入消息链路引发 DataCloneError（issue #1431）
 */
function createMessageWrapper<PM extends ProtocolMap>(original: {
  sendMessage: <K extends TMessageKey<PM>>(
    type: K,
    data: Parameters<THandler<PM, K>>[0],
  ) => Promise<ReturnType<THandler<PM, K>>>;
  onMessage: <K extends TMessageKey<PM>>(
    type: K,
    handler: (message: { data: Parameters<THandler<PM, K>>[0] }) => void | Promise<ReturnType<THandler<PM, K>>>,
  ) => void;
}) {
  const wrappedOnMessage = <K extends TMessageKey<PM>>(
    type: K,
    handler: (message: { data: Parameters<THandler<PM, K>>[0] }) => void | Promise<ReturnType<THandler<PM, K>>>,
  ) => {
    // @ts-expect-error 泛型 K 在这里证不出「写进 Partial<ProtocolMap> 的同一个键」，索引签名写入要绕一下
    messageMaps[type] = handler;
    original.onMessage(type, handler);
  };

  const wrappedSendMessage = async <K extends TMessageKey<PM>>(
    type: K,
    data: Parameters<THandler<PM, K>>[0],
  ): Promise<ReturnType<THandler<PM, K>>> => {
    // @ts-expect-error 同上：从 Partial<ProtocolMap> 读出来的那条不认得 K，收窄成交给下面用
    const localHandler = messageMaps[type] as THandler<PM, K> | undefined;

    // 本地短路优先：同一上下文内直接调用 handler，根本不存在跨进程序列化边界，
    // 深拷贝纯属白做。这里是 defineExtensionMessaging 设计的核心用途
    // （绕开 MV3 service worker ↔ offscreen 的 sendMessage 无响应问题），必然是本地命中。
    //
    // 大 payload 的受害者：saveSearchResultSnapshotData（快照可达数万条 torrent）、
    // restoreBackupData（含全量 cookies + metadata）、cookies.ts 的逐个 cookie。
    if (localHandler) {
      return await localHandler({ data });
    }

    // 只有真正要跨上下文时才拷贝：Vue 响应式 Proxy 等不可序列化对象
    // 进入消息链路会引发 DataCloneError（issue #1431）
    if (typeof data !== "undefined") {
      data = JSON.parse(JSON.stringify(data));
    }

    return await original.sendMessage(type, data);
  };

  return {
    sendMessage: wrappedSendMessage,
    onMessage: wrappedOnMessage,
  };
}

export const { sendMessage, onMessage } = createMessageWrapper(
  defineExtensionMessaging<ProtocolMap>({
    logger: isDebug ? console : undefined,
  }),
);
