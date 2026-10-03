<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { message } from "antdv-next";
import {
  AppstoreOutlined,
  BarChartOutlined,
  CloudUploadOutlined,
  DownloadOutlined,
  FileSearchOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  GlobalOutlined,
  HistoryOutlined,
  HomeOutlined,
  InboxOutlined,
  PlayCircleOutlined,
  PlaySquareOutlined,
  SearchOutlined,
  SettingOutlined,
  TeamOutlined,
} from "@antdv-next/icons";

import { sendMessage } from "@/messages.ts";
import { antdLocaleMap } from "@/options/plugins/antd.ts";
import { i18nInstance } from "@/options/plugins/i18n.ts";
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
  { path: "/", label: "首页", icon: HomeOutlined },
  { path: "/sites", label: "站点管理", icon: GlobalOutlined },
  { path: "/search", label: "搜索", icon: SearchOutlined },
  { path: "/my-data", label: "我的数据", icon: BarChartOutlined },
  { path: "/search-result-snapshot", label: "搜索快照", icon: FolderOpenOutlined },
  { path: "/download-history", label: "下载历史", icon: HistoryOutlined },
  { path: "/keep-upload-task", label: "辅种任务", icon: InboxOutlined },
  { path: "/media-server-entity", label: "媒体库", icon: PlaySquareOutlined },
  { path: "/set-backup", label: "数据备份", icon: CloudUploadOutlined },
  { path: "/set-downloader", label: "下载器", icon: DownloadOutlined },
  { path: "/set-media-server", label: "媒体服务器", icon: PlayCircleOutlined },
  { path: "/set-base", label: "基础设置", icon: SettingOutlined },
  { path: "/technology-stack", label: "技术栈", icon: AppstoreOutlined },
  { path: "/special-thank", label: "特别感谢", icon: TeamOutlined },
  { path: "/logger", label: "运行日志", icon: FileSearchOutlined },
  { path: "/debug/site-definitions", label: "站点定义", icon: FileTextOutlined, dev: true },
];

/**
 * 需要缓存的路由组件名，对应各 Index.vue 里的 defineOptions({ name })。
 * 这两个页面都持有大量本地状态（搜索队列、用户信息表、周期刷新定时器），
 * 每次切换都销毁重建会导致切页明显变慢。
 */
const cachedViewNames = ["SearchEntity", "MyData"];

const activePath = computed(() => route.path);

// ============================================================================
// 全局提示条：各页面 runtimeStore.showSnakebar() 的出口。
// 原先是 Vuetify 的 <v-snackbar-queue>；现在桥接到 antdv-next 的 message API，
// 保证所有既有调用点（showSnakebar(text, {color})）无需改动。
// ============================================================================
watch(
  () => runtimeStore.uiGlobalSnakebar.length,
  () => {
    while (runtimeStore.uiGlobalSnakebar.length > 0) {
      const item = runtimeStore.uiGlobalSnakebar.shift()!;
      const text = String((item as { text: string }).text ?? "");
      const color = (item as { color?: string }).color ?? "info";
      const timeout = typeof (item as { timeout?: number }).timeout === "number" ? (item as { timeout: number }).timeout : 3;

      const payload = { content: text, duration: timeout > 0 ? timeout : 0 };
      if (color === "success") message.success(payload);
      else if (color === "warning") message.warning(payload);
      else if (color === "error") message.error(payload);
      else message.info(payload);
    }
  },
);

// antdv-next 的 locale 跟随项目自身的 i18n 语言
const antdLocale = computed(() => antdLocaleMap[i18nInstance.global.locale.value as "zh_CN" | "en"]);
</script>

<template>
  <a-config-provider :locale="antdLocale" :theme="{ token: { fontSize: 13 } }">
    <a-app>
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
            <router-link
              v-for="item in navItems"
              :key="item.path"
              :to="item.path"
              class="menu-item"
              :class="{ active: activePath === item.path }"
            >
              <component :is="item.icon" style="font-size: 14px" />
              <span>{{ item.label }}</span>
              <a-tag v-if="item.dev" color="blue" style="margin-left: auto">调试</a-tag>
            </router-link>
          </nav>

          <footer class="nav-footer">
            <span v-if="backgroundOk === true" class="status ok">● background 正常</span>
            <span v-else-if="backgroundOk === false" class="status bad">● background 未响应</span>
            <span v-else class="status">● 正在连接 background…</span>
          </footer>
        </aside>

        <main class="content">
          <router-view v-slot="{ Component }">
            <KeepAlive :include="cachedViewNames" :max="10">
              <component :is="Component" />
            </KeepAlive>
          </router-view>
        </main>
      </div>
    </a-app>
  </a-config-provider>
</template>