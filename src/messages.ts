/// <reference types="chrome" />
import { defineExtensionMessaging } from "@webext-core/messaging";

import type { ISiteUserConfig, TSiteID } from "@ptd/site";
import type { TExtensionStorageKey, IExtensionStorageSchema } from "@/storage.ts";
import { isDebug } from "~/helper.ts";

/**
 * 精简版消息协议（对应 PT-depiler messages.ts 的 269 行全量协议，此处只保留骨架需要的部分）：
 * 1. chrome cookies / DNR —— site 包的 axios 拦截器（unsafe header 替换、Cloudflare 重试）依赖
 * 2. extStorage —— site 包 adapter.ts 的 store/retrieve 依赖
 */
type TMessageMap = Record<string, (data: any) => any>;

export interface ProtocolMap extends TMessageMap {
  ping(data?: null): { version: string; definitionCount: number };

  // 1. chrome.storage
  getExtStorage<T extends TExtensionStorageKey>(key: T): IExtensionStorageSchema[T];
  setExtStorage<T extends TExtensionStorageKey>(data: { key: T; value: IExtensionStorageSchema[T] }): void;

  // 2. chrome.declarativeNetRequest
  updateDNRSessionRules(data: { rule: chrome.declarativeNetRequest.Rule; extOnly?: boolean }): void;
  removeDNRSessionRuleById(data: chrome.declarativeNetRequest.Rule["id"]): void;

  // 3. chrome.cookies
  getAllCookies(data: chrome.cookies.GetAllDetails): chrome.cookies.Cookie[];
  setCookie(data: chrome.cookies.SetDetails): boolean;
  getCookie(data: chrome.cookies.CookieDetails): chrome.cookies.Cookie | null;
  removeCookie(data: chrome.cookies.CookieDetails | chrome.cookies.SetDetails): chrome.cookies.CookieDetails | null;

  // 4. 站点服务（当前注册在 options 页上下文，见 options/services/site.ts）
  getSiteUserConfig(data: { siteId: TSiteID; flush?: boolean }): ISiteUserConfig;
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
