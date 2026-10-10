import urlJoin from "url-join";
import { toMerged } from "es-toolkit";

import axios, { AxiosError, type AxiosRequestConfig, type AxiosResponse } from "axios";
import { EResultParseStatus } from "@ptd/site";
import {
  AbstractMediaServer,
  type IMediaServerBaseConfig,
  type IMediaServerItem,
  type IMediaServerMetadata,
  type IMediaServerSearchOptions,
  type IMediaServerSearchResult,
} from "@ptd/mediaServer";

export const mediaServerMetaData: IMediaServerMetadata = {
  description: "Plex 是一款流行的媒体服务器软件，支持多种设备和平台，提供丰富的媒体管理和播放功能",
  warning: ["apikey 可通过在console面板中查看 localStorage 中的 myPlexAccessToken 值"],
  auth_field: ["apikey"],
} as const;

interface IPlexConfig extends IMediaServerBaseConfig {
  type: "plex";
  auth: {
    apikey: string;
  };
}

export const mediaServerConfig: IPlexConfig = {
  type: "plex",
  name: "Plex",
  address: "",
  auth: {
    apikey: "",
  },
  timeout: 5000,
};

interface IPlexJsonResponse<T = any> {
  MediaContainer: T;
  error?: string;
  code?: number;
  message?: string;
}

interface IPlexIdentityData {
  apiVersion: string;
  claimed: boolean;
  machineIdentifier: string;
  size: number;
  version: string;
}

interface IPlexSearchItem {
  addedAt: number;
  allowSync: boolean;
  type: "movie" | "show";

  key: string;
  title: string;
  summary: string;
  thumb: string;

  librarySectionID: number;
  librarySectionTitle: string;
  librarySectionUUID: string;

  Genre: Array<{ tag: string }>;

  Media?: Array<{
    Part: Array<{
      container: string;
      duration: number;
      file: string;
      hasThumbnail: boolean;
      id: number;
      key: string;
      size: number;
    }>;
    aspectRatio: number;
    audioChannels: number;
    audioCodec: string;
    bitrate: number;
    container: string;
    duration: number;
    height: number;
    id: number;
    videoCodec: string;
    videoFrameRate: string;
    videoProfile: string;
    videoResolution: string;
    width: number;
  }>;

  audienceRating: number;
  duration: number;

  year: number;

  updatedAt: number;
}

interface IPlexRecentlyAddedItem extends Omit<IPlexSearchItem, "Media"> {
  parentTitle?: string; // 父标题，可能是系列名称
}

interface IPlexSearchData<T = IPlexSearchItem> {
  Metadata: T[];
  identifier: string;
  mediaTagPrefix: string;
  offset?: number;
  size: number;
  totalSize?: number;
}

