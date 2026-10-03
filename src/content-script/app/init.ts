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
 * - 「布局样式合并为单一 css 文件后需显式 <link>」那段也删了，样式不再走构建期产物。
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

export function mountApp(document: Document, data: Record<string, any> = {}) {
  // 创建挂载点 + shadow DOM：把扩展样式与站点样式彻底隔离
  const contentRoot = document.createElement("div");
  const shadowRoot = contentRoot.attachShadow({ mode: "open" });

  const baseStyleElement = document.createElement("style");
  baseStyleElement.id = "ptd-content-script-style-base";
  baseStyleElement.textContent = appCss.replaceAll(":root", ":host");
  shadowRoot.appendChild(baseStyleElement);

  const appMountElement = document.createElement("div");
  appMountElement.id = "ptd-content-script-app";
  shadowRoot.appendChild(appMountElement);

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
