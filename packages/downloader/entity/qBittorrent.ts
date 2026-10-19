/**
 * @see https://github.com/qbittorrent/qBittorrent/wiki/Web-API-Documentation
 *
 * 注意，因为使用大驼峰命名的形式，所以qBittorrent在各变量命名中均写成 QBittorrent
 */
import {
  AbstractBittorrentClient,
  type CAddTorrentOptions,
  CustomPathDescription,
  type CTorrent,
  type TorrentClientConfig,
  type TorrentClientMetaData,
  type CTorrentFilterRules,
  CTorrentState,
  type TorrentClientStatus,
  type CAddTorrentResult,
  type TorrentQueueDirection,
  type TorrentSpeedLimit,
  type CTorrentFile,
  type CTorrentFileList,
  type CTorrentFileSelection,
  type CTorrentPeer,
  type CTorrentTracker,
  CTrackerState,
  type TorrentFilePriority,
} from "../types";
import { type AxiosError, type AxiosRequestConfig, type AxiosResponse } from "axios";
import urlJoin from "url-join";
import { axios, getRemoteTorrentFile } from "../utils";
import { merge } from "es-toolkit";

/**
 * 定义一个 前缀，用于标识 qBittorrent 的分类
 * 如果用户传入的 savePath 中包含了这个前缀，则认为是 qBittorrent 的分类
 * 则设置 autoTMM = true & category = savePath.replace(category_prefix, "")
 */
const category_prefix = "category:";

export const clientConfig: TorrentClientConfig = {
  type: "qBittorrent",
  name: "qBittorrent",
  address: "http://localhost:9091/",
  username: "",
  password: "",
  timeout: 10 * 1e3,
};

// noinspection JSUnusedGlobalSymbols
export const clientMetaData: TorrentClientMetaData = {
  description: "qBittorrent是一个跨平台的自由BitTorrent客户端，其图形用户界面是由Qt所写成的。",
  warning: [
    "当前仅支持 qBittorrent v4.1+",
    "如果你使用的 qBittorrent 版本大于 5.2.0，可以使用 API Key 形式连接，此时请直接留空用户名，在密码栏输入 API key。",
    "如不便禁用 qBittorrent 的『启用跨站请求伪造(CSRF)保护』功能，可在下方开启『绕过 CSRF 保护』选项",
    "注意：由于 qBittorrent 验证机制限制，第一次测试连接成功后，后续测试无论密码正确与否都会提示成功。",
  ],
  feature: {
    CustomPath: {
      allowed: true,
      description:
        CustomPathDescription +
        `（ qBittorrent 额外支持以 "${category_prefix}" 前缀的分类作为下载目录，当使用该前缀时，请在 qBittorrent 中预设分类信息。）`,
    },
    DefaultAutoStart: {
      allowed: true,
    },
    Recheck: {
      allowed: true,
    },
    Queue: {
      allowed: true,
    },
    SpeedLimit: {
      allowed: true,
    },
    Label: {
      allowed: true,
    },
    BypassCSRF: {
      allowed: true,
    },
    FileList: {
      allowed: true,
    },
    FilePriority: {
      allowed: true,
    },
    PeerList: {
      allowed: true,
    },
    TrackerList: {
      allowed: true,
    },
    TrackerManage: {
      allowed: true,
    },
  },
  advanceAddTorrentOptions: [
    {
      name: "自动管理模式",
      key: "autoTMM",
      type: "boolean",
      defaultValue: false,
      description: `当使用 "${category_prefix}" 前缀的分类作为下载目录，会自动启用`,
    },
    { name: "跳过哈希校验", key: "skip_checking", type: "boolean", defaultValue: false },
    { name: "顺序下载", key: "sequentialDownload", type: "boolean", defaultValue: false },
    { name: "先下载首尾文件块", key: "firstLastPiecePrio", type: "boolean", defaultValue: false },
  ],
} as const;

const QBittorrentAdvanceAddTorrentOptionsBooleanKey = clientMetaData
  .advanceAddTorrentOptions!.filter((x) => x.type === "boolean")
  .map((x) => x.key) as ["autoTMM", "skip_checking", "sequentialDownload", "firstLastPiecePrio"];
type TQBittorrentAdvanceAddTorrentOptionsBooleanKey = (typeof QBittorrentAdvanceAddTorrentOptionsBooleanKey)[number];
type TQBittorrentAdvanceAddTorrentOptionsKey = TQBittorrentAdvanceAddTorrentOptionsBooleanKey | string;

/**
 * qBittorrent `TorrentContentLayout` 的**键名原文**，逐字抄自它自己的枚举
 * （`src/base/bittorrent/torrentcontentlayout.h`，4.5.0 / 4.6.0 / 5.2.3 三个 tag 一致）。
 * 服务端拿 `QMetaEnum::keyToValue` 精确匹配，认不出的串静默退回 `Original`，所以这一串
 * 不是可以随手改写的字符串 —— 改它之前先把上面那三行实测重做一遍。
 */
export const QBITTORRENT_CONTENT_LAYOUT_VALUES: string[] = ["Original", "Subfolder", "NoSubfolder"];

type TrueFalseStr = "true" | "false";

