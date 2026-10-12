import { createApp, watchEffect } from "vue";

import App from "./App.vue";

import { antdInstance } from "@/options/plugins/antd.ts";
import { piniaInstance } from "@/options/plugins/pinia.ts";
import { routerInstance } from "@/options/plugins/router.ts";
import { i18nInstance, mergeLocaleMessages } from "@/options/plugins/i18n.ts";
import { useConfigStore } from "@/options/stores/config.ts";
import { installConsoleLogGate } from "@/shared/consoleLog.ts";

// options 页面注册全量语言包（消息与 i18n 单例解耦，见 plugins/i18n.ts）
import en from "~/locales/en.json";
import zh_CN from "~/locales/zh_CN.json";
mergeLocaleMessages("en", en);
mergeLocaleMessages("zh_CN", zh_CN);

// 控制台日志总闸：必须早于第一个 store 实例化 —— pinia 持久化插件那句
// `Restoring state for key: config from storage: local` 就是在 store 创建时打的，
// 晚一步装就等于漏掉用户截图里最吵的那一条。
installConsoleLogGate();

import "./style.css";
import "./vuetify-compat.css";

// ⚠️ 必须 use(i18nInstance)（I18n 插件本体），不能 use(i18nInstance.global)（Composer）——
// 后者不会执行 install、__VUE_I18N_SYMBOL__ 挂不上 app，所有 useI18n() 的组件
// 会抛 ComposerErrorCodes.NOT_INSTALLED(27)，路由组件白屏（v0.4.0 备份页白屏的根因）。
const app = createApp(App);
app.use(piniaInstance).use(i18nInstance).use(routerInstance).use(antdInstance).mount("#app");

// 界面语言跟随配置：config.lang 是唯一真源，createI18n 里的 "zh_CN" 只是占位初值。
// 不接上这段的话，设置页的「界面语言」下拉框改了没有任何效果。
// 用 $onReady 等水合完成再开始 watch，避免首帧先渲染成默认语言再跳一次。
// App.vue 的 antdLocale 是 computed(() => i18nInstance.global.locale.value)，antd 组件库会一并跟随。
void useConfigStore().$onReady(() => {
  watchEffect(() => {
    i18nInstance.global.locale.value = useConfigStore().lang;
  });
});