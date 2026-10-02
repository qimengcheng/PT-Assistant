import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "wxt";
import vuetify from "vite-plugin-vuetify";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

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
  vite: () => ({
    // PT-depiler 沿用的编译期常量（site 包 favicon / 定义引用）
    define: {
      __BROWSER__: JSON.stringify(browser),
      __EXT_VERSION__: JSON.stringify(`v${pkgVersion}`),
      // TODO: 平移 public/icons/site 后改为真实图标清单
      __RESOURCE_SITE_ICONS__: JSON.stringify([]),
    },
    resolve: {
      alias: {
        // 与 PT-depiler 保持一致的别名约定，site/social 包可以零修改平移
        "@ptd": path.resolve(rootDir, "packages"),
        "@": path.resolve(rootDir, "src"),
        "~": path.resolve(rootDir, "src"),
      },
    },
    plugins: [
      // vuetify 组件按需自动导入 + styles 注入，配置与 PT-depiler 一致
      vuetify({ styles: { configFile: "./src/styles/vuetify/settings.scss" } }) as any,
    ],
    // Vuetify 4: 强制 Vite 预打包 overlay 相关模块，避免 dev 模式下浮层 z-index 失效
    // （仅影响 dev 模式，生产构建不受影响）。
    optimizeDeps: {
      include: [
        "vuetify/components/VOverlay",
        "vuetify/components/VDialog",
        "vuetify/components/VMenu",
        "vuetify/components/VSelect",
        "vuetify/components/VTooltip",
      ],
    },
  }),
}));
