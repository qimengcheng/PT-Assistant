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

/**
 * 多 agent 共用同一个 git 工作树时的产物隔离：`wxt` 每次构建都会**先清空 outDir**，
 * 两个会话并行构建就会互相擦（实测发生过：A 的 dist-latest 同步抓到 B 构建中途的空目录）。
 *
 * 注意 WXT 0.21.4 的 `wxt build` **没有 `--output` 参数**（只有 root/config/mode/browser/
 * filter-entrypoint/mv3/analyze/debug/level），隔离只能走这里的 `outDir` 配置，用环境变量传：
 *
 *     PTD_SESSION=qwenwork pnpm build     → dist-qwenwork-<版本号>/chrome-mv3
 *     PTD_SESSION=workbuddy pnpm dev      → dist-workbuddy-<版本号>/chrome-mv3
 *
 * 目录名带上版本号：本机同时躺着七八个会话的产物目录，光看 `dist-qoder` 分不清是哪个版本，
 * 而「加载哪个目录验收」恰恰是要报给用户的问题。版本号取自 package.json（与注入 manifest 的
 * 是同一个值）。**用户实际加载的不是这些目录，而是 `dist-verify`** —— 一个由
 * `scripts/build-verify.mjs` 在每次构建成功后换指的目录联接，固定路径才不会让 Chrome 的
 * 未打包扩展 id 每次变（详见 AGENTS §2.2）。
 *
 * 不设 PTD_SESSION 时仍是 WXT 默认的 `.output` —— CI（单文件流水线 ci.yml 的 build job）
 * 就没有并发会话，它按 `.output/*.zip` 取包，绝不能被这条改动影响。
 */
const sessionTag = (process.env.PTD_SESSION ?? "").trim();

export default defineConfig({
  srcDir: "src",
  outDir: sessionTag ? `dist-${sessionTag}-${pkgVersion}` : ".output",
  modules: ["@wxt-dev/module-vue"],
  manifest: {
    name: "PT Assistant",
    description: "PT 站点辅助扩展（WXT + Vue 3 重构版）",
    // 与 PT-depiler 权限清单对齐（offscreen 由 Chrome 端追加）
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
    // nativeMessaging 为可选权限：用户在「基础设置 → 原生通信桥」里动态授权，
    // 供本机 ptd CLI（com.ptd.native）与扩展通信（background/utils/nativeMessaging.ts）
    optional_permissions: ["nativeMessaging"],
    icons: {
      "16": "/icon/16.png",
      "32": "/icon/32.png",
      "48": "/icon/48.png",
      "64": "/icon/64.png",
      "128": "/icon/128.png",
      "256": "/icon/256.png",
    },
    // 必须显式声明 action（哪怕为空对象）：没有 action 键时工具栏不会出现可点击按钮，
    // background 里的 action.onClicked 永远不会触发。声明后点击 → 打开 options 标签页。
    action: {
      default_title: "PT Assistant",
    },
    // 地址栏输入 ptd + Tab 后可直接按搜索方案检索（background/utils/omnibox.ts）
    omnibox: {
      keyword: "ptd",
    },

    /**
     * content script 引导在命中站点后会 `import(chrome.runtime.getURL("content-app.js"))`。
     * 扩展页面之外默认拿不到资源，必须显式声明 web_accessible_resources，
     * 否则动态 import 会被跨源策略拦掉。
     *
     * `content-app*.js` 同时覆盖 ES 入口本身和它按需 import 的代码 chunk
     * （chunk 名带哈希，如 content-app-DrhOtjws.js），两者都在产物根目录。
     * 产物根目录下的其它 chunk（site/social 等被 app 间接依赖的）用 `*.js` 兜住。
     *
     * 用通配避免依赖拓扑变化后漏配（refs: PT-depiler issue #1467）。
     */
    web_accessible_resources: [
      {
        resources: ["content-app*.js", "*.js", "assets/*", "icon/*", "icons/*"],
        matches: ["*://*/*"],
      },
    ],
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
      alias: [
        // Node 内建 `path` → 浏览器最小实现。打包器默认把它替换成 `exports = {}` 的空 stub，
        // 导致 parse-torrent 的 path.join 是 undefined（解析任何种子都抛），且 rolldown 会把
        // 该 stub 产出到扩展根目录、文件名以 `_` 开头 —— Chrome 直接拒载整个扩展。
        // 本文件自身 import 的是 `node:path`，不受此别名影响。
        { find: /^path$/, replacement: path.resolve(rootDir, "src/extends/browserPath.ts") },
        // 同理顶掉 `crypto` 的 browser-external stub（crypto-js 里那条 require 在浏览器是死分支，
        // 但打包器仍会静态产出 stub 文件），见 src/extends/browserNodeCrypto.ts。
        { find: /^crypto$/, replacement: path.resolve(rootDir, "src/extends/browserNodeCrypto.ts") },
        // 与 PT-depiler 保持一致的别名约定，site/social 包可以零修改平移
        { find: "@ptd", replacement: path.resolve(rootDir, "packages") },
        { find: "@", replacement: path.resolve(rootDir, "src") },
        { find: "~", replacement: path.resolve(rootDir, "src") },
      ],
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
        // 必须用 configResolved 而不是 config：WXT 的 build.lib 是在用户 config
        // 钩子之后才合并进去的，在 config() 里读到的 build.lib 是 undefined。
        // 匹配用 lib.fileName（= content-app），它与引导里
        // chrome.runtime.getURL("content-app.js") 的产物名一一对应；
        // lib.name 是从文件名推的驼峰形式（contentApp），对不上。
        configResolved(config: any) {
          if (config?.build?.lib?.fileName === "content-app") {
            config.build.lib.formats = ["es"];
          }
        },
      },
    ],
  }),
});
