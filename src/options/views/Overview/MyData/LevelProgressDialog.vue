<script setup lang="ts">
/**
 * 升级进度：把「每个站点对等级各有叫法」这件事折成一条可以横向比的阶梯。
 *
 * 阶梯本身只画圆点，不写等级名 —— 实测（.tmp-build/bench-steps）256 个带等级表的站点里
 * 中位数 9 级、最长 24 级，圆点每颗最少占 32px，900px 的可用宽刚好排到 28 颗；而等级名
 * 一旦挂上去，18 级时名称就被折成两三行，整行从 39px 涨到 60~81px。所以名字走左边那一列
 * 与「第 N / M 级」那句话，每级的完整要求走展开后的纵向阶梯。
 *
 * 达标与否一律用 packages/site 的判据（差哪几项由它给），本文件不参与判定；
 * 「谁离下一级更近」的排序规则在 `@/shared/levelProgress.ts`。
 */
import { computed, h, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { computedAsync } from "@vueuse/core";
import { DownOutlined, UpOutlined } from "@antdv-next/icons";
import type { ILevelRequirement, TSiteID } from "@ptd/site";

import SiteFavicon from "@/options/components/SiteFavicon/Index.vue";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import { compareLevelProgress, type TLevelProgressState } from "@/shared/levelProgress.ts";

import { tableData } from "./utils/lastUserData.ts";
import { allAddedSiteMetadata } from "./utils/siteMetadata.ts";
import { buildLevelProgressRow, buildCurrentValues, type ILevelProgressRow } from "./utils/levelProgressData.ts";
import UserLevelsComponent from "./UserLevelsComponent.vue";
import UserNextLevelUnMet from "./UserNextLevelUnMet.vue";

const showDialog = defineModel<boolean>();

const { t } = useI18n();
const metadataStore = useMetadataStore();

const sortBy = ref<"nearest" | "siteName">("nearest");
const expandedSites = ref<Set<TSiteID>>(new Set());

/**
 * 等级表来自站点定义（本地数据，但要动态 import 才拿得到），所以是异步派生：
 * 走 computedAsync 而不是「打开时命令式拉一遍」—— 挂载钩子里读 store 会赶上水合未完成的窗口，
 * 首屏空着且不报错（AGENTS §3.4 防线⑤那条）。
 */
const isLoadingRequirements = ref(false);
const requirementsMap = computedAsync<Record<string, ILevelRequirement[]>>(
  async () => {
    if (!showDialog.value) return {};
    const siteIds = tableData.value.map((row) => row.site);
    const entries = await Promise.all(
      siteIds.map(async (siteId) => [siteId, await metadataStore.getSiteMergedMetadata(siteId, "levelRequirements", [])] as const),
    );
    return Object.fromEntries(entries) as Record<string, ILevelRequirement[]>;
  },
  {},
  isLoadingRequirements,
);

const rows = computed<ILevelProgressRow[]>(() =>
  tableData.value.map((userInfo) =>
    buildLevelProgressRow(
      userInfo,
      requirementsMap.value[userInfo.site] ?? [],
      allAddedSiteMetadata[userInfo.site]?.siteName ?? userInfo.site,
    ),
  ),
);

const sortedRows = computed(() => {
  const list = [...rows.value];
  if (sortBy.value === "siteName") {
    return list.sort((a, b) => a.siteName.localeCompare(b.siteName));
  }
  // 判据并列时按站点名兜底，否则同一份数据每次打开排出来的顺序可能不一样
  return list.sort((a, b) => compareLevelProgress(a, b) || a.siteName.localeCompare(b.siteName));
});

/** 还有得升的那些才是这张表要说话的对象 */
const rankableCount = computed(() => rows.value.filter((row) => row.state === "rankable").length);

const isBusy = computed(() => showDialog.value && isLoadingRequirements.value);

function levelNameOf(row: ILevelProgressRow, index: number): string {
  return row.ladder[index]?.name ?? "-";
}

/** 圆点阶梯：点亮到「当前级」，下一颗由 a-steps 自己标成进行中 */
function dotItems(row: ILevelProgressRow) {
  return row.ladder.map(() => ({}));
}

/**
 * 「当前值」那张悬浮卡，只挂在下一级那一行的**左边**（用户 2026-10-12 第二次指明：
 * 「都说了放左边悬浮着，你放这里好难看啊」—— 上一版把它并排塞在需求值左侧，占了正文宽度）。
 * 定位见下面 `.lp-current` 那条：绝对定位到 `.lp-detail-line` 的左外侧，所以它不吃表体宽度、
 * 也不把那一行撑高。
 *
 * 一项都对不上时整块不出（该级只要求入站时长，或这些字段站点压根没报数），不留一个空壳。
 */
function currentValuesChip(row: ILevelProgressRow, level: ILevelRequirement) {
  const values = buildCurrentValues(row.userInfo, level);
  if (Object.keys(values).length === 0) return null;
  return h("div", { class: "lp-current" }, [
    h("div", { class: "lp-current-label" }, t("MyData.levelProgress.currentValues")),
    /**
     * 这层 div 不能省：`UserLevelsComponent` → `UserLevelShowSpan` 是多根 fragment，
     * 直接当 flex 子项会把「图标 / 值 / 分号」逐个提成 flex 项、各占一行。
     */
    h(
      "div",
      { class: "lp-current-values" },
      h(UserLevelsComponent, { userInfo: row.userInfo, levelRequirement: values, useJoinTimeAsRef: true }),
    ),
  ]);
}

/** 展开后的纵向阶梯：每级一行，等级名 + 该级要求（下一级那一行的左外侧浮一张当前值卡）+ 特权说明 */
function detailItems(row: ILevelProgressRow) {
  return row.ladder.map((level) => ({
    title: level.name,
    content: h("div", { class: "lp-detail" }, [
      h("div", { class: "lp-detail-line" }, [
        /**
         * 必须再包一层 div：`UserLevelsComponent` 往下到 `UserLevelShowSpan` 是**多根 fragment**
         * （每档要求 = 图标 + 值 + 一枚字面量 `;`，全是平级的根节点）。fragment 直接当 flex 子项时，
         * 这些节点会被逐个提成 flex 项，而 `.lp-detail` 是 column → 图标、数值、分号各占一行
         * （用户截图上那个「🕐 / 2W / ;」就是这么来的）。包成普通块级元素后它们回到行内流，
         * 一排读下来和「我的数据」表格里那一格一致。
         */
        h("div", { class: "lp-detail-req" }, h(UserLevelsComponent, { userInfo: row.userInfo, levelRequirement: level, useJoinTimeAsRef: true })),
        row.nextLevel?.id === level.id ? currentValuesChip(row, level) : null,
      ]),
      level.privilege ? h("div", { class: "lp-privilege" }, level.privilege) : null,
    ]),
  }));
}

/** noLevel 那一行不给 current，否则第一颗点会被标成进行中，看着像「已经在第一级」 */
function stepsCurrent(row: ILevelProgressRow): number {
  return row.currentIndex >= 0 ? row.currentIndex + 1 : -1;
}

/** 只有能摆到阶梯上的状态才画阶梯：贵宾 / 管理组是授予的，没有「逐级走过」这回事 */
function showLadder(row: ILevelProgressRow): boolean {
  return row.state !== "special" && row.state !== "noRequirements" && row.ladder.length > 0;
}

/**
 * 四档「排不进进度比较」的情况各说一句真话。
 * 写成 switch 里的字面量而不是键表：键表是动态取键，防线③（check-locale-keys）看不见，
 * 少一侧的键就会把键路径直接渲染到界面上。
 */
function stateText(state: TLevelProgressState): string {
  switch (state) {
    case "maxed":
      return t("MyData.levelProgress.maxed");
    case "special":
      return t("MyData.levelProgress.special");
    case "noLevel":
      return t("MyData.levelProgress.noLevel");
    case "noRequirements":
      return t("MyData.levelProgress.noRequirements");
    default:
      return "";
  }
}

const STATE_COLOR: Record<TLevelProgressState, string> = {
  rankable: "",
  maxed: "green",
  special: "purple",
  noLevel: "default",
  noRequirements: "default",
};

function toggleDetail(siteId: TSiteID) {
  const next = new Set(expandedSites.value);
  if (next.has(siteId)) next.delete(siteId);
  else next.add(siteId);
  expandedSites.value = next;
}

// 关掉弹窗时收起所有展开行：下次打开回到「一排阶梯」的总览态，而不是上次翻开的十几条长表。
// 走 watch 而不是 modal 的 afterOpenChange —— 那个回调在后台标签里根本不触发（实测过）。
watch(
  () => showDialog.value,
  (open) => {
    if (!open) expandedSites.value = new Set();
  },
);

/** 差几项与最卡那一档的完成度；完成度算不出来时不写百分比，不替数据源编一个数 */
function rankText(row: ILevelProgressRow): string {
  if (row.unmetCount === 0) return t("MyData.levelProgress.alreadyMet");
  const parts = [t("MyData.levelProgress.unmetCount", { n: row.unmetCount })];
  if (row.bottleneck !== null) {
    parts.push(t("MyData.levelProgress.bottleneck", { pct: Math.round(row.bottleneck * 100) }));
  }
  return parts.join(" · ");
}
</script>

<template>
  <a-modal
    v-model:open="showDialog"
    :title="t('MyData.levelProgress.title')"
    :width="1200"
    :footer="null"
  >
    <div class="lp-toolbar">
      <a-radio-group v-model:value="sortBy" button-style="solid">
        <a-radio-button value="nearest">{{ t("MyData.levelProgress.sortNearest") }}</a-radio-button>
        <a-radio-button value="siteName">{{ t("MyData.levelProgress.sortSiteName") }}</a-radio-button>
      </a-radio-group>

      <span class="lp-summary">
        {{ t("MyData.levelProgress.summary", { total: rows.length, rankable: rankableCount }) }}
      </span>
    </div>

    <a-spin :spinning="isBusy">
      <p v-if="!isBusy && rows.length === 0" class="lp-empty">{{ t("MyData.levelProgress.empty") }}</p>

      <div v-for="row in sortedRows" :key="row.site" class="lp-row">
        <div class="lp-site">
          <SiteFavicon :site-id="row.site" :size="18" />
          <div class="lp-site-text">
            <div class="lp-site-name text-truncate">{{ row.siteName }}</div>
            <div class="lp-site-level text-truncate">
              {{ row.currentIndex >= 0 ? levelNameOf(row, row.currentIndex) : t("MyData.levelProgress.levelUnknown") }}
            </div>
          </div>
        </div>

        <div class="lp-main">
          <div class="lp-head">
            <a-tag v-if="row.state !== 'rankable'" :color="STATE_COLOR[row.state]">
              {{ stateText(row.state) }}
            </a-tag>
            <span v-else class="lp-rank">{{ rankText(row) }}</span>

            <span v-if="row.currentIndex >= 0" class="lp-position">
              {{
                t("MyData.levelProgress.position", {
                  index: row.currentIndex + 1,
                  total: row.ladder.length,
                })
              }}
            </span>

            <a-button
              v-if="row.ladder.length > 1"
              type="text"
              @click="toggleDetail(row.site)"
            >
              <template #icon>
                <DownOutlined v-if="!expandedSites.has(row.site)" />
                <UpOutlined v-else />
              </template>
              {{ expandedSites.has(row.site) ? t("MyData.levelProgress.collapseLadder") : t("MyData.levelProgress.expandLadder") }}
            </a-button>
          </div>

          <a-steps
            v-if="showLadder(row)"
            class="lp-ladder"
            type="dot"
            size="small"
            :responsive="false"
            :current="stepsCurrent(row)"
            :items="dotItems(row)"
          />

          <div v-if="row.state === 'rankable' && row.nextLevel" class="lp-next">
            <span class="lp-next-name">
              {{ t("MyData.levelProgress.nextLevel", { name: levelNameOf(row, row.currentIndex + 1) }) }}
            </span>
            <!-- 同 detailItems 里那层包裹一个道理：这一排是 flex（gap 4px），不包的话 fragment 的
                 每个节点都成 flex 项，图标与数值之间、数值与 `;` 之间都会被拉开一道缝。 -->
            <span class="lp-next-req">
              <UserNextLevelUnMet
                :next-level-un-met="row.unmet"
                :user-info="row.userInfo"
                :show-next-level-name="false"
                :show-level-score-conversion="true"
                icon-class="mr-1"
              />
            </span>
          </div>

          <div v-if="expandedSites.has(row.site)" class="lp-detail-ladder">
            <a-steps
              orientation="vertical"
              size="small"
              :responsive="false"
              :current="stepsCurrent(row)"
              :items="detailItems(row)"
            />
          </div>
        </div>
      </div>
    </a-spin>
  </a-modal>
</template>

<style scoped>
.lp-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding-bottom: 12px;
  margin-bottom: 8px;
  border-bottom: 1px solid var(--pt-color-border-light);
  /* 滚的是 .ant-modal-body（全局那条 flex 链），这一条钉在顶上，
     否则列表一长排序那组就滚出视野。底色必须有，不然文字叠文字。 */
  position: sticky;
  top: 0;
  z-index: 2;
  background: #fff;
}

