import type {
  ISearchCategories,
  ISearchEntryRequestConfig,
  ISiteUserConfig,
  IUserInfo,
  TSiteHost,
  TSiteID as TSiteKey,
} from "@ptd/site";
import type { TSelectSearchCategoryValue } from "@ptd/site";
import type { CAddTorrentOptions, DownloaderBaseConfig } from "@ptd/downloader";
import type { IMediaServerBaseConfig } from "@ptd/mediaServer";
import type { IBackupConfig, IBackupRetention } from "@ptd/backupServer";
import type { IImageHostMetadata, TImageHostKey } from "@/shared/imageHost/types.ts";

export interface ISearchSolution {
  id: string;
  siteId: TSiteKey;
  /**
   * 如何展示该站点搜索配置名称，
   * 在 #457 之前使用 selectedCategories 自动生成，在 #457 之后改为可选的 name 字段，其中 name 优先级更高
   */
  name?: string; // 方案名称，默认为空
  selectedCategories?: Record<ISearchCategories["key"], TSelectSearchCategoryValue>;
  searchEntries: Record<string, ISearchEntryRequestConfig>;
}

export type TSolutionKey = string;
export interface ISearchSolutionMetadata {
  id: TSolutionKey;
  name: string;
  sort: number;
  enabled: boolean;
  isDefault: boolean;
  createdAt: number;
  solutions: ISearchSolution[];
}

export type TSearchSnapshotKey = string;
export interface ISearchSnapshotMetadata {
  id: TSearchSnapshotKey;
  name: string; // [搜索方案] 搜索词 (搜索时间)
  createdAt: number;
  recordCount: number; // 记录数
}

// 这里要的是一个**有名字**的类型（存档记录、日志、IndexedDB store 都按 `IStoredUserInfo` 说话），
// 不是 `IUserInfo` 的别名 —— 空 body 是刻意的，所以豁免这条。
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface IStoredUserInfo extends IUserInfo {}

export type TDownloaderKey = string;

export interface IDownloaderMetadata extends DownloaderBaseConfig {
  id: TDownloaderKey;
  enabled: boolean;

  suggestFolders?: string[];
  suggestTags?: string[];

  /**
   * 「种子的分类叫法 → 这台下载器的分类目录」的关联记忆：发送到下载器的弹窗里，种子分类
   * 既没匹配上目录、用户又选了「新建分类 / 关联已有分类」并勾了「记住这个关联」时写进来。
   *
   * 键是折过小写、去过首尾空白的原样叫法（判据见 `categoryMatch.ts` 的 `categoryAssocKey`），
   * 值是带 `category:` 前缀的原样串。故意按下载器存：每台客户端的分类目录是各配一套。
   */
  categoryAssoc?: Record<string, string>;

  sortIndex?: number; // 排序索引，默认值取 100
  excludedSites?: string[]; // 排除的站点列表，在该列表中的站点不会显示该下载器
  autoFlushStatus?: number; // 自动刷新状态，0: 关闭，其他数值表示刷新间隔的秒数

  [key: string]: unknown; // 其他配置项（读已声明的字段不受影响，声明优先于索引签名）
}

export interface IDefaultDownloaderConfig {
  id?: TDownloaderKey;
  folder?: string;
  tags?: string;
}

export type TMediaServerKey = string;
export interface IMediaServerMetadata extends IMediaServerBaseConfig {
  id: TMediaServerKey;
  enabled: boolean;
  [key: string]: unknown; // 其他配置项
}

export const BackupFields = [
  "cookies", // 备份已添加站点的Cookie
  "config", // 备份插件基本配置
  "metadata", // 备份插件元数据（站点、搜索方案、下载器、媒体服务器等配置）
  "userInfo", // 备份插件历史获取的用户信息
  "searchResultSnapshot", // 备份搜索结果快照
  "keepUploadTask", // 备份辅种任务
  "downloadHistory", // 备份下载历史
] as const;
export type TBackupFields = (typeof BackupFields)[number];