enum QbittorrentTorrentState {
  Error = "error", // Some error occurred, applies to paused torrents
  PausedUP = "pausedUP", // Torrent is paused and has finished downloading
  PausedDL = "pausedDL", // Torrent is paused and has NOT finished downloading
  QueuedUP = "queuedUP", // Queuing is enabled and torrent is queued for upload
  QueuedDL = "queuedDL", // Queuing is enabled and torrent is queued for download
  Uploading = "uploading", // Torrent is being seeded and data is being transferred
  StalledUP = "stalledUP", // Torrent is being seeded, but no connection were made
  CheckingUP = "checkingUP", // Torrent has finished downloading and is being checked; this status also applies to preallocation (if enabled) and checking resume data on qBt startup
  CheckingDL = "checkingDL", // Same as checkingUP, but torrent has NOT finished downloading
  Downloading = "downloading", // Torrent is being downloaded and data is being transferred
  StalledDL = "stalledDL", // Torrent is being downloaded, but no connection were made
  ForcedDL = "forcedDL", // Torrent is forced to downloading to ignore queue limit
  ForcedUP = "forcedUP", // Torrent is forced to uploading and ignore queue limit
  MetaDL = "metaDL", // Torrent has just started downloading and is fetching metadata
  Allocating = "allocating", // Torrent is allocating disk space for download
  QueuedForChecking = "queuedForChecking",
  CheckingResumeData = "checkingResumeData", // Checking resume data on qBt startup
  Moving = "moving", // Torrent is moving to another location
  Unknown = "unknown", // Unknown status
  MissingFiles = "missingFiles", // Torrent data files is missing
}

interface rawTorrent {
  name: string; // Torrent name
  hash: string;
  magnet_uri: string;
  added_on: number; // datetime in seconds
  size: number; // Torrent size
  progress: number; // Torrent progress
  dlspeed: number; // Torrent download speed (bytes/s)
  upspeed: number; // Torrent upload speed (bytes/s)
  priority: number; // Torrent priority (-1 if queuing is disabled)
  num_seeds: number; // Torrent seeds connected to
  num_complete: number; // Torrent seeds in the swarm
  num_leechs: number; // Torrent leechers connected to
  num_incomplete: number; // Torrent leechers in the swarm
  ratio: number; // Torrent share ratio
  eta: number; // Torrent ETA
  state: QbittorrentTorrentState; // Torrent state
  seq_dl: boolean; // Torrent sequential download state
  f_l_piece_prio: boolean; // Torrent first last piece priority state
  completion_on: number; // Torrent copletion datetime in seconds
  tracker: string; // Torrent tracker
  dl_limit: number; // Torrent download limit
  up_limit: number; // Torrent upload limit
  downloaded: number; // Amount of data downloaded
  uploaded: number; // Amount of data uploaded
  downloaded_session: number; // Amount of data downloaded since program open
  uploaded_session: number; // Amount of data uploaded since program open
  amount_left: number; // Amount of data left to download
  save_path: string; // Torrent save path
  /**
   * 数据实际所在路径：多文件种 = 顶层目录本身，单文件种 = 那个文件
   * （qBittorrent `torrent.h` 对 `contentPath()` 的区分）。老版本不报这一格。
   */
  content_path?: string;
  completed: number; // Amount of data completed
  max_ratio: number; // Upload max share ratio
  max_seeding_time: number; // Upload max seeding time
  ratio_limit: number; // Upload share ratio limit
  seeding_time_limit: number; // Upload seeding time limit
  seen_complete: number; // Indicates the time when the torrent was last seen complete/whole
  last_activity: number; // Last time when a chunk was downloaded/uploaded
  total_size: number; // Size including unwanted data

  time_active: number;

  category: string; // Category name
  /** 标签：qBittorrent 的 /torrents/info 把它们拼成一个逗号分隔的字符串给出来 */
  tags?: string;
}

/**
 * 把 qBittorrent 那个逗号拼接的 `tags` 字符串拆成数组。
 * 标签名本身含逗号时会被拆成两条 —— 那是那个拼接格式的固有限制，这里没有可依据的转义规则。
 */
function splitTags(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const list = raw
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
  return list.length ? list : undefined;
}

/**
 * 这条种子的**整条数据**是不是都在本地。
 *
 * 不能只看 `progress === 1`：qBittorrent 那一栏是「选定大小」的完成度 —— 官方 WebAPI 写得很明确，
 * `size` = "Total size of files selected for download"、`total_size` = "Total size of all files
 * in this torrent (including unselected ones)"，所以**只勾了一部分文件**的种子会把没选的那些整个跳过、
 * 直接报 progress = 1。这种种子在辅种那条路上不是"已下完"：别的站要的是整条种子的数据，
 * 推过去就是 0% 下不动（用户 2026-10-19 那张截图：选定 13.93 GiB / 整条 679.51 GiB / 进度 100% /
 * 可用性 16.1%，而它被当成了辅种基准，推出十几条 0% 已停止的副本）。
 *
 * ⚠️ 两个数**报不出来时一律放行**（旧版 WebAPI 没有 `total_size`，未取到元数据时它是 0）：
 * 这一档是"能不能辅种"的硬闸，误拦会把用户**本地真有数据**的那些一起挡掉 —— 那比少判一条严重得多。
 */
export function isFullyDownloaded(torrent: Partial<Pick<rawTorrent, "progress" | "size" | "total_size">>): boolean {
  if (torrent.progress !== 1) return false;
  const selected = torrent.size;
  const whole = torrent.total_size;
  if (typeof selected !== "number" || typeof whole !== "number" || whole <= 0) return true;
  return selected >= whole;
}

interface QbittorrentTorrent extends CTorrent<rawTorrent> {
  id: string;
}

type QbittorrentTorrentFilters =
  | "all"
  | "downloading"
  | "completed"
  | "paused"
  | "active"
  | "inactive"
  | "resumed"
  | "stalled"
  | "stalled_uploading"
  | "stalled_downloading";

