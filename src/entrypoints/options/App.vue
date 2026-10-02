<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";

import { sendMessage } from "@/messages.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";

const version = browser.runtime.getManifest().version;
const route = useRoute();
const runtimeStore = useRuntimeStore();

const backgroundOk = ref<boolean | null>(null);

onMounted(async () => {
  // SW 冷启动（module SW 加载 + offscreen 创建）实测约 3s，一次性 ping 会撞上启动窗口误报「未响应」，
  // 因此带重试：成功或拿到 definitionCount>0 即终止，全部失败才判定为未响应
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const pong = await sendMessage("ping", null);
      if (pong.definitionCount > 0) {
        backgroundOk.value = true;
        return;
      }
      backgroundOk.value = false;
    } catch {
      backgroundOk.value = false;
    }
    await new Promise((r) => setTimeout(r, 1500));
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

    <!-- 全局提示条：各页面 runtimeStore.showSnakebar() 的渲染出口（漏挂时所有成功/失败提示都不可见） -->
    <v-snackbar-queue v-model="runtimeStore.uiGlobalSnakebar" closable />
  </v-app>
</template>
