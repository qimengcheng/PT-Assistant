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
import { logEvent } from "../utils/adapter";
import { isSilentZeroRound, pageShapeOf, shapeLine, skippedStepLine, type IPageShape } from "@/shared/userInfoShape";

export const SchemaMetadata: Partial<ISiteMetadata> = {
  version: -1,
  search: {},
  userInfo: {},
};

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

        const response = await this.request<any>(requestConfig);
        const dataDocument = response.data;

        // 形状读数：只有这一层还握着响应本体（上层拿到的是已经折好的字段值）。
        // 交出去的是**对象本身**不是它的属性 —— 真 XHR 在 responseType 为 document 时读 `responseText`
        // 会抛 InvalidStateError，在调用点取属性等于把整轮取数炸成 parseError（v0.125.0 就是这么坏的，
        // 用户 2026-10-24：「现在变成解析错误了」）。属性读取归 `@/shared/userInfoShape` 逐条兜。
        // 外面再套一层：观测件不许有弄坏被观测那条路的能力。
        try {
          pageShapes.push(
            pageShapeOf({
              status: response.status,
              transport: response.request,
              requestUrl: requestConfig.url,
              baseURL: this.url,
              contentType: response.headers?.["content-type"],
              data: dataDocument,
            }),
          );
        } catch {
          // 少一条读数比整轮取数变成 parseError 好
        }

        for (const key of processFields) {
          const dynamicParseFuncKey = `parseUserInfoFor${pascalCase(key)}` as keyof this;
          if (dynamicParseFuncKey in this && typeof this[dynamicParseFuncKey] === "function") {
            flushUserInfo = await this[dynamicParseFuncKey](flushUserInfo, dataDocument, requestConfig);
          } else {
            // 优先使用本步骤定义的选择器，如果没有则使用 userInfo 全局的选择器
            let elementQuery = thisUserInfoProcess.selectors?.[key] ?? this.metadata.userInfo?.selectors?.[key];
            if (elementQuery) {
              flushUserInfo[key] = this.getFieldData(dataDocument, elementQuery as IElementQuery);
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
            skipped ? `（${skipped}）` : ""
          } · ${taken}`,
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
