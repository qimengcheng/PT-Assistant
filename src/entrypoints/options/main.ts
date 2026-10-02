import { createApp, markRaw } from "vue";
import VueKonva from "vue-konva";

import App from "./App.vue";

import { antdInstance } from "@/options/plugins/antd.ts";
import { piniaInstance } from "@/options/plugins/pinia.ts";
import { routerInstance } from "@/options/plugins/router.ts";
import { i18nInstance } from "@/options/plugins/i18n.ts";

import "./style.css";
import "./vuetify-compat.css";

// ⚠️ 必须 use(i18nInstance)（I18n 插件本体），不能 use(i18nInstance.global)（Composer）——
// 后者不会执行 install、__VUE_I18N_SYMBOL__ 挂不上 app，所有 useI18n() 的组件
// 会抛 ComposerErrorCodes.NOT_INSTALLED(27)，路由组件白屏（v0.4.0 备份页白屏的根因）。
const app = createApp(App);
app.use(piniaInstance).use(i18nInstance).use(routerInstance).use(antdInstance).use(VueKonva).mount("#app");

// DEBUG-PROBE: 临时插桩供无头探针定位搜索表格空数据问题（验证后移除）
(window as any).__pinia = piniaInstance;
(window as any).__vue = { markRaw };
(window as any).__lastErr = null;
app.config.errorHandler = (err) => {
  (window as any).__lastErr = String((err as Error)?.stack || err);
};