.lp-summary {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.55);
}

.lp-empty {
  margin: 24px 0;
  text-align: center;
  color: rgba(0, 0, 0, 0.45);
}

.lp-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 10px 0;
}

.lp-row + .lp-row {
  border-top: 1px solid var(--pt-color-border-light);
}

.lp-site {
  flex: 0 0 240px;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.lp-site-text {
  min-width: 0;
}

.lp-site-name {
  font-weight: 500;
}

.lp-site-level {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.55);
}

.lp-main {
  flex: 1 1 0;
  min-width: 0;
}

.lp-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.65);
}

.lp-rank {
  font-variant-numeric: tabular-nums;
}

.lp-position {
  font-variant-numeric: tabular-nums;
}

.lp-ladder {
  margin-top: 4px;
  /* 最后一颗点之后的那段轨道是伪元素画的（量不到 rect，但会把 .ant-modal-body 的 scrollWidth
     顶大 6px，于是弹窗多出一条横向滚动条）。item 的并集本来就正好贴在可用宽内，裁掉这段尾巴
     不裁任何东西 —— 它伸向的是并不存在的下一颗点。 */
  overflow: hidden;
}

/* 圆点本身只要 8px，antd 却给每颗 item 兜了 32px 的 min-width：24 档的站（实测最长就是这一档）
   在窄窗口下会因此把阶梯顶出可用宽（32 × 24 = 768 > 可用 479）。放开下限后每颗 19.96px、刚好排满。
   dot 模式下 item 里没有 -container / -content 那两层（量到的结构是 item > wrapper > icon + section），
   所以只这一条起作用，别照着别的 Steps 用法往这里加兄弟选择器。 */
