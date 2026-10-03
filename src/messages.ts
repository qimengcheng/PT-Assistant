/// <reference types="chrome" />
import { defineExtensionMessaging } from "@webext-core/messaging";

import type {
  IAdvancedSearchRequestConfig,
  ISearchResult,
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
import type {
  IDownloaderMetadata,
  IDownloadTorrentOption,
  IDownloadTorrentResult,
  ILoggerItem,
  ISearchData,
  ITorrentDownloadMetadata,
  IKeepUploadTask,
  TKeepUploadTaskKey,
  TSearchSnapshotKey,
  TTorrentDownloadKey,
  TTorrentDownloadStatus,
  IRestoreOptions,
  TBackupFields,
  BridgeStatus,
} from "@/shared/types.ts";
import { isDebug } from "~/helper.ts";

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
  // manifest"（v0.5.18 备份恢复失败的根因，当时一度误删本 RPC）。
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
  checkAndExtendCookies(url: string): void;

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
  getClientTorrents(downloaderId: string): CTorrent[];
  getClientTorrentTrackers(data: { downloaderId: string; torrent: CTorrent }): string[];
  deleteClientTorrent(data: { downloaderId: string; id: any; removeData?: boolean }): boolean;
  pauseClientTorrent(data: { downloaderId: string; id: any }): boolean;
  resumeClientTorrent(data: { downloaderId: string; id: any }): boolean;
  recheckClientTorrent(data: { downloaderId: string; id: any }): boolean;
  moveClientTorrentInQueue(data: { downloaderId: string; id: any; direction: TorrentQueueDirection }): boolean;
  setClientTorrentSpeedLimit(data: { downloaderId: string; id: any; limits: TorrentSpeedLimit }): boolean;
  setClientTorrentLabel(data: { downloaderId: string; id: any; label: string }): boolean;

  // ===== 2.2.3 offscreen：文件级 / peers / tracker 管理 =====
  getClientTorrentFiles(data: { downloaderId: string; torrent: CTorrent }): CTorrentFile[];
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
  deleteKeepUploadTask(taskId: TKeepUploadTaskKey): void;
  clearKeepUploadTasks(): void;

  // ===== 2.5.1 offscreen：本地种子指纹索引 ( utils/fingerprint ) =====
  /**
   * 取某个下载器的本地种子指纹索引（标题+大小 / 文件清单 / piece 抽样 / tracker）。
   * 30 分钟内命中 IndexedDB 缓存；refresh=true 强制重建（下载器变动后用）。
   */
  getLocalFingerprintIndex(data: { downloaderId: string; refresh?: boolean }): ILocalFingerprintIndex | null;
  clearLocalFingerprintIndex(data?: { downloaderId?: string }): void;

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
  restoreBackupData(data: { restoreData: IBackupData; restoreOptions?: IRestoreOptions }): boolean;
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
 */
type TMessageKey<PM> = {
  [K in keyof PM]: PM[K] extends (...args: any[]) => any ? K : never;
}[keyof PM];

/**
 * 取键 K 对应的处理器函数类型。必须逐点用条件类型——
 * 光靠 `K extends TMessageKey<PM>` 不会让泛型内部的 PM[K] 被收窄成函数
 * （TS 不会跨聚合条件类型传递约束）。
 */
type THandler<PM, K extends keyof PM> = PM[K] extends (...args: any[]) => any ? PM[K] : never;

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
    // @ts-expect-error
    messageMaps[type] = handler;
    original.onMessage(type, handler);
  };

  const wrappedSendMessage = async <K extends TMessageKey<PM>>(
    type: K,
    data: Parameters<THandler<PM, K>>[0],
  ): Promise<ReturnType<THandler<PM, K>>> => {
    // @ts-expect-error
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
