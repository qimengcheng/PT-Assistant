<script setup lang="ts">
/**
 * 「做种价值」：按内容汇总，回答「这几条还值不值得继续占着磁盘做种」。
 *
 * 判据本体在 `@/shared/seedValue`（时魔公式与分档），取数拼法在 `./seedValueView.ts`（可在 Node 里断言）。
 * 这一屏只做**读与判**，不给删除键 —— 要删是回到「我的下载器」按名称找到那几条删，
 * 因为删哪一份副本（同内容往往有几份、在不同站）是有后果的决定，那一屏已经有
 * 「行内删除会把同内容的其余几条一起选上」的确认流程，这里不抄第二套。
 */
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import { QuestionCircleOutlined, ReloadOutlined, SearchOutlined } from "@antdv-next/icons";
import type { TablePaginationConfig } from "antdv-next";
import type { CTorrent } from "@ptd/downloader";
import HoverTip from "@/options/components/HoverTip.vue";
import { useTableBehavior } from "@/options/directives/useTableBehavior.ts";
import { sendMessage } from "@/messages.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { formatSize } from "@/options/utils.ts";
import { categoryKindLabelKey, type TCategoryKind } from "@/shared/category.ts";
import type { TSiteCategoryMapOf } from "@/shared/keepUploadTaskFilter.ts";
import type { IKeepUploadTask } from "@/shared/types/storages/keepUploadTask.ts";
import { SEED_VALUE_TIERS, type ISeedValueVerdict, type TSeedValueTier } from "@/shared/seedValue.ts";

import {
  buildSeedValueItems,
  filterSeedValueItems,
  seedValueCategoryChoices,
  sortSeedValueItems,
  toSeedValueRows,
  type ISeedValueItem,
  type ISeedValueRow,
} from "./seedValueView.ts";

defineOptions({ name: "SeedValue" });

const { t } = useI18n();
const metadataStore = useMetadataStore();
const runtimeStore = useRuntimeStore();

const pagePanel = ref<HTMLDivElement>();
const loading = ref(false);
const torrents = ref<CTorrent[]>([]);
const onlyLow = ref(false);

/**
 * 辅种任务台账：分组判据要它才认得出「这几条是同一批辅种发出去的」。
 * 取失败不影响这一页 —— 判据第二层（内容指纹）本来就独立于台账，与「我的下载器」退的是同一条路。
 */
const reseedTasks = ref<IKeepUploadTask[]>([]);

async function loadReseedTasks(): Promise<void> {
  try {
    reseedTasks.value = await sendMessage("getKeepUploadTasks", undefined);
  } catch (error) {
    console.error("[SeedValue] 读取辅种任务台账失败，同内容归并退回只按内容指纹判：", error);
  }
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const ids = metadataStore.getEnabledDownloaders.map((item) => item.id);
    const batches = await Promise.all(
      ids.map(async (id) => {
        try {
          return await sendMessage("getClientTorrents", id);
        } catch (error) {
          const name = metadataStore.downloaders[id]?.name ?? id;
          runtimeStore.showSnakebar(t("SeedValue.loadFailed", { name, message: String(error) }), { color: "error", timeout: 8 });
          return [] as CTorrent[];
        }
      }),
    );
    torrents.value = batches.flat();
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  // 这一页吃的两份 store 都是异步水合的：不等就是「一台下载器都没启用」的空清单（静默）
  await Promise.all([metadataStore.$onReady(), runtimeStore.$onReady()]);
  await Promise.all([load(), loadReseedTasks()]);
});

const rows = computed<ISeedValueRow[]>(() => toSeedValueRows(torrents.value));

/**
 * 站点 → 该站的用户覆盖表（设置页「其他设置 → 分类映射」那一栏），与辅种任务页、搜索页「分类」
 * 那一列同一份来源。派生成 computed，不在挂载钩子里命令式读 —— 那是异步水合的 store（AGENTS §3.4）。
 */
