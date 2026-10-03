import axios, { AxiosError, type AxiosRequestConfig, type AxiosResponse } from "axios";
import urlJoin from "url-join";
import { EResultParseStatus } from "@ptd/site";

export type IMediaServerId = string;
export type TAuthType = "user" | "apikey";

export interface IMediaServerBaseConfig {
  // 系统使用这个信息判断并生成唯一的客户端
  id?: IMediaServerId;
  // 客户端类型，与文件名相同
  type: string;
  // 客户端名称，用于用户辨识
  name: string;

  // 媒体服务器地址
  address: string;
  // 媒体服务器认证方式
  auth: Record<string, string>;
  // 媒体服务器请求超时
  timeout?: number;

  defaultSearchExtraRequestConfig?: AxiosRequestConfig; // 默认的搜索请求配置

  [key: string]: any;
}

export interface IMediaServerMetadata {
  // 客户端介绍
  description?: string;
  // 用于配置时显示的警告信息，要用于一些特殊提示
  warning?: string[];
  /**
   * 该客户端的认证的字段，对应字段会被放入 config.auth 中
   */
  auth_field: Array<
    | string //  等同于 { name: string; required: true }
    // name: 字段名称  required: 是否必填  message: 提示信息
    | { name: string; required: boolean; message?: string }
  >;
}

export interface IMediaServerItem<RAW = any> {
  // 所在的媒体服务器id
  server: IMediaServerId;
  // 名称
  name: string;
  // 对应服务器浏览地址
  url: string;

  // 媒体信息
  type: "Movie" | string; // 影片类型
  description?: string; // 影片描述
  format?: string; // 容器格式 如 MP4, MKV
  size?: number; // 文件大小
  duration?: number; // 时长
  poster?: string; // 封面图
  tags?: Array<{ name: string; url?: string }>; // 标签
  rating?: number | "-"; // 评分

  streams?: {
    title: string;
    type: "Video" | "Audio" | "Subtitle" | string; // 流类型
    format: string; // 流格式
  }[];

  // 用户对该媒体的情况
  user: {
    IsFavorite?: boolean; // 是否喜欢
    IsPlayed?: boolean; // 是否已播放过
  };

  // 服务器的原始返回
  raw: RAW;
}

export interface IMediaServerSearchOptions {
  startIndex?: number; // 起始索引
  limit?: number; // 限制数量
}

export interface IMediaServerSearchResult<RAW = any> {
  status: EResultParseStatus; // 状态码

  // 搜索结果
  items: IMediaServerItem<RAW>[];
  options?: IMediaServerSearchOptions;

  // 非 success 时附带的真实错误信息（如 timeout of 5000ms exceeded），用于 UI 展示失败原因
  errorMessage?: string;
}

export abstract class AbstractMediaServer<T extends IMediaServerBaseConfig = IMediaServerBaseConfig> {
  readonly config: T;

  protected constructor(options: T) {
    this.config = options as T;
  }

  // 检查客户端是否可以连接
  public abstract ping(): Promise<boolean>;

  /**
   * 获取搜索数据
   * 注意：我们对 keywords 同样约定了 ${advanceField}|${keywords} 的高级搜索方式，但不同的服务器进行实现不一致
   */
  public abstract getSearchResult(
    keywords?: string,
    options?: IMediaServerSearchOptions,
  ): Promise<IMediaServerSearchResult>;
}

/**
 * Emby 系（Emby / Jellyfin / 飞牛影视等）/System/Info 公共返回
 */
export interface IEmbySystemInfo {
  ServerName: string;
  Version: string;
  Id: string;
}

/**
 * Emby 系 /Items 查询的单条媒体结构。
 * Jellyfin 返回与之基本一致（仅顶层 Size 缺省），故直接复用。
 */
export interface IEmbyQueryItem {
  Name: string;
  ServerId: string;
  Id: string;
  Overview: string;
  Container: string;
  MediaSources: Array<{
    Path: string;
    Container: string;
    Size: number;
    Name: string;
    MediaStreams: Array<
      {
        Codec: string;
        Title: string;
        DisplayTitle: string;
        IsDefault?: boolean;
      } & ({ Type: "Video" } | { Type: "Audio" } | { Type: "Subtitle" })
    >;
  }>;
  Path: string;
  CommunityRating?: number;
  RunTimeTicks: number;
  Size: number;
  ImageTags: {
    Primary?: string;
    Logo?: string;
    Thumb?: string;
  };
  GenreItems: Array<{
    Name: string;
    Id: number;
  }>;
  MediaType: string;
  UserData: {
    IsFavorite: boolean;
    PlayCount: number;
    PlaybackPositionTicks: number;
    Played: boolean;
  };
}

