import { createApp } from "vue";

import App from "./App.vue";

import { piniaInstance } from "@/options/plugins/pinia.ts";
import { i18n } from "@/options/plugins/i18n.ts";
// 注册站点服务的消息处理器（getSiteUserConfig 等，运行在页面上下文）
import "@/options/services/site.ts";

import "./style.css";

createApp(App).use(piniaInstance).use(i18n as any).mount("#app");
