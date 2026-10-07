<script setup lang="ts">
import { computed, ref } from "vue";
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
 *
 * 快照从 v0.32.0 起是**累积档案**（只加不删，从 v0.1.0 一路排到最新），
 * 全铺开会把这一栏拉成几十屏，所以默认只出最新 PREVIEW_COUNT 个版本。
 * 条数不往这里抄：跑 `node scripts/check-recent-updates.mjs` 看它自己打印的那行。
 */
const updates = recentUpdates.versions;
const PREVIEW_COUNT = 10;
const showAllUpdates = ref(false);
const visibleUpdates = computed(() =>
  showAllUpdates.value ? updates : updates.slice(0, PREVIEW_COUNT),
);
const hasMoreUpdates = computed(() => updates.length > PREVIEW_COUNT);
const releasesUrl = `${REPO_URL}/releases`;
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
        <article v-for="u in visibleUpdates" :key="u.version" class="update">
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
            <!-- totals 大于数组长度时只报个数：那是这份档案里刻意省略掉的条目
                 （正常发版两个 Total 与数组长度相等，见 AGENTS.md §3.7） -->
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
      <!-- 快照是累积档案，默认只铺最新 10 个版本；这里用三条独立 v-if，
           不写 v-else 链 —— 中间插了这一段之后，链上的「否则」会挂到展开按钮那条判断上 -->
      <div v-if="hasMoreUpdates" class="updates-toggle">
        <a-button type="link" size="small" @click="showAllUpdates = !showAllUpdates">
          {{
            showAllUpdates
              ? t("HomeView.updatesCollapse", { recent: PREVIEW_COUNT })
              : t("HomeView.updatesExpandAll", { total: updates.length })
          }}
        </a-button>
      </div>
      <p v-if="!updates.length" class="updates-empty">{{ t("HomeView.updatesEmpty") }}</p>

      <p class="updates-note">
        {{ t("HomeView.updatesNote", { sha: recentUpdates.headSha, date: recentUpdates.generatedAt }) }}
      </p>
    </section>
  </div>
</template>

<style scoped>
/* 一列两行：hero 占内容高，最近更新吃掉剩余高度。
   右边那栏「功能模块」已于 2026-10-07 删掉 —— 九项全是 ✓，一栏只用来宣布「都做完了」
   没有信息量，还把它挤成窄列。
   列宽用 minmax(0,…) 是因为 grid 项默认 min-width:auto，不写 0 的话长文本会把这一列
   撑破而不是自己换行。 */
.home {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: auto 1fr;
  gap: 8px;
  /* 撑满一屏：内容不足一屏时，下半截不该露出整片灰底（第二行 1fr + align-items
     默认 stretch，面板自己滚） */
  min-height: 100%;
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

.updates-panel {
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

/* 展开/收起整行居中：它管的是下面那一整段历史，不是某一条记录 */
.updates-toggle {
  margin-top: 8px;
  text-align: center;
}

.updates-empty,
.updates-note {
  margin: 8px 0 0;
  color: var(--pt-color-text-secondary);
  font-size: 12px;
}
</style>