export interface IEmbyQueryResult<T extends any> {
  Items: T[];
  TotalRecordCount: number;
}

/**
 * Emby 系（Emby / Jellyfin / 飞牛影视等 Emby-compatible API）媒体服务器公共基类。
 *
 * 子类只需提供：
 * - `apiBaseUrl`：把用户填写的 Web 地址修正为 JSON API 入口；
 * - `applyAuth`：每次请求前写入认证头（需要动态登录的子类可在此完成登录）；
 * 可选覆写 `refreshAuth`：401 时刷新认证（如强制重登），返回 true 会原样重试一次。
 *
 * ping 统一走 GET /System/Info（status === 200 且返回带 Id 即视为可用）。
 */
export abstract class AbstractEmbyCompatibleServer<
  T extends IMediaServerBaseConfig = IMediaServerBaseConfig,
> extends AbstractMediaServer<T> {
  /** JSON API 根地址（子类负责把用户填写的 Web 地址修正成 API 入口） */
  protected abstract get apiBaseUrl(): string;

  /** 每次请求前写入认证信息（headers 等）；需要登录的子类可在此完成登录，抛错会中断本次请求 */
  protected abstract applyAuth(config: AxiosRequestConfig): void | Promise<void>;

  /** 401 时尝试刷新认证；返回 true 则用同一请求配置重试一次，默认不重试 */
  protected async refreshAuth(): Promise<boolean> {
    return false;
  }

  protected async request<T = any, D = any>(
    url: string,
    config: AxiosRequestConfig<D> = {},
    retried = false,
  ): Promise<AxiosResponse<T, D>> {
    config.baseURL = this.apiBaseUrl;
    config.url = url;
    config.timeout ??= this.config.timeout; // 未额外传入 timeout 时，使用默认的 timeout
    config.responseType ??= "json";

    await this.applyAuth(config);

    try {
      return await axios.request<T, AxiosResponse<T, D>>(config);
    } catch (e) {
      if (!retried && e instanceof AxiosError && e.response?.status === 401 && (await this.refreshAuth())) {
        return this.request<T, D>(url, config, true);
      }
      throw e;
    }
  }

  public override async ping(): Promise<boolean> {
    try {
      const response = await this.request<IEmbySystemInfo>("/System/Info");
      if (response.status === 200 && response.data?.Id) {
        return true;
      }
    } catch (e) {
      return false;
    }
    return false;
  }

  /**
   * 把 Emby/Jellyfin 的 /Items 查询条目映射为统一的 IMediaServerItem，
   * 三者差异只在条目链接、大小取值和标签链接上，其余字段映射完全一致。
   */
  protected mapQueryItemToMediaItem<
    TItem extends Omit<IEmbyQueryItem, "Size"> & { Size?: number },
  >(
    item: TItem,
    overrides: {
      /** 该条目在对应 Web 前端中的链接 */
      url: string;
      /** 大小（Jellyfin 取 MediaSources[0].Size，Emby 取顶层 Size） */
      size?: number;
      /** 分类标签在对应 Web 前端中的链接构造方式 */
      tagUrl: (tag: { Id: number; Name: string }) => string;
    },
  ): IMediaServerItem<TItem> {
    return {
      server: this.config.id!,
      name: item.Name,
      url: overrides.url,
      type: item.MediaType,
      description: item.Overview ?? "",
      format: item.Container,
      size: overrides.size,
      duration: item.RunTimeTicks / 10000000, // 10000 ticks = 1 ms, 10000 ms = 1 s
      poster: urlJoin(this.apiBaseUrl, `/Items/${item.Id}/Images/Primary`),
      tags: item.GenreItems?.map((tag) => ({
        name: tag.Name,
        url: overrides.tagUrl(tag),
      })),
      rating: item.CommunityRating ?? "-",
      streams: item.MediaSources?.[0]?.MediaStreams?.map((stream) => ({
        title: stream.Title ?? stream.DisplayTitle,
        type: stream.Type,
        format: stream.Codec,
      })),
      user: {
        IsFavorite: item.UserData?.IsFavorite ?? false,
        IsPlayed: item.UserData?.Played ?? false,
      },
      raw: item,
    };
  }
}
