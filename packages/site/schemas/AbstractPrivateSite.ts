// 所有PT站点的基类
import Sizzle from "sizzle";
import type { AxiosRequestConfig, AxiosResponse } from "axios";
import { intersection, pascalCase, pick, toMerged, uniq } from "es-toolkit";
import { get, has, set } from "es-toolkit/compat";

import BittorrentSite from "./AbstractBittorrentSite";
import { guessUserLevelId } from "../utils";
import {
  EResultParseStatus,
  CFBlockedError,
  NeedLoginError,
  NoUserInputError,
  type IElementQuery,
  type ISiteMetadata,
  type ISiteMessage,
  type ISiteMessageActionResult,
  type IUserInfo,
  type TLevelId,
  type TPatterns,
  type TUserInfoParseKey,
} from "../types";
// noinspection ES6PreferShortImport
import { axios, logEvent, probePageInTab } from "../utils/adapter";
import {
  isBlockShellPage,
  isSilentZeroRound,
  pageShapeOf,
  shapeLine,
  skippedStepLine,
  userInfoRequestVariants,
  type IPageShape,
} from "@/shared/userInfoShape";

export const SchemaMetadata: Partial<ISiteMetadata> = {
  version: -1,
  search: {},
  userInfo: {},
};

/** 外壳页探针的一次结果：要么带回一页形状，要么带回一句失败原因 */
interface IUserInfoProbeResult {
  variant: string;
  headers: Record<string, string>;
  data?: unknown;
  response?: AxiosResponse<unknown>;
  shape?: IPageShape;
  error?: string;
}

export default class PrivateSite extends BittorrentSite {
  get allowQueryUserInfo(): boolean {
    return this.isOnline && !!this.metadata.userInfo && !(this.userConfig.allowQueryUserInfo === false);
  }

  protected get noLoginCheckHttpStatusCodes(): number[] | false {
    return (
      this.metadata.noLoginAssert?.httpStatusCodes ?? [
        401, // Unauthorized
        403, // Forbidden
        502, // Bad Gateway
        504, // Gateway Timeout
      ]
    );
  }

  protected get noLoginCheckUrlPatterns(): TPatterns | false {
    return this.metadata.noLoginAssert?.urlPatterns ?? [/doLogin|login|verify|checkpoint|returnto/gi];
  }

  protected get noLoginCheckRefreshHeaderPattern(): TPatterns | false {
    return this.metadata.noLoginAssert?.refreshHeaderPattern ?? this.noLoginCheckUrlPatterns;
  }

  protected override loggedCheck(res: AxiosResponse): boolean {
    const request = res.request as XMLHttpRequest;
    try {
      // 检查状态码：如果状态码在 noLoginCheckStatusCodes 中，则直接返回 false
      if (this.noLoginCheckHttpStatusCodes && this.noLoginCheckHttpStatusCodes.includes(res.status)) {
        return false;
      }

      if (this.noLoginCheckUrlPatterns) {
        for (const noLoginCheckUrlPattern of this.noLoginCheckUrlPatterns) {
          if (new RegExp(noLoginCheckUrlPattern).test(request.responseURL)) {
            return false; // 检查URL是否匹配 noLoginCheckUrlPatterns 中的任意一个
          }
        }
      }

      // https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Refresh
      if (res.headers.refresh && this.noLoginCheckRefreshHeaderPattern) {
        // 处理带URL的情况（支持逗号/分号分隔，忽略大小写和多余空格）
        const urlPattern = /[,;]\s*url\s*=\s*([^,\s;]+)/i;
        const urlMatch = res.headers.refresh.match(urlPattern);

        if (urlMatch) {
          let redirectUrl = urlMatch[1].trim();

          for (const noLoginCheckRefreshHeaderPattern of this.noLoginCheckRefreshHeaderPattern) {
            if (new RegExp(noLoginCheckRefreshHeaderPattern).test(redirectUrl)) {
              return false; // 检查URL是否匹配 noLoginCheckRefreshHeaderPattern 中的任意一个
            }
          }
        }
      }

      const noLoginAssertMatchSelectors = this.metadata.noLoginAssert?.matchSelectors ?? [];
      if (noLoginAssertMatchSelectors.length > 0) {
        const matchFn = res.data instanceof Document ? (d: any, m: string) => Sizzle(m, d).length > 0 : has;
        for (const matchSelector of noLoginAssertMatchSelectors) {
          if (matchFn(res.data, matchSelector)) {
            return false;
          }
        }
      }

      if (this.metadata.noLoginAssert?.checkResponseContent === true) {
        const responseText =
          request.responseType === "document" ? request.responseXML?.documentElement.outerHTML : request.responseText;
        if (typeof responseText === "undefined") {
          return false; // 检查最终的Text，如果什么都没有也可能说明需要登陆
        } else if (responseText.length < 800 && /login|auth_form|not authorized/.test(responseText)) {
          return false; // 对Text进行检查，断言 “过短，且中间出现login等字段“ 说明可能需要登陆
        }
      }
    } catch (e) {
      console.debug(e);
    }

    return true;
  }

