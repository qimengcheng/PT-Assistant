/**
 * 把 Vue 应用挂到 shadow DOM 里。
 *
 * 平移自 PT-depiler `entries/content-script/app/init.ts`，针对 antdv-next 做了调整：
 *
 * - Vuetify 原本靠「把 #vuetify-theme-stylesheet 搬进 shadow root」来隔离样式。
 *   antdv-next 走 CSS-in-JS，官方提供了 `<a-style-provider :container="shadowRoot">`
 *   （@antdv-next/cssinjs 的 StyleContext.container 类型是 `Element | ShadowRoot`），
 *   直接指定注入目标即可，不需要再搬运任何样式表。
 * - mdi webfont 那段 FontFace 逻辑随之删除，图标统一用 @antdv-next/icons 的 SVG 组件。
 * - ⚠️ 但「样式不再走构建期产物」这句是错的，见下方 injectSfcStyles：
 *   `<a-style-provider :container>` 只管 antd 的 CSS-in-JS，管不到 Vite 抽离出去的
 *   SFC `<style>`，那部分一直是零引用的孤立产物，content 侧组件样式从未生效过。
 */
import appCss from "./app.css?inline";

import { createApp } from "vue";

import App from "./App.vue";
import { piniaInstance as pinia } from "@/options/plugins/pinia.ts";
import { i18nInstance as i18n } from "@/options/plugins/i18n.ts";
// content 侧不共用 options 的全量 antd install：整包 antd 会让 content-app 单个 chunk
// 涨到 4.3MB（每个站点都要背），改按需注册见 @/content-script/antd-lite.ts。
import { antdLiteInstance as antd } from "@/content-script/antd-lite.ts";
// 同理，语言包只注册 content 闭包用到的 6 个命名空间，其余被 tree-shake（见 i18n-lite.ts）
import "@/content-script/i18n-lite.ts";

/** Vite 为 content-app 这个 chunk 抽出的 SFC 样式产物名，与 chunk 名绑定。 */
const SFC_CSS_PATH = "assets/content-app.css";

/**
 * 把 SFC `<style>` 产物取回来注进 shadowRoot。
 *
 * content-app 是运行时 `import()` 的 unlisted script（见 src/entrypoints/content.ts），
 * 它没有 HTML 宿主去挂 `<link>`，manifest 的 content_scripts 也没有 css 字段，
 * 于是 Vite 抽出的 assets/content-app.css 变成**零引用的孤立产物** ——
 * 所有组件样式（包括 .ptd-root 的 `position:fixed; z-index:9999999`）从未进过 shadowRoot，
 * 悬浮球退回静态定位后被文档流推到视口外（2026-10-03 实测 rect.y=4921，视口高 986）。
 *
 * 取回失败必须响：静默 catch 会让同一个 bug 以完全一样的面目复发，
 * 而它的表象只是"扩展在页面上没反应"，极难归因。
 */
function injectSfcStyles(document: Document, shadowRoot: ShadowRoot) {
  void fetch(chrome.runtime.getURL(SFC_CSS_PATH))
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    })
    .then((css) => {
      const el = document.createElement("style");
      el.id = "ptd-content-script-style-sfc";
      el.textContent = css;
      shadowRoot.appendChild(el);
    })
    .catch((e) => console.error("[PTD] 注入 content-app.css 失败，content 侧组件样式将全部丢失", SFC_CSS_PATH, e));
}


export function mountApp(document: Document, data: Record<string, any> = {}) {
  // 创建挂载点 + shadow DOM：把扩展样式与站点样式彻底隔离
  const contentRoot = document.createElement("div");
  const shadowRoot = contentRoot.attachShadow({ mode: "open" });

  const baseStyleElement = document.createElement("style");
  baseStyleElement.id = "ptd-content-script-style-base";
  baseStyleElement.textContent = appCss.replaceAll(":root", ":host");
  shadowRoot.appendChild(baseStyleElement);

  injectSfcStyles(document, shadowRoot);

  const appMountElement = document.createElement("div");
  appMountElement.id = "ptd-content-script-app";
  shadowRoot.appendChild(appMountElement);

  /**
   * shadowRoot 内的浮层容器，交给 ConfigProvider 的 getPopupContainer 与 message 的 getContainer。
   *
   * 为什么必须有：antd 的 modal / dropdown / message 默认挂到 document.body，而我们所有样式
   * （SFC CSS + StyleProvider 的 CSS-in-JS）都在 shadowRoot 里 —— 挂在 body 上的浮层拿不到
   * 任何样式，表现就是"点了没反应"：弹窗其实开了，只是零样式且落在视口之外
   * （2026-10-03 实测 light.modal=1 / shadow.modal=0）。
   *
   * 刻意用 0x0 而不是 inset:0：容器本身没有面积就不会吃掉页面点击，
   * 而它的后代（modal 的 fixed mask/wrap、dropdown 的 absolute 面板）各自按 viewport
   * 或容器原点定位，坐标仍由 antd 自己算准。
   */
  const overlayElement = document.createElement("div");
  overlayElement.id = "ptd-content-script-overlay";
  shadowRoot.appendChild(overlayElement);

  document.body.append(contentRoot);

  const app = createApp(App).use(pinia).use(i18n).use(antd);
  app.provide("ptd_data", data);
  // 把 shadowRoot 交给组件树，供 <a-style-provider :container> 使用
  app.provide("ptd_shadow_root", shadowRoot);
  app.mount(appMountElement);

  /**
   * 某些站点会动态改写 body 把我们的节点挤掉，用 MutationObserver 兜底重挂。
   *
   * 只观察 body 的直接子节点（childList，不带 subtree）：
   * 我们要判断的只是「contentRoot 是否还在 body 里」，而站点把contentRoot 挤出去
   * 必然伴随 body 的直接子节点变动。原来 observe(document, {subtree: true})
   * 会让页面上任何 DOM 变更都触发回调，在 SPA/高频刷新页面上是实打实的性能损耗。
   */
  let disposed = false;
  const mutationObserver = new MutationObserver(() => {
    if (!disposed && !document.body.contains(contentRoot)) {
      console.debug("[PTD] Content root removed from body, remounting app...");
      dispose();
      mountApp(document, data);
    }
  });

  function dispose() {
    if (disposed) return;
    disposed = true;
    mutationObserver.disconnect();
    // unmount 会触发 App.vue 的 onBeforeUnmount，document 级 dragstart 监听随之解绑
    app.unmount();
  }

  mutationObserver.observe(document.body, { childList: true });

  return { contentRoot, shadowRoot, appMountElement, app, dispose };
}
