<script setup lang="ts">
import { computed, ref, useTemplateRef } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
// 注意：antdv-next 根入口把这几个类型做了别名再导出（ColumnType -> TableColumnType 等）
import type { TableColumnsType } from "antdv-next";
import {
  AlertOutlined,
  BarChartOutlined,
  CalendarOutlined,
  ColumnWidthOutlined,
  ExclamationCircleOutlined,
  ExportOutlined,
  FilterOutlined,
  LineChartOutlined,
  MailOutlined,
  SearchOutlined,
  SettingOutlined,
  StopOutlined,
  SyncOutlined,
  TrophyOutlined,
} from "@antdv-next/icons";
import { EResultParseStatus, type TSiteID } from "@ptd/site";

import { useConfigStore } from "@/options/stores/config.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import { useTableCustomFilter } from "@/options/directives/useAdvanceFilter.ts";
import { useTableBehavior } from "@/options/directives/useTableBehavior.ts";
import { buildSortOrderMap, toTableColumns } from "@/options/components/tableSorters.ts";
import { formatDate } from "@/options/utils.ts";
import { RATIO_DANGER_CEIL, ratioTier } from "@/shared/ratioGuard.ts";

import HistoryDataViewDialog from "./HistoryDataViewDialog.vue";
import SiteMessagesDialog from "./SiteMessagesDialog.vue";
import AllSiteMessagesDialog from "./AllSiteMessagesDialog.vue";
import ExportUserInfoDialog from "./ExportUserInfoDialog.vue";
import LevelProgressDialog from "./LevelProgressDialog.vue";
// 表格每一格的渲染：主表与上面两块单列表共用它，所以「列一样」才是真的列一样。
import UserInfoCell from "./UserInfoCell.vue";

import {
  tableData,
  isTableLoading,
  cancelFlushSiteLastUserInfo,
  flushSiteLastUserInfo,
  type IUserInfoItem,
} from "./utils/lastUserData.ts";

// 本文件名为 Index.vue，与 SearchEntity/Index.vue 同名；<script setup> 推断出的
// __name 会是 "Index"，导致 App.vue 的 KeepAlive :include 无法区分两者（会互相顶掉缓存）。
defineOptions({ name: "MyData" });

const { t } = useI18n();
const router = useRouter();
const configStore = useConfigStore();
const runtimeStore = useRuntimeStore();
const metadataStore = useMetadataStore();

const currentDate = new Date();

/**
 * v-data-table 的 `DataTableHeader` 在本仓库的本地替身。
 * 语义保持一致：key 同时充当「列标识」和 configStore.tableBehavior.MyData.columns 里的取值，
 * props.disabled 表示该列不可被用户隐藏/排序（仍然恒定显示）。
 */
interface ITableHeader {
  title: string;
  key: string;
  align?: "start" | "end" | "center";
  width?: number | string;
  sortable?: boolean;
  props?: { disabled?: boolean };
}

// computed（原先是 reactive）：表头有 t()，setup 里一次性求值的话切语言不会重算
const fullTableHeader = computed<ITableHeader[]>(() => [
  {
    title: t("common.site"),
    key: "siteUserConfig.sortIndex",
    align: "start",
    props: { disabled: true },
  },
  { title: t("common.username"), key: "name", align: "center" },
  { title: t("MyData.table.levelName"), key: "levelName", align: "start", width: "15%" },
  // NOTE: 这里将key设为 uploaded, trueUploaded 而不是虚拟的 userData，可以让 v-data-table 使用 uploaded 的进行排序
  { title: t("MyData.table.userData"), key: "uploaded", align: "end" },
  { title: t("MyData.table.trueUserData"), key: "trueUploaded", align: "end" }, // 默认不显示
  { title: t("levelRequirement.ratio"), key: "ratio", align: "end" },
  { title: t("levelRequirement.trueRatio"), key: "trueRatio", align: "end" }, // 默认不显示
  { title: t("levelRequirement.uploads"), key: "uploads", align: "end" },
  { title: t("levelRequirement.seeding"), key: "seeding", align: "end" },
  { title: t("levelRequirement.seedingSize"), key: "seedingSize", align: "end" },
  { title: t("levelRequirement.bonus"), key: "bonus", align: "end" },
  { title: t("levelRequirement.bonusPerHour"), key: "bonusPerHour", align: "end" },
  { title: t("MyData.table.invites"), key: "invites", align: "end" }, // 默认不显示
  { title: t("MyData.table.joinTime"), key: "joinTime", align: "center" },
  { title: t("MyData.table.lastAccessAt"), key: "lastAccessAt", align: "center" }, // 默认不显示
  { title: t("MyData.table.updateAt"), key: "updateAt", align: "center" },
  // 操作列必须给确定宽度：这张表没有 fixed 列、`scroll.x: 'max-content'` 会让 rc-table 退回
  // table-layout: auto（列宽跟着内容走），刷新时每行的 loading 一出现就把内容撑宽 →
  // 整张表的列一起重排（肉眼可见地抖一下）。
  { title: t("common.action"), key: "action", align: "center", width: 72, sortable: false, props: { disabled: true } },
]);

