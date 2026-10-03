/**
 * background 基础能力（平移自 PT-depiler background/utils/base.ts）。
 * 打开选项页：content-script 的划词搜索、omnibox 地址栏搜索均通过 openOptionsPage 消息跳转。
 * WXT 构建产物中选项页位于扩展根 /options.html（旧版路径 /src/entries/options/index.html）。
 */
import { stringify } from "urlencode";

import { onMessage } from "@/messages.ts";

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
