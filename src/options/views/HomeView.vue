<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { definitionList } from "@ptd/site";

const { t } = useI18n();

// 本组件是 router-view 直接渲染的路由页，没有调用方可以传 props，所以版本与站点数在组件内自取。
// （骨架阶段把 version / definitionCount 声明成了 props，一直没人传值，
//   于是首页两张卡恒显示成空的 "v" 和 "…"。）
const version = browser.runtime.getManifest().version;
const definitionCount = definitionList.length;

// 功能模块状态（随 Roadmap 平移逐个点亮）
// 注意：状态必须与代码实装保持一致，不要凭记忆标注——
// 下载器（SetDownloader + SentToDownloaderDialog 推送）、content script（悬浮入口 +
// 站点/社交页解析）、媒体服务器（SetMediaServer 配置 + MediaServerEntity 库浏览）
// 均已实装，曾长期误标 todo。新增条目时同步更新。
const modules = computed<{ name: string; status: "ok" | "todo" }[]>(() => [
  { name: t("HomeView.modules.siteDefinitions", [definitionCount]), status: "ok" as const },
  { name: t("HomeView.modules.messageLayer"), status: "ok" as const },
  { name: t("HomeView.modules.siteManage"), status: "ok" as const },
  { name: t("HomeView.modules.multiSiteSearch"), status: "ok" as const },
  { name: t("HomeView.modules.myData"), status: "ok" as const },
  { name: t("HomeView.modules.backup"), status: "ok" as const },
  { name: t("HomeView.modules.downloader"), status: "ok" as const },
  { name: t("HomeView.modules.contentScript"), status: "ok" as const },
  { name: t("HomeView.modules.mediaServer"), status: "ok" as const },
]);
</script>

<template>
  <div class="home">
    <h2>{{ t("HomeView.welcome") }}</h2>
    <p class="sub">{{ t("HomeView.subtitle") }}</p>

    <a-row :gutter="[12, 12]" style="margin-bottom: 24px">
      <a-col :span="8">
        <a-card size="small">
          <a-statistic :title="t('common.version')" :value="'v' + version" />
        </a-card>
      </a-col>
      <a-col :span="16">
        <a-card size="small">
          <a-statistic
            :title="t('HomeView.siteDefinitionsCard')"
            :value="definitionCount"
            :suffix="t('HomeView.siteDefinitionsUnit')"
          />
        </a-card>
      </a-col>
    </a-row>

    <h3>{{ t("HomeView.modulesTitle") }}</h3>
    <!--
      原来写的是 <a-list>/<a-list-item>：antdv-next 1.5.6 没有这两个组件（根入口只有虚拟滚动的
      `Listy`），未注册的标签会被当成原生未知元素，而带命名插槽（#extra）时 children 是对象、
      原生元素分支只吃数组 —— 整栏渲染成空白。
      另一方面 style.css 里 `.modules` / `.dot` / `.pending` / `.pending-tag` 一套样式早就写好了
      （带边框卡片 + li 分隔线），却没有任何组件在用：迁移时把 <ul class="modules"> 换成了 a-list，
      样式与结构就此错位。这里按样式的原始约定改回 ul/li。
    -->
    <ul class="modules">
      <li v-for="m in modules" :key="m.name">
        <span class="dot" :class="m.status">{{ m.status === "ok" ? "✓" : "…" }}</span>
        <span :class="{ pending: m.status === 'todo' }">{{ m.name }}</span>
        <span v-if="m.status === 'todo'" class="pending-tag">{{ t("HomeView.pending") }}</span>
      </li>
    </ul>
  </div>
</template>