const tableHeader = computed(() => {
  return fullTableHeader.value.filter(
    (item: ITableHeader) => item?.props?.disabled || configStore.tableBehavior.MyData.columns!.includes(item.key!),
  ) as ITableHeader[];
});

/**
 * 列显隐的 v-model 代理。
 * 原来 v-combobox 的 `v-model` 与 `@update:model-value` 都落到 configStore，
 * 这里统一在 setter 里调用 updateTableBehavior（它内部还负责 $save）。
 */
const selectedColumnKeys = computed({
  get: () => configStore.tableBehavior.MyData.columns ?? [],
  set: (value: string[]) => configStore.updateTableBehavior("MyData", "columns", value),
});

/**
 * 列显隐面板：工具条只留一个按钮，点开 modal 用 3 列开关逐个切。
 * 原先那是一个 mode="multiple" 的 a-select，12 个列名摊成 tag 能占满整条工具条。
 * 切换即时写入 configStore —— 沿用旧多选框的行为，所以没有草稿态，也不需要「确定」。
 */
type ColumnItem = { key: string; label: string; fixed: boolean };

const showColumnDialog = ref<boolean>(false);

const columnItems = computed<ColumnItem[]>(() =>
  fullTableHeader.value.map((header) => ({ key: header.key, label: header.title, fixed: !!header.props?.disabled })),
);

/**
 * 固定列（`props.disabled`，例如「操作」）永远会显示 —— tableHeader 的过滤条件是
 * `props.disabled || 已选`。所以它们的开关显示成「开且不可改」，
 * 而不是留一个拨了没反应的开关。
 */
const fixedColumnKeys = computed(() => fullTableHeader.value.filter((h) => h.props?.disabled).map((h) => h.key));

const columnVisible = (key: string) => selectedColumnKeys.value.includes(key) || fixedColumnKeys.value.includes(key);

const toggleColumn = (key: string, on: boolean) => {
  const next = new Set(selectedColumnKeys.value);
  if (on) next.add(key);
  else next.delete(key);
  selectedColumnKeys.value = [...next];
};

/** 排序/分页行为统一收敛到 useTableBehavior（MyData 允许多列排序）；列生成走公共 toTableColumns */
const pagePanel = useTemplateRef<HTMLDivElement>("pagePanel");
const { sortBy, pagination: tablePagination, handleTableChange } = useTableBehavior("MyData", {
  defaultPageSize: 20,
  multiSort: true,
  // 一页放得下就不出分页条（用户 2026-10-07：条数少的时候不要启用分页）
  totalRows: () => filteredTableData.value.length,
  // 每页条数按面板实高算（用户 2026-10-08：「既不能出现滚动条又要把页面铺满」）
  autoFit: { container: () => pagePanel.value, rows: () => filteredTableData.value },
  // 但不超过 50 条时干脆不分页（用户 2026-10-08：「这个页面没有超过50条不要分页」）。
  // 这条排在 autoFit 前面：实高量出来只有 13 行，19 个站就会被切成两页 —— 他要的不是这个。
  maxSinglePage: 50,
});

const tableColumns = computed<TableColumnsType<IUserInfoItem>>(() =>
  toTableColumns<IUserInfoItem>(tableHeader.value, buildSortOrderMap(sortBy.value)),
);

