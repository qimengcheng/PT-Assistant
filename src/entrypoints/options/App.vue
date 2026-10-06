<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useI18n } from "vue-i18n";
import { message } from "antdv-next";
import {
  BarChartOutlined,
  CloudUploadOutlined,
  DatabaseOutlined,
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
  ToolOutlined,
} from "@antdv-next/icons";

import { sendMessage } from "@/messages.ts";
import { antdLocaleMap } from "@/options/plugins/antd.ts";
import { i18nInstance } from "@/options/plugins/i18n.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { useConfigStore } from "@/options/stores/config.ts";
import ReleaseNoteDialog from "@/options/views/Layout/ReleaseNoteDialog.vue";

const version = browser.runtime.getManifest().version;
const route = useRoute();
const { t } = useI18n();
const runtimeStore = useRuntimeStore();
const configStore = useConfigStore();

// 版本更新弹窗：必须等 configStore hydrate 完成（$onReady）再比对版本，
// 否则首帧读到的是初始值会误判「每次都弹」。开启开关且记录版本 ≠ 当前版本时弹一次；
// 已读版本号的回写由 ReleaseNoteDialog 关闭时自行完成。
const showReleaseNoteDialog = ref<boolean>(false);
void configStore.$onReady(() => {
  if (configStore.showReleaseNoteOnVersionChange && configStore.version !== __EXT_VERSION__) {
    showReleaseNoteDialog.value = true;
  }
});

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

const navItems = computed(() => [
  { path: "/", label: t("layout.nav.home"), icon: HomeOutlined },
  { path: "/sites", label: t("layout.nav.sites"), icon: GlobalOutlined },
  { path: "/search", label: t("common.search"), icon: SearchOutlined },
  { path: "/my-data", label: t("route.Overview.MyData"), icon: BarChartOutlined },
  // /my-client 早就注册在 router.ts 里，页面也写完了，但此前只有「下载器」页那个 ⓘ
  // 按钮能跳过来（manageDownloader），左侧导航漏了这条 —— 文件在 ≠ 用户能看到。
  // 放在「我的数据」后面：两个「我的」页面相邻；下载器设置仍在下面 /set-downloader。
  { path: "/my-client", label: t("layout.nav.myClient"), icon: DatabaseOutlined },
  { path: "/search-result-snapshot", label: t("layout.nav.snapshot"), icon: FolderOpenOutlined },
  { path: "/download-history", label: t("route.Overview.DownloadHistory"), icon: HistoryOutlined },
  { path: "/keep-upload-task", label: t("route.Overview.KeepUploadTask"), icon: InboxOutlined },
  { path: "/media-server-entity", label: t("route.Overview.MediaServerEntity"), icon: PlaySquareOutlined },
  { path: "/set-backup", label: t("layout.nav.backup"), icon: CloudUploadOutlined },
  { path: "/set-downloader", label: t("layout.nav.downloader"), icon: DownloadOutlined },
  { path: "/set-media-server", label: t("layout.nav.mediaServer"), icon: PlayCircleOutlined },
  { path: "/set-base", label: t("layout.nav.basicSettings"), icon: SettingOutlined },
  // 「技术栈」不再进左侧导航（2026-10-06），路由 /technology-stack 保留，需要时直链进入。
  { path: "/special-thank", label: t("route.About.SpecialThank"), icon: TeamOutlined },
  { path: "/logger", label: t("layout.nav.logger"), icon: FileSearchOutlined },
  { path: "/debug/site-definitions", label: t("layout.nav.siteDefinitions"), icon: FileTextOutlined, dev: true },
  { path: "/debugger", label: t("route.Devtools.Debugger"), icon: ToolOutlined, dev: true },
]);

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
  <!-- Table.rowHoverBg：表格行悬停底色改成很淡的蓝（antd 默认是 colorFillAlterSolid≈#fafafa，
       而斑马纹的奇数行底色就是 #fafafa —— 悬停在奇数行上等于没反应）。
       #f0f7ff 比选中态 colorPrimaryBg #e6f4ff 浅一档，两态能分开。
       Table.headerBg：表头底色。antd 默认同样是 colorFillAlterSolid≈#fafafa，跟斑马纹的奇数行
       一个色 —— 表头和表体糊成一片，只有靠那条边框分隔。#eef2f7 是偏冷的蓝灰，和
       --pt-color-bg-content(#f5f6f8) / --pt-color-border-light(#eaeef2) 同一家族，比它们深一档，
       又能和白底偶数行、#fafafa 奇数行、#f0f7ff 悬停行四档都拉开。
       headerSortHoverBg / headerSortActiveBg 必须跟着改：这两档默认是 colorFillContentSolid /
       colorFillSecondarySolid（从白色容器算出来的**灰**实心色），底色换成蓝灰后它们会退色成
       另一套色板，点一下排序表头就看见色差。所以按 #eef2f7 往深各取一档。
       headerColor 没动：antd 默认 colorTextHeading(≈rgba(0,0,0,.88)) 在这个底色上对比足够。
       content 侧同值另配一份（见 src/content-script/app/App.vue）：那边的样式注入在
       shadow root 里，读不到这侧的 ConfigProvider。 -->
  <a-config-provider
    :locale="antdLocale"
    :theme="{
      token: { fontSize: 13 },
      components: {
        Table: {
          rowHoverBg: '#f0f7ff',
          headerBg: '#eef2f7',
          headerSortHoverBg: '#e4ebf3',
          headerSortActiveBg: '#dbe5f0',
        },
      },
    }"
  >
    <a-app>
      <a-layout class="shell">
        <a-layout-sider :width="220" theme="light" class="nav">
          <header class="brand">
            <img src="/icon/128.png" alt="logo" class="logo" />
            <div>
              <h1>PT Assistant</h1>
              <span class="version">v{{ version }} (WXT)</span>
            </div>
          </header>

          <nav class="menu">
            <!-- 导航项本体是 router-link 渲染的 <a>：整行可点，且保留
                 「ctrl/中键 → 新标签页打开」。所以不用 a-menu 的 @click 自己 push
                 —— 一旦改由菜单事件跳转，这两个修饰键点击就退化成静默无效。
                 选中态由 :selected-keys 受控，a-menu 不参与路由。 -->
            <a-menu mode="inline" :selected-keys="[activePath]">
              <a-menu-item v-for="item in navItems" :key="item.path">
                <router-link :to="item.path" class="nav-link">
                  <component :is="item.icon" style="font-size: 14px" />
                  <span>{{ item.label }}</span>
                  <a-tag v-if="item.dev" color="blue" style="margin-left: auto">{{ t("layout.nav.devTag") }}</a-tag>
                </router-link>
              </a-menu-item>
            </a-menu>
          </nav>

          <footer class="nav-footer">
            <span v-if="backgroundOk === true" class="status ok">● {{ t("layout.nav.backgroundOk") }}</span>
            <span v-else-if="backgroundOk === false" class="status bad">● {{ t("layout.nav.backgroundFailed") }}</span>
            <span v-else class="status">● {{ t("layout.nav.backgroundConnecting") }}</span>
          </footer>
        </a-layout-sider>

        <a-layout class="body">
          <a-layout-content class="content">
            <router-view v-slot="{ Component }">
              <KeepAlive :include="cachedViewNames" :max="10">
                <component :is="Component" />
              </KeepAlive>
            </router-view>
          </a-layout-content>
        </a-layout>
      </a-layout>

      <ReleaseNoteDialog v-model="showReleaseNoteDialog" />
    </a-app>
  </a-config-provider>
</template>