<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { definitionList } from "@ptd/site";

import { REPO_URL } from "~/helper.ts";
import recentUpdates from "@/options/data/recentUpdates.json";

const { t } = useI18n();

// 本组件是 router-view 直接渲染的路由页，没有调用方可以传 props，所以版本与站点数在组件内自取。
// （骨架阶段把 version / definitionCount 声明成了 props，一直没人传值，
//   于是首页两张卡恒显示成空的 "v" 和 "…"。）
const version = browser.runtime.getManifest().version;
const definitionCount = definitionList.length;

/**
 * 「最近更新」读的是入库快照 `src/options/data/recentUpdates.json`。
 * ⚠️ 这份文案**由 agent 读提交历史手写，不用脚本生成**：脚本只能搬运提交标题，
 * 那是写给仓库读者的内部口吻（「表体高度被自己的公式冻住」「contain 只给真滚得动的面板」），
 * 用户读不出跟自己有什么关系。规矩见 AGENTS.md §3.7。
 * 也不在运行时拉 GitHub Release：那要多一条 host 权限、断网就成空面板，
 * 而 Release 正文同样是给仓库读者看的 Markdown。
 */
const updates = recentUpdates.versions;
const releasesUrl = `${REPO_URL}/releases`;

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
    <!-- 白表面一律复用全局 .page-panel（与 9 个列表页同一档：白底 + 浅边框 + 10px 圆角），
         这里只加各自的内衬与排布，不再抄一份背景/边框。 -->
    <section class="page-panel hero">
      <div class="hero-text">
        <h2>{{ t("HomeView.welcome") }}</h2>
        <p class="sub">{{ t("HomeView.subtitle") }}</p>
      </div>
      <div class="hero-stats">
        <a-statistic :title="t('common.version')" :value="'v' + version" />
        <a-divider type="vertical" class="stat-divider" />
        <a-statistic
          :title="t('HomeView.siteDefinitionsCard')"
          :value="definitionCount"
          :suffix="t('HomeView.siteDefinitionsUnit')"
        />
      </div>
    </section>

    <section class="page-panel updates-panel">
      <header class="panel-head">
        <h3>{{ t("HomeView.updatesTitle") }}</h3>
        <a class="panel-more" :href="releasesUrl" rel="noopener noreferrer nofollow" target="_blank">
          {{ t("HomeView.releasesLink") }}
        </a>
      </header>

      <div v-if="updates.length" class="updates">
        <article v-for="u in updates" :key="u.version" class="update">
          <div class="update-head">
            <a-tag color="processing">v{{ u.version }}</a-tag>
            <span class="update-date">{{ u.date }}</span>
          </div>
          <ul class="update-list">
            <li v-for="(line, i) in u.added" :key="`a${i}`">
              <span class="kind kind-added">{{ t("HomeView.kindAdded") }}</span>
              <span class="line">{{ line }}</span>
            </li>
            <li v-for="(line, i) in u.improved" :key="`i${i}`">
              <span class="kind kind-improved">{{ t("HomeView.kindImproved") }}</span>
              <span class="line">{{ line }}</span>
            </li>
            <!-- 快照每桶最多列 MAX 条，剩下的只报个数（完整清单在 Releases 页） -->
            <li v-if="u.addedTotal + u.improvedTotal > u.added.length + u.improved.length" class="update-more">
              {{
                t("HomeView.moreItems", {
                  n: u.addedTotal + u.improvedTotal - u.added.length - u.improved.length,
                })
              }}
            </li>
          </ul>
        </article>
      </div>
      <p v-else class="updates-empty">{{ t("HomeView.updatesEmpty") }}</p>

      <p class="updates-note">
        {{ t("HomeView.updatesNote", { sha: recentUpdates.headSha, date: recentUpdates.generatedAt }) }}
      </p>
    </section>

    <section class="page-panel modules-panel">
      <header class="panel-head">
        <h3>{{ t("HomeView.modulesTitle") }}</h3>
      </header>
      <ul class="modules">
        <li v-for="m in modules" :key="m.name">
          <span class="dot" :class="m.status">{{ m.status === "ok" ? "✓" : "…" }}</span>
          <span :class="{ pending: m.status === 'todo' }">{{ m.name }}</span>
          <span v-if="m.status === 'todo'" class="pending-tag">{{ t("HomeView.pending") }}</span>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