  /**
   * 获得当前站点最新的用户信息方法入口
   * 这里 lastUserInfo 以及 保存/更新 UserInfo 均由调用的上层完成
   */
  public async getUserInfoResult(lastUserInfo: Partial<IUserInfo> = {}): Promise<IUserInfo> {
    let flushUserInfo: IUserInfo = {
      status: EResultParseStatus.unknownError,
      updateAt: +new Date(),
      site: this.metadata.id,
    };

    if (!this.allowQueryUserInfo || !this.metadata.userInfo?.process) {
      flushUserInfo.status = EResultParseStatus.passParse;
      return flushUserInfo;
    }

    // 如果有 lastUserInfo 则合并
    if (this.metadata.userInfo.pickLast) {
      flushUserInfo = toMerged(flushUserInfo, pick(lastUserInfo, this.metadata.userInfo.pickLast));
    }

    try {
      // 每一步拿回的那一页「长什么样」，只在整轮空手时才会被写进运行日志（见下面的那条 logEvent）。
      // 收集它不改任何解析行为：状态、字段、返回值一个都不动。
      const pageShapes: IPageShape[] = [];
      // 被「字段已经有了」短路掉的那几步。不记它，一轮里「压根没发 /index.php」这件事
      // 在读数上就是隐形的 —— 而 pickLast 会把上一轮的 id 并进来，所以那种短路恰恰是能发生的。
      const skippedSteps: { url: string; fields: string[] }[] = [];
      // 探针一轮只打一次：第一次遇到「200 + 0 个 td + 极短正文」时试完四种请求形状就定，
      // 不逐页反复试。试出能过的那一种后，本轮后续步骤直接沿用它（例如 mybonus.php）。
      let probedShellPage = false;
      let winningVariant: { headers: Record<string, string>; data?: unknown } | undefined;
      let visitIndexFirst = false;
      // 本轮的「只有真导航能过」结论：第一页用标签页取回来之后，后续步骤直接走标签页，
      // 不再打一轮注定被拦截的 XHR（PTzone 2026-10-24 的现场：连 6 种 XHR 形状全被 403）。
      let useTabNavigation = false;

      for (const thisUserInfoProcess of this.metadata.userInfo.process) {
        // 该步骤能够获取的字段
        const processFields = uniq([
          ...(thisUserInfoProcess.fields ?? []),
          ...Object.keys(thisUserInfoProcess.selectors ?? {}),
        ]) as TUserInfoParseKey[];
        // 检查相关元素是否均已有
        const existField = intersection(processFields, Object.keys(flushUserInfo));
        if (existField.length === processFields.length) {
          // 观测件：url 取自站点定义（这一步还没经过 assertion 填参数），不含账号值
          skippedSteps.push({
            url: String(thisUserInfoProcess.requestConfig?.url ?? "?"),
            fields: processFields.map(String),
          });
          continue; // 如果全部数据都有则直接跳过本轮
        }

        // 更新请求字段，如果字段缺失则跳出循环
        let requestConfig: AxiosRequestConfig = toMerged(
          { url: "/", params: {}, data: {}, responseType: "document" },
          thisUserInfoProcess.requestConfig,
        );
        if (thisUserInfoProcess.assertion) {
          for (const [requiredFieldRaw, pathKey] of Object.entries(thisUserInfoProcess.assertion)) {
            // assertion 的键受 ISiteMetadata 类型约束为 TUserInfoParseKey，Object.entries 退化为 string，这里收窄回来
            const requiredField = requiredFieldRaw as TUserInfoParseKey;
            if (flushUserInfo[requiredField]) {
              if (has(requestConfig, pathKey as string)) {
                let oldData = get(requestConfig, pathKey as string);
                if (oldData && typeof oldData === "string") {
                  oldData = oldData.replace(`$${requiredField}$`, String(flushUserInfo[requiredField]));
                  set(requestConfig, pathKey as string, oldData);
                }
              } else {
                set(requestConfig, pathKey as string, flushUserInfo[requiredField]);
              }
            } else {
              // noinspection ExceptionCaughtLocallyJS
              throw new Error(`断言字段 ${requiredField} 缺失`);
            }
          }
        }

        // 如果有 requestConfigTransformer，则会在最后一步对请求配置进行处理
        if (typeof thisUserInfoProcess.requestConfigTransformer === "function") {
          requestConfig = thisUserInfoProcess.requestConfigTransformer(requestConfig, flushUserInfo as IUserInfo, this);
        }

        const requestDelay = thisUserInfoProcess.requestDelay ?? this.metadata.userInfo?.requestDelay ?? 0;
        await this.sleepAction(requestDelay);

        // 上一页已经试出「站点认哪种形状」时，后续步骤直接用这一种，不重跑探针。
        if (winningVariant) {
          requestConfig.headers = {
            ...(requestConfig.headers as Record<string, string> | undefined),
            ...winningVariant.headers,
          };
          if (winningVariant.data !== undefined) {
            requestConfig.data = winningVariant.data;
          }
        }

        // 上一页试出「站点要靠一次页面访问刷新反爬状态」时，后续步骤先顺带访问一次首页。
        if (visitIndexFirst) {
          try {
            await this.request<unknown>({ ...requestConfig, url: "/index.php", params: {}, data: null }, false);
          } catch {
            // 刷新失败也照原请求发；探针那一步已经把两页的形状记进日志了
          }
        }

        let response: AxiosResponse<unknown> | undefined;
        let dataDocument: unknown;
        // 形状读数：只有这一层还握着响应本体（上层拿到的是已经折好的字段值）。
        // 交出去的是**对象本身**不是它的属性 —— 真 XHR 在 responseType 为 document 时读 `responseText`
        // 会抛 InvalidStateError，在调用点取属性等于把整轮取数炸成 parseError（v0.125.0 就是这么坏的，
        // 用户 2026-10-24：「现在变成解析错误了」）。属性读取归 `@/shared/userInfoShape` 逐条兜。
        // 外面再套一层：观测件不许有弄坏被观测那条路的能力。
        let shape: IPageShape | undefined;
        let loadedViaTab = false;

        // 本轮已证明「只认顶层导航」时，后续步骤直接开标签页，不再发注定被拦截的 XHR。
        if (useTabNavigation) {
          try {
            const viaTab = await this.fetchUserInfoPageInTab(requestConfig);
            if (viaTab) {
              dataDocument = viaTab.document;
              shape = viaTab.shape;
              loadedViaTab = true;
            }
          } catch {
            // 标签页那条路坏了就退回普通请求；观测件不许把这一轮炸成 parseError
          }
        }

        if (!loadedViaTab) {
          response = await this.request<unknown>(requestConfig);
          dataDocument = response.data;
          try {
            shape = this.userInfoShapeOf(response, requestConfig);
          } catch {
            // 少一条读数比整轮取数变成 parseError 好
          }
        }

        // 站点把用户页换成了「200 + 0 个 td」的拦截外壳页时，用当前登录态换请求形状再试一次。
        // 只试一次、只在第一页试；试出来能过的那一种本轮后续步骤直接沿用。
        if (shape && isBlockShellPage(shape) && !probedShellPage && !useTabNavigation) {
          probedShellPage = true;
          let probes: IUserInfoProbeResult[] = [];
          try {
            probes = await this.probeUserInfoShellPage(requestConfig, this.url);
          } catch {
            // 探针自己坏了不许把这一轮取数炸成 parseError（观测件不许有弄坏被观测那条路的能力）
          }
          const winner = probes.find(
            (probe) => probe.response && probe.shape && this.isUsableUserInfoShape(probe.shape),
          );

          // 再试一个假设：这一步 /index.php 被 pickLast 的 id 短路掉了，而站点可能要靠一次
          // 页面访问刷新反爬状态。先看首页形状，能用就再**原样**重试一次原页 —— 重试不带任何
          // 特殊头、也不改 body，否则就分不清是「访问首页有用」还是「换头/去 body 有用」。
          let indexShape: IPageShape | undefined;
          let indexError: string | undefined;
          let indexRetry: { response: AxiosResponse<unknown>; shape: IPageShape } | undefined;
          let indexRetryError: string | undefined;
          try {
            const indexConfig: AxiosRequestConfig = { ...requestConfig, url: "/index.php", params: {}, data: null };
            const indexResponse = await this.request<unknown>(indexConfig, false);
            indexShape = this.userInfoShapeOf(indexResponse, indexConfig);
            if (this.isUsableUserInfoShape(indexShape)) {
              try {
                const retryConfig: AxiosRequestConfig = { ...requestConfig };
                const retryResponse = await this.request<unknown>(retryConfig, false);
                const retryShape = this.userInfoShapeOf(retryResponse, retryConfig);
                indexRetry = { response: retryResponse, shape: retryShape };
              } catch (error) {
                indexRetryError = error instanceof Error ? error.message : String(error);
              }
            }
          } catch (error) {
            indexError = error instanceof Error ? error.message : String(error);
          }

          // 最后一个假设：拦截认的是「这次请求是不是顶层导航」，XHR 侧改头永远过不去。
          // 只有换头与「先访问首页」都没救回来时才真开一个标签页（不抢焦点、读完立刻关）。
          let tabPage: { document: Document; shape: IPageShape } | undefined;
          let tabError: string | undefined;
          if (!winner && !(indexRetry && this.isUsableUserInfoShape(indexRetry.shape))) {
            try {
              tabPage = await this.fetchUserInfoPageInTab(requestConfig);
              if (!tabPage) tabError = "标签页没有返回内容";
            } catch (error) {
              tabError = error instanceof Error ? error.message : String(error);
            }
          }

          logEvent({
            module: "userInfo",
            level: "warn",
            msg: `站点 ${this.metadata.id} 的用户页返回拦截外壳页（${shapeLine(shape)}），已用当前登录态比对请求形状：${
              probes.length > 0
                ? probes
                    .map(
                      (probe) =>
                        `${probe.variant} → ${
                          probe.error ? `失败（${probe.error}）` : probe.shape ? shapeLine(probe.shape) : "无读数"
                        }`,
                    )
                    .join(" ／ ")
                : "探针没有拿到任何读数"
            }；顺带访问 /index.php → ${indexShape ? shapeLine(indexShape) : `失败（${indexError}）`}${
              indexRetry
                ? `，随后重试原页 → ${shapeLine(indexRetry.shape)}`
                : indexRetryError
                  ? `，随后重试原页 → 失败（${indexRetryError}）`
                  : ""
            }${tabPage ? `；标签页导航 → ${shapeLine(tabPage.shape)}` : tabError ? `；标签页导航 → 失败（${tabError}）` : ""}${
              tabPage && this.isUsableUserInfoShape(tabPage.shape) ? "，本轮后续步骤都改走标签页" : ""
            }${winner ? `；本轮改用「${winner.variant}」` : indexRetry && this.isUsableUserInfoShape(indexRetry.shape) ? "；本轮改为先访问首页再取用户页" : ""}`,
            data: {
              site: this.metadata.id,
              baseline: shape,
              probes: probes.map((probe) => ({ variant: probe.variant, shape: probe.shape, error: probe.error })),
              index: indexShape,
              indexError,
              indexRetry: indexRetry?.shape,
              indexRetryError,
              tab: tabPage?.shape,
              tabError,
            },
          });

          if (winner?.response && winner.shape) {
            response = winner.response;
            dataDocument = response.data;
            shape = winner.shape;
            winningVariant = { headers: winner.headers, data: winner.data };
          } else if (indexRetry && this.isUsableUserInfoShape(indexRetry.shape)) {
            response = indexRetry.response;
            dataDocument = response.data;
            shape = indexRetry.shape;
            visitIndexFirst = true;
          } else if (tabPage && this.isUsableUserInfoShape(tabPage.shape)) {
            dataDocument = tabPage.document;
            shape = tabPage.shape;
            useTabNavigation = true;
          }
        }

        if (shape) {
          pageShapes.push(shape);
        }

        // 取数那一层只保证「拿到了某个响应」，交给解析器时按它本该是的 Document 收窄一次；
        // 真正的形状差异由 `pageShapeOf` 记，解析器这边行为不变。
        const parseDocument = dataDocument as Document;

        for (const key of processFields) {
          const dynamicParseFuncKey = `parseUserInfoFor${pascalCase(key)}` as keyof this;
          if (dynamicParseFuncKey in this && typeof this[dynamicParseFuncKey] === "function") {
            flushUserInfo = await this[dynamicParseFuncKey](flushUserInfo, parseDocument, requestConfig);
          } else {
            // 优先使用本步骤定义的选择器，如果没有则使用 userInfo 全局的选择器
            let elementQuery = thisUserInfoProcess.selectors?.[key] ?? this.metadata.userInfo?.selectors?.[key];
            if (elementQuery) {
              flushUserInfo[key] = this.getFieldData(parseDocument, elementQuery as IElementQuery);
            } else {
              // noinspection ExceptionCaughtLocallyJS
              // throw new Error(`字段 ${key} 未设置 selector 或 ${String(dynamicParseFuncKey)} 方法`);
            }
          }
        }
      }

      // 如果前面没有获取到用户等级的id，则尝试通过定义的 levelRequirements 来获取
      if (this.metadata.levelRequirements && flushUserInfo.levelName && typeof flushUserInfo.levelId === "undefined") {
        flushUserInfo.levelId = this.guessUserLevelId(flushUserInfo as IUserInfo);
      }

      // 整轮空手才出声（用户 2026-10-24：「这两个怎么获取不到这些数据了？前几天都还可以」）。
      // 出声之前这里什么都不改：status 照旧 success、字段照旧是那些默认值 —— 这条只是把
      // 「界面报 0」与「我们拿到的那一页根本没被解析出格子」分开的观测值写进运行日志。
      // 判据（哪三格算空手、形状怎么折）在 `@/shared/userInfoShape`，那边有 Node 断言。
      //
      // 那道门从「有条响应读数」放宽成「这一轮至少动过一步」：一步都没发（全被「字段已有」短路）
      // 同样是一轮空手，而原来那种写法让它**完全隐形** —— 界面上那个 id 是 pickLast 从上一轮存档
      // 带过来的，读数里连一条地址都没有，谁也都判不出「这一轮压根没联网」。
      if ((pageShapes.length > 0 || skippedSteps.length > 0) && isSilentZeroRound(flushUserInfo)) {
        const sentCount = pageShapes.length;
        const totalCount = sentCount + skippedSteps.length;
        const skipped = skippedSteps.map(skippedStepLine).join(" ／ ");
        const taken = sentCount > 0 ? pageShapes.map(shapeLine).join(" ／ ") : "一次请求都没发";
        logEvent({
          module: "userInfo",
          level: "warn",
          msg: `站点 ${this.metadata.id} 这一轮用户信息一格都没命中：共 ${totalCount} 步、实发 ${sentCount} 次${
            skipped ? `；跳过 ${skipped}` : ""
          }｜${taken}`,
          data: { site: this.metadata.id, totalSteps: totalCount, skippedSteps, pages: pageShapes },
        });
      }

      flushUserInfo.status = EResultParseStatus.success;
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error(error);
      }

      flushUserInfo.status = EResultParseStatus.parseError;

      if (error instanceof CFBlockedError) {
        flushUserInfo.status = EResultParseStatus.CFBlocked;
      } else if (error instanceof NeedLoginError) {
        flushUserInfo.status = EResultParseStatus.needLogin;
      } else if (error instanceof NoUserInputError) {
        flushUserInfo.status = EResultParseStatus.noUserInput;
      }
    }

