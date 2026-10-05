<script setup lang="ts">
/**
 * 搜索作用域选择器：下拉面板分上下两区。
 * 上区单选「方案」，下区多选「站点」——两条路写出的都是同一个 plan key：
 * 方案 id，或约定的 `site:a,b,c`（metadata.ts 的 getSearchSolution 已支持逗号多站点）。
 * 站点口径沿用上游 Topbar.vue:51-63：allowSearch && !isOffline && !isDead。
 */
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { CheckOutlined, DownOutlined, SearchOutlined } from "@antdv-next/icons";

import { useMetadataStore } from "@/options/stores/metadata.ts";
import SiteFavicon from "@/options/components/SiteFavicon/Index.vue";
import SiteName from "@/options/components/SiteName.vue";

const searchPlanKey = defineModel<string>({ required: true });

const { t } = useI18n();
const metadataStore = useMetadataStore();

const open = ref(false);
const siteFilter = ref("");
const checkedSiteIds = ref<string[]>([]);

function siteIdsOf(key: string): string[] {
  return key
    .slice("site:".length)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

// ===== 下区：可搜站点 =====
const searchableSiteIds = ref<string[]>([]);

async function refreshSearchableSites() {
  const ids = await Promise.all(
    metadataStore.getSortedAddedSites
      .filter((site) => (site.allowSearch ?? false) && !site.isOffline)
      .map(async (site) => {
        try {
          return (await metadataStore.getSiteMetadata(site.id))?.isDead ? undefined : site.id;
        } catch {
          // 元数据取不到时宁可多列一个勾了搜不出东西的站点，也不把能搜的站点藏掉
          return site.id;
        }
      }),
  );
  searchableSiteIds.value = ids.filter((id): id is string => !!id);
}

// 监听整个已添加站点配置（不只 id 列表），站点编辑器里改 allowSearch/isOffline 后这里同步跟上
watch(() => metadataStore.getAddedSites, refreshSearchableSites, { immediate: true, deep: true });

const siteRows = computed(() => {
  const kw = siteFilter.value.trim().toLowerCase();
  return searchableSiteIds.value
    .map((id) => ({ id, name: metadataStore.siteNameMap[id] ?? id }))
    .filter((row) => !kw || row.name.toLowerCase().includes(kw) || row.id.toLowerCase().includes(kw));
});

const siteColumns = computed(() => [{ title: t("common.site"), key: "site" }]);

// ===== 上区：方案 =====
const planItems = computed<Array<{ id: string; name: string; note?: string }>>(() => {
  const hasCustomDefault = metadataStore.defaultSolutionId !== "default";
  const items: Array<{ id: string; name: string; note?: string }> = [
    {
      id: "default",
      // 用「默认搜索方案」而不是 layout.header.searchPlan.default（那个值是「默认」）：
      // 顶栏时代的短词在这个面板里说不清它到底指向什么
      name: t("SearchEntity.index.defaultSearchPlan"),
      // 副标题说明「默认」此刻实际指向哪里，否则用户看不到自己点的是什么
      note: hasCustomDefault
        ? metadataStore.getSearchSolutionName(metadataStore.defaultSolutionId)
        : t("layout.header.searchPlan.all"),
    },
  ];
  if (hasCustomDefault) {
    items.push({ id: "all", name: t("layout.header.searchPlan.all") });
  }
  for (const plan of metadataStore.getSearchSolutions.filter((x) => !!x.enabled).sort((a, b) => b.sort - a.sort)) {
    items.push({ id: plan.id, name: plan.name ?? plan.id });
  }
  return items;
});

const isSiteScope = computed(() => searchPlanKey.value.startsWith("site:"));

const scopeLabel = computed(() => {
  // getSearchSolutionName 认 "all" 和 `site:a,b,c`；"default" 是它唯一不认的约定键
  if (searchPlanKey.value === "default") return t("SearchEntity.index.defaultSearchPlan");
  return metadataStore.getSearchSolutionName(searchPlanKey.value);
});

function selectPlan(id: string) {
  checkedSiteIds.value = [];
  searchPlanKey.value = id;
  open.value = false;
}

function setCheckedSites(keys: string[]) {
  checkedSiteIds.value = keys;
  // 全勾掉时回落到默认方案，不留一个搜不出任何东西的空 site: 键
  searchPlanKey.value = keys.length > 0 ? `site:${keys.join(",")}` : "default";
}

// 作用域也可能由外部写入（右键菜单、地址栏 query.plan），要跟着回显勾选态
watch(searchPlanKey, (key) => (checkedSiteIds.value = key.startsWith("site:") ? siteIdsOf(key) : []), {
  immediate: true,
});
</script>

<template>
  <a-popover v-model:open="open" placement="bottomLeft" trigger="click">
    <a-button class="search-scope-trigger">
      <span class="search-scope-trigger-label">{{ scopeLabel }}</span>
      <DownOutlined />
    </a-button>

    <template #content>
      <div class="search-scope-panel">
        <div class="search-scope-section-title">{{ t("SearchEntity.scope.planSection") }}</div>
        <div class="search-scope-plans">
          <div
            v-for="plan in planItems"
            :key="plan.id"
            class="search-scope-plan"
            :class="{ 'is-active': !isSiteScope && plan.id === searchPlanKey }"
            @click="selectPlan(plan.id)"
          >
            <span class="search-scope-plan-name">{{ plan.name }}</span>
            <span v-if="plan.note" class="search-scope-plan-note">&lt;{{ plan.note }}&gt;</span>
            <CheckOutlined v-if="!isSiteScope && plan.id === searchPlanKey" class="search-scope-plan-check" />
          </div>
        </div>

        <a-divider style="margin: 8px 0" />

        <div class="search-scope-section-title">
          <span>{{ t("SearchEntity.scope.siteSection") }}</span>
          <a-input
            v-model:value="siteFilter"
            allow-clear
            class="search-scope-site-filter"
            :placeholder="t('common.search')"
            size="small"
          >
            <template #prefix><SearchOutlined /></template>
          </a-input>
        </div>

        <!-- 不用 scroll.y：那会启用 rc-table 的固定表头双表结构，在弹层里测宽会和表体错位
             （勾选列宽度和内容列对不上）。滚动交给外层 div。 -->
        <div class="search-scope-site-scroll">
          <a-table
            :columns="siteColumns"
            :data-source="siteRows"
            :pagination="false"
            :row-selection="{
              type: 'checkbox',
              columnWidth: 40,
              selectedRowKeys: checkedSiteIds,
              onChange: (keys: any[]) => setCheckedSites(keys as string[]),
            }"
            row-key="id"
            size="small"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'site'">
                <span class="search-scope-site-cell">
                  <SiteFavicon :site-id="record.id" :size="16" />
                  <SiteName :site-id="record.id" tag="span" />
                </span>
              </template>
            </template>
          </a-table>
        </div>

        <div class="search-scope-footer">
          <span>{{ t("SearchEntity.scope.selectedSites", [checkedSiteIds.length]) }}</span>
          <a-button
            :disabled="checkedSiteIds.length === 0"
            size="small"
            type="link"
            @click="setCheckedSites([])"
          >
            {{ t("SearchEntity.scope.clearSites") }}
          </a-button>
        </div>
      </div>
    </template>
  </a-popover>
</template>

<style scoped>
.search-scope-trigger {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  width: 200px;
}

.search-scope-trigger-label {
  flex: 1;
  overflow: hidden;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.search-scope-panel {
  /* 宽度挂在面板自己身上：a-popover 没有 overlayStyle，只有语义化 styles */
  width: min(460px, calc(100vw - 24px));
}

.search-scope-section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
  color: rgba(0, 0, 0, 0.45);
  font-size: 12px;
}

.search-scope-site-filter {
  width: 160px;
}

.search-scope-plan {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
}

.search-scope-plan:hover {
  background: rgba(0, 0, 0, 0.04);
}

.search-scope-plan.is-active {
  background: #e6f4ff;
  color: #1677ff;
}

.search-scope-plan-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.search-scope-plan-note {
  color: rgba(0, 0, 0, 0.45);
  font-size: 12px;
}

.search-scope-plan-check {
  margin-left: auto;
}

.search-scope-site-scroll {
  max-height: 260px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.search-scope-site-cell {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.search-scope-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 4px;
  color: rgba(0, 0, 0, 0.65);
  font-size: 12px;
}
</style>
