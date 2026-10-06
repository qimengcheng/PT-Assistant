import { createI18n } from "vue-i18n";

export type TLangCode = "en" | "zh_CN";

interface ILangMetaData {
  title: string;
  value: TLangCode;
}

/**
 * 由于 Vue-i18n v11 在 CSP 环境中无法进行编译操作，所以所有语言文件需要预注册，
 * 不然不会在插件页面显示，也不能实现像 v1.x 中的”临时添加新语言功能“
 */
export const definedLangMetaData: readonly ILangMetaData[] = [
  {
    title: "English (Beta)",
    value: "en",
  },
  {
    title: "简体中文 Chinese (Simplified)",
    value: "zh_CN",
  },
] as const;

/**
 * 消息**不**在 createI18n 时静态注册：
 * - options 入口（entrypoints/options/main.ts）注册全量 en/zh_CN；
 * - content-script 入口（content-script/i18n-lite.ts）只注册实际用到的 6 个命名空间。
 * 若在此静态 import 两份 ~60KB 的 JSON，任何复用本单例的 chunk（含每个站点都注入的
 * content-app）都会被整体拖入全量语言包。
 */
export const i18nInstance = createI18n({
  legacy: false, // you must set `false`, to use Composition API
  locale: "zh_CN",
  fallbackLocale: "en",
  messages: {},
});

/** 增量合并注册某语种消息（mergeLocaleMessage 在 global Composer 上，I18n 实例只代理 get/set） */
export function mergeLocaleMessages(locale: TLangCode, messages: Record<string, unknown>) {
  i18nInstance.global.mergeLocaleMessage(locale, messages as never);
}

export const i18n = i18nInstance.global;