interface QbittorrentTorrentFilterRules extends CTorrentFilterRules {
  hashes?: string | string[];
  filter?: QbittorrentTorrentFilters;
  category?: string;
  sort?: string;
  offset?: number;
  reverse?: boolean | TrueFalseStr;
}

// refs: https://github.com/qbittorrent/qBittorrent/pull/23202/changes
interface QBittorrentAddTorrentResponse {
  added_torrent_ids?: string[];
  failure_count?: number;
  pending_count?: number;
  success_count?: number;
}

interface rawSyncMaindata {
  rid: number;
  full_update?: boolean;
  torrents?: Record<string, rawTorrent>;
  torrents_removed?: string[];
  categories?: Record<string, { name: string; savePath: string }>;
  categories_removed?: string[];
  tags?: string[];
  tags_removed?: string[];
  server_state?: Record<string, string | number | boolean>;
}

const convertMaps: [string, keyof TorrentClientStatus][] = [
  ["dl_info_data", "dlData"],
  ["dl_info_speed", "dlSpeed"],
  ["up_info_data", "upData"],
  ["up_info_speed", "upSpeed"],
];

/**
 * 取路径最后一段作为文件名。
 *
 * CTorrentFile 的契约是「name 不含路径」，而 qBittorrent 的 `/torrents/files` 回的是
 * `种子目录/子目录/文件` —— 原样当 name 用，列表里每行都带一遍路径。
 * Deluge（`file.path.split(/[/\\]/).pop()`）和 ruTorrent 早就是这条规则，qBittorrent
 * 是这批里唯一没剥的那个，所以按同一条收口，而不是另发明一种「只剥顶层」的判法：
 * 嵌套目录（`种子目录/CD1/track01.flac`）只剥第一段的话 name 里仍然留着斜杠。
 * path 字段不动 —— 第二层种子指纹吃的就是 path。
 */
function toFileName(name: string): string {
  return name.split(/[/\\]/).pop() || name;
}

// qBittorrent 文件优先级: 0=skip, 1=normal, 6=high, 7=maximum
function mapQBittorrentFilePriority(priority: number): TorrentFilePriority {
  switch (priority) {
    case 0:
      return "skip";
    case 6:
      return "high";
    case 7:
      return "highest";
    case 1:
    default:
      return "normal";
  }
}

function mapTorrentFilePriorityToQBittorrent(priority: TorrentFilePriority): number {
  switch (priority) {
    case "skip":
      return 0;
    case "high":
      return 6;
    case "highest":
      return 7;
    case "low":
    case "normal":
    default:
      return 1;
  }
}

// qBittorrent tracker status: 0=disabled, 1=notContacted, 2=working, 3=updating, 4=error
function mapQbittorrentTrackerState(status: number): CTrackerState {
  switch (status) {
    case 0:
      return CTrackerState.disabled;
    case 2:
      return CTrackerState.working;
    case 3:
      return CTrackerState.updating;
    case 4:
      return CTrackerState.error;
    case 1:
    default:
      return CTrackerState.unknown;
  }
}

function normalizePieces(pieces: string | string[], joinBy: string = "|"): string {
  if (Array.isArray(pieces)) {
    return pieces.join(joinBy);
  }
  return pieces;
}

// noinspection JSUnusedGlobalSymbols
export default class QBittorrent extends AbstractBittorrentClient<TorrentClientConfig> {
  readonly version = "v0.1.0";

  isLogin: boolean | null = null;
  private syncData: rawSyncMaindata = { rid: 0 };
  private lastSyncTimestamp: number = 0;
  private webApiVersion: string | null = null;
  /** 单飞重登用（见 request 的 403 分支），同一时刻只允许一个重登在进行 */
  private _reloginPromise: Promise<void> | null = null;

  constructor(options: Partial<TorrentClientConfig> = {}) {
    super({ ...clientConfig, ...options });
  }

  get isApiKeyAuth(): boolean {
    // ⚠️ 只有 username 为空时才会走到 startsWith（`&&` 短路），所以坏的形状是
    // 「username 空 且 password 这项是 undefined」。构造函数吃的是
    // `{...clientConfig, ...options}`，实测两种展开：options 里**没有**这个键时默认的 ""
    // 会留下（不炸）；键在、值为 undefined 时被覆盖成 undefined（炸）。而
    // `DownloaderBaseConfig.password` 的类型本来就是可选，配置又是从存储里直接传进来的
    // （getDownloader 把 config 原样交给构造函数）。原先直接 .startsWith 抛 TypeError，
    // 这个 getter 每个请求前都要问一次，于是整个客户端不可用。补 ?? ""。
    return !this.config.username && (this.config.password ?? "").startsWith("qbt_");
  }

  // 是否启用「绕过 CSRF 保护」：请求时通过 DNR 移除 Origin 头
  private get bypassCSRF(): boolean {
    return this.config.feature?.BypassCSRF === true;
  }

  async ping(): Promise<boolean> {
    try {
      if (this.isApiKeyAuth) {
        const version = await this.getClientVersion();
        this.isLogin = !!version;
      } else {
        const pong = await this.login();
        // qbittorrent 5.2.0+ returns 204 No Content with empty body, older versions return 200 OK with "Ok." body
        this.isLogin = pong.data === "Ok." || pong.status === 204;
      }

      return this.isLogin;
    } catch (e) {
      return false;
    }
  }

  protected async getClientVersionFromRemote(): Promise<string> {
    const { data: version } = await this.request<string>("/app/version");
    const { data: webApiVersion } = await this.request<string>("/app/webapiVersion");
    this.webApiVersion = webApiVersion;
    return `${version} (${webApiVersion})`;
  }

