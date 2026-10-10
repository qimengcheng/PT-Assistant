import {
  AbstractEmbyCompatibleServer,
  type IEmbyQueryItem,
  type IEmbyQueryResult,
  type IMediaServerBaseConfig,
  type IMediaServerMetadata,
  type IMediaServerSearchOptions,
  type IMediaServerSearchResult,
} from "@ptd/mediaServer";
import { AxiosError, type AxiosRequestConfig } from "axios";
import { EResultParseStatus } from "@ptd/site";
import { toMerged } from "es-toolkit";
import urlJoin from "url-join";

export const mediaServerMetaData: IMediaServerMetadata = {
  description: "Jellyfin 是一个由志愿者开发的开源媒体系统，可让用户自由管理和流式传输个人媒体内容，支持多平台多语言",
  warning: [
    'apikey, userId 可通过在console面板中执行 var c = JSON.parse(localStorage.getItem("jellyfin_credentials")).Servers[0]; console.log({AccessToken: c.AccessToken, UserId: c.UserId}); 来获取',
    "apikey 也可以在 `API 密钥` 中设置，或网络请求等其他地方中获取， userId 也可以在 url 等其他地方获取。（ 请参见 Wiki ）",
  ],
  auth_field: ["apikey", { name: "userId", required: false, message: "可以额外获取用户喜欢、观看情况" }],
} as const;

interface IJellyfinConfig extends IMediaServerBaseConfig {
  type: "jellyfin";
  auth: {
    apikey: string;
    userId: string;
  };
}

export const mediaServerConfig: IJellyfinConfig = {
  type: "jellyfin",
  name: "Jellyfin",
  address: "",
  auth: {
    apikey: "",
    userId: "",
  },
  timeout: 5000,
};

interface IJellyfinQueryItem extends Omit<IEmbyQueryItem, "Size"> {}

/**
 * Jellyfin 的多数 API 和 Emby 相同
 */
export default class Jellyfin extends AbstractEmbyCompatibleServer<IJellyfinConfig> {
  /**
   * 修正baseUrl，如果用户传入的地址为 http://127.0.0.1:8096/web/#/home.html 或者 https://127.0.0.1:8096/
   * 则将其修正为入口 https://127.0.0.1:8096/
   *
   * Jellyfin 的 JSON API 入口即服务根路径（不像 Emby 需要追加 /emby/）
   */
  get apiBaseUrl() {
    let serverAddress = this.config.address;
    // 用户在网页地址栏里停的位置不同，粘出来的形态就不同：`/web`、`/web/`、
    // `/web/index.html`、`/web/index.html#!/home.html`、`/web/#/details/...` 都见得到，
    // 一个都不剥就会拼出 `/web/.../System/Info` 这种必然 404 的 API 地址。
    // 靠 `$` 锚住尾巴，`webhook`/`swagger`/`jellyfin-web` 这类同前缀的路径不受影响。
    serverAddress = serverAddress.replace(/\/web(?:\/(?:index\.html)?)?(?:[#!/].*)?$/, "");

    return serverAddress;
  }

  protected applyAuth(config: AxiosRequestConfig): void {
    config.headers = {
      ...(config.headers ?? {}),
      /**
       * 这里我们混用 Authorize with API key 和 Authorize with access token （因为实测对 access token 来说，不一定需要传 Client 等 params）
       * docs: https://gist.github.com/nielsvanvelzen/ea047d9028f676185832e51ffaf12a6f
       */
      Authorization: `MediaBrowser Token="${this.config.auth.apikey}"`,
    };
  }

  public async getSearchResult(
    keywords: string = "",
    config: IMediaServerSearchOptions = {},
  ): Promise<IMediaServerSearchResult> {
    // 预定义搜索结果
    const result: IMediaServerSearchResult<IJellyfinQueryItem> = {
      status: EResultParseStatus.unknownError,
      items: [],
    };

    const hasUserId = this.config.auth.userId && this.config.auth.userId != "";

    let url = "/Items";
    let requestConfig: AxiosRequestConfig = { params: {} };

    if (hasUserId) {
      requestConfig.params["userId"] = this.config.auth.userId;
    }
    if (keywords != "") {
      // Jellyfin 不支持 AnyProviderIdEquals 搜索词，直接将 keywords 扔入 SearchTerm
      requestConfig.params["searchTerm"] = keywords;
    } else {
      // 如果没有关键词，则展示推荐？
      requestConfig.params["sortBy"] = (hasUserId ? "IsFavoriteOrLiked," : "") + "Random";
    }

    requestConfig.params["includeItemTypes"] = "Movie,Series";
    requestConfig.params["recursive"] = true;
    config.startIndex = requestConfig.params["startIndex"] = config.startIndex ?? 0;
    config.limit = requestConfig.params["limit"] = config.limit ?? 50;
    requestConfig.params["fields"] =
      "Path,Status,ExternalUrls,CommunityRating,MediaSources,DisplayPreferences,Genres,DateCreated,Overview,ExtraIds";

    // 处理额外的请求配置
    requestConfig = toMerged(requestConfig, this.config.defaultSearchExtraRequestConfig ?? {});

    try {
      const response = await this.request<IEmbyQueryResult<IJellyfinQueryItem>>(url, requestConfig);
      if (response.status === 200) {
        const {
          data: { Items = [] },
        } = response;
        for (const item of Items) {
          // 处理搜索结果
          result.items.push(
            this.mapQueryItemToMediaItem(item, {
              url: urlJoin(this.apiBaseUrl, `/web/#/details?id=${item.Id}&serverId=${item.ServerId}`),
              size: item.MediaSources?.[0]?.Size,
              tagUrl: (tag) =>
                urlJoin(this.apiBaseUrl, `/web/#/list.html?genreId=${tag.Id}&serverId=${item.ServerId}`),
            }),
          );
        }
        result.options = config;
        result.status = EResultParseStatus.success;
      } else {
        result.status = EResultParseStatus.needLogin;
      }
    } catch (e) {
      // 401 是认证问题（needLogin），其余（超时、网络不可达、解析异常等）不是认证问题，
      // 需要把真实错误带回去，避免 UI 统一提示「请检查认证信息」误导排障（#1396）
      if (e instanceof AxiosError && e.response?.status === 401) {
        result.status = EResultParseStatus.needLogin;
      } else {
        result.status = EResultParseStatus.parseError;
      }
      result.errorMessage = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    }

    return result;
  }
}
