<script setup lang="ts">
import { computed, nextTick, onMounted, ref, shallowRef, useTemplateRef, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { useBreakpoint } from "antdv-next";
import { useWindowSize } from "@vueuse/core";
import {
  AlertOutlined,
  CameraOutlined,
  CheckOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  FilterOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  SearchOutlined,
  SettingOutlined,
  SyncOutlined,
} from "@antdv-next/icons";
import { EResultParseStatus, ETorrentStatus } from "@ptd/site";

import { useMetadataStore } from "@/options/stores/metadata.ts";
import { useConfigStore } from "@/options/stores/config.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { useTableBehavior } from "@/options/directives/useTableBehavior.ts";
import { buildSortOrderMap, toTableColumns } from "@/options/components/tableSorters.ts";
import { formatDate, formatSize, formatTimeAgo } from "@/options/utils.ts";
import type { ISearchResultTorrent } from "@/shared/types.ts";

import SiteName from "@/options/components/SiteName.vue";
import SiteFavicon from "@/options/components/SiteFavicon/Index.vue";
import TorrentTitleTd from "@/options/components/TorrentTitleTd.vue";

import ActionTd from "./ActionTd.vue";
import TorrentProcessTd from "./TorrentProcessTd.vue";
import QuickFilterNotice from "./QuickFilterNotice.vue";
import SearchStatusDialog from "./SearchStatusDialog.vue";
import SaveSnapshotDialog from "./SaveSnapshotDialog.vue";
import AdvanceFilterGenerateDialog from "./AdvanceFilterGenerateDialog.vue";

// 主要助手方法
import { tableCustomFilter } from "./utils/filter";
import { doSearch, retrySearch, searchPlanStatus, searchQueue } from "./utils/search";
import RecommendationMenu from "@/options/views/Layout/RecommendationMenu.vue";

// 本文件名为 Index.vue，与 MyData/Index.vue 同名；<script setup> 推断出的
// __name 会是 "Index"，导致 App.vue 的 KeepAlive :include 无法区分两者（会互相顶掉缓存）。
defineOptions({ name: "SearchEntity" });

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const configStore = useConfigStore();
const metadataStore = useMetadataStore();
const runtimeStore = useRuntimeStore();

/**
 * useBreakpoint() 返回的是**单个 Ref**，其 .value 上挂着 { xs, sm, md, lg, xl, ... }。
 * 原先 Vuetify 的 display.smAndDown 表示「比 lg 窄」，这里用 !lg 近似同一断点。
 */
const screens = useBreakpoint();
const smAndDown = computed(() => !screens.value?.lg);

const showAdvanceFilterGenerateDialog = ref<boolean>(false);
const showSearchStatusDialog = ref<boolean>(false);
const showSaveSnapshotDialog = ref<boolean>(false);

/**
 * 表格列定义。原先用的是 Vuetify 的 DataTableHeader，这里就地定义一个本地类型：
 * - dataIndex / className / minWidth 是 a-table 需要且语义一致的字段；
 * - align 沿用 start/center/end（rc-table 原生支持这三个值）；
 * - sortable 是 Vuetify 的开关，映射到 a-table 的 sorter（见下 tableHeader）；
 * - props.disabled 仍被 tableHeader 用于「这些列不参与列显隐配置」的判断，语义保持不变。
 */
interface ITableColumn {
  title: string;
  key: string;
  dataIndex?: string;
  align?: "start" | "center" | "end";
  minWidth?: number;
  /** 标题列在窄屏 / 开启限宽时需要压到 32vw，用 className 走 CSS（rc-table 的 maxWidth 只接受数字） */
  className?: string;
  /** 默认 true（与 Vuetify 一致：只要有 key 就可排序），action 列显式关掉 */
  sortable?: boolean;
  props?: { disabled?: boolean };
}

const fullTableHeader = computed(
  () =>
    [
      { title: t("common.site"), key: "site", dataIndex: "site", align: "center", props: { disabled: true } },
      {
        title: t("SearchEntity.index.table.title"),
        key: "title",
        dataIndex: "title",
        align: "start",
        minWidth: 480,
        ...(configStore.searchEntifyControl.limitTorrentTitleTdWidth || smAndDown.value
          ? { className: "search-entity-title-limit" }
          : {}),
        props: { disabled: true },
      },
      { title: t("SearchEntity.index.table.category"), key: "category", dataIndex: "category", align: "center" },
      { title: t("SearchEntity.index.table.size"), key: "size", dataIndex: "size", align: "end" },
      { title: t("SearchEntity.index.table.seeders"), key: "seeders", dataIndex: "seeders", align: "end" },
      { title: t("SearchEntity.index.table.leechers"), key: "leechers", dataIndex: "leechers", align: "end" },
      { title: t("SearchEntity.index.table.completed"), key: "completed", dataIndex: "completed", align: "end" },
      { title: t("SearchEntity.index.table.comments"), key: "comments", dataIndex: "comments", align: "end" },
      { title: t("SearchEntity.index.table.time"), key: "time", dataIndex: "time", align: "center" },
      {
        title: t("common.action"),
        key: "action",
        align: "center",
        sortable: false,
        props: { disabled: true },
      },
    ] as ITableColumn[],
);

/**
 * 排序/分页行为统一收敛到 useTableBehavior：
 * - multiSort：搜索结果页允许多列排序
 * - clearOnEmpty：点第三下取消排序时写 [] 清掉持久化（本页旧实现就是这个语义）
 * 本地保留别名 tablePageSize/onTableChange，下方调用点无需改名。
 */
const {
  itemsPerPage: tablePageSize,
  sortBy,
  handleTableChange: onTableChange,
} = useTableBehavior("SearchEntity", {
  defaultPageSize: 50,
  multiSort: true,
  clearOnEmpty: true,
});

const tableHeader = computed<Record<string, any>[]>(() => {
  // 旧 storage 里 columns 可能缺失/非数组（Vuetify 时期格式），守卫回退为全部列
  const savedColumns = configStore.tableBehavior?.SearchEntity?.columns;
  const visibleColumns: string[] = Array.isArray(savedColumns) ? savedColumns : [];
  const visibleHeader = fullTableHeader.value.filter(
    (item) => item?.props?.disabled || visibleColumns.length === 0 || visibleColumns.includes(item.key),
  );

  // 列生成走公共 toTableColumns：enableTableMultiSort 时 sorter 包成 { compare, multiple }
  return toTableColumns(
    visibleHeader as Record<string, any>[],
    buildSortOrderMap(sortBy.value),
    { multiSort: configStore.enableTableMultiSort },
  );
});

/** a-select(mode="multiple") 的 options 形如 { value, label } */
const columnOptions = computed(() => fullTableHeader.value.map((item) => ({ value: item.key, label: item.title })));

function onColumnsChange(value: any) {
  configStore.updateTableBehavior("SearchEntity", "columns", value);
}

/** 显示偏好开关：原来挂在 v-switch 的 v-model + @update:model-value="$save()" 上 */
function onDisplayPreferenceChange(key: string, checked: any) {
  (configStore.searchEntifyControl as Record<string, any>)[key] = !!checked;
  configStore.$save();
}

const { tableFilterRef, tableWaitFilterRef, tableFilterFn, buildAdvanceItemPropsFn, buildFilterDictFn } =
  tableCustomFilter;

/**
 * v-data-table 的 :search + :custom-filter 在 a-table 里没有对应 prop，
 * 这里用 computed 复现同一个判断：tableFilterFn 的第三个参数形如 { raw: item }。
 *
 * 防御性约束（v0.4.6）：过滤器/数据异常时「宁可多显示，绝不清空表格」——
 * 单行判断抛错按通过处理，整体 filter 抛错回退为未过滤列表。
 */
const tableItems = computed<any[]>(() => {
  const items = (runtimeStore.search.searchResult ?? []) as any[];
  try {
    return items.filter((item: any) => {
      if (!item || typeof item !== "object") return false; // 脏条目直接丢弃
      try {
        return tableFilterFn(null, tableFilterRef.value, { raw: item });
      } catch (e) {
        console.warn("[SearchEntity] row filter error, show row anyway:", (e as Error)?.message, item?.uniqueId);
        return true;
      }
    });
  } catch (e) {
    console.warn("[SearchEntity] tableItems fallback to unfiltered list:", e);
    return items;
  }
});

// 使用 shallowRef 优化：种子对象数组不需要深度响应性，提升性能
const tableSelectedRaw = shallowRef<ISearchResultTorrent[]>([]);

// ============================================================================
// 以下为 v-data-table → a-table 迁移所需的表格「胶水」，不涉及任何业务逻辑：
// 过滤结果、当前页码、排序回写、行选择回写。
// ============================================================================

const tableWrapperRef = useTemplateRef<HTMLDivElement>("tableWrapper");
const { width: windowWidth, height: windowHeight } = useWindowSize();
const tableScrollY = ref(400);

/**
 * 表体可视高度 = 视口高度 − 表格顶部位置 − 表头 − 分页 − 底部留白，
 * 让表格始终铺满视口右下区域（scroll.y 固定后横向滚动条也常驻可见）。
 */
function recalcTableScrollY() {
  const el = tableWrapperRef.value;
  if (!el) return;
  const top = el.getBoundingClientRect().top;
  tableScrollY.value = Math.max(windowHeight.value - top - 55 - 64 - 16, 200);
}

onMounted(recalcTableScrollY);
// 窗口尺寸变化（工具栏换行会改变 top）、结果集变化（提示条出现/消失同理）后重测
watch([windowWidth, windowHeight, tableItems], () => nextTick(recalcTableScrollY));

/** a-table 的分页是受控的，v-data-table 原本把这块状态收在组件内部 */
const tablePage = ref(1);
// tablePageSize（非法值守卫）已由 useTableBehavior 提供

/** 过滤条件变化后如果还停在旧页码上，antd 会显示空表，这里跟随 Vuetify 的行为回到第一页 */
watch([tableFilterRef, tablePageSize], () => {
  tablePage.value = 1;
});

const tablePagination = computed(() => ({
  current: tablePage.value,
  pageSize: tablePageSize.value,
  showSizeChanger: true,
  onChange: (page: number) => (tablePage.value = page),
  onShowSizeChange: (_page: number, size: number) =>
    configStore.updateTableBehavior("SearchEntity", "itemsPerPage", size),
}));

/** a-table 没有 v-model，行选择通过 rowSelection.selectedRowKeys + onChange 双向同步 */
const tableSelectedRowKeys = computed(() => tableSelectedRaw.value.map((x) => x.uniqueId));

function onRowSelectionChange(_keys: any, rows: any[]) {
  tableSelectedRaw.value = rows;
}

// ============================================================================
// 搜索输入区：旧项目的关键词输入在全局顶栏（Topbar），antdv 版没有顶栏，
// 在搜索页顶部提供「搜索方案 + 关键词 + 搜索」，回车/点击走 query → 上方 watch 触发 doSearch。
// ============================================================================
const searchKey = ref<string>("");
const searchPlanKey = ref<string>("default");

const searchPlanOptions = computed(() => [
  { value: "default", label: "默认搜索方案" },
  ...metadataStore.getSearchSolutions
    .filter((x: any) => !!x.enabled)
    .sort((a: any, b: any) => b.sort - a.sort)
    .map((x: any) => ({ value: x.id, label: x.name })),
]);

function startSearchEntity() {
  router.push({
    query: {
      search: searchKey.value,
      plan: searchPlanKey.value,
      flush: 1,
    },
  });
}

// 热门推荐：点选推荐条目后把标题灌进关键词并立即搜索（query watch 会触发 doSearch）
function searchRecommendation(title: string) {
  searchKey.value = title;
  startSearchEntity();
}

// 地址栏变化时同步输入框显示（右键菜单/外部跳转带 search 参数进来的场景）
watch(
  () => route.query,
  (newQuery) => {
    if (newQuery?.search && (newQuery.search as string) !== searchKey.value) {
      searchKey.value = newQuery.search as string;
    }
    if (newQuery?.plan && (newQuery.plan as string) !== searchPlanKey.value) {
      searchPlanKey.value = newQuery.plan as string;
    }
  },
);

watch(
  () => route.query,
  (newParams, oldParams) => {
    if (newParams.snapshot) {
      metadataStore.getSearchSnapshotData(newParams.snapshot as string).then((data) => {
        data && (runtimeStore.search = { ...data, snapshot: newParams.snapshot as string });
        // 如果启用了快速站点筛选，则重置一下筛选器，以防止快速站点筛选中无站点数据
        if (configStore.searchEntity.quickSiteFilter) {
          buildAdvanceItemPropsFn();
        }
      });
    } else {
      if (
        newParams.flush ||
        (newParams.search && newParams.search != oldParams?.search) ||
        (newParams.plan && newParams.plan != oldParams?.plan)
      ) {
        // 清理已选择项 （ #622 ）
        tableSelectedRaw.value = [];
        // doSearch 会自动处理过滤器重置
        doSearch((newParams.search as string) ?? "", (newParams.plan as string) ?? "default", true);
      }
    }
  },
  { immediate: true, deep: true },
);

const isSearchingParsed = ref<boolean>(searchQueue.isPaused);

function pauseSearchQueue() {
  console.log("pauseSearchQueue", searchQueue);
  searchQueue.pause();
  isSearchingParsed.value = true;
}

function startSearchQueue() {
  console.log("startSearchQueue", searchQueue);
  searchQueue.start();
  isSearchingParsed.value = false;
}

function cancelSearchQueue() {
  console.log("cancelSearchQueue", searchQueue);
  searchQueue.clear(); // 清空搜索队列
  // 将搜索队列中状态设置为跳过
  for (const key of Object.keys(runtimeStore.search.searchPlan)) {
    // @ts-ignore
    if (runtimeStore.search.searchPlan[key]!.status === EResultParseStatus.waiting) {
      // @ts-ignore
      runtimeStore.search.searchPlan[key]!.status = EResultParseStatus.passParse;
      // @ts-ignore
      runtimeStore.search.searchPlan[key]!.statusMsg = "i18n.userCancel";
    }
  }

  runtimeStore.search.isSearching = false;
}

const tableNonBooleanControlKey = ["maxTagCountBeforeGroup", "hiddenTagNames"];

// 过滤出表格控制中非布尔类型的键
const filteredTableBooleanControlKeys = computed(() => {
  return Object.keys(configStore.searchEntifyControl).filter(
    (key) => tableNonBooleanControlKey.indexOf(key) === -1,
  ) as (keyof typeof configStore.searchEntifyControl)[];
});

const hiddenTagNamesText = computed({
  get: () => configStore.searchEntifyControl.hiddenTagNames.join("\n"),
  set: (val: string) => {
    configStore.searchEntifyControl.hiddenTagNames = val
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  },
});
</script>

<template>
<div class="search-toolbar">
  <a-select
    v-model:value="searchPlanKey"
    :options="searchPlanOptions"
    placeholder="搜索方案"
    style="width: 200px"
  />
  <a-input-search
    v-model:value="searchKey"
    enter-button="搜索"
    placeholder="输入关键词开始搜索"
    enterkeyhint="search"
    style="max-width: 480px"
    @search="startSearchEntity"
  />
  <RecommendationMenu
    v-if="configStore.searchEntity.showHotRecommendations"
    :disabled="runtimeStore.search.isSearching"
    @search="searchRecommendation"
  />
</div>
  <a-alert type="info">
    <template #message>
      <div class="d-flex align-center">
        <div class="flex-1-1-0">
          <template v-if="runtimeStore.search.startAt === 0">
            {{ t("SearchEntity.index.alert.enterKeyword") }}
          </template>
          <template v-else>
            <template v-if="runtimeStore.search.isSearching">
              <template v-if="isSearchingParsed">
                {{ t("SearchEntity.index.alert.paused") }}
              </template>
              <template v-else>
                <template v-if="runtimeStore.search.searchResult.length > 0">
                  {{ t("SearchEntity.index.alert.plan") }}
                  [{{ metadataStore.getSearchSolutionName(runtimeStore.search.searchPlanKey) }}]，
                  {{ t("SearchEntity.index.alert.keyword") }}
                  [{{ runtimeStore.search.searchKey }}]，
                  {{ t("SearchEntity.index.alert.searchProgress", [runtimeStore.search.searchResult.length]) }}
                </template>
                <template v-else>
                  {{ t("SearchEntity.index.alert.searching") }}
                </template>
              </template>
            </template>
            <template v-else>
              <template v-if="runtimeStore.search.snapshot">
                {{ t("SearchEntity.index.alert.snapshot") }}
                [{{ metadataStore.snapshots[runtimeStore.search.snapshot].name }}]，
              </template>
              <template v-else>
                {{ t("SearchEntity.index.alert.plan") }}
                [{{ metadataStore.getSearchSolutionName(runtimeStore.search.searchPlanKey) }}]，
              </template>
              {{ t("SearchEntity.index.alert.keyword") }}
              [{{ runtimeStore.search.searchKey }}]，
              {{ t("SearchEntity.index.alert.results", [runtimeStore.search.searchResult.length]) }}
              {{ t("SearchEntity.index.alert.duration", [(runtimeStore.searchCostTime / 1000).toFixed(1)]) }}
            </template>
          </template>
        </div>

        <a-button
          :title="t('SearchEntity.index.alert.searchStatus')"
          class="ml-2 status-btn"
          type="primary"
          size="small"
          @click="showSearchStatusDialog = true"
        >
          <template v-if="searchPlanStatus.success > 0">
            <CheckOutlined class="mr-1" />{{ searchPlanStatus.success }}
          </template>
          <template v-if="searchPlanStatus.error > 0">
            <AlertOutlined class="mr-1" style="color: #faad14" />{{ searchPlanStatus.error }}
          </template>
          <template v-if="searchPlanStatus.queued > 0">
            <ClockCircleOutlined class="mr-1" style="color: #607d8b" />{{ searchPlanStatus.queued }}
          </template>
        </a-button>
      </div>
    </template>
  </a-alert>

  <a-card>
    <template #title>
      <div class="d-flex align-center">
        <!-- 启动/暂停 搜索队列 -->
        <a-space-compact>
          <a-button
            v-show="isSearchingParsed"
            :title="t('SearchEntity.index.action.start')"
            type="text"
            @click="() => startSearchQueue()"
          >
            <template #icon><PlayCircleOutlined style="color: #52c41a" /></template>
          </a-button>
          <a-button
            v-show="!isSearchingParsed"
            :title="t('SearchEntity.index.action.pause')"
            type="text"
            @click="() => pauseSearchQueue()"
          >
            <template #icon><PauseCircleOutlined style="color: #52c41a" /></template>
          </a-button>

          <!-- 取消/重试 搜索队列 -->
          <a-button
            v-show="runtimeStore.search.isSearching"
            :title="t('SearchEntity.index.action.cancel')"
            type="text"
            danger
            @click="cancelSearchQueue"
          >
            <template #icon><CloseCircleOutlined /></template>
          </a-button>
          <a-button
            v-show="!runtimeStore.search.isSearching"
            :disabled="isSearchingParsed"
            :title="t('SearchEntity.index.action.retry')"
            type="text"
            danger
            @click="() => doSearch(null as unknown as string, null as unknown as string, true)"
          >
            <template #icon><SyncOutlined /></template>
          </a-button>

          <!-- 重试失败的搜索 -->
          <a-button
            :disabled="searchPlanStatus.error === 0"
            :title="t('SearchEntity.index.action.retryFailed')"
            type="text"
            style="color: #faad14"
            @click="() => retrySearch()"
          >
            <template #icon><SyncOutlined /></template>
          </a-button>
        </a-space-compact>

        <a-divider orientation="vertical" class="mx-2" />

        <!-- 创建搜索快照 -->
        <a-button
          :disabled="runtimeStore.search.isSearching || runtimeStore.search.searchResult.length === 0"
          :title="t('SearchEntity.index.action.saveSnapshot')"
          type="text"
          style="color: #13c2c2"
          @click="showSaveSnapshotDialog = true"
        >
          <template #icon><CameraOutlined /></template>
        </a-button>

        <a-divider orientation="vertical" class="mx-2" />

        <ActionTd :torrent-items="tableSelectedRaw" />

        <a-divider orientation="vertical" class="mx-2" />

        <!-- 显示偏好设置 -->
        <a-popover trigger="click" placement="bottomLeft">
          <template #content>
            <div class="display-preferences">
              <div v-for="item in filteredTableBooleanControlKeys" :key="item" class="mb-1">
                <a-switch
                  :checked="configStore.searchEntifyControl[item]"
                  size="small"
                  @click.stop
                  @change="(checked: any) => onDisplayPreferenceChange(item, checked)"
                />
                <span class="ml-1">{{ t("SearchEntity.index." + item) }}</span>
              </div>
              <a-textarea
                v-if="configStore.searchEntifyControl.showTorrentTag"
                v-model:value="hiddenTagNamesText"
                class="mt-2"
                :rows="5"
                :placeholder="t('SetBase.searchEntity.hiddenTagNames')"
              />
            </div>
          </template>
          <a-button type="text" :title="t('SearchEntity.index.action.displayPreferences')">
            <template #icon><SettingOutlined style="color: #1677ff" /></template>
          </a-button>
        </a-popover>

        <!-- 列显隐配置（原 v-combobox + #chip 折叠成「第一列 + (+N)」，用 a-select 的 maxTagCount 复现） -->
        <a-select
          v-model:value="configStore.tableBehavior.SearchEntity.columns"
          mode="multiple"
          :options="columnOptions"
          :max-tag-count="1"
          size="small"
          class="table-header-filter-clear ml-1"
          :style="{ maxWidth: '220px', minWidth: '180px' }"
          @change="onColumnsChange"
        >
          <template #prefix><FilterOutlined /></template>
        </a-select>

        <div class="flex-1-1-0" />
        <a-input
          v-model:value="tableWaitFilterRef"
          allow-clear
          size="small"
          :placeholder="t('SearchEntity.index.filterLabel')"
          style="max-width: 500px"
          @change="(e: any) => buildFilterDictFn(e?.target?.value ?? '')"
        >
          <template #prefix>
            <span class="filter-icon" @click="showAdvanceFilterGenerateDialog = true">
              <FilterOutlined />
            </span>
          </template>
          <template #suffix><SearchOutlined /></template>
        </a-input>
      </div>
    </template>

    <div class="pt-2 pb-0">
      <!-- 站点筛选器、已选种子等提示信息 -->
      <QuickFilterNotice :selected-torrents="tableSelectedRaw" />

      <div id="ptd-search-entity-table" ref="tableWrapper" class="search-entity-table table-stripe table-header-no-wrap">
        <a-table
          :columns="tableHeader"
          :data-source="tableItems"
          row-key="uniqueId"
          :pagination="tablePagination"
          :row-selection="{
            selectedRowKeys: tableSelectedRowKeys,
            onChange: onRowSelectionChange,
          }"
          size="small"
          :scroll="{ x: tableItems.length > 0 ? 'max-content' : undefined, y: `${tableScrollY}px` }"
          @change="onTableChange"
        >
          <template #bodyCell="{ column, record }">
            <!-- 站点图标 -->
            <template v-if="column.key === 'site'">
              <div class="d-flex flex-column align-center">
                <SiteFavicon
                  :site-id="record.site"
                  :size="configStore.searchEntifyControl.showSiteName ? 18 : 24"
                />
                <SiteName v-if="configStore.searchEntifyControl.showSiteName" :site-id="record.site" />
              </div>
            </template>

            <!-- 主标题，副标题，优惠及标签 -->
            <template v-else-if="column.key === 'title'">
              <TorrentTitleTd :item="record" />
            </template>

            <!-- 种子大小，下载情况 -->
            <template v-else-if="column.key === 'size'">
              <div class="pa-0">
                <div class="d-flex">
                  <span class="t_size text-no-wrap">{{ formatSize(record.size ?? 0) }}</span>
                </div>
                <div
                  v-if="record.status && (record.status as ETorrentStatus) !== ETorrentStatus.unknown"
                  class="d-flex"
                >
                  <TorrentProcessTd :torrent="record" />
                </div>
              </div>
            </template>

            <!-- 上传人数 -->
            <template v-else-if="column.key === 'seeders'">
              <span class="t_seeders text-no-wrap">{{ record.seeders }}</span>
            </template>

            <!-- 下载人数 -->
            <template v-else-if="column.key === 'leechers'">
              <span class="t_leechers text-no-wrap">{{ record.leechers }}</span>
            </template>

            <!-- 完成人数 -->
            <template v-else-if="column.key === 'completed'">
              <span class="t_completed text-no-wrap">{{ record.completed }}</span>
            </template>

            <!-- 评论人数 -->
            <template v-else-if="column.key === 'comments'">
              <span class="t_comments text-no-wrap">{{ record.comments }}</span>
            </template>

            <!-- 发布日期 -->
            <template v-else-if="column.key === 'time'">
              <span class="t_time text-no-wrap" :title="record.time ? (formatDate(record.time) as string) : '-'">
                {{
                  record.time
                    ? configStore.searchEntifyControl.uploadAtFormatAsAlive
                      ? formatTimeAgo(record.time)
                      : formatDate(record.time)
                    : "-"
                }}
              </span>
            </template>

            <!-- 其他操作 -->
            <template v-else-if="column.key === 'action'">
              <ActionTd :torrent-items="[record]" density="compact" :show-keep-upload-btn="false" />
            </template>
          </template>
        </a-table>
      </div>
    </div>
  </a-card>

  <AdvanceFilterGenerateDialog v-model="showAdvanceFilterGenerateDialog" />
  <SearchStatusDialog v-model="showSearchStatusDialog" />
  <SaveSnapshotDialog v-model="showSaveSnapshotDialog" />
</template>

<style scoped lang="scss">
.display-preferences {
  min-width: 240px;
  max-height: 60vh;
  overflow-y: auto;
}

.filter-icon {
  cursor: pointer;
}

#ptd-search-entity-table {
  /* 滚动条平时透明不可见，鼠标悬停到表格区域（含拖拽滚动条时）才现形 */
  :deep(.ant-table-body) {
    scrollbar-width: thin;
    scrollbar-color: transparent transparent;
  }

  &:hover :deep(.ant-table-body) {
    scrollbar-color: rgba(0, 0, 0, 0.25) transparent;
  }

  :deep(td) {
    padding: 0 8px;
  }

  /**
   * 标题列限宽：原先是 Vuetify header 的 maxWidth: 32vw，
   * rc-table 的 maxWidth 只接受数字，这里用 className 走 CSS。
   */
  :deep(.search-entity-title-limit) {
    max-width: 32vw;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}
</style>

<style scoped>
.search-toolbar {
  display: flex;
  gap: 12px;
  margin-bottom: 10px;
}
</style>
