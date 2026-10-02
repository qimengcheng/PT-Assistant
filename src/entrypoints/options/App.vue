<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";

import { sendMessage } from "@/messages.ts";

const version = browser.runtime.getManifest().version;
const route = useRoute();

const backgroundOk = ref<boolean | null>(null);

onMounted(async () => {
  try {
    const pong = await sendMessage("ping", null);
    backgroundOk.value = pong.definitionCount > 0;
  } catch {
    backgroundOk.value = false;
  }
});

const navItems = [
  { path: "/", label: "首页", icon: "mdi-home" },
  { path: "/sites", label: "站点管理", icon: "mdi-web" },
  { path: "/search", label: "搜索", icon: "mdi-magnify" },
  { path: "/set-backup", label: "数据备份", icon: "mdi-backup-restore" },
  { path: "/debug/site-definitions", label: "站点定义", icon: "mdi-file-tree", dev: true },
];

const activePath = computed(() => route.path);
</script>

<template>
  <v-app class="shell">
    <v-navigation-drawer permanent class="nav">
      <header class="brand">
        <img src="/icon/128.png" alt="logo" class="logo" />
        <div>
          <h1 class="text-subtitle-1 font-weight-bold">PT Assistant</h1>
          <span class="text-caption text-medium-emphasis">v{{ version }} (WXT)</span>
        </div>
      </header>

      <v-divider />

      <v-list nav>
        <v-list-item
          v-for="item in navItems"
          :key="item.path"
          :to="item.path"
          :title="item.label"
          :prepend-icon="item.icon"
          :active="activePath === item.path"
        >
          <template v-if="item.dev" #append>
            <v-chip size="x-small" color="info" label>调试</v-chip>
          </template>
        </v-list-item>
      </v-list>

      <template #append>
        <div class="nav-footer">
          <span v-if="backgroundOk === true" class="status ok">● background 正常</span>
          <span v-else-if="backgroundOk === false" class="status bad">● background 未响应</span>
          <span v-else class="status">● 正在连接 background…</span>
        </div>
      </template>
    </v-navigation-drawer>

    <v-main class="content">
      <router-view />
    </v-main>
  </v-app>
</template>