/**
 * 主表上方两块单列表（异常 / 低分享率）用的列：**就是主表那一份 tableHeader**，
 * 同一批列、同一顺序、同一标题与对齐（用户 2026-10-13：「单列出来的站点，表头的列要和下面的一样」）。
 * 原先两块各自手写 5 列，与主表的列名、顺序、宽度全不一样，同一个站在两块里像两张表的数据。
 *
 * 唯一去掉的是排序：这两块没有 @change 接，把带 sorter 的那份直接递过去会留下
 * 「箭头点了没反应」的死控件（AGENTS 记的那一族：sorter 无 compare / 无回调时数据不排）。
 * 低分享率那块自己按分享率升序排（最欠的排前面，见 lowRatioTableData），排序交给 JS，不让 antd 插手。
 */
const blockColumns = computed<TableColumnsType<IUserInfoItem>>(() =>
  toTableColumns<IUserInfoItem>(tableHeader.value.map((header) => ({ ...header, sortable: false }))),
);

/**
 * 「异常」的口径 = 筛选面板那颗「最后更新状态异常」用的同一批状态，两处共用这一个常量。
 * 不含 waiting/working（那是正在刷）、也不含 noResults/passParse（不是读取失败）。
 */
const ABNORMAL_STATUSES: EResultParseStatus[] = [
  EResultParseStatus.parseError,
  EResultParseStatus.unknownError,
  EResultParseStatus.needLogin,
  EResultParseStatus.noUserInput,
];

/**
 * 异常行单独一张表（用户 2026-10-08）。读不出的站混在几十行正常数据里要翻很久，
 * 而它们恰恰是唯一需要他动手的（重新登录、去站点看看）。
 *
 * 走 tableData 而不是 filteredTableData：这是一份「哪些站这次没读到」的健康清单，
 * 不该被搜索框筛掉 —— 他搜某个站的时候，别的站坏了这件事不应该因此消失。
 * 一条都没有时整块不渲染（含标题），留一张空表在那儿是新的噪音。
 *
 * 列与主表同一份（blockColumns），所以这一块不再有自己那颗「状态」列：读取失败时
 * 「更新时间」那一格本来就画成状态标签（UserInfoCell 的 updateAt 分支，主表一直是这个画法），
 * 信息没丢，位置与主表一致。
 */
const abnormalTableData = computed(() =>
  tableData.value.filter((row) => ABNORMAL_STATUSES.includes(row.status as EResultParseStatus)),
);

/**
 * 分享率低于 1 的站点再单独一张表（用户 2026-10-13）。它们要的不是「重新登录」而是「去补上传」，
 * 混在几十行里靠手动排序翻，正好像现在这样只有一两个坏消息时反而最容易看漏。
 *
 * 判据不写第二份：用 `@/shared/ratioGuard.ts` 的 `ratioTier`，`danger` 那一档就是发送下载器时
 * 拦人确认的同一档，两处各判一次迟早分叉。标题里那个阈值也直接取 `RATIO_DANGER_CEIL`，
 * 常量改了文案跟着改。站点没报出数（`-1` / `NaN` / 空串）由它归成 `unknown`，本来就进不来；
 * `+Infinity`（有上传没下载）是达标里最好的一档，同样不进。
 *
 * 与异常表同两条口径：走 tableData 不走 filteredTableData（他搜某个站时，别的站欠着分享率
 * 这件事不该因此消失）；一条都没有时整块不渲染。
 *
 * 刻意**不**再按 status 筛一道：这一格显示的就是主表同一行显示的那个数，再筛一次会出现
 * 「主表写着 0.23、这块却说没有」的自相矛盾。读取失败那条由上面那块点名，不重复报。
 */
const lowRatioTableData = computed(() =>
  tableData.value
    .filter((row) => ratioTier(row.ratio) === "danger")
    .sort((a, b) => Number(a.ratio) - Number(b.ratio)),
);

const tableNonBooleanControlKey = [
  "joinTimeFormat",
  // Deprecated
  "joinTimeWeekOnly",
];

// 过滤出表格控制中非布尔类型的键
const filteredTableBooleanControlKeys = computed(() => {
  return Object.keys(configStore.myDataTableControl).filter(
    (key) => tableNonBooleanControlKey.indexOf(key) === -1,
  ) as (keyof typeof configStore.myDataTableControl)[];
});

/** 对应原 v-btn-toggle 里 v-for 出来的三个入站时间格式按钮 */
const joinTimeFormatOptions = computed(() =>
  ["alive", "aliveWeek", "added"].map((type) => ({
    value: type,
    label: t(`MyData.index.joinTimeFormatOptions.${type}`),
  })),
);