const siteCategoryMaps = computed(() => {
  const out: Record<string, Record<string, string>> = {};
  for (const [id, cfg] of Object.entries(metadataStore.sites ?? {})) {
    const map = cfg.categoryMap;
    if (map && Object.keys(map).length) out[id] = map;
  }
  return out;
});
const siteMapOf: TSiteCategoryMapOf = (siteId) => siteCategoryMaps.value[siteId];

const items = computed(() =>
  sortSeedValueItems(
    buildSeedValueItems(
      rows.value,
      Object.entries(metadataStore.siteHostMap),
      reseedTasks.value,
      Math.floor(Date.now() / 1000),
      siteMapOf,
    ),
  ),
);

/**
 * 分类筛选（用户 2026-10-23：「增加按分类筛选的功能」）。
 * 空串 = 不按分类筛 —— 用空串而不是 null 是因为 `a-select` 的清除态给的就是空。
 * 判据本体（这一组算哪一类、下拉里该有哪几档）在 `./seedValueView.ts`，那份能在 Node 里断言。
 */
const categoryFilter = ref<TCategoryKind | "">("");
const kindFilter = computed<TCategoryKind | null>(() => (categoryFilter.value === "" ? null : categoryFilter.value));

/**
 * 名称搜索（用户 2026-10-23：「做种价值页面增加搜索功能」）。判据同样在 `./seedValueView.ts`；
 * 吃的是这一组里出现过的**每一种名称写法**，不只是界面上显示的那一个（同一片内容各站标题写法不同）。
 */
const searchWord = ref("");

/**
 * 只按名称筛过的那一份：分类下拉的候选与「只看低价值」括号里那个数都由它算。
 * 两条各有一条理由（与「我的下载器」「辅种任务」那两页同一口径）：
 * ① 候选不许被分类或那一勾自己缩掉 —— 选了「电影」之后下拉只剩「电影」就换不回去了；
 * ② 名称参与缩候选，因为括号里那个数的意思是「勾上会剩下几条」，搜完之后再报全批的低价值条数就是假话。
 */
const wordMatched = computed(() => filterSeedValueItems(items.value, { word: searchWord.value, lowOnly: false, kind: null }));

const lowCount = computed(() => wordMatched.value.filter((item) => item.verdict.tier === "low").length);
const visible = computed(() =>
  filterSeedValueItems(items.value, { word: searchWord.value, lowOnly: onlyLow.value, kind: kindFilter.value }),
);

/**
 * 标签集合必须 computed：里面有 t()，setup 里求值一次的话切语言不重算（AGENTS §3.4）。
 */
const categoryOptions = computed(() => [
  { value: "" as const, label: t("SeedValue.filter.categoryAll") },
  ...seedValueCategoryChoices(wordMatched.value).map((kind) => ({
    value: kind,
    label: t(categoryKindLabelKey(kind)),
  })),
]);

const { pagination: fittedPagination, handleTableChange } = useTableBehavior("SeedValue", {
  defaultPageSize: 25,
  size: "small",
  totalRows: () => visible.value.length,
  autoFit: { container: () => pagePanel.value, rows: () => visible.value },
  // 这一页没有默认排序档，「点第三下取消」要真能取消，否则存下来的档会把箭头按回去
  clearOnEmpty: true,
});

/**
 * 分页在这页是受控的：筛选一变就回到第 1 页。
 * 不控 `current` 的话，筛完只剩几条而人正停在「第 4 页」时那一页是空的 —— 表现成「筛了什么都没有」，
 * 其实数据在上一页（全站那条口径见 AGENTS §3.4 的分页那两行；他截图里这一页正停在第 4 页 / 共 19 页）。
 */
const tablePage = ref(1);
const pagination = computed<TablePaginationConfig | false>(() =>
  fittedPagination.value === false ? false : { ...fittedPagination.value, current: tablePage.value },
);