  // Returns true when the connected qBittorrent WebAPI version is at least major.minor.
  // qBittorrent 5.0.0 ships WebAPI 2.11.0 which renamed pause→stop and resume→start.
  private async isApiVersionAtLeast(major: number, minor: number): Promise<boolean> {
    if (this.webApiVersion === null) {
      const { data: webApiVersion } = await this.request<string>("/app/webapiVersion");
      this.webApiVersion = webApiVersion;
    }
    const parts = this.webApiVersion.split(".");
    const remoteMajor = parseInt(parts[0] ?? "0", 10);
    const remoteMinor = parseInt(parts[1] ?? "0", 10);
    if (isNaN(remoteMajor) || isNaN(remoteMinor)) {
      return false;
    }
    return remoteMajor > major || (remoteMajor === major && remoteMinor >= minor);
  }

  override async getClientStatus(): Promise<TorrentClientStatus> {
    const retStatus: TorrentClientStatus = await super.getClientStatus();
    const { server_state } = await this.getSyncData();

    for (const [key, convertKey] of convertMaps) {
      if (server_state?.[key]) {
        retStatus[convertKey] = Number(server_state[key]);
      }
    }

    return retStatus as TorrentClientStatus;
  }

  override async getClientFreeSpace(): Promise<number> {
    const syncData = await this.getSyncData();
    // 声明的是 number，但 server_state 可能整个缺失 —— 给 0 而不是 undefined
    return (syncData.server_state?.["free_space_on_disk"] as number) ?? 0;
  }

  // qbt 默认Session时长 3600s，一次登录应该足够进行所有操作
  async login(): Promise<AxiosResponse> {
    const form = new FormData();
    form.append("username", this.config.username);
    form.append("password", this.config.password);

    return await axios.post(urlJoin(this.config.address, "/api/v2", "/auth/login"), form, {
      timeout: this.config.timeout,
      withCredentials: true,
      ...(this.bypassCSRF ? { headers: { origin: "" } } : {}),
    });
  }

  private async request<T>(path: string, config: AxiosRequestConfig = {}): Promise<AxiosResponse<T>> {
    if (this.isLogin === null && !this.isApiKeyAuth) {
      await this.ping();
    }

    const send = async () => {
      if (config.method?.toLowerCase() === "post") {
        config.headers = {
          ...(config.headers ?? {}),
          "content-type": "application/x-www-form-urlencoded",
        };
      }

      if (this.isApiKeyAuth) {
        config.headers = {
          ...(config.headers ?? {}),
          Authorization: `Bearer ${this.config.password}`,
        };
      }

      if (this.bypassCSRF) {
        config.headers = {
          ...(config.headers ?? {}),
          origin: "", // 空字符串哨兵：replaceUnsafeHeader 拦截器会将其转为移除 Origin 头
        };
      }

      return await axios.request<T>({
        baseURL: this.config.address,
        url: urlJoin("/api/v2", path),
        timeout: this.config.timeout,
        ...config,
      });
    };

    try {
      return await send();
    } catch (e) {
      // qbt 的会话默认 3600s 过期，而本实例在 offscreen 里按 id 长驻缓存，
      // isLogin 只在 null 时才 ping 一次 —— 运行一小时后全链路 403 且永不自愈。
      // 这里捕获 403 重登一次再重试；单飞（复用同一个 promise）避免并发请求各登一次。
      const isForbidden = (e as AxiosError)?.response?.status === 403;
      if (!isForbidden || this.isApiKeyAuth) throw e;
      // 登录接口本身 403 不能重试，否则无限递归
      if (path.startsWith("/auth/login")) throw e;

      await this.reloginOnce();
      return await send();
    }
  }

  /** 单飞重登：并发 403 时只真正登录一次，其余调用复用同一个 promise */
  private reloginOnce(): Promise<void> {
    if (!this._reloginPromise) {
      this._reloginPromise = (async () => {
        this.isLogin = null;
        try {
          await this.ping();
        } finally {
          this._reloginPromise = null;
        }
      })();
    }
    return this._reloginPromise;
  }

  private async getSyncData(fullSync: boolean = false) {
    if (Date.now() > this.lastSyncTimestamp + 15e3) {
      const { data } = await this.request<rawSyncMaindata>("/sync/maindata", {
        params: { rid: fullSync ? 0 : this.syncData.rid },
      });

      this.lastSyncTimestamp = Date.now();
      this.syncData = data.full_update ? data : merge(this.syncData, data);

      if (this.syncData.torrents && this.syncData.torrents_removed) {
        this.syncData.torrents_removed.forEach((hash) => delete this.syncData.torrents![hash]);
        delete this.syncData.torrents_removed;
      }

      if (this.syncData.categories && this.syncData.categories_removed) {
        this.syncData.categories_removed.forEach((cat) => delete this.syncData.categories![cat]);
        delete this.syncData.categories_removed;
      }

      if (this.syncData.tags && this.syncData.tags_removed) {
        this.syncData.tags_removed.forEach((removeTag) => {
          const tagIndex = this.syncData.tags!.findIndex((tag) => {
            return tag === removeTag;
          });
          if (tagIndex !== -1) {
            this.syncData.tags!.splice(tagIndex, 1);
          }
        });
        delete this.syncData.tags_removed;
      }
    }

    return this.syncData;
  }

