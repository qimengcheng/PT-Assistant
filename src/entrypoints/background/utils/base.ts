/**
 * background 基础能力（平移自 PT-depiler background/utils/base.ts）。
 * 打开选项页：content-script 的划词搜索、omnibox 地址栏搜索均通过 openOptionsPage 消息跳转。
 * WXT 构建产物中选项页位于扩展根 /options.html（旧版路径 /src/entries/options/index.html）。
 */
import { stringify } from "urlencode";

import { onMessage } from "@/messages.ts";
import { extStore } from "@/storage.ts";

export interface IOpenOptionsTarget {
  path: string;
  query?: Record<string, unknown>;
}

export function openOptionsPage(url?: string | IOpenOptionsTarget) {
  let target: string;
  if (url && typeof url !== "string") {
    target = url.path + (url.query ? "?" + stringify(url.query) : "");
  } else {
    target = url ?? "/";
  }

  chrome.tabs.create({ url: "/options.html#" + target }).catch(() => {
    // 极少数情况下 tabs.create 被拒（如策略限制），退回 runtime.openOptionsPage（只能打开默认页）
    void chrome.runtime.openOptionsPage();
  });
}

onMessage("openOptionsPage", async ({ data: url }) => {
  openOptionsPage(url);
});

// ===== chrome.storage 代理：offscreen document 唯一可用的扩展 API 是 chrome.runtime，
// 没有 chrome.storage，offscreen 侧的 extStore（@/storage.ts）自动改走这里。
// 读写都经过 SW 这唯一一份 extStore，顺带获得 SW 内的按 key 写串行保证。
onMessage("getExtStorage", async ({ data: key }) => {
  return await extStore.getItem(key);
});

onMessage("setExtStorage", async ({ data: { key, value } }) => {
  await extStore.setItem(key, value);
});

onMessage("patchExtStorage", async ({ data: { key, path, value } }) => {
  await extStore.patchItem(key, path, value);
});
