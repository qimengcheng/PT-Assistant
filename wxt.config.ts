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
 * 这里只看环境变量本身，不参与推断：**没有 `PTD_SESSION` 时就是 WXT 默认的 `.output`**，
 * CI（单文件流水线 ci.yml 的 build job）靠这个默认值按 `.output/*.zip` 取包，绝不能被影响。
 * 本地裸 `pnpm build` / `pnpm zip` 拿不到固定加载路径的问题，是在上一层解决的：
 * `scripts/build-verify.mjs` 检测到「没给会话名且不在 CI」时按 `owner` 传下来，
 * 于是产物落 `dist-owner-<版本号>/chrome-mv3` 并照常换指 `dist-verify`。
 * `pnpm dev` 不经那个脚本，所以裸 `pnpm dev` 仍然写 `.output`、也不碰联接。
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
     *
     * ⚠️ **`*.js` 不是偷懒的兜底，删不得、也收窄不了**（曾有人提议改成
     * `chunks/*` + `content-app*`，那是一份会把扩展弄坏的处方，别再提）：
     *
     *  1. `content-app.js` 落在产物**根目录**，它 `import("./NexusPHP-<hash>.js")` 拉的是
     *     **同级**文件 —— 实测根级 379 个 .js 全是这类被 app 间接依赖的 chunk，每一个都必须
     *     web-accessible。而 `chunks/` 下那 571 个 content-app 引用数为 0（只被扩展页面
     *     options / offscreen / background 用到，那些是同源扩展页、本来就不需要 WAR）。
     *     所以「收窄到 chunks/*」正好把必需的那批删掉、把不需要的那批加上。
     *  2. 改成枚举具体文件名也不行：名字带内容哈希，每次构建都变，等于把 379 个文件名的
     *     正确性押在「每次发版手工同步」上 —— 这才是真正的漏配来源。
     *
     * 安全性上这条也不是短板：`content-app*.js` 的 matches 已经覆盖所有 http/https 页面，
     * 任意网页本来就能 fetch 到它并据此判定装了本扩展，`*.js` 有没有额外多露一片
     * （通配符是否跨路径分隔符，本次未能证实 —— Chrome 文档两条获取路径都断了；
     * 但结论不依赖这个未知量）都不改变这个事实。而暴露的这些文件里**没有秘密**：
     * 站点定义是公开源码，`password` / `ApiKey` / `Secret` 的命中全是表单字段名与站点名
     * （如 `e.append("password", this.config.password)`，凭据值只在运行期用户配置里），
     * 字面量赋值凭据的扫描为空。
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
        /**
         * `buffer` 同理，且这里两个后果都真实发生过（v0.22.38 实测）：
         * 1. 不接管时 rolldown 按 external 处理它，内容是 `exports = {}` 的空 stub，于是
         *    `packages/downloader/utils.ts` 的 `import { Buffer } from "buffer"` 拿到
         *    undefined，`Buffer.from(...)` 抛 TypeError；
         * 2. 该 stub 还会被产出为 `__vite-browser-external-*.js`，且**直接落在扩展根目录** ——
         *    Chrome 拒载根目录下以 `_` 开头的文件，整个扩展直接装不上（同 browserPath.ts 那个坑）。
         *
         * 接到一个本地中转文件而不是直接指包入口：那样模块 id 仍是 "buffer"，产物文件名会
         * 继续叫 `__vite-browser-external-*`，名字含义与实际内容不符（里面装的是真 buffer），
         * 将来 rolldown 一旦改成真 externalize 就会静默失效。详见 src/extends/browserBuffer.ts。
         *
         * ⚠️ 这条 alias 覆盖不了「没有 import 语句的自由变量 Buffer」—— 那种它管不到
         * （`urlencode`@2 的 `decode()` 里就有一行，见 packages/downloader/utils.ts 的
         * decodePercentAscii 注释）。两处要分别处理。
         */
        { find: /^buffer$/, replacement: path.resolve(rootDir, "src/extends/browserBuffer.ts") },
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
