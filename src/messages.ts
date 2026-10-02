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
import type { TorrentClientStatus } from "@ptd/downloader";
import type { IBackupData, IBackupFileInfo } from "@ptd/backupServer";

import type { TExtensionStorageKey, IExtensionStorageSchema } from "@/storage.ts";
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
} from "@/shared/types.ts";
import { isDebug } from "~/helper.ts";

/**
 * 消息协议（对齐 PT-depiler messages.ts 的全量协议，按已平移模块裁剪：
 * 未平移的 backup / nativeMessaging / CLI 分组暂不声明，走索引签名宽松兜底）：
 * 1. background —— chrome cookies / DNR / storage
 * 2. offscreen —— 站点解析、搜索、下载器、用户信息、社交信息、辅种
 */
type TMessageMap = Record<string, (data: any) => any>;

export interface ProtocolMap extends TMessageMap {
  ping(data?: null): { version: string; definitionCount: number };

  // ===== 1. chrome.storage（供 site 包 adapter 的 store/retrieve 使用）=====
  getExtStorage<T extends TExtensionStorageKey>(key: T): IExtensionStorageSchema[T];
  setExtStorage<T extends TExtensionStorageKey>(data: { key: T; value: IExtensionStorageSchema[T] }): void;

  // ===== 1.1 chrome.declarativeNetRequest（供 unsafe header 替换使用）=====
  updateDNRSessionRules(data: { rule: chrome.declarativeNetRequest.Rule; extOnly?: boolean }): void;
  removeDNRSessionRuleById(data: chrome.declarativeNetRequest.Rule["id"]): void;

  // ===== 1.2 chrome.cookies（供 Cloudflare 重试与站点登录态使用）=====
  getAllCookies(data: chrome.cookies.GetAllDetails): chrome.cookies.Cookie[];
  setCookie(data: chrome.cookies.SetDetails): boolean;
  getCookie(data: chrome.cookies.CookieDetails): chrome.cookies.Cookie | null;
  removeCookie(data: chrome.cookies.CookieDetails | chrome.cookies.SetDetails): chrome.cookies.CookieDetails | null;

  // ===== 2. offscreen：站点基础 ( utils/site ) =====
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

  // ===== 1.3 chrome.downloads（供备份本地导出等使用）=====
  downloadFile(downloadOptions: chrome.downloads.DownloadOptions): number;

  // ===== 2.6 日志 ( utils/logger ) =====
  logger(data: ILoggerItem): void;

  // ===== 2.7 备份与恢复 ( utils/backup ) =====
  exportBackupData(data: { backupServerId: string | "local"; backupFields: TBackupFields[] }): boolean;
  getBackupHistory(backupServerId: string): IBackupFileInfo[];
  deleteBackupHistory(data: { backupServerId: string; path: string }): boolean;
  applyBackupRetention(data: { backupServerId: string; keepFilename?: string }): IBackupFileInfo[];
  restoreBackupData(data: { restoreData: IBackupData; restoreOptions?: IRestoreOptions }): boolean;
  getRemoteBackupData(data: { backupServerId: string; path: string; decryptKey?: string }): IBackupData;
}

/** 可序列化的种子信息，用于辅种检测（与 PT-depiler messages.ts 定义一致） */
export interface ITorrentInfoForVerification {
  infoHash: string;
  name: string;
  length: number;
  files: Array<{
    path: string;
    length: number;
  }>;
}

// 全局消息处理函数映射
const messageMaps: Partial<ProtocolMap> = {};

/**
 * 为 sendMessage 和 onMessage 创建一个包装器（移植自 PT-depiler）：
 * - 同一上下文内注册的 handler 直接本地调用，避免 MV3 service worker +
 *   offscreen / firefox background script 的 chrome.runtime.sendMessage 无响应问题
 * - 统一 JSON 深拷贝，避免 Vue 响应式 Proxy 等不可序列化对象进入消息链路引发 DataCloneError（issue #1431）
 */
function createMessageWrapper<PM extends ProtocolMap>(original: {
  sendMessage: <K extends keyof PM>(type: K, data: Parameters<PM[K]>[0]) => Promise<ReturnType<PM[K]>>;
  onMessage: <K extends keyof PM>(
    type: K,
    handler: (message: { data: Parameters<PM[K]>[0] }) => void | Promise<ReturnType<PM[K]>>,
  ) => void;
}) {
  const wrappedOnMessage = <K extends keyof PM>(
    type: K,
    handler: (message: { data: Parameters<PM[K]>[0] }) => void | Promise<ReturnType<PM[K]>>,
  ) => {
    // @ts-expect-error
    messageMaps[type] = handler;
    original.onMessage(type, handler);
  };

  const wrappedSendMessage = async <K extends keyof PM>(
    type: K,
    data: Parameters<PM[K]>[0],
  ): Promise<ReturnType<PM[K]>> => {
    // @ts-expect-error
    const localHandler = messageMaps[type] as PM[K] | undefined;

    if (typeof data !== "undefined") {
      data = JSON.parse(JSON.stringify(data));
    }

    if (localHandler) {
      return await localHandler({ data });
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
