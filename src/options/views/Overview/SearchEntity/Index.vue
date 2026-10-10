<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import {
  AlertOutlined,
  CameraOutlined,
  CheckOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  FilterOutlined,
  FolderOpenOutlined,
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
import { buildSortOrderMap, toPagination, toTableColumns } from "@/options/components/tableSorters.ts";
import { formatDate, formatSize, formatTimeAgo } from "@/options/utils.ts";
import type { ISearchResultTorrent } from "@/shared/types.ts";
import { categoryKindLabelKey, categoryKindOf, compareCategory } from "@/shared/category.ts";

import SiteName from "@/options/components/SiteName.vue";
import SiteFavicon from "@/options/components/SiteFavicon/Index.vue";
import TorrentTitleTd from "@/options/components/TorrentTitleTd.vue";

import ActionTd from "./ActionTd.vue";
import TorrentProcessTd from "./TorrentProcessTd.vue";
import QuickFilterNotice from "./QuickFilterNotice.vue";
import SearchStatusDialog from "./SearchStatusDialog.vue";
import SaveSnapshotDialog from "./SaveSnapshotDialog.vue";
import SnapshotManagerDialog from "./SnapshotManagerDialog.vue";
import AdvanceFilterGenerateDialog from "./AdvanceFilterGenerateDialog.vue";
import SearchScopeSelect from "./SearchScopeSelect.vue";
// 搜索方案管理页整块复用（而不是抄一份精简版）：增删改/启默/导入导出全在那一个组件里
import SetSearchSolutionPage from "@/options/views/Settings/SetSearchSolution/Index.vue";

// 主要助手方法
import { tableCustomFilter } from "./utils/filter";
import { countCompare, commentsHref, countText } from "@/shared/torrentCount.ts";
import { bumpSearchGeneration, doSearch, retrySearch, searchPlanStatus, searchQueue } from "./utils/search";
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

const showAdvanceFilterGenerateDialog = ref<boolean>(false);
const showSearchStatusDialog = ref<boolean>(false);
const showSaveSnapshotDialog = ref<boolean>(false);
/** 快照管理弹窗：这一页原先是左侧导航里的独立一项，v0.38.0 起并进搜索页 */
const showSnapshotManagerDialog = ref<boolean>(false);

/**
 * 表格列定义。原先用的是 Vuetify 的 DataTableHeader，这里就地定义一个本地类型：
 * - dataIndex / className 是 a-table 需要且语义一致的字段；
 * - align 沿用 start/center/end（rc-table 原生支持这三个值）；
 * - sortable 是 Vuetify 的开关，映射到 a-table 的 sorter（见下 tableHeader）；
 * - props.disabled 仍被 tableHeader 用于「这些列不参与列显隐配置」的判断，语义保持不变。
 */
interface ITableColumn {
  title: string;
  key: string;
  dataIndex?: string;
  align?: "start" | "center" | "end";
  /**
   * 标题列的限宽走 CSS（rc-table 的 maxWidth 只接受数字，而这里要的是「容器宽 − 其它列预算」
   * 这种容器查询算式，见下面 .search-entity-title-limit）。
   * 原来配的 minWidth: 480 已删 —— 它本来就是死配置：本页的 layout 判出来是 fixed
   * （设了 scroll.y 又没有固定列），而 @v-c/table 只在 tableLayout === 'auto' 时才把
   * minWidth 写进 <col style="min-width">。删它是清理，不是这条修复的内容。
   */
  className?: string;
  /** 默认 true（与 Vuetify 一致：只要有 key 就可排序），action 列显式关掉 */
  sortable?: boolean;
  /** 显示值 ≠ 存储值时自带比较函数（toTableColumns 会用它顶掉按 dataIndex 取值的默认实现） */
  compare?: (a: any, b: any) => number;
  props?: { disabled?: boolean };
}

/**
 * 分类列显示的是折过的规范类别（Movies / 电影 / Movies(电影) / Movie(電影) 都显示「电影」），
 * 原样叫法留在悬停里。判据与每站覆盖表见 src/shared/category.ts。
 * 覆盖表读的是 metadataStore.sites[id].categoryMap，派生成 computed —— 不在挂载
 * 钩子里命令式读（那是异步水合的 store，首屏会静默空，AGENTS §3.4 第五条）。
 */
const siteCategoryMaps = computed(() => {
  const out: Record<string, Record<string, string>> = {};
  for (const [id, cfg] of Object.entries(metadataStore.sites ?? {})) {
    const map = cfg.categoryMap;
    if (map && Object.keys(map).length) out[id] = map;
  }
  return out;
});

function categoryCell(record: any) {
  return { raw: record?.category, siteMap: siteCategoryMaps.value[record?.site] };
}

function categoryKindLabel(record: any): string {
  return t(categoryKindLabelKey(categoryKindOf(categoryCell(record))));
}

/** 与原样叫法一致时不挂 tooltip：整列几十个悬停组件没有信息量 */
function categoryOriginal(record: any): string {
  const raw = String(record?.category ?? "").trim();
  return raw && raw !== categoryKindLabel(record) ? raw : "";
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
        className: "search-entity-title-limit",
        props: { disabled: true },
      },
      {
        title: t("SearchEntity.index.table.category"),
        key: "category",
        dataIndex: "category",
        align: "center",
        // 显示的是折过的类别，排序也必须按折过的类别排：按原样叫法排会把拉丁写法的
        // 「Movies」和中文写法的「电影」分到列表两头，同一类内容被劈开
        compare: (a: any, b: any) => compareCategory(categoryCell(a), categoryCell(b)),
      },
      // width 是给下面那条进度条留的：这一列由「大小」那一行数字定宽时只有六十来像素，
      // 图标占掉 16 之后条子只剩四十多，看着就是"进度条太短"。
      { title: t("SearchEntity.index.table.size"), key: "size", dataIndex: "size", align: "end", width: 112 },
      // 这四列都要显式 compare：站点给来的原值可能是「图标字符 + 数字」的字符串（见 torrentCount.ts 顶部），
      // 公共比较器对那种串 parseFloat 得 NaN，就退回按字符串排 —— 同一列里两种档位会各排一段
      {
        title: t("SearchEntity.index.table.seeders"),
        key: "seeders",
        dataIndex: "seeders",
        align: "end",
        compare: countCompare("seeders"),
      },
      {
        title: t("SearchEntity.index.table.leechers"),
        key: "leechers",
        dataIndex: "leechers",
        align: "end",
        compare: countCompare("leechers"),
      },
      {
        title: t("SearchEntity.index.table.completed"),
        key: "completed",
        dataIndex: "completed",
        align: "end",
        compare: countCompare("completed"),
      },
      {
        title: t("SearchEntity.index.table.comments"),
        key: "comments",
        dataIndex: "comments",
        align: "end",
        compare: countCompare("comments"),
      },
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
 * 防御性约束（v0.7.0）：过滤器/数据异常时「宁可多显示，绝不清空表格」——
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
const tableScrollY = ref(400);

/**
 * 表体（scroll.y）高度 = 容器高 − 表头 − 分页器 − 分页器自己的 margin-top。
 *
 * 这个函数错过三次，每次都是「拿会漂的量当基准 / 拿猜的数当减数」，第三次最隐蔽：
 * 它把「分页器底到容器底那一截」也减掉了，而那一截**就是 y 自己剩下的空白** ——
 * 剩余 = 容器 − 表头 − 分页器 − 表体实高，代回去得 `新 y ≡ 当前表体实高`，
 * 是个恒等式：量多少次都原样吐回当前值，永远收敛不到铺满；首批结果少时
 * 表体实高等于内容高，y 还会缩到那个高度然后再也长不回来（表现就是
 * 「下面空一大片，且空白高度跟第一次返回的结果条数有关」）。
 *
 * 所以四个减数必须都不依赖 y：表头量 `.ant-table-header`（设了 scroll.y 后表头被拆成
 * 独立一层，量它比量 thead 准），分页器量它自己，间距取它的 computed margin-top。
 * 基准是容器 `clientHeight`：它由 `.search-page` 的 height:100% 一路 flex 下来，
 * 不随表格内容变，所以这里不存在反馈回路，也就不需要防抖。
 */
function recalcTableScrollY() {
  const el = tableWrapperRef.value;
  if (!el) return;

  const containerHeight = el.clientHeight;
  if (containerHeight <= 0) return;

  const headerHeight =
    el.querySelector<HTMLElement>(".ant-table-header")?.getBoundingClientRect().height ??
    el.querySelector<HTMLElement>(".ant-table-thead")?.getBoundingClientRect().height ??
    0;
  const pagEl = el.querySelector<HTMLElement>(".ant-table-pagination");
  const paginationHeight = pagEl ? pagEl.getBoundingClientRect().height : 0;
  const paginationGap = pagEl ? parseFloat(getComputedStyle(pagEl).marginTop) || 0 : 0;

  const next = Math.max(containerHeight - headerHeight - paginationHeight - paginationGap, 200);
  if (next !== tableScrollY.value) tableScrollY.value = next;
}

/**
 * 重测的触发条件。原先只有窗口尺寸与结果集，够不到真正会变的那几种：
 * 工具条换行、提示条出现/消失、侧栏折叠 —— 这些都只改容器自身的高度。
 * ResizeObserver 在 observe 时就会先投递一次观测，所以首帧那一量也归它管
 * （量到 0 时函数自己早退，容器从 0 长开时它会再投一次）。
 * 结果集仍要单独 watch：0 条时分页器根本不渲染，它的 24px + 8px 不在式子里。
 */
let tableResizeObserver: ResizeObserver | null = null;
onMounted(() => {
  const el = tableWrapperRef.value;
  if (!el) return;
  tableResizeObserver = new ResizeObserver(() => nextTick(recalcTableScrollY));
  tableResizeObserver.observe(el);
});
onBeforeUnmount(() => tableResizeObserver?.disconnect());
watch(tableItems, () => nextTick(recalcTableScrollY));

/** a-table 的分页是受控的，v-data-table 原本把这块状态收在组件内部 */
const tablePage = ref(1);
// tablePageSize（非法值守卫）已由 useTableBehavior 提供

/** 过滤条件变化后如果还停在旧页码上，antd 会显示空表，这里跟随 Vuetify 的行为回到第一页 */
watch([tableFilterRef, tablePageSize], () => {
  tablePage.value = 1;
});

const tablePagination = computed(() =>
  // totalRows 一传就有「一页放得下就不出分页条」——结果只有几条时不必挂着一条分页条
  // （用户 2026-10-07：条数少的时候不要启用分页）。
  toPagination(tablePageSize.value, 50, {
    totalRows: tableItems.value.length,
    extraConfig: {
      current: tablePage.value,
      onChange: (page: number) => (tablePage.value = page),
      onShowSizeChange: (_page: number, size: number) =>
        configStore.updateTableBehavior("SearchEntity", "itemsPerPage", size),
    },
  }),
);

/** a-table 没有 v-model，行选择通过 rowSelection.selectedRowKeys + onChange 双向同步 */
const tableSelectedRowKeys = computed(() => tableSelectedRaw.value.map((x) => x.uniqueId));

function onRowSelectionChange(_keys: any, rows: any[]) {
  tableSelectedRaw.value = rows;
}

// ============================================================================
// 搜索输入区：旧项目的关键词输入在全局顶栏（Topbar），antdv 版没有顶栏，
// 在搜索页顶部提供「作用域（方案 / 直接勾站点）+ 关键词 + 搜索」，
// 回车/点击走 query → 上方 watch 触发 doSearch。
// ============================================================================
const searchKey = ref<string>("");

/**
 * 记住上次选的搜索方案。落在 configStore.searchEntity.lastPlanKey（chrome.storage.local，
 * 跨会话），原先是写死的 ref("default")，每次打开选项页都退回「默认搜索方案」。
 *
 * 用 computed 而不是 ref + 手动读写：persistWebExt 的 store 是**异步水合**的
 * （AGENTS.md §3.4），ref 在水合完成前读到的是初值 "default"，此时任何一次写入
 * 都会把用户真正的选择抹掉。派生是水合一到自动重算，不需要等。
 */
const searchPlanKey = computed({
  get: () => {
    const key = configStore.searchEntity.lastPlanKey || "default";
    // 记住的方案可能已经被删掉或禁用（跨设备同步、手动清理配置都会发生）。
    // 这类失效键必须就地回落，否则 SearchScopeSelect 的按钮会显示成方案 id 本身 ——
    // getSearchSolutionName 找不到时是 `?? solutionId`（AGENTS.md §3.5 零容忍项），
    // 而且搜索时会拿着一个不存在的方案去跑队列。
    return isUsablePlanKey(key) ? key : "default";
  },
  set: (value) => {
    configStore.searchEntity.lastPlanKey = value;
    configStore.$save();
  },
});

/** plan key 是否还有效：约定键恒真；方案 id 要求存在且启用；`site:` 要求还留着至少一个站点 */
function isUsablePlanKey(key: string): boolean {
  if (key === "default" || key === "all") return true;

  if (key.startsWith("site:")) {
    const ids = key
      .slice("site:".length)
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    if (ids.length === 0) return false;
    return metadataStore.getSortedAddedSites.some((site) => ids.includes(site.id));
  }

  return metadataStore.getSearchSolutions.some((solution) => solution.id === key && !!solution.enabled);
}

function startSearchEntity() {
  router.push({
    query: {
      search: searchKey.value,
      plan: searchPlanKey.value,
      flush: 1,
    },
  });
}

// /set-search-solution 没进左侧导航（App.vue 的 navItems），这个弹层是它唯一的入口。
// 就地弹层而不是跳页：跳走会打断「选方案 → 搜」这条线，改完还得点回来。
const showSearchPlanSettingsDialog = ref<boolean>(false);

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

/**
 * 装载一份快照。两条路都走这里：地址栏带 `?snapshot=xxx` 进来（外部链接、旧书签），
 * 以及快照管理弹窗里那一行的「查看」—— 后者原先是 router.push 跳到搜索页，
 * 现在这一页就是搜索页，就地装载，不再多一次导航。
 */
function applySnapshot(snapshotId: string) {
  metadataStore.getSearchSnapshotData(snapshotId).then((data) => {
    if (!data) return;
    runtimeStore.search = { ...data, snapshot: snapshotId };
    // 如果启用了快速站点筛选，则重置一下筛选器，以防止快速站点筛选中无站点数据
    if (configStore.searchEntity.quickSiteFilter) {
      buildAdvanceItemPropsFn();
    }
  });
}

/** 快照管理弹窗里点「查看」：就地装载，然后把弹窗收掉 —— 他要的是回到结果列表看这份快照 */
function viewSnapshotFromManager(snapshotId: string) {
  applySnapshot(snapshotId);
  showSnapshotManagerDialog.value = false;
}

watch(
  () => route.query,
  (newParams, oldParams) => {
    if (newParams.snapshot) {
      applySnapshot(newParams.snapshot as string);
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
  // clear() 只清「还没开始」的排队任务，正在跑的那个照旧跑完并把结果追加进表格 ——
  // 世代号让它回来后自行放弃，否则界面表现是「已取消却还在冒新结果」而 isSearching 已 false。
  bumpSearchGeneration();
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

// maxTagCountBeforeGroup / hiddenTagNames 不是开关（下面另有输入控件）。
// limitTorrentTitleTdWidth 也一并藏起来：标题列现在**一律**限宽（见 .search-entity-title-limit），
// 这个开关失去了意义；config 字段保留，不动存量数据（同 UiWindow 里那两个已摘掉的开关的做法）。
const tableNonBooleanControlKey = ["maxTagCountBeforeGroup", "hiddenTagNames", "limitTorrentTitleTdWidth"];

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

/**
 * 状态按钮里那三段计数（成功/失败/排队）各自带 v-if，全 0 时按钮**内容空了但壳还在** ——
 * 于是没搜索之前，提示条右端挂着一颗没有字、没有图标的蓝色胶囊（用户 2026-10-06 指的就是它）。
 * 判据放在整颗按钮上：没有东西可报就不出现，而不是只把里面三段藏掉。
 */
const hasSearchStatus = computed<boolean>(() => {
  const { success, error, queued } = searchPlanStatus.value;
  return success + error + queued > 0;
});
</script>

<template>
<!-- 整页一个列向 flex：三段的 8px 间距交给 gap 统一给，结果卡片用 flex:1 吃掉剩余高度。
     页面原先是多根节点，没有可设高度的根，`.content` 的 8px 内衬之下的高度没人占，
     卡片下方就空出一大片灰底。 -->
  <div class="search-page">
  <!-- page-bar = 其它 9 个列表页工具条用的那一档白表面（style.css 里的全局类）：
       白底 + 浅边框 + 圆角。复用它而不是在 .search-toolbar 里重写一份，
       否则日后调白面板样式这里必然又分叉成两套。排布仍由 .search-toolbar 自己的
       flex / gap 负责，两者声明的属性不重叠。 -->
  <div class="search-toolbar page-bar">
  <SearchScopeSelect v-model="searchPlanKey" />
  <a-input-search
    v-model:value="searchKey"
    :enter-button="t('common.search')"
    :placeholder="t('SearchEntity.index.searchKeywordPlaceholder')"
    enterkeyhint="search"
    style="max-width: 480px"
    @search="startSearchEntity"
  />
  <RecommendationMenu
    v-if="configStore.searchEntity.showHotRecommendations"
    :disabled="runtimeStore.search.isSearching"
    @search="searchRecommendation"
  />
  <a-button type="text" @click="showSearchPlanSettingsDialog = true">
    <template #icon><SettingOutlined /></template>
    {{ t("SearchEntity.index.searchPlanSettings") }}
  </a-button>
  <a-button type="text" @click="showSnapshotManagerDialog = true">
    <template #icon><FolderOpenOutlined /></template>
    {{ t("SearchEntity.index.manageSnapshots") }}
  </a-button>
</div>
  <a-alert type="info" class="search-alert">
    <template #message>
      <div class="d-flex align-center flex-wrap search-action-bar">
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

        <a-tooltip v-if="hasSearchStatus" :title="t('SearchEntity.index.alert.searchStatus')">
          <a-button
            class="ml-2 status-btn"
            type="primary"
            size="small"
            @click="showSearchStatusDialog = true"
          >
            <!-- 三颗图标一律不写颜色，跟着按钮前景走（primary 蓝底上是白）。
                 原来这两处内联色是 Vuetify 时代的 Material 残留，落在这颗蓝底上量到的对比度：
                 时钟 #607d8b = 1.07:1（等于看不见）、警告 #faad14 = 2.16:1，都低于非文本图形
                 的 3:1 下限；继承白色是 4.10:1。要区分三种计数靠字形本身，不靠手挑色。 -->
            <template v-if="searchPlanStatus.success > 0">
              <CheckOutlined class="mr-1" />{{ searchPlanStatus.success }}
            </template>
            <template v-if="searchPlanStatus.error > 0">
              <AlertOutlined class="mr-1" />{{ searchPlanStatus.error }}
            </template>
            <template v-if="searchPlanStatus.queued > 0">
              <ClockCircleOutlined class="mr-1" />{{ searchPlanStatus.queued }}
            </template>
          </a-button>
        </a-tooltip>
      </div>
    </template>
  </a-alert>

  <a-card class="result-card">
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
          <a-tooltip :title="t('SearchEntity.index.action.cancel')">
            <a-button
              v-show="runtimeStore.search.isSearching"
              type="text"
              danger
              @click="cancelSearchQueue"
            >
              <template #icon><CloseCircleOutlined /></template>
            </a-button>
          </a-tooltip>
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

        <a-divider type="vertical" class="mx-2" />

        <!-- 创建搜索快照 -->
        <a-tooltip :title="t('SearchEntity.index.action.saveSnapshot')">
          <a-button
            :disabled="runtimeStore.search.isSearching || runtimeStore.search.searchResult.length === 0"
            type="text"
            style="color: #13c2c2"
            @click="showSaveSnapshotDialog = true"
          >
            <template #icon><CameraOutlined /></template>
          </a-button>
        </a-tooltip>

        <a-divider type="vertical" class="mx-2" />

        <ActionTd :torrent-items="tableSelectedRaw" />

        <a-divider type="vertical" class="mx-2" />

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

    <!-- 内衬由下面 .result-card 的 card body padding 统一给 8px，这里不再叠 pt-2/pb-0 -->
    <div class="search-results">
      <!-- 站点筛选器、已选种子等提示信息 -->
      <QuickFilterNotice
        class="site-filter-notice"
        :selected-torrents="tableSelectedRaw"
        :all-torrents="tableItems"
      />

      <!-- `--pt-table-body-h` 把这里已经实测好的表体高递给全局样式：空态那条规则要撑满
           剩余高度，而这一页的表体是 scroll.y（rc-table 给它写的是内联 max-height），
           全站那条 flex 链走不到它。判据只在空态生效，见 style.css 同名变量处。 -->
      <div
        id="ptd-search-entity-table"
        ref="tableWrapper"
        class="search-entity-table table-header-no-wrap"
        :style="{ '--pt-table-body-h': `${tableScrollY}px` }"
      >
        <a-table
          bordered
          :columns="tableHeader"
          :data-source="tableItems"
          :loading="runtimeStore.search.isSearching"
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

            <!-- 分类：显示折过的规范类别，与原样叫法不同时给悬停看本站写法 -->
            <template v-else-if="column.key === 'category'">
              <a-tooltip v-if="categoryOriginal(record)" :title="categoryOriginal(record)">
                <span>{{ categoryKindLabel(record) }}</span>
              </a-tooltip>
              <span v-else>{{ categoryKindLabel(record) }}</span>
            </template>

            <!-- 种子大小，下载情况 -->
            <template v-else-if="column.key === 'size'">
              <div class="pa-0">
                <!-- justify-end 不是多余的：列上的 align:"end" 只把 td 的 text-align 设成 end，
                     而 .d-flex 是块级 flex 容器、默认 justify-content:flex-start，
                     里面那颗 span 照样贴左沿（台架 .tmp-build/bench-size-align 量到右沿留 35~42px）。 -->
                <div class="d-flex justify-end">
                  <span class="t_size text-no-wrap">{{ formatSize(record.size ?? 0) }}</span>
                </div>
                <!-- 这里不能再套一层 d-flex：TorrentProcessTd 的根自己就是 flex 行，
                     套上之后它变成 flex item、按 max-content 收缩，而里面那条进度条是
                     width:100% —— 在收缩父级下算不出确定宽度，整行塌成 10px、进度条 0px。 -->
                <TorrentProcessTd
                  v-if="record.status && (record.status as ETorrentStatus) !== ETorrentStatus.unknown"
                  :torrent="record"
                />
              </div>
            </template>

            <!-- 上传人数 -->
            <template v-else-if="column.key === 'seeders'">
              <span class="text-no-wrap">{{ countText(record.seeders) }}</span>
            </template>

            <!-- 下载人数 -->
            <template v-else-if="column.key === 'leechers'">
              <span class="text-no-wrap">{{ countText(record.leechers) }}</span>
            </template>

            <!-- 完成人数 -->
            <template v-else-if="column.key === 'completed'">
              <span class="text-no-wrap">{{ countText(record.completed) }}</span>
            </template>

            <!-- 评论人数：有评论才给跳转，点开是站点详情页的评论区 -->
            <template v-else-if="column.key === 'comments'">
              <a
                v-if="commentsHref(record)"
                :href="commentsHref(record)"
                rel="noopener noreferrer nofollow"
                target="_blank"
                :title="t('SearchEntity.index.table.commentsLink')"
              >
                <span class="text-no-wrap">{{ countText(record.comments) }}</span>
              </a>
              <span v-else class="text-no-wrap">{{ countText(record.comments) }}</span>
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
  <SnapshotManagerDialog v-model="showSnapshotManagerDialog" @view="viewSnapshotFromManager" />

  <!-- 标题只走 :title 属性（#title 插槽会和右上角关闭按钮相撞）；body 定高是为了让
       复用进来的 .page 骨架（height:100% + 1fr 面板行）在弹层内部滚动，而不是撑长页面 -->
  <a-modal
    v-model:open="showSearchPlanSettingsDialog"
    :title="t('SearchEntity.index.searchPlanSettings')"
    :width="'90%'"
    :body-style="{ height: '70vh', overflow: 'hidden' }"
    :footer="null"
    destroy-on-hidden
  >
    <SetSearchSolutionPage />
  </a-modal>
  </div>
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
  /* 滚动条「平时隐形、悬停现形」已经在 style.css 里全站铺过，这里不再逐页写一份 */
  :deep(td) {
    padding: 0 8px;
  }

  /**
   * 标题列限宽的算式要按「这张表实际有多宽」来定，所以先把表格容器标成 inline-size 尺寸容器。
   * 标在这里而不是 .ant-table-body 上：设了 scroll.y 之后 rc-table 把表头/表体拆成两张 <table>，
   * 两边必须算出同一个 max-width，否则列对不齐。
   */
  container-type: inline-size;

  /**
   * 标题列一律限宽（原先是 Vuetify header 的 maxWidth: 32vw，且挂在一个默认关闭的开关上；
   * 不限宽时这一列的宽度就是最长那条种子名的整行宽度，整张表被撑出横向滚动条）。
   *
   * 860 = 其它 10 列的宽度预算。台架照本页真实结构搭（同一份 rc-table：scroll.x: max-content
   * + scroll.y → 表头/表体两张表 + 隐藏量宽行 + 表头那条 17px 滚动条占位列），
   * 实测其它列 = 702px（勾选 48 + 站点 64 + 分类 64 + 大小 65 + 四个数字列 64×4 + 时间 100
   * + 操作 140），加占位列与边框约 740。取 860 是给英文表头（约 +80）和操作列多一颗按钮留余量：
   * 预算小于真实占用时滚动条就回来了，反过来只是标题列窄一点。
   *
   * 220 是地板：窗口很窄时优先保标题能读。代价是容器低于约 970px（740 + 220）时必然溢出，
   * 那 11 列确实放不下 —— 属于必要滚动条，不是这个式子要消灭的那种。
   *
   * 实测三档容器（1309 / 1140 / 972）：表宽 == 容器宽、横向滚动条消失，标题列拿到
   * 约 500 / 320 / 220，长标题在单元格内被省略号截断（原生 title 悬停看全文）。
   *
   * overflow: hidden 不是可选的装饰，它挡的是第二行（标签 / 副标题）：
   * 标签给到 20 个时只写 max-width —— 表宽仍然 == 容器宽，但标签伸出单元格右边 756px，
   * 把滚动容器的 scrollWidth 顶大，横向滚动条照样回来；补上 overflow: hidden 才消失。
   * （标题那一行不需要它：fixed 布局下 max-width 自己就压得住。）
   */
  :deep(.search-entity-title-limit) {
    /* 前一条是不支持容器查询单位时的兜底，后一条在支持的浏览器里覆盖它 */
    max-width: 420px;
    max-width: max(220px, calc(100cqi - 860px));
    overflow: hidden;
  }
}
</style>

<style scoped>
/* 搜索页没有走 style.css 的 .page 网格骨架（它是唯一一个多段结构的页面：
   搜索条 / 状态提示 / 结果卡片三段），所以块间距在这里自己定，
   口径统一成 8px —— 与 .page 的 grid gap、.content 的 padding、.page-panel 的 padding 同一档。
   原来这三段之间是 10px / 0px / 0px：搜索条离提示条差 2px 看不出来，
   提示条和下面的卡片、站点筛选条和表格则是**完全贴死**（a-alert、a-card、a-tag 在
   antdv-next 里都不带默认 margin，所以那两处真的是 0）。 */
/* 整页列向布局：三段之间的 8px 全部交给 gap，不再各写各的 margin-bottom。
   与 .page 骨架（grid gap: 8px + 1fr 面板行）同一套口径，只是这里结构不是「工具条 + 面板」
   两行，而是 搜索条 / 状态提示 / 结果卡片 三段。 */
.search-page {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
  min-height: 0;
}

.search-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  /* 不被下面的结果卡片挤扁（flex 子项默认可以被压小，而工具条里的控件高度固定） */
  flex-shrink: 0;
  /* .page-bar 的 padding 是 `0 8px` —— 上下本来就没有，靠别处给的行高把控件撑开：
     列表页那边是 `.page` 网格的第一行 `minmax(48px, auto)`，工具条作为网格项自然拿到 48px，
     控件居中后上下各留 8px。搜索页没有那层网格（它是列向 flex），行高没人给，
     工具条会塌到控件本身的 32px，比别的页面矮一截。这里把那一档补回来。
     窄窗口下控件换行变两行时，`min-height` 不会截断，仍由内容撑高。 */
  min-height: 48px;
}

/* 站点筛选条与表格之间的 8px（组件根元素是 a-alert，自带 mb-0，
   这里由父组件的 scoped 规则补上 —— scoped 会把父作用域 id 加到子组件根元素上，能命中）。
   这条在卡片**内部**，不是 .search-page 的直接子元素，所以 gap 管不到。 */
.site-filter-notice {
  margin-bottom: 8px;
}

/* 结果卡片吃掉剩余高度。a-table 的 scroll.y 只是 max-height：没有结果时没有行可撑，
   容器按内容收窄，卡片跟着塌下去，下方空出一大片灰底。让卡片自身撑满，
   空白就只剩 .content 的 8px 内衬 —— 有结果、无结果两种状态一致。 */
.result-card {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
}

/* 卡片内衬同时收成 8px（antd 默认 24px，再叠分页器自带的 16px 上下 margin，
   表格下方原本会空出近 40px），并让 body 变成可伸展的列容器。 */
.result-card :deep(.ant-card-body) {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
  padding: 8px;
}

/* 卡片内那层容器与表格容器各占一段，表格吃剩下的（表格高度由 scroll.y 算，见
   recalcTableScrollY），这样「暂无数据」时也是整块铺到底，而不是按内容收窄。 */
.search-results,
#ptd-search-entity-table {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
}

/* 分页器只保留上边距 8px：下边距交给上面 card body 的 8px padding，
   两条都留会重新在表格下方拼出一段空白（这正是原来那段空白的两处来源）。 */
.result-card :deep(.ant-table-pagination) {
  margin: 8px 0 0;
}

/* alert 内整行操作条换行后的行间距（元素自身间距靠 mx-2/ml-2，行间没人管） */
.search-action-bar {
  row-gap: 8px;
}
</style>
