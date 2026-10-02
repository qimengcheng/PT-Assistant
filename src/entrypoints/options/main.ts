import { createApp } from "vue";

import App from "./App.vue";

import { vuetifyInstance } from "@/options/plugins/vuetify.ts";
import { piniaInstance } from "@/options/plugins/pinia.ts";
import { routerInstance } from "@/options/plugins/router.ts";
import { i18n } from "@/options/plugins/i18n.ts";

import "./style.css";

createApp(App).use(piniaInstance).use(i18n as any).use(routerInstance).use(vuetifyInstance).mount("#app");