/* 两列：最近更新占大头，功能模块窄列；窄窗口（options 是独立窗口，能拖到 600px）
   退回单列。列宽用 minmax(0,…) 是因为 grid 项默认 min-width:auto，
   不写 0 的话长文本会把这一列撑破而不是自己换行。 */
.home {
  display: grid;
  grid-template-columns: minmax(0, 1.7fr) minmax(0, 1fr);
  grid-template-rows: auto 1fr;
  grid-template-areas:
    "hero hero"
    "updates modules";
  gap: 8px;
  /* 撑满一屏：内容不足一屏时，下半截不该露出整片灰底（第二行的两块面板靠 1fr
     分到剩余高度，align-items 默认 stretch，两块一样高） */
  min-height: 100%;
}
.hero {
  grid-area: hero;
}
.updates-panel {
  grid-area: updates;
}
.modules-panel {
  grid-area: modules;
}
@media (max-width: 900px) {
  .home {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      "hero"
      "updates"
      "modules";
  }
}

.hero {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 18px;
}
.hero-text h2 {
  margin: 0 0 4px;
  font-size: 20px;
}
.hero-text .sub {
  margin: 0;
  color: var(--pt-color-text-secondary);
}
.hero-stats {
  display: flex;
  align-items: center;
  gap: 20px;
}
.stat-divider {
  height: 40px;
  margin: 0;
}

.updates-panel,
.modules-panel {
  padding: 12px 14px;
}
.panel-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}
.panel-head h3 {
  margin: 0;
  font-size: 14px;
}
.panel-more {
  font-size: 12px;
  white-space: nowrap;
}

.update + .update {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--pt-color-border-light);
}
.update-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.update-date {
  color: var(--pt-color-text-secondary);
  font-size: 12px;
}
.update-list {
  list-style: none;
  margin: 6px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.update-list li {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  line-height: 1.5;
}
/* 类型标签：新增 / 优化两色，跟 a-tag 的 processing 蓝错开，避免一行里三种蓝 */
.kind {
  flex: none;
  padding: 0 6px;
  border-radius: 4px;
  font-size: 11px;
  line-height: 18px;
}
.kind-added {
  background: #f6ffed;
  color: #389e0d;
}
.kind-improved {
  background: #f5f5f5;
  color: rgba(0, 0, 0, 0.65);
}
.line {
  min-width: 0;
  overflow-wrap: anywhere;
}
.update-more {
  color: var(--pt-color-text-secondary);
  font-size: 12px;
}

.updates-empty,
.updates-note {
  margin: 8px 0 0;
  color: var(--pt-color-text-secondary);
  font-size: 12px;
}

/* 模块清单：去掉了外框（面板本身就是白表面），只留行分隔线 */
.modules {
  list-style: none;
  margin: 0;
  padding: 0;
}
.modules li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  line-height: 1.4;
}
.modules li + li {
  border-top: 1px solid var(--pt-color-border-light);
}
.dot {
  flex: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
}
.dot.ok {
  background: var(--pt-color-success-bg, #f6ffed);
  color: var(--pt-color-success, #52c41a);
}
.dot.todo {
  background: var(--pt-color-disabled-bg, #f5f5f5);
  color: var(--pt-color-disabled, #bfbfbf);
}
.pending {
  color: var(--pt-color-text-secondary);
}
.pending-tag {
  margin-left: auto;
  padding: 0 6px;
  border-radius: 4px;
  background: var(--pt-color-disabled-bg, #f5f5f5);
  color: var(--pt-color-disabled, #bfbfbf);
  font-size: 11px;
}
</style>
