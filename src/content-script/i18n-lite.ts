/**
 * content script 侧的**精简语言包**注册（与 antd-lite.ts 对称）。
 *
 * 背景：i18n 单例（@/options/plugins/i18n.ts）不再静态携带消息，由各入口自行注册
 * （见该文件注释）。本模块是 content-app 入口的消息来源：
 *
 * - 从 content import 闭包（src/entrypoints/content-app.ts → init.ts，76 个文件）里
 *   扫描出全部 i18n 调用，只涉及 6 个顶层命名空间，无动态拼接 key；
 * - 通过 JSON **具名导入**拿这 6 个命名空间，rollup 生产构建会把 JSON 转成具名
 *   exports 并 tree-shake 掉其余部分（约 84% 的语言包不进 content chunk）；
 * - 整命名空间保留（不逐叶子 key 裁剪），对「按数据拼 key」之类扫描不到的用法留有余量。
 *
 * 维护：content 闭包新增 t() 调用且落在新的顶层命名空间时，把该命名空间补进下方
 * 两处具名导入与 liteMessages；漏了的表现是页面显示 raw key。
 * 可临时改 scripts 扫描闭包里的顶层命名空间集合做复核。
 */
import { mergeLocaleMessages, type TLangCode } from "@/options/plugins/i18n.ts";

import {
  SearchEntity as enSearchEntity,
  SentToDownloaderDialog as enSentToDownloaderDialog,
  common as enCommon,
  contentScript as enContentScript,
  downloaderLabel as enDownloaderLabel,
  layout as enLayout,
} from "~/locales/en.json";

import {
  SearchEntity as zhCNSearchEntity,
  SentToDownloaderDialog as zhCNSentToDownloaderDialog,
  common as zhCNCommon,
  contentScript as zhCNContentScript,
  downloaderLabel as zhCNDownloaderLabel,
  layout as zhCNLayout,
} from "~/locales/zh_CN.json";

const liteMessages: Record<TLangCode, Record<string, unknown>> = {
  en: {
    SearchEntity: enSearchEntity,
    SentToDownloaderDialog: enSentToDownloaderDialog,
    common: enCommon,
    contentScript: enContentScript,
    downloaderLabel: enDownloaderLabel,
    layout: enLayout,
  },
  zh_CN: {
    SearchEntity: zhCNSearchEntity,
    SentToDownloaderDialog: zhCNSentToDownloaderDialog,
    common: zhCNCommon,
    contentScript: zhCNContentScript,
    downloaderLabel: zhCNDownloaderLabel,
    layout: zhCNLayout,
  },
};

// 模块副作用：import 本文件即完成注册（必须在 mountApp 之前执行，ES import 顺序保证）
for (const [locale, messages] of Object.entries(liteMessages) as [TLangCode, Record<string, unknown>][]) {
  mergeLocaleMessages(locale, messages);
}