const {
  tableWaitFilterRef,
  tableFilterRef,
  tableFilterFn,
  advanceFilterDictRef,
  updateTableFilterValueFn,
  buildFilterDictFn,
  setKeywordRequiredFn,
} = useTableCustomFilter<IUserInfoItem>({
  parseOptions: {
    keywords: ["site", "status", "siteUserConfig.groups"],
    ranges: ["updateAt", "messageCount"],
  },
  titleFields: ["site", "siteName", "name"],
  format: {
    status: "number",
  },
});

const showMessageDialog = ref<boolean>(false);
const messageDialogSiteId = ref<TSiteID | null>(null);
/**
 * 打开弹窗时把「站点报告的未读数」一起递进去：弹窗要靠它判断「列表一条都没有」到底是
 * 真没信，还是没解析出来 —— 后者不能拿「没有未读消息」冒充（见 SiteMessagesDialog 的空态）。
 * 用的是站点给的原始数字，不减本地已读：本地读过几条不影响信箱页上有没有行。
 */
const messageDialogUnread = ref<number>(0);

/**
 * 格子里那颗红数字/圆点被点中时由 UserInfoCell 递上来。「按事件目标分流」那条判据住在格子里
 * （只有它知道点的是 a-badge 的哪一层：指示物开弹窗，图标本体留给 SiteFavicon 自己的 click 去刷新），
 * 这里只负责开弹窗。
 */
function openMessagesDialog(payload: { site: TSiteID; unread: number }) {
  messageDialogSiteId.value = payload.site;
  messageDialogUnread.value = payload.unread;
  showMessageDialog.value = true;
}

const tableSelected = ref<TSiteID[]>([]); // 选中的站点行

const showAllMessagesDialog = ref<boolean>(false);

/**
 * 工具条「站内信」按钮上的汇总数字：各站报的未读数之和。
 * 用的是站点给的原始值，不减本地已读记账 —— 口径与行内那颗徽章完全一致
 * （见 SiteMessagesDialog 顶部；同一条被扣两遍会把红数字长期压小）。
 */
const totalUnreadMessageCount = computed(() =>
  tableData.value.reduce((sum, row) => sum + (row.messageCount ?? 0), 0),
);

/** 对应 v-data-table 的 show-select + item-value="site" */
const tableRowSelection = computed(() => ({
  selectedRowKeys: tableSelected.value,
  onChange: (keys: (string | number)[]) => {
    tableSelected.value = keys as TSiteID[];
  },
  // 对应 v-data-table 的 item-selectable="selectable"（判据在 utils/lastUserData.ts：
  // isDead / isOffline 的站点不让选）
  getCheckboxProps: (record: IUserInfoItem) => ({ disabled: !record.selectable }),
}));

/**
 * 对应 v-data-table 的 :search + :custom-filter。
 * tableFilterFn 来自 useAdvanceFilter，是通用的过滤实现（不含 Vuetify 逻辑），
 * 只是它的第三个参数需要 { raw } 包装 —— 那是 Vuetify 的内部 item 结构，这里补上即可。
 */
const filteredTableData = computed<IUserInfoItem[]>(() => {
  const query = tableFilterRef.value;
  if (!query) return tableData.value;
  return tableData.value.filter((raw) => tableFilterFn(undefined, query, { raw }));
});

// 这里什么都不用挂。
//
// 表格数据（utils/lastUserData.ts 的 tableData）是从 metadataStore.sites / allAddedSiteMetadata /
// metadataStore.lastUserInfo 三处派生出来的 computed，而 pinia 水合完成的那次 $patch 本身就是一次
// 依赖变化 —— Vue 会自动重算，不需要 onMounted 去拉、不需要 $onReady 等水合、也不需要
// 「监听 lastUserInfo 变化后整表重建」的 debounce watcher。
//
// 上面这三样东西原来都存在，且只有 $onReady + 5 秒 debounce watcher 这一条路能走通：
// 挂载时 sites 还是水合前的空对象，取数空跑一遍，真正让数据出现的是水合触发 watcher、5 秒后
// 重建整表 —— 实测「水合 → 首行」5403ms，其中 5000ms 是白等的 debounce。
// 那是给一条 Vue 已经免费提供的边手动补的轮子。v0.22.9 用 $onReady 止血，本次连同轮子一起拆掉。