    return flushUserInfo;
  }

  /**
   * 用一次**真实标签页导航**取一页，折成与 XHR 同口径的形状。
   *
   * 只在「直接请求被判定成拦截外壳页、且换头与先访问首页都没救回来」时调用；
   * 成功一次之后本轮后续步骤直接走这里（`useTabNavigation`），不再发注定被拦的 XHR。
   * 失败回 undefined，绝不抛 —— 观测件不许把这一轮炸成 parseError。
   */
  private async fetchUserInfoPageInTab(
    requestConfig: AxiosRequestConfig,
  ): Promise<{ document: Document; shape: IPageShape } | undefined> {
    const url = axios.getUri({
      baseURL: this.url,
      url: requestConfig.url,
      params: requestConfig.params,
    });
    const result = await probePageInTab(url);
    if (!result?.html) {
      return undefined;
    }
    const document = new DOMParser().parseFromString(result.html, "text/html");
    const shape = pageShapeOf({
      status: 200,
      transport: { responseText: result.html, responseURL: result.finalUrl ?? url },
      contentType: "text/html",
      data: document,
    });
    return { document, shape };
  }

  /** 把一次用户信息响应折成形状读数（观测值的读法统一在 @/shared/userInfoShape） */
  private userInfoShapeOf(response: AxiosResponse<unknown>, requestConfig: AxiosRequestConfig): IPageShape {
    return pageShapeOf({
      status: response.status,
      transport: response.request,
      requestUrl: requestConfig.url,
      baseURL: this.url,
      contentType: response.headers?.["content-type"],
      headers: response.headers,
      data: response.data,
    });
  }

  /**
   * 探针拿回来的这一页能不能直接交给解析器。
   * 不能只看「不是外壳页」：未登录时站点会跳 login.php（td 很多），把它当成功会把登录页解析成用户信息。
   */
  private isUsableUserInfoShape(shape: IPageShape): boolean {
    return (
      shape.status === 200 &&
      shape.isDocument &&
      shape.cells > 0 &&
      !shape.cfMitigated &&
      !/login|takelogin/i.test(shape.hostPath)
    );
  }

  /**
   * 用当前登录态依次试几种请求形状，遇到第一个「能用的页」就停。
   * 每一次都走 `checkLogin: false`：探针的目的是看站点对形状的反应，不该因为登录态判据提前抛错。
   */
  private async probeUserInfoShellPage(
    requestConfig: AxiosRequestConfig,
    siteUrl: string,
  ): Promise<IUserInfoProbeResult[]> {
    const results: IUserInfoProbeResult[] = [];

    for (const variant of userInfoRequestVariants(siteUrl)) {
      try {
        const probeConfig: AxiosRequestConfig = {
          ...requestConfig,
          ...(variant.data === undefined ? {} : { data: variant.data }),
          headers: {
            ...(requestConfig.headers as Record<string, string> | undefined),
            ...variant.headers,
          },
        };
        const response = await this.request<unknown>(probeConfig, false);
        const shape = this.userInfoShapeOf(response, probeConfig);
        results.push({ variant: variant.name, headers: variant.headers, data: variant.data, response, shape });
        if (this.isUsableUserInfoShape(shape)) break;
      } catch (error) {
        results.push({
          variant: variant.name,
          headers: variant.headers,
          data: variant.data,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
  }

  // 允许子类覆盖
  protected guessUserLevelId(userInfo: IUserInfo): TLevelId {
    return guessUserLevelId(userInfo, this.metadata.levelRequirements ?? []);
  }

  /**
   * 能否在扩展内读站内信（我的数据页点未读数字那条路）。
   *
   * 默认 false：站内信的列表结构各站改版就不一样，没实测过的 schema 不该假装解析得动 ——
   * 解析不出来时给用户一个空列表比给他一个错误的列表更诚实，所以界面直接给「去网页看」。
   * 目前只有 NexusPHP 系覆写了这一组（167/340 个定义，含国内绝大多数 PT 站）。
   */
  public get supportsMessages(): boolean {
    return false;
  }

  public async getMessages(): Promise<ISiteMessage[]> {
    return [];
  }

  /**
   * @param messageId 列表给出的站内信 id
   * @param url 列表里那条指向正文的链接原样（能拿到就该用它：各分支的 action/参数名不统一）
   */
  public async getMessageContent(_messageId: string, _url?: string): Promise<string | undefined> {
    return undefined;
  }

  /**
   * 批量删除站内信。默认不支持（理由同 `supportsMessages`：没实测过的 schema 不该假装删得动）。
   * 注意这条会**改站点侧的数据**，所以调用方必须在跑完后重拉列表，以站点给的为准。
   */
  public async deleteMessages(_messageIds: string[]): Promise<ISiteMessageActionResult> {
    return { supported: false, status: EResultParseStatus.success, handled: 0 };
  }
}