export type TBackupServerKey = string;
export interface IBackupServerMetadata extends IBackupConfig {
  id: TBackupServerKey;
  enabled: boolean; // 此处仅影响自动备份
  backupFields: TBackupFields[]; // 备份的字段
  retention?: IBackupRetention; // 历史备份的保留策略，不设置或全部未启用时表示不自动清理

  lastBackupAt?: number; // 上次备份时间
  backupInterval?: number; // 自动备份间隔（小时），不设置或为 0 表示不自动备份
}

export interface IMetadataPiniaStorageSchema {
  // 站点配置(用户配置)
  sites: Record<TSiteKey, ISiteUserConfig>;

  // 搜索方案配置
  solutions: Record<TSolutionKey, ISearchSolutionMetadata>;

  /**
   * 搜索快照配置（元信息）
   * 具体快照内容需要通过 getSearchResultSnapshotData() 方法获取
   */
  snapshots: Record<TSearchSnapshotKey, ISearchSnapshotMetadata>;

  // 下载器配置
  downloaders: Record<TDownloaderKey, IDownloaderMetadata>;

  // 媒体服务器配置
  mediaServers: Record<TMediaServerKey, IMediaServerMetadata>;

  // 备份服务器配置
  backupServers: Record<TBackupServerKey, IBackupServerMetadata>;

  /**
   * 图床配置（转种时把源站截图转存过去）。
   *
   * 与 backupServers / downloaders 同住在 metadata 而不是 config：config 那份只管界面偏好，
   * 这一份是外部服务的连接信息，要跟着备份包一起走。凭证是明文，与站点 cookie 同一笔账。
   */
  imageHosts: Record<TImageHostKey, IImageHostMetadata>;

  // 默认搜索方案
  defaultSolutionId: TSolutionKey | "default";

  // 默认下载器配置
  defaultDownloader: IDefaultDownloaderConfig;

  // 上一次搜索时在结果页面的筛选词，需要启用 configStore.searchEntity.saveLastFilter
  lastSearchFilter?: string;

  /**
   * 此处仅存储站点最近一次的记录。
   *
   * ⚠️ **历史记录不在 storage 里** —— 原注释写「需要获取历史记录要用 storage 方法获取」，
   * 那是指搬迁前的实现。历史早已进 IndexedDB：`shared/userInfoArchive.ts` 的
   * `readSiteArchive` / `readAllArchive`。照原注释去 `extStore.getItem("userInfo")`
   * 只会拿到 `{}`（那个键已标 @deprecated，迁移后被 userInfoArchive 清空）。
   */
  lastUserInfo: Record<TSiteKey, IStoredUserInfo>;

  lastDownloader?: {
    id?: TDownloaderKey;
    options?: Omit<CAddTorrentOptions, "localDownloadOption">;
  };

  // 上一次创建辅种任务时使用的下载设置（受 saveLastDownloader 配置控制）
  lastKeepUpload?: {
    downloaderId?: TDownloaderKey;
    savePath?: string;
    label?: string;
  };

  // 上一次自动刷新的时间戳
  lastUserInfoAutoFlushAt: number;

  // 站点 host 映射表
  siteHostMap: Record<TSiteHost, TSiteKey>;

  // 站点 ID 到站点名称的映射表
  siteNameMap: Record<TSiteKey, string>;

  /**
   * 「站点分类」的一次性回填跑过了没有（v0.101.2 起）。
   *
   * 为什么用自带标记而不是 config 那套 version 门：config store 的 afterRestore 末尾就把
   * `version` 追平成当前版本了，两条水合是各自独立的异步过程，谁先谁后说不准 —— 等回填
   * 轮到跑的时候门可能已经判不出「更旧」了。标记落在被改的那份数据自己头上，不看别人脸色。
   */
  siteGroupsBackfilled?: boolean;
}
