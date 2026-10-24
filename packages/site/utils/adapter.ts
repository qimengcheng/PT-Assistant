/**
 * 此处为 site 包提供一些与平台相关的工具函数和适配器，
 *
 * 在 site 包中，难免使用一些与平台有关的工具，比如 使用 axios 进行网络请求，获取cookies
 * 此处为这些操作提供统一的出口
 * 来尽可能实现 site 包的 schemas 和 definitions 实现与浏览器平台能解耦
 * （其他地方只要修改此处的实现即可）
 *
 * ⚠️ 本仓的别名只有 `@ptd/*`（映射到 `packages/`，见 tsconfig.json 与 wxt.config.ts）；
 * 原注释写的 `@pkg/site` / `pkg/site` 是上游仓库的叫法，**在本仓不存在**。
 *
 */

import axiosRaw from "axios";
import { get, set } from "es-toolkit/compat";

import { sendMessage } from "@/messages.ts";
import { setupReplaceUnsafeHeader } from "~/extends/axios/replaceUnsafeHeader.ts";
import { setupRetryWhenCloudflareBlock } from "~/extends/axios/retryWhenCloudflareBlock.ts";

export { isCloudflareBlocked } from "~/extends/axios/retryWhenCloudflareBlock.ts";
export { sleep } from "~/helper.ts";

import type { ISiteUserConfig } from "../types";
import type { ILoggerItem } from "@/shared/types.ts";
import type { IExtensionStorageSchema } from "@/storage.ts";
import type { IMetadataPiniaStorageSchema } from "@/shared/types/storages/metadata.ts";
import { extStore } from "@/storage.ts";

// 默认允许 site 包中的 axios 请求替换 unsafeHeader
export const axios = setupRetryWhenCloudflareBlock(setupReplaceUnsafeHeader(axiosRaw));

/**
 * 存储数据到 metadata.site[siteId].runtimeSettings[key] 中，
 * 这样对应站点实例可以使用 this.userConfig?.runtimeSettings?.[key] 或者 this.retrieveRuntimeSettings(key) 来获取
 */
export async function store(
  siteId: string,
  key: string,
  value: any,
  field: keyof ISiteUserConfig = "runtimeSettings",
): Promise<void> {
  // 走按路径增量写入，而不是「读全量 metadata → 改 → 写回全量」：
  // 后者每次都要传输/序列化整个 300+ 站点的 metadata blob，且两个并发调用会互相覆盖。
  await extStore.patchItem("metadata", `sites.${siteId}.${field}.${key}`, value);
}

export async function retrieve<T extends any>(
  siteId: string,
  key: string,
  field: keyof ISiteUserConfig = "runtimeSettings",
): Promise<T | null> {
  const metadataStore = (await extStore.getItem("metadata")) as IMetadataPiniaStorageSchema;
  return get(metadataStore, `sites.${siteId}.${field}.${key}`, null) as T | null;
}

export async function retrieveStore(store: keyof IExtensionStorageSchema, keyPath: string): Promise<any> {
  const metadataStore = (await extStore.getItem(store)) as IMetadataPiniaStorageSchema;
  return get(metadataStore, keyPath, null);
}

/**
 * 允许调用来获取获取单个 cookie 信息
 */
export async function cookie(detail: chrome.cookies.CookieDetails): Promise<chrome.cookies.Cookie | null> {
  return await sendMessage("getCookie", detail);
}

/**
 * 往「运行日志」那一屏记一条（offscreen 里的内存环形缓冲）。
 *
 * 为什么走这里：schemas 里唯一伸向 app 的通道就是这个 adapter 文件（同上的 `cookie()` / `store()`
 * 都经 `sendMessage`），而 logger 的实现住在 offscreen。日志那条注释定的口径就是
 * 「非 offscreen 上下文用 `sendMessage("logger", …).catch()`」——这里就是那条路。
 * 记日志失败（offscreen 还没起来、消息没人接）绝不能反过来影响取数，所以既不 await 也不抛。
 */
export function logEvent(item: ILoggerItem): void {
  try {
    sendMessage("logger", item).catch(() => {});
  } catch {
    // 同上：连「发不出去」这种同步失败也不许反过来影响调用方
  }
}
