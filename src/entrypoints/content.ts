/// <reference types="chrome" />
/**
 * content script 引导（唯一注入到所有页面的部分）
 *
 * 平移自 PT-depiler `src/entries/content-script/index.ts`。
 *
 * ⚠️ 这个入口必须保持轻量。PT-depiler 是靠「两套构建 + assets/cs-app.js 动态 import」
 * 才做到引导不带重资源的；WXT 默认把每个 content script 编成自包含 IIFE
 * （wxt/dist/core/builders/vite/index.mjs 里 formats: ["iife"]），无法直接 import()。
 *
 * 本项目的解法：把 content-app 这一个 unlisted script 通过 vite 插件改成 ES 输出
 * （见 wxt.config.ts 的 ptd-content-app-esm 插件），引导命中站点后再
 * `import(chrome.runtime.getURL("content-app.js"))` 按需加载。
 * 这样引导里只剩 messages / host 匹配判断 / 两次存储读，几十行。
 *
 * 存储读**直连 extStore**，不再走 sendMessage("getExtStorage")：RPC 版本在每个
 * http/https 页面上都要先把 MV3 service worker 冷起来才能拿到 config，
 * 直连就是两次 chrome.storage 读。代价是引导从 7,969 B 涨到 20,309 B
 * （wxt/storage 的 StorageItem 机制），仍远小于命中站点才加载的 content-app。
 *
 * social 站点匹配仍走消息交给 offscreen 代查，避免把 @ptd/social 打进引导
 * （refs: PT-depiler issue #1467）。
 */
import { getHostFromUrl } from "@ptd/site/utils/html.ts";

import { sendMessage } from "@/messages.ts";
import type { IConfigPiniaStorageSchema } from "@/shared/types/storages/config.ts";
import type { IMetadataPiniaStorageSchema } from "@/shared/types/storages/metadata.ts";
import { extStore } from "@/storage.ts";

export default defineContentScript({
  matches: ["*://*/*"],
  excludeMatches: ["*://*/*.xml", "*://*/*.xml?*"],
  runAt: "document_idle",
  allFrames: false,

  async main() {
    // props 通过全局暂存传给 content-app：引导与 app 是两次独立的模块求值，
    // 无法直接传参；用 Symbol 之外的唯一键名避免与站点脚本冲突。
    (globalThis as any).__PTD_CONTENT_PROPS__ = null;

    const configStore = (await extStore.getItem("config")) as IConfigPiniaStorageSchema;

    if (!(configStore?.contentScript?.enabled ?? true)) return;

    // ① 社交站点（bangumi / douban / imdb ...）
    // 这一步要经SW/offscreen 代查，浏览器刚启动时它们可能还没起来而 reject。
    // 不接住的话异常会逃出 main()，下面的 PT 站点匹配与 loadApp 全都不执行 ——
    // 表现是「刚打开 PT 站时悬浮球静默不挂载」，且没有任何重试，只能手动刷新。
    if (configStore?.contentScript?.enabledAtSocialSite ?? true) {
      const socialSite = await sendMessage("matchSocialPage", window.location.href).catch(() => undefined);
      if (socialSite) {
        console.debug(`[PTD] Social site detected: ${socialSite}, loading app...`);
        await loadApp({ socialSite });
        return;
      }
    }

    // ② PT 站点
    const metadataStore = (await extStore.getItem("metadata")) as IMetadataPiniaStorageSchema;
    const host = getHostFromUrl(window.location.href);
    const siteId = metadataStore?.siteHostMap?.[host];

    if (!siteId) return;

    if (
      configStore?.contentScript?.allowExceptionSites === true &&
      metadataStore.sites[siteId]?.allowContentScript === false
    ) {
      console.debug(`[PTD] Content script is disabled for site: ${siteId}`);
      return;
    }

    console.debug(`[PTD] host found for site: ${siteId}, loading app...`);
    await loadApp({ siteId });
  },
});

/** 按需加载 app（ES module，由 wxt.config.ts 的 ptd-content-app-esm 插件保证产物格式） */
async function loadApp(props: Record<string, unknown>) {
  (globalThis as any).__PTD_CONTENT_PROPS__ = props;

  const appUrl = chrome.runtime.getURL("content-app.js");
  console.debug("[PTD] loading app from", appUrl);

  // @vite-ignore：必须是运行时 URL，否则构建期会把这个动态 import 静态打进引导
  await import(/* @vite-ignore */ appUrl);

  console.debug("[PTD] app module loaded");
}
