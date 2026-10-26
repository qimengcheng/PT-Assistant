/**
 * @zboson/ui（antdv-next 的 fork，2026-10-26 起用它）接入。
 *
 * 替换掉原先的 Vuetify。
 *
 * ⚠️ 必须用根入口导出的全量 `install`，不能用 `App`：
 *   antdv-next 的 `App` 是 `<a-app>` 那个 Provider 包装组件，
 *   它的 install 只做一件事 `app.component(App.name, App)` —— 只注册 `a-app` 一个，
 *   所有 a-table / a-card / a-modal / a-tag / a-config-provider 运行时都解析不到，
 *   只会 warn 并渲染成未知原生标签（页面看着像"完全没样式/是裸标签"）。
 *
 *   根入口的 `install` 会遍历 components_exports，对每个带 install 的组件调 app.use，
 *   组件自身的 name 是 "ACard" / "ATable" 这类，Vue 会同时接受 <ACard> 和 <a-card>。
 *
 * 样式走 CSS-in-JS（@antdv-next/cssinjs），运行时注入 <style>，没有 Vuetify 那种
 * 「构建期拆 CSS chunk + 动态 <link> 注入」的链路 —— 后者在扩展页里加载并不可靠
 * （表现为页面完全没有表格样式）。
 *
 * 这条只针对**构建期 CSS chunk**，别顺延成「antd 不能拆」：`wxt.config.ts` 的
 * `ptd-vendor-chunk` 拆的是 JS 模块，产物之间是普通静态 import，样式仍由运行时注入，
 * 与上面那条失效链路无关。
 */
import { install } from "@zboson/ui";
import zhCN from "@zboson/ui/locale/zh_CN";
import enUS from "@zboson/ui/locale/en_US";

import { type TLangCode } from "./i18n.ts";

/** app.use(antdInstance) 会把全部 a-* 组件注册到全局 */
export const antdInstance = { install };

/** 与项目自身的 i18n 语言码对齐 */
export const antdLocaleMap: Record<TLangCode, typeof zhCN> = {
  en: enUS,
  zh_CN: zhCN,
};