  async addTorrent(url: string, options: Partial<CAddTorrentOptions> = {}): Promise<CAddTorrentResult> {
    const addResult = { success: false } as CAddTorrentResult;

    const formData = new FormData();
    const advanceAddTorrentOptions = (options.advanceAddTorrentOptions ?? {}) as Record<
      TQBittorrentAdvanceAddTorrentOptionsKey,
      any
    >;

    // 处理链接
    if (url.startsWith("magnet:") || !options.localDownload) {
      formData.append("urls", url);
    } else {
      const torrent = await getRemoteTorrentFile({
        url,
        ...(options.localDownloadOption || {}),
      });

      formData.append("torrents", torrent.metadata.blob(), torrent.name);
    }

    // 将通用字段转成qbt字段
    if (options.savePath) {
      // 如果是 qBittorrent 的分类，则设置 autoTMM = true & category = savePath.replace(category_prefix, "")
      if (options.savePath.startsWith(category_prefix)) {
        advanceAddTorrentOptions.autoTMM = true; // 开启自动管理
        formData.append("category", options.savePath.replace(category_prefix, "")); // 分类名称
      } else {
        formData.append("savepath", options.savePath); // Download folder
      }
    }

    if (options.label) {
      formData.append("tags", options.label); // Tags for the torrent
    }

    if (options.addAtPaused) {
      // 同时发送新旧两个参数，让 qBittorrent 自动选择识别
      // qBittorrent < 5.1.0 使用 'paused' 参数
      formData.append("paused", options.addAtPaused ? "true" : "false");
      // qBittorrent 5.1.0+ 使用 'stopped' 参数
      formData.append("stopped", options.addAtPaused ? "true" : "false");
    }

    if (options.uploadSpeedLimit && options.uploadSpeedLimit > 0) {
      // Upload speed limit in bytes/sec, -1 means no limit
      formData.append("upLimit", (options.uploadSpeedLimit * 1024 * 1024).toString());
    }

    // 处理高级选项（Boolean类型）
    for (const key of QBittorrentAdvanceAddTorrentOptionsBooleanKey) {
      if (advanceAddTorrentOptions[key] === true) {
        formData.append(key, "true");
      }
    }

    // 内容布局走 `advanceAddTorrentOptions.contentLayout`（辅种要用它，见 `src/shared/reseedTargetDir.ts`）。
    // 值只能是它那个枚举的**键名原文**：服务端是 `QMetaEnum::keyToValue` 精确匹配，
    // 认不出的串**静默退回 `Original`**（实测 release-5.2.3 的 `torrentscontroller.cpp` 那三行 +
    // `utils/string.h` 的 `toEnum`），所以拼错了不会报错、只会「设了等于没设」—— 这里干脆只放行三个真名。
    // 4.5.0 / 4.6.0 / 5.2.3 三个 tag 的枚举都是这一套名字（逐个拉过源码），更早的没查；
    // 老拼法 `NoCreateSubfolder` 发过去只会静默不生效，所以不再兼容、也不发。
    //
    // 刻意**没**把它登记进上面那份 `clientMetaData.advanceAddTorrentOptions`：那一份被两处界面
    // 当**布尔开关**渲染（`SetDownloader/Editor.vue` 与 `SentToDownloaderDialog/Index.vue` 都是
    // `a-switch` 直绑 `opt.key`），一个字符串塞进去就是一颗「拨一下就把布局写成 true」的键。
    const contentLayout = advanceAddTorrentOptions.contentLayout;
    if (typeof contentLayout === "string" && QBITTORRENT_CONTENT_LAYOUT_VALUES.includes(contentLayout)) {
      formData.append("contentLayout", contentLayout);
    }

    // qBittorrent < v5.2.0 returns "Ok." or "Fails." as plain text;
    // qBittorrent >= v5.2.0 returns a JSON object with counts and IDs.
    const res = await this.request<"Ok." | "Fails." | QBittorrentAddTorrentResponse>("/torrents/add", {
      method: "post",
      data: formData,
    });

    if (typeof res.data === "object" && res.data !== null) {
      // qBittorrent >= v5.2.0 JSON response
      const jsonData = res.data as QBittorrentAddTorrentResponse;
      addResult.success = (jsonData.success_count ?? 0) > 0 && (jsonData.failure_count ?? 0) === 0;
      if (addResult.success && jsonData.added_torrent_ids?.length) {
        addResult.id = jsonData.added_torrent_ids[0];
      }
      if (!addResult.success) {
        addResult.message = {
          success_count: jsonData.success_count ?? 0,
          failure_count: jsonData.failure_count ?? 0,
          pending_count: jsonData.pending_count ?? 0,
          added_torrent_ids: jsonData.added_torrent_ids ?? [],
        } as CAddTorrentResult["message"];
        return addResult;
      }
    } else {
      // qBittorrent < v5.2.0 plain text response
      addResult.success = res.data === "Ok.";
      if (!addResult.success) {
        addResult.message = res.data;
        return addResult;
      }
    }

    return addResult;
  }