.lp-ladder :deep(.ant-steps-item) {
  min-width: 0;
}

.lp-next {
  display: flex;
  align-items: baseline;
  gap: 4px;
  flex-wrap: wrap;
  margin-top: 2px;
  font-size: 12px;
}

.lp-next-name {
  color: rgba(0, 0, 0, 0.65);
}

.lp-detail-ladder {
  margin-top: 8px;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.02);
}

.lp-detail-ladder :deep(.lp-detail) {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
  line-height: 1.5;
}

.lp-detail-ladder :deep(.lp-privilege) {
  color: rgba(0, 0, 0, 0.45);
}

/* 下一级那一行是这张卡的定位基准。它自己不再是 flex 行 —— 卡片走绝对定位到左外侧，
   留在正常流里的只有需求值那一串。 */
.lp-detail-ladder :deep(.lp-detail-line) {
  position: relative;
}

/*
 * 当前值卡：浮在等级表左外侧那条空档里（用户点名要的位置），垂直对齐到它所属那一行。
 * `right: calc(100% + 60px)` 是「贴在整个等级表面板的外面」，60 由台架实测相加（.tmp-build/bench-leveldlg，
 * 量的是需求行左沿到各参照物的距离）：编号圆点那一列占 40（圆 24 + 与正文的缝 16）、面板左内衬 12、
 * 再留 8 的缝。上一版给的是 12，只躲开了正文，于是卡片右沿压在编号圆点上（用户 2026-10-12 报「再往左
 * 一些，不要挡住」）。不需要 JS 量行高 —— 行高会随特权说明的有无变化，靠量再定位的那套一改就漂。
 * 不透明底 + 描边 + 一点投影：它是盖在左栏上面的，没有底色的话字会叠字。
 * `max-width` 由同一次量出：左栏 240 + 行间距 12 + 面板左内衬 12 + 圆点列 40 ≈ 300px 可用，
 * 给到 220 既放得下「↓ 78.31 GiB; ↑ 6.68; ⚡ 4,939.00」这一串（超宽自动换行），
 * 又不会顶到弹窗左内衬（220 + 60 < 那一行的左沿到弹窗左内衬的距离）。
 */
.lp-detail-ladder :deep(.lp-current) {
  position: absolute;
  top: 0;
  right: calc(100% + 60px);
  z-index: 1;
  width: max-content;
  max-width: 220px;
  padding: 6px 8px;
  border: 1px solid var(--pt-color-border-light);
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  line-height: 1.5;
}

.lp-detail-ladder :deep(.lp-current-label) {
  margin-bottom: 2px;
  color: rgba(0, 0, 0, 0.45);
}
</style>
