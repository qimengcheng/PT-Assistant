<script setup lang="ts">
import { onMounted, ref } from "vue";

import { sendMessage } from "@/messages.ts";

import HomeView from "./HomeView.vue";
import SiteDefinitions from "./SiteDefinitions.vue";
import SiteManageView from "./SiteManageView.vue";

type TView = "home" | "site-manage" | "site-definitions";

const version = browser.runtime.getManifest().version;

const activeView = ref<TView>("home");

const definitionCount = ref<number | null>(null);
const backgroundOk = ref<boolean | null>(null);

onMounted(async () => {
  try {
    const pong = await sendMessage("ping", null);
    definitionCount.value = pong.definitionCount;
    backgroundOk.value = true;
  } catch {
    backgroundOk.value = false;
  }
});

const navItems: Array<{ key: TView; label: string; dev?: boolean }> = [
  { key: "home", label: "首页" },
  { key: "site-manage", label: "站点管理" },
  { key: "site-definitions", label: "站点定义", dev: true },
];
</script>

<template>
  <div class="shell">
    <aside class="nav">
      <header class="brand">
        <img src="/icon/128.png" alt="logo" class="logo" />
        <div>
          <h1>PT Assistant</h1>
          <span class="version">v{{ version }} (WXT)</span>
        </div>
      </header>

      <nav class="menu">
        <button
          v-for="item in navItems"
          :key="item.key"
          class="menu-item"
          :class="{ active: activeView === item.key }"
          @click="activeView = item.key"
        >
          {{ item.label }}
          <span v-if="item.dev" class="badge">开发调试</span>
        </button>
      </nav>

      <footer class="nav-footer">
        <span v-if="backgroundOk === true" class="status ok">● background 正常</span>
        <span v-else-if="backgroundOk === false" class="status bad">● background 未响应</span>
        <span v-else class="status">● 正在连接 background…</span>
      </footer>
    </aside>

    <main class="content">
      <HomeView v-if="activeView === 'home'" :version="version" :definition-count="definitionCount" />
      <SiteManageView v-else-if="activeView === 'site-manage'" />
      <SiteDefinitions v-else />
    </main>
  </div>
</template>