const showHistoryDataViewDialog = ref<boolean>(false);
const historyDataViewDialogSiteId = ref<TSiteID | null>(null);
function viewHistoryData(siteId: TSiteID) {
  showHistoryDataViewDialog.value = true;
  historyDataViewDialogSiteId.value = siteId;
}

async function multiOpen() {
  // ⚠️ 弹窗必须在**用户手势那一帧**同步打开：原先这里先 await getSiteUrl()
  // （里面是 `await import()` 取站点定义，真跨了任务边界），手势链一断，
  // window.open 被拦且不给任何提示 —— 选了 5 个站点只开出 1 个标签页。
  // 办法：同步开占位窗口拿到句柄，之后再逐个填地址。
  // 句柄必须**按位**存（map 天然如此）：少存一个，windows[i] 与 siteId 就整体错位，
  // 每个站点会导航到别人的那个标签页。
  const siteIds = tableSelected.value;
  const windows: (Window | null)[] = siteIds.map(() => window.open("about:blank", "_blank"));

  for (const [i, siteId] of siteIds.entries()) {
    const siteUrl = await metadataStore.getSiteUrl(siteId);
    const w = windows[i];
    if (siteUrl && w) {
      try {
        w.location.href = siteUrl;
      } catch (e) {
        // 用户提前把占位标签页关掉了：退回直接开，让 Chrome 自己处理
        console.error("[MyData] 指定下载位置失败，回落到 window.open", siteId, e);
        window.open(siteUrl, "_blank", "noopener noreferrer");
      }
      // 占位窗口是我们自己开的、带着 opener，原来那串 "noopener noreferrer" 在这条路上
      // 整个丢了：站点页拿到 window.opener 就能反向导航设置页（reverse tabnabbing）。
      // 把 opener 置 null 不要求同源，导航发起后立刻断开。
      try {
        w.opener = null;
      } catch {
        // 断开失败也不影响已经发起的导航
      }
    } else {
      // 拿不到地址就把占位窗口关掉，别留一个空白标签页
      w?.close();
    }
  }
}

async function multiFlush() {
  let flushSiteIds: TSiteID[] = tableSelected.value;
  if (flushSiteIds.length === 0) {
    flushSiteIds = tableData.value.map((item) => item.site);
    runtimeStore.showSnakebar(t("MyData.index.noSiteSelectedRefreshAll"), { color: "info" });
  }

  if (flushSiteIds.length > 0) {
    flushSiteLastUserInfo(flushSiteIds);
  } else {
    runtimeStore.showSnakebar(t("MyData.index.noSiteSelectedCancelRefresh"), { color: "warning" });
  }
}

// 时间线 / 统计两个子页分别依赖 konva 与 echarts。
//
// ⚠️ 原注释写「WXT 版尚未平移（见 README Roadmap）」——**早已平移**：两页都已实际 import
// （UserDataTimeline/Index.vue 的 konva/vue-konva、UserDataStatistic/Index.vue 的
// echarts/vue-echarts），plugins/router.ts 也已注册同名路由，README Roadmap 早已标 [x]。
// 所以下面两个 hasRoute 守卫**恒真**，:254 / :267 的「未平移」提示与 locales 里对应的两条文案
// 都是死码。守卫本身留着无害（将来路由改名会真的拦住），但别再当成「功能没做」的证据。
function viewTimeline() {
  if (!router.hasRoute("UserDataTimeline")) {
    runtimeStore.showSnakebar(t("MyData.index.timelineNotMigrated"), { color: "warning" });
    return;
  }
  router.push({
    name: "UserDataTimeline",
    query: {
      sites: tableSelected.value,
    },
  });
}

function viewStatistic() {
  if (!router.hasRoute("UserDataStatistic")) {
    runtimeStore.showSnakebar(t("MyData.index.statisticNotMigrated"), { color: "warning" });
    return;
  }
  router.push({
    name: "UserDataStatistic",
    query: {
      sites: tableSelected.value,
    },
  });
}

const showExportDialog = ref(false);
const showLevelProgressDialog = ref(false);
</script>

