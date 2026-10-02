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
import { antdInstance as antd } from "@/options/plugins/antd.ts";

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

  // 某些站点会动态改写 body 把我们的节点挤掉，用 MutationObserver 兜底重挂
  const mutationObserver = new MutationObserver(() => {
    if (!document.body.contains(contentRoot)) {
      console.debug("[PTD] Content root removed from body, remounting app...");
      app.unmount();
      mutationObserver.disconnect();
      mountApp(document, data);
    }
  });
  mutationObserver.observe(document, { childList: true, subtree: true });

  return { contentRoot, shadowRoot, appMountElement, app };
}