  async getAllTorrents(): Promise<QbittorrentTorrent[]> {
    const { torrents } = await this.getSyncData();
    return Object.entries(torrents!).map(([hash, torrent]) => {
      let state = CTorrentState.unknown;

      switch (torrent.state) {
        case QbittorrentTorrentState.ForcedDL:
        case QbittorrentTorrentState.Downloading:
        case QbittorrentTorrentState.MetaDL:
        case QbittorrentTorrentState.StalledDL:
          state = CTorrentState.downloading;
          break;
        case QbittorrentTorrentState.Allocating:
          // state = 'stalledDL';
          state = CTorrentState.queued;
          break;
        case QbittorrentTorrentState.ForcedUP:
        case QbittorrentTorrentState.Uploading:
        case QbittorrentTorrentState.StalledUP:
          state = CTorrentState.seeding;
          break;
        case QbittorrentTorrentState.PausedDL:
          state = CTorrentState.paused;
          break;
        case QbittorrentTorrentState.PausedUP:
          // state = 'completed';
          state = CTorrentState.paused;
          break;
        case QbittorrentTorrentState.QueuedDL:
        case QbittorrentTorrentState.QueuedUP:
          state = CTorrentState.queued;
          break;
        case QbittorrentTorrentState.CheckingDL:
        case QbittorrentTorrentState.CheckingUP:
        case QbittorrentTorrentState.QueuedForChecking:
        case QbittorrentTorrentState.CheckingResumeData:
        case QbittorrentTorrentState.Moving:
          state = CTorrentState.checking;
          break;
        case QbittorrentTorrentState.Error:
        case QbittorrentTorrentState.Unknown:
        case QbittorrentTorrentState.MissingFiles:
          state = CTorrentState.error;
          break;
        default:
          break;
      }

      const isCompleted = isFullyDownloaded(torrent);

      return {
        id: hash,
        infoHash: hash,
        name: torrent.name,
        state,
        dateAdded: torrent.added_on,
        isCompleted,
        progress: torrent.progress * 100,
        label: torrent.category,
        savePath: torrent.save_path,
        contentPath: torrent.content_path || undefined,
        totalSize: torrent.total_size,
        ratio: torrent.ratio,
        uploadSpeed: torrent.upspeed,
        downloadSpeed: torrent.dlspeed,
        totalUploaded: torrent.uploaded,
        totalDownloaded: torrent.downloaded,
        seeds: torrent.num_seeds,
        peers: torrent.num_leechs,
        eta: torrent.eta,
        completedDate: torrent.completion_on,
        tracker: torrent.tracker,
        tags: splitTags(torrent.tags),
        raw: torrent,
        clientId: this.config.id,
      } as QbittorrentTorrent;
    });
  }

  // 注意方法虽然支持一次对多个种子进行操作，但仍建议每次均只操作一个种子
  async pauseTorrent(hashes: string | string[] | "all"): Promise<boolean> {
    const data = {
      hashes: hashes === "all" ? "all" : normalizePieces(hashes),
    };
    // qBittorrent 5.0+ (WebAPI 2.11.0+) renamed /torrents/pause to /torrents/stop
    const endpoint = (await this.isApiVersionAtLeast(2, 11)) ? "/torrents/stop" : "/torrents/pause";
    await this.request(endpoint, { method: "post", data });
    return true;
  }

  // 注意方法虽然支持一次对多个种子进行操作，但仍建议每次均只操作一个种子
  async removeTorrent(hashes: string | string[] | "all", removeData: boolean = false): Promise<boolean> {
    const data = {
      hashes: hashes === "all" ? "all" : normalizePieces(hashes),
      deleteFiles: removeData,
    };
    await this.request("/torrents/delete", { method: "post", data });
    return true;
  }

  // 注意方法虽然支持一次对多个种子进行操作，但仍建议每次均只操作一个种子
  async resumeTorrent(hashes: string | string[] | "all"): Promise<any> {
    const data = {
      hashes: hashes === "all" ? "all" : normalizePieces(hashes),
    };
    // qBittorrent 5.0+ (WebAPI 2.11.0+) renamed /torrents/resume to /torrents/start
    const endpoint = (await this.isApiVersionAtLeast(2, 11)) ? "/torrents/start" : "/torrents/resume";
    await this.request(endpoint, { method: "post", data });
    return true;
  }

  /**
   * 分类表。基类那份默认回 null（`types.ts` 的 `getClientCategories`），这里给真数据：
   * `getClientPaths` 要用它列候选，辅种那两处要用它把 `category:电影` 翻成真实目录。
   */
  public override async getClientCategories(): Promise<Record<string, { name: string; savePath: string }>> {
    const { data: categories } =
      await this.request<Record<string, { name: string; savePath: string }>>("/torrents/categories");
    return categories;
  }

  /**
   * 建一个带目录的分类。`/torrents/createCategory` 成功时回空 body，失败是非 2xx
   * （`request` 会抛），所以「没抛」就是建好了 —— 不去看 body 里有没有 "Ok."。
   *
   * 目录留空时**不传** savePath：那是「用下载器的默认目录」，与「不指定」同义；
   * 传空串会被 qBittorrent 当成一个真目录名，建出一条落不了东西的分类。
   */
  public override async createClientCategory(name: string, savePath: string): Promise<boolean> {
    const data = new FormData();
    data.append("category", name);
    if (savePath) data.append("savePath", savePath);
    await this.request("/torrents/createCategory", { method: "post", data });
    return true;
  }

  public override async getClientPaths(): Promise<string[]> {
    const savePaths: string[] = await super.getClientPaths();
    const categories = await this.getClientCategories();

    return [...Object.keys(categories).map((cat) => category_prefix + cat), ...savePaths].filter(Boolean);
  }

  // 获取客户端中的已有的标签
  public override async getClientLabels(): Promise<string[]> {
    const { data } = await this.request<string[]>("/torrents/tags");
    return data;
  }

  async getTorrentTrackers(torrent: CTorrent): Promise<string[]> {
    // 首先尝试从 torrent.magnet_uri 中解析出 tracker 列表
    if (typeof torrent === "object" && typeof torrent?.raw?.magnet_uri === "string") {
      const queryString = torrent.raw.magnet_uri.split("?")[1] || "";
      const params = new URLSearchParams(queryString);

      // URLSearchParams 已经会对参数值进行解码，这里直接返回即可，避免二次解码导致 tracker URL 被破坏
      return params.getAll("tr");
    }

    // 不然，则从客户端直接请求获取
    const hash = torrent.infoHash || (torrent.id as string);
    const { data } = await this.request<Array<{ url: string }>>("/torrents/trackers", { params: { hash } });
    return data.map((t) => t.url);
  }

