import path from "node:path";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "wxt";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

// 站点图标清单（编译期注入，供 favicon 匹配本地图标；与 PT-depiler vite.config 一致）
const siteIconsDir = path.resolve(rootDir, "public/icons/site");
const siteIconFiles = (() => {
  try {
    return readdirSync(siteIconsDir);
  } catch {
    return [];
  }
})();

// 与 PT-depiler vite.config 一致：mediaServer 等包会在运行时展示扩展版本号。
// 注意：不要在这里 execSync("git describe")——沙箱内 spawn cmd.exe 会被 EBUSY 拦截，
// 改用 package.json 的 version（发布流程本来就三处同步 bump）。
const pkgVersion = (await import("./package.json", { with: { type: "json" } })).default.version;

export default defineConfig({
  srcDir: "src",
  modules: ["@wxt-dev/module-vue"],
  manifest: {
    name: "PT Assistant",
    description: "PT 站点辅助扩展（WXT + Vue 3 重构版）",
    // 与 PT-depiler 权限清单对齐（offscreen 由 Chrome 端追加；nativeMessaging 仍为可选权限，后续轮次再定）
    permissions: [
      "activeTab",
      "alarms",
      "clipboardWrite",
      "contextMenus",
      "cookies",
      "downloads",
      "declarativeNetRequest",
      "storage",
      "unlimitedStorage",
      "notifications",
      "offscreen",
    ],
    host_permissions: ["*://*/*"],
    icons: {
      "16": "/icon/16.png",
      "128": "/icon/128.png",
    },
    // 必须显式声明 action（哪怕为空对象）：没有 action 键时工具栏不会出现可点击按钮，
    // background 里的 action.onClicked 永远不会触发。声明后点击 → 打开 options 标签页。
    action: {
      default_title: "PT Assistant",
    },
  },
  // env.browser 是 WXT 从 CLI `-b/--browser` 解析出的目标浏览器。
  // ⚠️ 不要再用 `process.env.TARGET || "chrome"`：WXT 全程不设置 process.env.TARGET，
  // 那样写会让 __BROWSER__ 恒为 "chrome"，实测 `pnpm build:firefox` 产出的 hdsky
  // chunk 仍然走 chrome 分支（Firefox 下下载链接选择器会取错）。
  vite: (env) => ({
    // PT-depiler 沿用的编译期常量（site 包 favicon / 定义引用）
    define: {
      __BROWSER__: JSON.stringify(env.browser),
      __EXT_VERSION__: JSON.stringify(`v${pkgVersion}`),
      __RESOURCE_SITE_ICONS__: JSON.stringify(siteIconFiles),
    },
    resolve: {
      alias: {
        // 与 PT-depiler 保持一致的别名约定，site/social 包可以零修改平移
        "@ptd": path.resolve(rootDir, "packages"),
        "@": path.resolve(rootDir, "src"),
        "~": path.resolve(rootDir, "src"),
      },
    },
    /**
     * content script 的「轻量引导 + 按需加载 app」拆分。
     *
     * WXT 默认把 content script / unlisted script 都编成 IIFE（build.lib.formats: ["iife"]），
     * IIFE 不能被 `import()` 动态加载，所以引导脚本必须自包含整个应用。
     * 引导脚本匹配所有 http/https 页面（URL pattern 通配），等于每个页面都要解析一整个 Vue+antd 的 IIFE。
     *
     * 这里把 **content-app 这一个** unlisted script 改成 ES 输出，
     * 让引导脚本可以 `import(chrome.runtime.getURL("content-app.js"))` 在命中站点时才加载。
     * 其余入口（尤其 content 引导本身）必须保持 IIFE，否则 manifest 注入会失败。
     *
     * lib.name 即 WXT 的 entrypoint 名（见 wxt/dist/core/builders/vite/index.mjs）。
     */
    plugins: [
      {
        name: "ptd-content-app-esm",
        enforce: "post" as const,
        config(config: any) {
          if (config?.build?.lib?.name === "content-app") {
            config.build.lib.formats = ["es"];
          }
        },
      },
    ],
  }),
});