<template>
  <!-- 顶部那条 a-alert 页标题去掉了：左侧导航已经标出当前页，这里再占一条只是把表格往下推。
       骨架（48px 工具条 + 白底面板）见 style.css 的 .page / .page-bar / .page-panel。 -->
  <div class="page">
    <a-flex align="center" gap="small" wrap justify="space-between" class="page-bar">
      <a-flex align="center" gap="small" wrap>
        <!-- 刷新，取消刷新 -->
        <a-button v-if="runtimeStore.isUserInfoFlush" type="primary" @click="cancelFlushSiteLastUserInfo"><template #icon><StopOutlined /></template><span>{{ t('MyData.index.flushCancel') }}</span></a-button>

        <a-button v-else type="primary" @click="multiFlush"><template #icon><SyncOutlined /></template><span>{{ t('MyData.index.flushSelectSite') }}</span></a-button>

        <a-button :disabled="tableSelected.length === 0" @click="multiOpen"><template #icon><ExportOutlined /></template><span>{{ t('MyData.index.multiOpen') }}</span></a-button>

        <a-divider type="vertical" class="mx-2" />

        <a-button @click="viewTimeline"><template #icon><LineChartOutlined /></template><span>{{ t('MyData.index.viewTimeline') }}</span></a-button>
        <a-button @click="viewStatistic"><template #icon><BarChartOutlined /></template><span>{{ t('MyData.index.viewStatistic') }}</span></a-button>

        <!-- 各站等级叫法不一，表格那一列没法横向比；阶梯单独收进弹窗，按「离下一级还差多远」排 -->
        <a-button @click="showLevelProgressDialog = true"><template #icon><TrophyOutlined /></template><span>{{ t('MyData.index.levelProgress') }}</span></a-button>

        <a-divider type="vertical" class="mx-2" />

        <!-- 导出按钮 -->
        <a-button @click="showExportDialog = true"><template #icon><ExportOutlined /></template><span>{{ t('MyData.index.exportData') }}</span></a-button>

        <a-divider type="vertical" class="mx-2" />

        <!-- 表格设置面板：原 v-menu + v-list，antdv-next 没有 a-list，改用 a-popover + 普通 div -->
        <a-popover trigger="click" placement="bottomLeft">
          <template #default>
            <a-button class="mr-1"><template #icon><SettingOutlined /></template><span>{{ t('MyData.index.setting') }}</span></a-button>
          </template>
          <template #content>
            <div class="table-setting-panel">
              <!-- 入站时间显示 -->
              <div class="d-flex align-center mb-2">
                <CalendarOutlined class="mr-2" />
                <span class="text-label-large">{{ t("MyData.index.joinTimeFormat") }}</span>
                <a-segmented
                  v-model:value="configStore.myDataTableControl.joinTimeFormat"
                  size="small"
                  :options="joinTimeFormatOptions"
                  @change="() => configStore.$save()"
                />
              </div>

              <a-divider class="my-2" />

              <!-- 其他开关控制 -->
              <div v-for="index in filteredTableBooleanControlKeys" :key="index" class="d-flex align-center mb-2">
                <a-switch
                  v-model:checked="configStore.myDataTableControl[index]"
                  size="small"
                  @change="() => configStore.$save()"
                />
                <span class="text-label-large ml-2">{{ t("MyData.index." + index) }}</span>
              </div>
            </div>
          </template>
        </a-popover>

        <!-- 列显隐：勾选面板收进按钮 + modal，工具条不再摊一排 tag -->
        <a-button @click="showColumnDialog = true"><template #icon><ColumnWidthOutlined /></template><span>{{ t("MyData.index.columns") }}</span></a-button>

        <!-- 站内信汇总。a-badge 要包住整颗按钮：只包文字那一半会把数字裁到按钮右沿内侧 -->
        <a-divider type="vertical" class="mx-2" />

        <a-tooltip :title="t('MyData.index.allMessagesTip')">
          <a-badge :count="totalUnreadMessageCount" :overflow-count="99">
            <a-button @click="showAllMessagesDialog = true"><template #icon><MailOutlined /></template><span>{{ t("MyData.index.allMessages") }}</span></a-button>
          </a-badge>
        </a-tooltip>
      </a-flex>

      <div class="page-bar-extra">
      <!-- 搜索框：原 v-text-field + prepend-inner 里的 v-menu 筛选面板 -->
      <a-input
        v-model:value="tableWaitFilterRef"
        allow-clear
        :placeholder="t('common.search')"
        class="my-data-search"
        @clear="buildFilterDictFn('')"
      >
        <template #prefix>
          <a-popover trigger="click" placement="bottomLeft">
            <template #default>
              <FilterOutlined style="cursor: pointer" />
            </template>
            <template #content>
              <div class="table-setting-panel">
                <div class="text-body-small text-medium-emphasis ma-2">{{ t("MyData.index.siteStatus") }}</div>

                <div class="advance-filter-item">
                  <a-button type="text" size="small" @click="advanceFilterDictRef.updateAt = ['', formatDate(currentDate, 'yyyyMMdd')]; updateTableFilterValueFn();">
                    {{ t("MyData.index.filter.todayNotUpdated") }}
                  </a-button>
                </div>

                <div class="advance-filter-item">
                  <a-button
                    type="text"
                    size="small"
                    @click="
                      advanceFilterDictRef.status.required = ABNORMAL_STATUSES.map((item) => item.toString());
                      updateTableFilterValueFn();
                    "
                  >
                    {{ t("MyData.index.filter.lastUpdateError") }}
                  </a-button>
                </div>

                <div class="advance-filter-item">
                  <a-button
                    type="text"
                    size="small"
                    @click="advanceFilterDictRef.messageCount = [1, ' ']; updateTableFilterValueFn();"
                  >
                    {{ t("MyData.index.filter.unreadMessage") }}
                  </a-button>
                </div>

                <div class="text-body-small text-medium-emphasis ma-2">{{ t("MyData.index.siteCategory") }}</div>

                <div
                  v-for="(item, index) in metadataStore.getSitesGroupData"
                  :key="index"
                  class="d-flex align-center px-2 advance-filter-item"
                >
                  <a-checkbox
                    :checked="advanceFilterDictRef[`siteUserConfig.groups`].required.includes(index)"
                    :indeterminate="
                      advanceFilterDictRef[`siteUserConfig.groups`].required.length > 0 &&
                      !advanceFilterDictRef[`siteUserConfig.groups`].required.includes(index)
                    "
                    @change="
                      (e: any) => {
                        // 必须用 setKeywordRequiredFn：这里是受控 :checked 且没有 checkbox-group，
                        // 而 toggleKeywordStateFn 只改 exclude、不碰 required，点了等于没反应。
                        // 同时 antd Checkbox 的 change 传的是事件对象，取 e.target.checked。
                        setKeywordRequiredFn(`siteUserConfig.groups`, index, e.target.checked);
                      }
                    "
                    @click.stop
                  />
                  <span class="ml-2">{{ index }} ({{ item.length }})</span>
                </div>
              </div>
            </template>
          </a-popover>
        </template>
        <template #suffix>
          <SearchOutlined />
        </template>
      </a-input>
      </div>
    </a-flex>

    <div ref="pagePanel" class="page-panel">
    <!-- 异常行单独一张表（用户 2026-10-08）：读不出的站混在几十行数据里要翻很久，
         而它们恰恰是唯一需要他动手的。一条都没有时整块不渲染（连标题一起），
         空表占在那儿是新噪音。
         外面这层 div 不是可有可无：style.css 里 `.page-panel > .ant-table-wrapper` 那串
         flex 规则是给「主表」准备的，异常表若也当直接子节点，会被同一条 flex:1 0 auto 拉去
         跟主表抢高度；包一层之后它按 `.page-panel > :not(.ant-table-wrapper)` 拿 flex-shrink:0。 -->
    <div v-if="abnormalTableData.length > 0" class="abnormal-block">
      <a-flex align="center" gap="small" class="block-title">
        <ExclamationCircleOutlined class="cell-icon cell-icon--red" />
        <span>{{ t("MyData.index.abnormalSites", { n: abnormalTableData.length }) }}</span>
      </a-flex>
      <a-table
        bordered
        size="small"
        :columns="blockColumns"
        :data-source="abnormalTableData"
        :row-key="(r: any) => r.site"
        :pagination="false"
        :scroll="{ x: 'max-content' }"
        class="table-header-no-wrap"
      >
        <template #bodyCell="{ column, record }">
          <UserInfoCell
            :column="column"
            :record="record"
            @view-messages="openMessagesDialog"
            @view-history="viewHistoryData"
          />
        </template>
      </a-table>
    </div>

    <!-- 分享率低于 1 的站点单独一张表（用户 2026-10-13）：判据与阈值都取自 ratioGuard，
         理由写在上面的 lowRatioTableData 那段注释里。外层那层 div 同异常块 —— 不能让这张表
         当 .page-panel 的直接子节点，否则它会跟主表抢那条 flex: 1 0 auto。 -->
    <div v-if="lowRatioTableData.length > 0" class="low-ratio-block">
      <a-flex align="center" gap="small" class="block-title">
        <AlertOutlined class="cell-icon cell-icon--yellow" />
        <span>
          {{ t("MyData.index.lowRatioSites", { n: lowRatioTableData.length, ceil: RATIO_DANGER_CEIL }) }}
        </span>
      </a-flex>
      <a-table
        bordered
        size="small"
        :columns="blockColumns"
        :data-source="lowRatioTableData"
        :row-key="(r: any) => r.site"
        :pagination="false"
        :scroll="{ x: 'max-content' }"
        class="table-header-no-wrap"
      >
        <template #bodyCell="{ column, record }">
          <UserInfoCell
            :column="column"
            :record="record"
            @view-messages="openMessagesDialog"
            @view-history="viewHistoryData"
          />
        </template>
      </a-table>
    </div>

    <a-table
      bordered
      :columns="tableColumns"
      :data-source="filteredTableData"
      :loading="isTableLoading"
      :row-key="(r: any) => r.site"
      :row-selection="tableRowSelection"
      :pagination="tablePagination"
      :scroll="{ x: 'max-content' }"
      class="table-header-no-wrap"
      size="small"
      @change="handleTableChange"
    >
      <!-- 每一格的渲染住在 UserInfoCell：主表与上面两块单列表共用同一份 —— 「表头列一样」
           才不会退化成「列名一样、格子里各画一套」（等级列一边是组件、一边是裸文本就是这样）。 -->
      <template #bodyCell="{ column, record }">
        <UserInfoCell
          :column="column"
          :record="record"
          @view-messages="openMessagesDialog"
          @view-history="viewHistoryData"
        />
      </template>
    </a-table>
    </div>
  </div>

  <!-- 列显隐面板：3 列开关（a-row / a-col，:span="8" 一份三列）。
       切换即时生效，所以 :footer="null" 不要「确定/取消」；
       标题走 :title 属性（项目硬规定：不用 #title 插槽、不往标题栏塞控件）。 -->
  <a-modal v-model:open="showColumnDialog" :title="t('MyData.index.columns')" :width="520" :footer="null">
    <a-row :gutter="[16, 12]">
      <a-col v-for="item in columnItems" :key="item.key" :span="8">
        <a-flex align="center" gap="small">
          <a-switch
            size="small"
            :checked="columnVisible(item.key)"
            :disabled="item.fixed"
            @change="(on: boolean) => toggleColumn(item.key, on)"
          />
          <span>{{ item.label }}</span>
        </a-flex>
      </a-col>
    </a-row>
  </a-modal>

  <HistoryDataViewDialog v-model="showHistoryDataViewDialog" :site-id="historyDataViewDialogSiteId!" />
  <AllSiteMessagesDialog v-model="showAllMessagesDialog" />
  <SiteMessagesDialog
    v-model="showMessageDialog"
    :site-id="messageDialogSiteId!"
    :reported-unread="messageDialogUnread"
  />
  <ExportUserInfoDialog v-model="showExportDialog" :selected-site-ids="tableSelected" />
  <LevelProgressDialog v-model="showLevelProgressDialog" />
</template>

<style scoped lang="scss">
.table-setting-panel {
  min-width: 280px;
  max-height: 60vh;
  overflow-y: auto;
}

/* 主表上面那两块小表（异常 / 低分享率）各自与下面的内容留一道缝
   （全站口径 8px 的放大档：这里隔着的是两张表的表头，不是两个控件） */
.abnormal-block,
.low-ratio-block {
  margin-bottom: 16px;
}

.block-title {
  margin-bottom: 6px;
  font-size: 13px;
  color: var(--pt-color-text-secondary);
}

.my-data-search {
  max-width: 500px;
}

.advance-filter-item {
  min-height: 24px;
}

.cell-icon {
  font-size: 14px; /* 原 <v-icon size="small"> */
}
.cell-icon--red {
  color: #c62828; /* Vuetify red-darken-4 */
}
.cell-icon--yellow {
  color: #f9a825; /* Vuetify yellow-darken-4 */
}

/* 格子里那一批规则（站点格 / 未读徽章 / 悬停圆底 / 浮层）跟着模板一起搬进了 UserInfoCell ——
   scoped 样式选不到子组件渲染出来的元素，留在这里等于没写。这里只剩标题那两颗图标用的三条。 */
</style>