  // 重新校验种子
  override async recheckTorrent(id: any): Promise<boolean> {
    await this.request("/torrents/recheck", {
      method: "post",
      data: { hashes: normalizePieces(id) },
    });
    return true;
  }

  // 调整种子在队列中的位置
  override async moveTorrentInQueue(id: any, direction: TorrentQueueDirection): Promise<boolean> {
    const endpointMap: Record<TorrentQueueDirection, string> = {
      top: "/torrents/topPrio",
      up: "/torrents/increasePrio",
      down: "/torrents/decreasePrio",
      bottom: "/torrents/bottomPrio",
    };
    await this.request(endpointMap[direction], {
      method: "post",
      data: { hashes: normalizePieces(id) },
    });
    return true;
  }

  // 设置单个种子的速度限制（单位 KiB/s，0 表示不限速；qBittorrent 使用 bytes/s，-1 表示不限速）
  override async setTorrentSpeedLimit(id: any, limits: TorrentSpeedLimit): Promise<boolean> {
    const hash = normalizePieces(id);
    const requests: Promise<any>[] = [];

    if (typeof limits.download !== "undefined") {
      requests.push(
        this.request("/torrents/setLimit", {
          method: "post",
          data: { hashes: hash, limit: limits.download > 0 ? limits.download * 1024 : -1 },
        }),
      );
    }

    if (typeof limits.upload !== "undefined") {
      requests.push(
        this.request("/torrents/setUploadLimit", {
          method: "post",
          data: { hashes: hash, limit: limits.upload > 0 ? limits.upload * 1024 : -1 },
        }),
      );
    }

    // ⚠️ Promise.all 短路：上传限速与下载限速是两个独立请求，一个失败整批 reject，
    // 于是「只设了下载限速」这种情况既不会生效、也不会返回 false —— 调用方
    // （限速弹窗）把它当成功，界面无提示，用户以为限速设上了。
    // allSettled + 计数：全成功才 true，部分成功按「整体失败」返回（宁可让用户
    // 重来一次，也不要静默半套）。
    const settled = await Promise.allSettled(requests);
    const failedCount = settled.filter((r) => r.status === "rejected").length;
    if (failedCount > 0) {
      console.error(
        `[qBittorrent] setTorrentSpeedLimit partially failed (${failedCount}/${settled.length})`,
        settled.filter((r) => r.status === "rejected").map((r) => (r as PromiseRejectedResult).reason),
      );
      return false;
    }
    return true;
  }

  // 设置单个种子的分类（qBittorrent 的 label 即 category）
  override async setTorrentLabel(id: any, label: string): Promise<boolean> {
    await this.request("/torrents/setCategory", {
      method: "post",
      data: { hashes: normalizePieces(id), category: label },
    });
    return true;
  }

  /**
   * 追加标签（qBittorrent 的 tags，与上面那个 category 是两格）。
   *
   * `addTags` 是**并集**语义：已有的标签不会被冲掉，站名也不存在时 qBittorrent 会顺手建出来，
   * 所以这一步不需要先查一遍全局标签表。传进来的空串要滤掉 —— 逗号串里留一个空项，
   * 服务端会当成一个真要去掉的名字处理，那是往用户数据上做反向操作。
   */
  override async addTorrentTags(id: string | number, tags: string[]): Promise<boolean> {
    const joined = tags.map((tag) => (tag ?? "").trim()).filter(Boolean).join(",");
    if (!joined) return false;
    await this.request("/torrents/addTags", {
      method: "post",
      data: { hashes: normalizePieces(String(id)), tags: joined },
    });
    return true;
  }

  /**
   * 把种子已有的数据搬到别的目录（qBittorrent WebUI 里那颗 "Set Location"）。
   *
   * 两条实测自上游源码（`src/webui/api/torrentscontroller.cpp` 的 `setLocationAction` +
   * `src/base/bittorrent/torrentimpl.cpp` 的 `setSavePath`）的副作用要说清，界面按这个措辞：
   * - 它会**关掉这条种子的自动 Torrent 管理**（autoTMM），此后它的位置不再由分类决定；
   * - 目录不存在时它会先建；而**只有已下完的那条才真的挪文件**，还在下的只改往后的落点。
   *   辅种的基准本来就必须是已下完的那一条（后台第 4 档认的是 isCompleted），所以这条正好成立。
   */
  override async setTorrentLocation(id: any, location: string): Promise<boolean> {
    await this.request("/torrents/setLocation", {
      method: "post",
      data: { hashes: normalizePieces(id), location },
    });
    return true;
  }

  // ─────────────────────────────────────────────
  // 文件级 / peers / tracker 管理（qBittorrent WebAPI v2）
  // ─────────────────────────────────────────────

  // 文件列表: GET /torrents/files
  private async fetchTorrentFilesRaw(hash: string) {
    const { data } = await this.request<
      Array<{
        index: number;
        name: string;
        size: number;
        progress: number; // 0-1
        priority: number; // 0/1/6/7
        is_seed: boolean;
      }>
    >("/torrents/files", { params: { hash } });
    return data;
  }