function onTableChange(page: TablePaginationConfig, filters: unknown, sorter: Parameters<typeof handleTableChange>[2]) {
  if (typeof page?.current === "number") tablePage.value = page.current;
  handleTableChange(page, filters, sorter);
}

watch([onlyLow, categoryFilter, searchWord], () => {
  tablePage.value = 1;
});

const columns = computed(() => [
  { title: t("SeedValue.column.name"), key: "name", dataIndex: "name" },
  { title: t("SeedValue.column.category"), key: "category", align: "center" as const, width: 110 },
  {
    title: t("SeedValue.column.weight"),
    key: "weight",
    align: "end" as const,
    width: 130,
    sorter: { compare: (a: ISeedValueItem, b: ISeedValueItem) => a.verdict.weight - b.verdict.weight },
  },
  { title: t("SeedValue.column.sites"), key: "sites", align: "center", width: 150 },
  {
    title: t("SeedValue.column.size"),
    key: "size",
    align: "end" as const,
    width: 120,
    sorter: { compare: (a: ISeedValueItem, b: ISeedValueItem) => a.bytes - b.bytes },
  },
  { title: t("SeedValue.column.uploaded"), key: "uploaded", align: "end" as const, width: 130 },
  { title: t("SeedValue.column.tier"), key: "tier", align: "center", width: 120 },
]);

/** 分档 → 界面那一格的颜色与说法。`idle` / `unknown` 用灰：它们说的是「先去做点别的」，不是「这条差」 */
function tierOf(verdict: ISeedValueVerdict): { text: string; color: string } {
  const key: TSeedValueTier = verdict.tier;
  const color = key === "high" ? "success" : key === "low" ? "warning" : "default";
  return { text: t(`SeedValue.tier.${key}`), color };
}

/** 权重那一格的浮层：把三个因子和「这是估算」一次说清，不留一句光秃秃的数字 */
function weightTip(item: ISeedValueItem): string {
  return t("SeedValue.weightTip", {
    weight: item.verdict.weight.toFixed(2),
    sites: item.verdict.siteCount,
    copies: item.verdict.copies,
    seeding: item.verdict.seedingCopies,
    unknownSites: item.verdict.unknownSiteCopies,
    incomplete: item.verdict.incomplete,
    low: SEED_VALUE_TIERS.lowBelow,
    high: SEED_VALUE_TIERS.highFrom,
  });
}

/** 在做种的那些份挂的站点名（去重）。**不能**拿 `weight !== null` 当筛选：那会把「在做种但数报不出」的漏掉 */
function siteNames(item: ISeedValueItem): string {
  const names = [
    ...new Set(
      item.verdict.details
        .filter((detail) => detail.counted && detail.siteId)
        .map((detail) => metadataStore.siteNameMap[detail.siteId!] ?? detail.siteId!),
    ),
  ];
  return names.length > 0 ? names.join("、") : t("SeedValue.siteUnknown");
}

/** 浮层里那句「认不出站点」要说清是哪一种：Tracker 那格没报，还是报了但反查不到 */
function siteTip(item: ISeedValueItem): string {
  const missing = item.verdict.unknownSiteCopies;
  return missing === 0 ? siteNames(item) : t("SeedValue.siteTipPartial", { names: siteNames(item), missing });
}

/**
 * 大小那一格的浮层。这个数按**一处物理数据**计一次（同目录的几份副本不重复算，不同目录各算一份），
 * 而「同一份内容挂在十几个站」这两种形状在界面上长得一样 —— 不说清就会让人以为 13 份也只占一份，
 * 而这一屏的动作恰恰是「还占不占着磁盘」。只有一份副本时没得解释，那句话不出现（AGENTS §3.4：
 * 重复摆在旁边的文字不叠浮层）。
 */
function sizeTip(item: ISeedValueItem): string {
  return t("SeedValue.sizeTip", { copies: item.verdict.copies, locations: item.verdict.locations });
}
</script>

