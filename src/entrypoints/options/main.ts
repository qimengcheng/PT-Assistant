import { createApp } from "vue";

import App from "./App.vue";

// ⚠️ Vuetify 主题变量（--v-theme-primary / hover·activated 透明度等）默认靠页面运行时
// 注入 <style id="vuetify-theme-stylesheet">，注入一旦被环境吞掉，hover/激活层的
// currentColor 透明度会回退为 1，表现为侧栏选中/悬浮纯黑块（v0.4.4 用户实报）。
// 这里把运行时注入的样式表原样静态打包一份兜底，与注入内容一致、重复定义无害。
import "../../styles/vuetify/theme-variables.css";

import { vuetifyInstance } from "@/options/plugins/vuetify.ts";
import { piniaInstance } from "@/options/plugins/pinia.ts";
import { routerInstance } from "@/options/plugins/router.ts";
import { i18nInstance } from "@/options/plugins/i18n.ts";

import "./style.css";

// ⚠️ 必须 use(i18nInstance)（I18n 插件本体），不能 use(i18nInstance.global)（Composer）——
// 后者不会执行 install、__VUE_I18N_SYMBOL__ 挂不上 app，所有 useI18n() 的组件
// 会抛 ComposerErrorCodes.NOT_INSTALLED(27)，路由组件白屏（v0.4.0 备份页白屏的根因）。
createApp(App).use(piniaInstance).use(i18nInstance).use(routerInstance).use(vuetifyInstance).mount("#app");
