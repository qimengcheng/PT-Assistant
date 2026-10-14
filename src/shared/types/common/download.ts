import type { AxiosRequestConfig } from "axios";

import type { ITorrent, TSiteID as TSiteKey } from "@ptd/site";
import type { CAddTorrentOptions, CAddTorrentResult } from "@ptd/downloader";
import type { TDownloaderKey } from "@/shared/types/storages/metadata.ts";

export type TTorrentDownloadKey = number;
export type TTorrentDownloadStatus = "pending" | "downloading" | "completed" | "failed";

/**
 * 这一条下载是谁发起的。
 *
 * 只有两档，因为判据是「发送那一刻有没有人正看着界面等结果」：界面上点出来的都算 manual
 * （搜索页、站点页按钮、右键菜单、辅种任务页的手动发送、下载历史页的重新下载、外部程序经
 * native 桥转发进来的），后台自动辅种那一轮算 auto —— 它的成败只进日志与任务进度，没人盯着。
 *
 * 站点下载间隔没到时的冷却重推（alarms 的 `reDownloadTorrent`）带着已存在的 `downloadId`，
 * 不会再落一条新记录，所以它不动这一档：一条记录永远归属它被创建时的发起方。
 */
export type TDownloadTrigger = "manual" | "auto";

export const LocalDownloadMethod = [
  "web", // 和PTPP一样打开对应种子下载的链接页面，然后由浏览器自动拉起下载过程，只有 method='get' 的种子才能支持，其他情况会回落到 extension
  "browser", // （默认）由插件直接调用 chrome.downloads.download() 方法，支持 post, data, headers 参数（够用了），此时 filename 由浏览器自动猜测
  "extension", // （回落）插件调用 axios.requests() 方法，获取并解析种子，生成 Blob 后交由 chrome.downloads.download ，此时 filename 由插件直接控制，可能会出现错误，同时支持 axios 的高级参数
] as const;

export type TLocalDownloadMethod = (typeof LocalDownloadMethod)[number];

export interface IDownloadTorrentOption {
  downloadId?: TTorrentDownloadKey;
  torrent: Partial<ITorrent>;
  downloaderId:
    | string // 下载到对应id的下载器中
    | "local"; // （默认）下载为本地文件

  // 是否忽略种子对应站点的下载
  ignoreSiteDownloadInterval?: boolean;

  // 剩余等待时间(估算)
  leftInterval?: number;

  // 当使用下载为本地文件时，可用下面配置项
  localDownloadMethod?: TLocalDownloadMethod; // 不存在时回落到 configStoreRaw?.download?.localDownloadMethod ?? "web"

  // 当下载到对应id的下载器中时
  addTorrentOptions?: CAddTorrentOptions;

  /**
   * 发起方式。**缺省按 manual** —— 归一化写在落库那一步（offscreen 的 `buildDownloadHistory`），
   * 因为「没说」的情况全是界面点出来的。
   *
   * 反过来，以后新增任何「没人点界面」的发送方（后台定时、批量重推、外部自动流程）**必须显式带 auto**，
   * 否则它会被记成手动，而下载历史页就靠这一档区分两者。
   */
  trigger?: TDownloadTrigger;
}

export interface ITorrentDownloadMetadata extends Pick<ITorrent, "title" | "subTitle" | "url" | "link"> {
  id?: TTorrentDownloadKey; // 每个下载任务生成的唯一id
  siteId: TSiteKey; // 站点id
  torrentId: ITorrent["id"]; // 种子id
  downloaderId: TDownloaderKey | "local"; // 下载器id，注意 local 是一个特殊的关键词，表示本地下载
  downloadAt: number; // 下载时间
  downloadStatus: TTorrentDownloadStatus; // 下载状态
  torrent: ITorrent; // 种子信息
  addTorrentOptions: Partial<CAddTorrentOptions>;

  downloadRequestConfig?: AxiosRequestConfig;
  addTorrentResult?: CAddTorrentResult;
  errorMessage?: string; // 失败时的错误信息（如推送失败原因），便于在下载历史中定位问题

  /**
   * 这一条是谁发起的（见 `TDownloadTrigger`）。
   *
   * **v0.103.0 才开始落库**，所以下面这些存量记录拿不到它：升级之前写下的每一条、以及从备份
   * 导入的旧数据（`offscreen/utils/backup.ts` 那条整表 `put` 不经过 `buildDownloadHistory`）。
   * 界面把它们统一显示成「未记录」，不拿别的字段反推 —— 自动辅种与辅种任务页的手动发送共用
   * 同一个 `buildReseedAddTorrentOptions`，落库的 `addTorrentOptions` 一字不差，推不出来。
   */
  trigger?: TDownloadTrigger;
}

export interface IDownloadTorrentResult {
  downloadId: TTorrentDownloadKey;
  downloadStatus: TTorrentDownloadStatus;
  errorMessage?: string;
}
