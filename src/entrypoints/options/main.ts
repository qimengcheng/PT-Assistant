import { createApp } from "vue";

import App from "./App.vue";

import { vuetifyInstance } from "@/options/plugins/vuetify.ts";
import { piniaInstance } from "@/options/plugins/pinia.ts";
import { routerInstance } from "@/options/plugins/router.ts";
import { i18nInstance } from "@/options/plugins/i18n.ts";

import "./style.css";

// ⚠️ 必须 use(i18nInstance)（I18n 插件本体），不能 use(i18nInstance.global)（Composer）——
// 后者不会执行 install、__VUE_I18N_SYMBOL__ 挂不上 app，所有 useI18n() 的组件
// 会抛 ComposerErrorCodes.NOT_INSTALLED(27)，路由组件白屏（v0.4.0 备份页白屏的根因）。
createApp(App).use(piniaInstance).use(i18nInstance).use(routerInstance).use(vuetifyInstance).mount("#app");