  override async getTorrentFiles(torrent: string | CTorrent): Promise<CTorrentFile[]> {
    const files = await this.fetchTorrentFilesRaw(this.getTorrentHash(torrent));

    return files.map((file) => {
      const priority = mapQBittorrentFilePriority(file.priority);
      return {
        index: file.index,
        // ⚠️ 契约是「name 不含路径」：qB 的 file.name 是 "种子目录/…/子文件"，
        // 原样当 name 用会让列表里每行都带一遍路径。取最后一段。
        name: toFileName(file.name),
        path: file.name,
        size: file.size,
        progress: file.progress * 100,
        priority,
        wanted: priority !== "skip",
        raw: file,
      };
    });
  }

  /**
   * 导出指纹所需的文件清单（第 2 层指纹的原料）。
   *
   * 与 getTorrentFiles 共用同一次 `/torrents/files` 请求 —— 本地索引要对全部
   * 种子各发一次请求（O(n)），能省一次是一次。
   *
   * 关于 piece：qBittorrent 的 WebAPI **不提供 piece 哈希**（`/torrents/properties`
   * 只有 piece_size / pieces_num / pieces_have 这种进度位图），所以本地种子拿不到
   * 第 3 层指纹。第 3 层仍然有用 —— 站点侧的 .torrent 之间可以互相校验 ——
   * 但「本地 vs 站点」这一侧只能停在第 2 层。
   */
  override async getTorrentFileList(torrent: string | CTorrent): Promise<CTorrentFileList> {
    const hash = this.getTorrentHash(torrent);
    const files = await this.fetchTorrentFilesRaw(hash);

    return {
      name: typeof torrent === "string" ? undefined : torrent.name,
      // qBittorrent 对多文件种返回的 name 含顶层目录名，上层按 name 剥离
      files: files.map((file) => ({ path: file.name, size: file.size })),
      length: typeof torrent === "string" ? undefined : torrent.totalSize,
    };
  }

  // 文件优先级/选择: POST /torrents/filePrio，同一优先级合并为一次请求
  override async setTorrentFilePriority(
    torrent: string | CTorrent,
    selections: CTorrentFileSelection[],
  ): Promise<boolean> {
    if (selections.length === 0) {
      return true;
    }
    const hash = this.getTorrentHash(torrent);

    const grouped = new Map<number, string[]>();
    for (const selection of selections) {
      const priority = mapTorrentFilePriorityToQBittorrent(selection.priority);
      const ids = grouped.get(priority) ?? [];
      ids.push(String(selection.index));
      grouped.set(priority, ids);
    }

    for (const [priority, ids] of grouped) {
      await this.request("/torrents/filePrio", {
        method: "post",
        data: { hash, id: ids.join("|"), priority },
      });
    }
    return true;
  }

  // peer 列表: GET /sync/torrentPeers（注意拼写为 torrentPeers 单数词，peers 为按 peer id 键控的对象）
  override async getTorrentPeers(torrent: string | CTorrent): Promise<CTorrentPeer[]> {
    const { data } = await this.request<{
      peers?: Record<
        string,
        {
          client?: string;
          connection?: string;
          country?: string;
          downloaded?: number;
          ip?: string;
          port?: number;
          progress?: number; // 0-1
          uploaded?: number;
          dl_speed?: number;
          up_speed?: number;
          download_speed?: number; // 部分旧版本字段
          upload_speed?: number;
          flags?: string;
          flags_desc?: string;
        }
      >;
    }>("/sync/torrentPeers", { params: { hash: this.getTorrentHash(torrent) } });

    return Object.values(data.peers ?? {}).map((peer) => ({
      ip: peer.ip ?? "",
      port: peer.port,
      client: peer.client,
      progress: (peer.progress ?? 0) * 100,
      downloadSpeed: peer.dl_speed ?? peer.download_speed ?? 0,
      uploadSpeed: peer.up_speed ?? peer.upload_speed ?? 0,
      totalDownloaded: peer.downloaded,
      totalUploaded: peer.uploaded,
      country: peer.country,
      flags: peer.flags_desc ? String(peer.flags_desc).split(",").filter(Boolean) : [],
      raw: peer,
    }));
  }

  // tracker 列表（带状态）: GET /torrents/trackers
  override async getTorrentTrackersDetail(torrent: string | CTorrent): Promise<CTorrentTracker[]> {
    const { data: trackers } = await this.request<
      Array<{
        url: string;
        status: number;
        tier: number;
        msg: string;
        num_seeds?: number;
        num_leeches?: number;
        num_downloaded?: number;
      }>
    >("/torrents/trackers", { params: { hash: this.getTorrentHash(torrent) } });

    return trackers.map((tracker) => ({
      url: tracker.url,
      tier: tracker.tier ?? 0,
      status: mapQbittorrentTrackerState(tracker.status),
      statusMessage: tracker.msg,
      seeds: tracker.num_seeds,
      leeches: tracker.num_leeches,
      downloaded: tracker.num_downloaded,
      enabled: tracker.status !== 0,
      raw: tracker,
    }));
  }

  // 新增 tracker: POST /torrents/addTrackers
  override async addTorrentTracker(torrent: string | CTorrent, url: string): Promise<boolean> {
    await this.request("/torrents/addTrackers", {
      method: "post",
      data: { hash: this.getTorrentHash(torrent), urls: url },
    });
    return true;
  }

  // 删除 tracker: POST /torrents/removeTrackers
  override async removeTorrentTracker(torrent: string | CTorrent, url: string): Promise<boolean> {
    await this.request("/torrents/removeTrackers", {
      method: "post",
      data: { hash: this.getTorrentHash(torrent), urls: url },
    });
    return true;
  }
}