export default class Plex extends AbstractMediaServer<IPlexConfig> {
  get apiBaseUrl(): string {
    let serverAddress = this.config.address;
    if (serverAddress.includes("/web/index.html")) {
      serverAddress = serverAddress.replace(/\/web\/index.html#.+/, "");
    }
    return serverAddress;
  }

  get webBaseUrl(): string {
    let serverAddress = this.config.address;
    if (serverAddress.includes("/web/index.html")) {
      serverAddress = serverAddress.replace(/\/web\/index.html#.+/, "");
    }
    return serverAddress.replace(/\/$/, "") + "/web/index.html";
  }

  protected async request<T = any, D = any>(
    url: string,
    config: AxiosRequestConfig<D> = {},
  ): Promise<AxiosResponse<T, D>> {
    config.baseURL = this.apiBaseUrl;
    config.url = url;
    config.timeout ??= this.config.timeout; // 未额外传入 timeout 时，使用默认的 timeout
    config.method ??= "GET"; // 默认使用 GET 方法

    // 处理认证方式
    config.params ??= {};
    config.params["X-Plex-Token"] = this.config.auth.apikey;

    // ⚠️ 原来是无条件赋值 responseType = "json"，会把调用方传的 blob 覆盖掉 ——
    // getPosterUrl 要下图片二进制（用 URL.createObjectURL 转 blob URL），
    // 拿到 JSON 文本的话 createObjectURL 建出来的是「字符串」而不是图片，
    // 海报位直接裂。
    config.responseType ??= "json";
    return axios.request<T>(config);
  }

  /**
   * 海报缓存：key → objectURL。
   *
   * ⚠️ 为什么不能直接给界面一个带 token 的 URL：海报是 <img src> 加载的，
   * 而 <img> 发不了自定义请求头 —— 只能把 token 拼在 query 里，于是这条 URL 会
   * 落进 DOM、浏览器历史、以及它自己发出的 Referer。
   * 所以按 fnos 那套做法：自己把图取回来（走 request()，token 仍按它一贯的方式放在
   * params 里，不是自定义头 —— 这次改的不是「token 不上 URL」，
   * 而是**不再把它交给页面里的那张 <img>**），转成 blob URL 给界面。
   */
  private static posterUrlCache = new Map<string, string>();

  private async getPosterUrl(item: IPlexSearchItem | IPlexRecentlyAddedItem): Promise<string> {
    if (!item.thumb) return "";

    const cacheKey = [this.config.id, item.key, item.thumb].join("|");
    const cached = Plex.posterUrlCache.get(cacheKey);
    if (cached) return cached;

    try {
      const resp = await this.request<Blob>(item.thumb, { responseType: "blob" });
      const objectUrl = URL.createObjectURL(resp.data);
      Plex.posterUrlCache.set(cacheKey, objectUrl);
      // objectURL 不会被 GC 回收，缓存得自己设上限（沿用 fnos 那档）
      if (Plex.posterUrlCache.size > 300) {
        const oldest = Plex.posterUrlCache.keys().next().value;
        if (oldest !== undefined) {
          URL.revokeObjectURL(Plex.posterUrlCache.get(oldest)!);
          Plex.posterUrlCache.delete(oldest);
        }
      }
      return objectUrl;
    } catch (e) {
      console.warn(`[plex] load poster failed: ${item.thumb}`, e);
      return "";
    }
  }

  private async getServerIdentity(): Promise<string | undefined> {
    const response = await this.request<IPlexJsonResponse<IPlexIdentityData>>("/identity");
    return response.data?.MediaContainer?.machineIdentifier;
  }

  public override async ping(): Promise<boolean> {
    const serverIdentity = await this.getServerIdentity();
    return !!serverIdentity;
  }

  public override async getSearchResult(
    keywords: string = "",
    config: IMediaServerSearchOptions = {},
  ): Promise<IMediaServerSearchResult> {
    // 预定义搜索结果
    const result: IMediaServerSearchResult<IPlexSearchItem> = {
      status: EResultParseStatus.unknownError,
      items: [],
    };

    // 生成基本请求参数
    let requestConfig: AxiosRequestConfig = { params: {} };
    config.startIndex = requestConfig.params["X-Plex-Container-Start"] = config.startIndex ?? 0;
    config.limit = requestConfig.params["X-Plex-Container-Size"] = config.limit ?? 50;
    requestConfig = toMerged(requestConfig, this.config.defaultSearchExtraRequestConfig ?? {});

    try {
      // ⚠️ 原来这次身份查询在 try **之外**：服务器不可达时它自己 reject，
      // 整个 getSearchResult 直接抛出，拿不到 {status, errorMessage} 这套统一结构
      // —— 上层拿到的就是一个 AxiosError，与 emby / jellyfin 的行为不一致。
      // 挪进 try：401 判 needLogin（plex 的 token 也走 401），其余 parseError。
      const serverIdentity = await this.getServerIdentity();
      // 从服务器获取最新数据 /library/recentlyAdded
      let url = "/library/recentlyAdded";

      // 如果有 keywords 则进行搜索 /search?query=string   注意两个接口返回略有不同
      if (keywords !== "") {
        url = "/search";
        requestConfig.params.query = keywords;
      }

      const resp = await this.request<IPlexJsonResponse<IPlexSearchData>>(url, requestConfig);

      const items = resp?.data?.MediaContainer?.Metadata ?? [];
      // 海报逐个下（带鉴权头）→ blob URL，见 getPosterUrl 的注释
      const posters = await Promise.all(items.map((item) => this.getPosterUrl(item)));

      for (const [index, item] of items.entries()) {
        const mediaItem: IMediaServerItem<IPlexSearchItem | IPlexRecentlyAddedItem> = {
          server: this.config.id!,
          // @ts-ignore
          name: item.parentTitle ? `${item.parentTitle} (${item.title})` : item.title,
          url: `${this.webBaseUrl}#!/server/${serverIdentity}/details?key=${item.key.replace(/\/children$/, '')}`,
          type: item.type === "movie" ? "Movie" : item.type,
          description: item.summary,
          // @ts-ignore
          format: item.Media?.[0]?.container ?? "",
          // @ts-ignore
          size: item.Media?.[0]?.Part?.[0].size ?? 0,
          // Plex 的 duration 是毫秒；消费方（ItemInformationDialog.formatDuration）按秒拆分，
          // 与 emby/fnos 的 RunTimeTicks/1e7 同一口径，不除会放大 1000 倍
          duration: item.duration ? item.duration / 1000 : 0,
          poster: posters[index] ?? "",
          tags: item.Genre?.map((tag) => ({ name: tag.tag, url: "" })) ?? [],
          rating: item.audienceRating ?? "-", // Plex may not provide rating in search results
          streams: [], // Plex does not provide streams in search results
          user: { IsFavorite: false, IsPlayed: false }, // Plex does not provide user favorite status in search results
          raw: item, // Store the raw data for reference
        };
        result.items.push(mediaItem);
      }
      result.options = config;
      result.status = EResultParseStatus.success;
    } catch (e) {
      if (e instanceof AxiosError && e.response?.status === 401) {
        result.status = EResultParseStatus.needLogin;
      } else {
        result.status = EResultParseStatus.parseError;
      }
      // 与 emby / jellyfin 保持一致：非 401 的失败也要填 errorMessage，
      // 否则用户只看到一个没有原因的 parseError（见 #1396）。
      result.errorMessage = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    }

    return result;
  }
}
