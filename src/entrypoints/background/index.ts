/// <reference types="chrome" />
import type { ISiteMetadata, TSite } from "@ptd/site"; // type-only：构建时擦除，不会把 @ptd/site 的 eager 链（utils → social → sizzle）带进 SW

import { onMessage } from "@/messages.ts";
import { extStore } from "@/storage.ts";
import { setupOffscreenDocumentSafe } from "./utils/offscreen.ts";
// cookies 相关 handler（含 setCookie 的字段白名单与 checkAndExtendCookies）统一在本模块注册
import "./utils/cookies.ts";
// 右键菜单（划词搜索/豆瓣·IMDb 链接搜索/下载链接推送），挂载于 tabs 激活事件
import "./utils/contextMenus.ts";
// openOptionsPage 消息：content-script 划词搜索等跳转选项页
import "./utils/base.ts";
// DNR session 规则（unsafe header 注入，正向圈定本扩展请求 #1465/#1486）
import "./utils/webRequest.ts";
// 地址栏 ptd + Tab 搜索
import "./utils/omnibox.ts";
// 定时任务：自动刷新站点数据 / 自动备份 / 冷却后重新推送种子
import "./utils/alarms.ts";
// 原生通信桥（可选权限 nativeMessaging）：本机 ptd CLI ↔ 扩展，未授权时自动休眠
import "./utils/nativeMessaging.ts";
import { fixAllStoredUserInfo } from "./utils/fixer.ts";

// 只需要「站点定义数量」时，用 import.meta.glob 拿文件名键即可（不会加载任何模块）。
// ⚠️ 不能 import { definitionList } from "@ptd/site"：那会把 site index 的 eager import 链
// （→ utils → @ptd/social → anidb/douban → sizzle）在启动时拉进 service worker。
// sizzle 的 UMD 工厂在模块顶层就访问 window，而 MV3 SW 无 window，会直接 ReferenceError：
// SW 启动即崩、消息监听器注册不上，前端表现为消息永远无响应。
interface definitionEntity {
  default?: TSite;
  siteMetadata: ISiteMetadata & Required<Pick<ISiteMetadata, "schema">>;
}
// ⚠️ glob 必须用「项目根绝对路径」形式（/ 开头）：WXT 会用虚拟模块包装 entrypoint，
// "../" 相对 pattern 的解析基准会失效，静默匹配出空 map（v0.4.0 的 definitionCount=0 根因）。
// 另外这里只用文件名键、不加载任何模块：不能 import { definitionList } from "@ptd/site"，
// 那会把 site index 的 eager 链（→ utils → @ptd/social → sizzle）拉进 SW，
// sizzle 的 UMD 工厂在模块顶层访问 window，MV3 SW 无 window，启动即崩。
const definitionModules = import.meta.glob<definitionEntity>("/packages/site/definitions/*.ts");
const definitionCount = Object.keys(definitionModules).length;

export default defineBackground({
  // type: 'module' 至关重要：
  // 1. module SW 才支持静态 import 与动态 import()；classic SW（WXT 默认）不支持 import()，
  //    WXT 会退化为 inlineDynamicImports，把 340 个站点定义 + sizzle 全部内联进 background.js，
  //    sizzle 顶层访问 window 直接炸掉整个 SW。
  // 2. module 模式下站点定义保持为独立懒加载 chunk，只有真正用到某站点时才加载。
  type: "module",
  main() {
    // ===== offscreen 文档（站点解析/搜索/下载等服务宿主，具备 DOM）=====
    setupOffscreenDocumentSafe();

    // ===== 基础 =====
    // 点扩展图标直接打开完整标签页（无 popup 入口时 onClicked 才会触发）
    browser.action.onClicked.addListener(() => {
      void browser.runtime.openOptionsPage();
    });

    onMessage("ping", async () => ({
      version: browser.runtime.getManifest().version,
      definitionCount,
    }));

    // ===== chrome.storage（供 offscreen / site 包 adapter 的 store/retrieve 使用）=====
    // ⚠️ 必须走 @/storage.ts 的 extStore，不能自己拼 storage.local 的 key：
    // options 页的 pinia 持久化（persistWebExt，key = store.$id）写的是裸 key "metadata"，
    // 若这里换成 `extStorage:${key}`，两套命名空间互不相通 —— 备份恢复写进去的数据
    // options 页永远读不到（MyData 表格空白），offscreen 侧也永远读不到用户的站点配置。
    onMessage("getExtStorage", async ({ data: key }) => {
      // 不同 key 的值类型不同，这里无法收窄到具体键的类型
      return (await extStore.getItem(key)) as any;
    });

    onMessage("setExtStorage", async ({ data: { key, value } }) => {
      await extStore.setItem(key, value);
    });

    // ===== chrome.downloads（供备份本地导出等使用）=====
    onMessage("downloadFile", async ({ data }) => {
      return await chrome.downloads.download(data);
    });

    // ===== chrome.declarativeNetRequest 的 updateDNRSessionRules /
    //      removeDNRSessionRuleById 已在 ./utils/webRequest.ts 注册 =====

    // ===== chrome.cookies 的 getAllCookies / getCookie / setCookie / removeCookie /
    //      checkAndExtendCookies 已在 ./utils/cookies.ts 注册 =====

    // ===== 安装/升级时修复历史版本写入的坏数据（字符串型 ratio/seeding/joinTime 等）=====
    browser.runtime.onInstalled.addListener(() => {
      console.debug("[PTD] Installed!");
      void fixAllStoredUserInfo();
    });
  },
});
