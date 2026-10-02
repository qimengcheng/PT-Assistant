/// <reference types="chrome" />
import type { ISiteMetadata, TSite } from "@ptd/site"; // type-only：构建时擦除，不会把 @ptd/site 的 eager 链（utils → social → sizzle）带进 SW

import { onMessage } from "@/messages.ts";

// 只需要「站点定义数量」时，用 import.meta.glob 拿文件名键即可（不会加载任何模块）。
// ⚠️ 不能 import { definitionList } from "@ptd/site"：那会把 site index 的 eager import 链
// （→ utils → @ptd/social → anidb/douban → sizzle）在启动时拉进 service worker。
// sizzle 的 UMD 工厂在模块顶层就访问 window，而 MV3 SW 无 window，会直接 ReferenceError：
// SW 启动即崩、消息监听器注册不上，前端表现为消息永远无响应。
interface definitionEntity {
  default?: TSite;
  siteMetadata: ISiteMetadata & Required<Pick<ISiteMetadata, "schema">>;
}
const definitionModules = import.meta.glob<definitionEntity>("../../packages/site/definitions/*.ts");
const definitionCount = Object.keys(definitionModules).length;

const storageLocalKey = (key: string) => `extStorage:${key}`;

export default defineBackground({
  // type: 'module' 至关重要：
  // 1. module SW 才支持静态 import 与动态 import()；classic SW（WXT 默认）不支持 import()，
  //    WXT 会退化为 inlineDynamicImports，把 340 个站点定义 + sizzle 全部内联进 background.js，
  //    sizzle 顶层访问 window 直接炸掉整个 SW。
  // 2. module 模式下站点定义保持为独立懒加载 chunk，只有真正用到某站点时才加载。
  type: "module",
  main() {
    // ===== 基础 =====
    // 点扩展图标直接打开完整标签页（无 popup 入口时 onClicked 才会触发）
    browser.action.onClicked.addListener(() => {
      void browser.runtime.openOptionsPage();
    });

    onMessage("ping", async () => ({
      version: browser.runtime.getManifest().version,
      definitionCount,
    }));

    // ===== chrome.storage（供 site 包 adapter 的 store/retrieve 使用）=====
    onMessage("getExtStorage", async ({ data }) => {
      const result = await browser.storage.local.get(storageLocalKey(data));
      return result[storageLocalKey(data)] ?? {};
    });

    onMessage("setExtStorage", async ({ data }) => {
      await browser.storage.local.set({ [storageLocalKey(data.key)]: data.value });
    });

    // ===== chrome.declarativeNetRequest（供 unsafe header 替换使用）=====
    onMessage("updateDNRSessionRules", async ({ data }) => {
      await chrome.declarativeNetRequest.updateSessionRules({
        addRules: [data.rule],
        removeRuleIds: [data.rule.id],
      });
    });

    onMessage("removeDNRSessionRuleById", async ({ data }) => {
      await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [data] });
    });

    // ===== chrome.cookies（供 Cloudflare 重试与站点登录态使用）=====
    onMessage("getCookie", async ({ data }) => {
      return (await chrome.cookies.get(data)) ?? null;
    });

    onMessage("getAllCookies", async ({ data }) => {
      return await chrome.cookies.getAll(data);
    });

    onMessage("setCookie", async ({ data }) => {
      await chrome.cookies.set(data);
      return true;
    });

    onMessage("removeCookie", async ({ data }) => {
      const details = data as chrome.cookies.SetDetails;
      const domain = (details.domain ?? "").replace(/^\./, "");
      if (!domain || !details.name) {
        return null;
      }
      const url = `${details.secure ? "https" : "http"}://${domain}${details.path || "/"}`;
      await chrome.cookies.remove({ url, name: details.name });
      return { url, name: details.name };
    });
  },
});