<template>
  <div class="page">
    <a-flex align="center" gap="small" wrap class="page-bar">
      <a-button type="primary" :loading="loading" @click="load">
        <template #icon><ReloadOutlined /></template>
        {{ t("SeedValue.refresh") }}
      </a-button>

      <a-checkbox v-model:checked="onlyLow">
        {{ t("SeedValue.onlyLow", { count: lowCount }) }}
      </a-checkbox>

      <a-input
        v-model:value="searchWord"
        allow-clear
        :placeholder="t('SeedValue.searchPlaceholder')"
        style="width: 220px; min-width: 120px"
      >
        <template #prefix>
          <SearchOutlined />
        </template>
      </a-input>

      <a-select v-model:value="categoryFilter" :options="categoryOptions" style="width: 140px" />

      <HoverTip :text="t('SeedValue.formulaNotice')">
        <a-flex align="center" gap="small" class="text-body-small">
          <QuestionCircleOutlined />
          <span>{{ t("SeedValue.summary", { items: items.length, copies: rows.length }) }}</span>
        </a-flex>
      </HoverTip>
    </a-flex>

    <div ref="pagePanel" class="page-panel">
      <a-table
        bordered
        :columns="columns"
        :data-source="visible"
        row-key="key"
        :loading="loading"
        :pagination="pagination"
        size="small"
        @change="onTableChange"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'name'">
            <div class="text-truncate">{{ record.name }}</div>
            <div class="text-body-small text-no-wrap mt-1">
              {{ t("SeedValue.copiesLine", { copies: record.verdict.copies, bytes: formatSize(record.bytes) }) }}
            </div>
          </template>

          <!-- 折不出那一档留空，不写「其他」：`other` 在折类判据里是「未知」，
               画成一个类别词会让人以为这一条被哪个站标成了「其他」类（站点分类里真有这么一类）。 -->
          <template v-else-if="column.key === 'category'">
            <span v-if="record.categoryKind" class="text-no-wrap">{{ t(categoryKindLabelKey(record.categoryKind)) }}</span>
          </template>

          <template v-else-if="column.key === 'weight'">
            <HoverTip :text="weightTip(record)">
              <span class="text-no-wrap">{{ record.verdict.weight.toFixed(2) }}</span>
            </HoverTip>
          </template>

          <template v-else-if="column.key === 'sites'">
            <HoverTip :text="siteTip(record)">
              <span class="text-no-wrap">
                {{ record.verdict.siteCount }}
                <template v-if="record.verdict.copies > record.verdict.seedingCopies">
                  · {{ t("SeedValue.idleCopies", { count: record.verdict.copies - record.verdict.seedingCopies }) }}
                </template>
              </span>
            </HoverTip>
          </template>

          <template v-else-if="column.key === 'size'">
            <HoverTip v-if="record.verdict.copies > 1" :text="sizeTip(record)">
              <span class="text-no-wrap">{{ formatSize(record.bytes) }}</span>
            </HoverTip>
            <span v-else class="text-no-wrap">{{ formatSize(record.bytes) }}</span>
          </template>

          <template v-else-if="column.key === 'uploaded'">
            <HoverTip v-if="record.verdict.active" :text="t('SeedValue.activeTip')">
              <span class="text-no-wrap">
                {{ formatSize(record.verdict.uploaded) }}
                <span class="up-live">↑</span>
              </span>
            </HoverTip>
            <span v-else class="text-no-wrap">{{ formatSize(record.verdict.uploaded) }}</span>
          </template>

          <template v-else-if="column.key === 'tier'">
            <a-tag :color="tierOf(record.verdict).color">{{ tierOf(record.verdict).text }}</a-tag>
          </template>
        </template>
      </a-table>
    </div>
  </div>
</template>

<style scoped>
/* 这一格只有「现在正在传」那一档上色，其余照旧继承表格前景色（AGENTS §3.4：颜色不逐页挑） */
.up-live {
  color: var(--pt-color-success);
}
</style>
