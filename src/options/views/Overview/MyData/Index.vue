<script setup lang="ts">
import { computed, ref, useTemplateRef } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { isUndefined } from "es-toolkit/compat";
// 注意：antdv-next 根入口把这几个类型做了别名再导出（ColumnType -> TableColumnType 等）
import type { TableColumnsType } from "antdv-next";
import {
  AlertOutlined,
  ArrowDownOutlined,
  ArrowUpOutlined,
  BarChartOutlined,
  CalendarOutlined,
  ColumnWidthOutlined,
  DollarOutlined,
  ExclamationCircleOutlined,
  ExportOutlined,
  FilterOutlined,
  LineChartOutlined,
  MailOutlined,
  SearchOutlined,
  SettingOutlined,
  StopOutlined,
  SyncOutlined,
  ThunderboltOutlined,
  UnorderedListOutlined,
} from "@antdv-next/icons";
import { EResultParseStatus, type ISiteUserConfig, type IUserInfo, type TSiteID } from "@ptd/site";

import { useConfigStore } from "@/options/stores/config.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import { useTableCustomFilter } from "@/options/directives/useAdvanceFilter.ts";
import { useTableBehavior } from "@/options/directives/useTableBehavior.ts";
import { buildSortOrderMap, toTableColumns } from "@/options/components/tableSorters.ts";
import { formatDate, formatSize, formatTimeAgo } from "@/options/utils.ts";

import SiteName from "@/options/components/SiteName.vue";
import SiteFavicon from "@/options/components/SiteFavicon/Index.vue";
import ResultParseStatus from "@/options/components/ResultParseStatus.vue";
import UserLevelRequirementsTd from "./UserLevelRequirementsTd.vue";
import HistoryDataViewDialog from "./HistoryDataViewDialog.vue";
import SiteMessagesDialog from "./SiteMessagesDialog.vue";
import AllSiteMessagesDialog from "./AllSiteMessagesDialog.vue";
import BonusFormatSpan from "./BonusFormatSpan.vue";
import ExportUserInfoDialog from "./ExportUserInfoDialog.vue";

import { formatRatio } from "./utils/format.ts";
import { tableData, isTableLoading, cancelFlushSiteLastUserInfo, flushSiteLastUserInfo } from "./utils/lastUserData.ts";

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
});

const tableColumns = computed<TableColumnsType<IUserInfoItem>>(() =>
  toTableColumns<IUserInfoItem>(tableHeader.value, buildSortOrderMap(sortBy.value)),
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

interface IUserInfoItem extends IUserInfo {
  siteUserConfig: ISiteUserConfig;
  siteName: string;
}

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

/** v-badge 的 model-value/content 到 a-badge 的 count/dot 的映射 */
function unreadBadge(record: IUserInfoItem) {
  /**
   * 只显站点自己报的那个数，**不减本地已读**。v0.31.0 拿记账去减，于是徽章和站点横幅
   * 长期对不上（站点横幅「你有2条新短讯」、徽章 1，刷新也不回来）：记账只增不减，
   * 而读信那条 GET 本身就会把站点侧标成已读（LuckPT 真页：读前横幅 8、读后 7），
   * 减一次等于把同一条扣两遍。记账现在只管列表里那行的置灰，见 utils/siteMessageRead.ts。
   */
  const messageCount = record.messageCount ?? 0;
  if (!configStore.myDataTableControl.showUnreadMessage || messageCount <= 0) {
    return { count: 0, dot: false };
  }
  // 超过 10 条时原实现只显示一个小圆点（content 传 undefined）
  return messageCount > 10 ? { count: 0, dot: true } : { count: messageCount, dot: false };
}

const showMessageDialog = ref<boolean>(false);
const messageDialogSiteId = ref<TSiteID | null>(null);
/**
 * 打开弹窗时把「站点报告的未读数」一起递进去：弹窗要靠它判断「列表一条都没有」到底是
 * 真没信，还是没解析出来 —— 后者不能拿「没有未读消息」冒充（见 SiteMessagesDialog 的空态）。
 * 用的是站点给的原始数字，不减本地已读：本地读过几条不影响信箱页上有没有行。
 */
const messageDialogUnread = ref<number>(0);

/**
 * 红数字/圆点是「读站内信」的入口，图标本体仍然是「刷新该站数据」。
 * 两者都落在 a-badge 这一层（a-badge 把 click 挂到根 span 上），所以按事件目标分流：
 * 命中的是徽标指示物才开弹窗，否则什么都不做，让 SiteFavicon 自己的 click 去刷新。
 */
function onBadgeClick(event: MouseEvent, record: IUserInfoItem) {
  const target = event.target as HTMLElement | null;
  if (!target?.closest(".ant-badge-count, .ant-badge-dot")) {
    return;
  }
  messageDialogSiteId.value = record.site;
  messageDialogUnread.value = record.messageCount ?? 0;
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
  // 对应 v-data-table 的 item-selectable="selectable"
  getCheckboxProps: (record: IUserInfoItem) => ({ disabled: !(record as any).selectable }),
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
  for (const siteId of tableSelected.value) {
    const siteUrl = await metadataStore.getSiteUrl(siteId);
    if (siteUrl) {
      window.open(siteUrl, "_blank", "noopener noreferrer");
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
</script>

<template>
  <!-- 顶部那条 a-alert 页标题去掉了：左侧导航已经标出当前页，这里再占一条只是把表格往下推。
       骨架（48px 工具条 + 白底面板）见 style.css 的 .page / .page-bar / .page-panel。 -->
  <div class="page">
    <a-flex align="center" gap="small" wrap justify="space-between" class="page-bar">
      <a-flex align="center" gap="small" wrap>
        <!-- 刷新，取消刷新 -->
        <a-button type="primary" v-if="runtimeStore.isUserInfoFlush" @click="cancelFlushSiteLastUserInfo"><template #icon><StopOutlined /></template><span>{{ t('MyData.index.flushCancel') }}</span></a-button>

        <a-button type="primary" v-else @click="multiFlush"><template #icon><SyncOutlined /></template><span>{{ t('MyData.index.flushSelectSite') }}</span></a-button>

        <a-button :disabled="tableSelected.length === 0" @click="multiOpen"><template #icon><ExportOutlined /></template><span>{{ t('MyData.index.multiOpen') }}</span></a-button>

        <a-divider type="vertical" class="mx-2" />

        <a-button @click="viewTimeline"><template #icon><LineChartOutlined /></template><span>{{ t('MyData.index.viewTimeline') }}</span></a-button>
        <a-button @click="viewStatistic"><template #icon><BarChartOutlined /></template><span>{{ t('MyData.index.viewStatistic') }}</span></a-button>

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
                      advanceFilterDictRef.status.required = [
                        EResultParseStatus.parseError,
                        EResultParseStatus.unknownError,
                        EResultParseStatus.needLogin,
                        EResultParseStatus.noUserInput,
                      ].map((item) => item.toString());
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
      <!-- 站点信息 -->
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'siteUserConfig.sortIndex'">
          <a-badge
            class="site-unread-badge"
            :count="unreadBadge(record).count"
            :dot="unreadBadge(record).dot"
            color="#f44336"
            :title="t('MyData.messages.badgeTip')"
            @click="onBadgeClick($event, record)"
          >
            <div class="site-cell">
              <div class="favicon-hover-wrapper favicon-hover-bg">
                <SiteFavicon
                  :site-id="record.site"
                  :size="configStore.myDataTableControl.showSiteName ? 18 : 24"
                  @click="() => flushSiteLastUserInfo([record.site])"
                />
              </div>

              <SiteName v-if="configStore.myDataTableControl.showSiteName" :site-id="record.site" />
            </div>
          </a-badge>
        </template>

        <!-- 用户名，用户ID -->
        <template v-else-if="column.key === 'name'">
          <span :title="record.id as string" class="text-no-wrap">
            {{ configStore.myDataTableControl.showUserName ? (record.name ?? "-") : "******" }}
          </span>
        </template>

        <!-- 等级信息，升级信息 -->
        <template v-else-if="column.key === 'levelName'">
          <UserLevelRequirementsTd :user-info="record" />
        </template>

        <!-- 上传、下载 -->
        <template v-else-if="column.key === 'uploaded'">
          <div class="d-flex flex-column align-end">
            <div class="d-flex justify-end flex-nowrap">
              <span class="text-no-wrap">
                {{ typeof record.uploaded !== "undefined" ? formatSize(record.uploaded) : "-" }}
              </span>
              <ArrowUpOutlined class="cell-icon cell-icon--green" />
            </div>
            <div class="d-flex justify-end flex-nowrap">
              <span class="text-no-wrap">
                {{ typeof record.downloaded !== "undefined" ? formatSize(record.downloaded) : "-" }}
              </span>
              <ArrowDownOutlined class="cell-icon cell-icon--red" />
            </div>
          </div>
        </template>

        <!-- 真实上传、下载 -->
        <template v-else-if="column.key === 'trueUploaded'">
          <div class="d-flex flex-column align-end">
            <div class="d-flex justify-end flex-nowrap">
              <span class="text-no-wrap">
                {{ typeof record.trueUploaded !== "undefined" ? formatSize(record.trueUploaded) : "-" }}
              </span>
              <ArrowUpOutlined class="cell-icon cell-icon--green" />
            </div>
            <div class="d-flex justify-end flex-nowrap">
              <span class="text-no-wrap">
                {{ typeof record.trueDownloaded !== "undefined" ? formatSize(record.trueDownloaded) : "-" }}
              </span>
              <ArrowDownOutlined class="cell-icon cell-icon--red" />
            </div>
          </div>
        </template>

        <!-- 分享率 -->
        <template v-else-if="column.key === 'ratio'">
          <span class="text-no-wrap">{{ formatRatio(record) }}</span>
        </template>

        <!-- 真实分享率 -->
        <template v-else-if="column.key === 'trueRatio'">
          <span class="text-no-wrap">{{ formatRatio(record, "trueRatio") }}</span>
        </template>

        <!-- 发布数 -->
        <template v-else-if="column.key === 'uploads'">
          <span class="text-no-wrap">{{ record.uploads ?? "-" }}</span>
        </template>

        <!-- 做种数， H&R 情况  -->
        <template v-else-if="column.key === 'seeding'">
          <div class="d-flex flex-column align-end">
            <div class="d-flex align-center justify-end flex-nowrap">
              <span class="text-no-wrap">{{ record.seeding ?? "-" }}</span>
            </div>
            <div v-if="configStore.myDataTableControl.showHnR" class="d-flex align-center justify-end flex-nowrap">
              <span
                v-if="typeof record.hnrPreWarning !== 'undefined' && record.hnrPreWarning > 0"
                class="d-inline-flex align-center ml-2"
              >
                <AlertOutlined class="cell-icon cell-icon--yellow" :title="t('levelRequirement.hnrPreWarning')" />
                <span class="text-no-wrap">
                  {{ record.hnrPreWarning }}
                </span>
              </span>
              <span
                v-if="typeof record.hnrUnsatisfied !== 'undefined' && record.hnrUnsatisfied > 0"
                class="d-inline-flex align-center ml-1"
              >
                <ExclamationCircleOutlined
                  class="cell-icon cell-icon--red"
                  :title="t('levelRequirement.hnrUnsatisfied')"
                />
                <span class="text-no-wrap">
                  {{ record.hnrUnsatisfied }}
                </span>
              </span>
            </div>
          </div>
        </template>

        <!-- 做种量 -->
        <template v-else-if="column.key === 'seedingSize'">
          <span class="text-no-wrap">
            {{ typeof record.seedingSize !== "undefined" ? formatSize(record.seedingSize) : "-" }}
          </span>
        </template>

        <!-- 魔力/积分 -->
        <template v-else-if="column.key === 'bonus'">
          <div class="d-flex flex-column align-end">
            <div class="bonus-line d-flex align-center justify-end flex-nowrap">
              <BonusFormatSpan :num="record.bonus" />
              <DollarOutlined class="cell-icon cell-icon--green" :title="t('levelRequirement.bonus')" />
            </div>
            <div
              v-if="
                configStore.myDataTableControl.showSeedingBonus &&
                record.seedingBonus !== '' &&
                !isUndefined(record.seedingBonus)
              "
              class="bonus-line d-flex align-center justify-end flex-nowrap"
            >
              <BonusFormatSpan :num="record.seedingBonus" />
              <ThunderboltOutlined class="cell-icon cell-icon--green" :title="t('levelRequirement.seedingBonus')" />
            </div>
          </div>
        </template>

        <template v-else-if="column.key === 'bonusPerHour'">
          <BonusFormatSpan :num="record.bonusPerHour" />
        </template>

        <template v-else-if="column.key === 'invites'">
          <span class="text-no-wrap">{{ typeof record.invites !== "undefined" ? record.invites : "-" }}</span>
        </template>

        <!-- 入站时间 -->
        <template v-else-if="column.key === 'joinTime'">
          <span class="text-no-wrap" :title="record.joinTime ? (formatDate(record.joinTime) as string) : '-'">
            {{
              typeof record.joinTime !== "undefined"
                ? configStore.myDataTableControl.joinTimeFormat === "aliveWeek"
                  ? formatTimeAgo(record.joinTime, { weekOnly: true })
                  : configStore.myDataTableControl.joinTimeFormat === "alive"
                    ? formatTimeAgo(record.joinTime)
                    : formatDate(record.joinTime, "yyyy-MM-dd")
                : "-"
            }}
          </span>
        </template>

        <!-- 最近访问时间 -->
        <template v-else-if="column.key === 'lastAccessAt'">
          <span
            class="text-no-wrap"
            :title="record.lastAccessAt ? (formatDate(record.lastAccessAt) as string) : '-'"
          >
            <template v-if="typeof record.lastAccessAt !== 'undefined'">
              {{ formatDate(record.lastAccessAt) }}
              <AlertOutlined
                v-if="record.lastAccessDuration >= 5"
                class="cell-icon"
                :style="{ color: record.lastAccessDuration >= 15 ? '#f44336' : '#ffc107' }"
                :title="t('MyData.table.lastAccessDurationNote', [record.lastAccessDuration])"
              />
            </template>
            <template v-else>-</template>
          </span>
        </template>

        <!-- 更新时间 -->
        <template v-else-if="column.key === 'updateAt'">
          <template v-if="record.status === EResultParseStatus.success">
            <span class="text-wrap" :title="record.updateAt ? (formatDate(record.updateAt) as string) : '-'">
              {{
                record.updateAt
                  ? configStore.myDataTableControl.updateAtFormatAsAlive
                    ? formatTimeAgo(record.updateAt)
                    : formatDate(record.updateAt)
                  : "-"
              }}
            </span>
          </template>
          <template v-else>
            <a-tag>
              <ResultParseStatus :status="record.status" />
            </a-tag>
          </template>
        </template>

        <!-- 操作 -->
        <template v-else-if="column.key === 'action'">
          <!-- 两个按钮的图标都必须走 #icon 插槽（与 SetSite、SearchEntity/ActionTd 同一写法）：
               挂在默认插槽时 antd 的 loading 图标是**插在按钮前面**的，还带一段 width 0→N 的
               过渡动画（button/DefaultLoadingIcon.js 的 existIcon 分支）—— 按钮变宽就把整张表
               的列宽重排一遍；挂进 #icon 后 loading 是原地替换同一个 .ant-btn-icon，宽度不动。
               顺带统一尺寸：默认插槽的图标不算 icon-only，内衬比 #icon 那档宽 4px。 -->
          <div class="table-action">
            <a-tooltip :title="t('MyData.table.action.viewHistoryData')">
              <a-button
                type="text"
                size="small"
                @click="viewHistoryData(record.site)"
              >
                <template #icon><UnorderedListOutlined /></template>
              </a-button>
            </a-tooltip>
            <a-tooltip :title="t('MyData.table.action.flushData')">
              <a-button
                type="text"
                size="small"
                :disabled="runtimeStore.userInfo.flushPlan[record.site]"
                :loading="runtimeStore.userInfo.flushPlan[record.site]"
                @click="flushSiteLastUserInfo([record.site])"
              >
                <template #icon><SyncOutlined /></template>
              </a-button>
            </a-tooltip>
          </div>
        </template>
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
</template>

<style scoped lang="scss">
.table-setting-panel {
  min-width: 280px;
  max-height: 60vh;
  overflow-y: auto;
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
.cell-icon--green {
  color: #388e3c; /* Vuetify green-darken-4 */
}
.cell-icon--red {
  color: #c62828; /* Vuetify red-darken-4 */
}
.cell-icon--yellow {
  color: #f9a825; /* Vuetify yellow-darken-4 */
}

.favicon-hover-wrapper {
  cursor: pointer;
}

/* 站点列：图标在左、站名在右（原来是上下两行，行高被堆成 63.8px）。
   未读徽标因此改成包住「图标 + 站名」整块：antd 的数字挂在被包元素右边缘之外半个自身宽度
   （台架实测一位数溢出 9.5px、两位数 13.4px），只包图标时横排后数字会压到站名第一个字
   （gap 4 实测重叠 5.5px），要让开就得把图标到文字撑到 18px 以上。包整块之后数字落在
   站名右上角，图标与文字就能留紧的 8px（含悬停圆底那 4px 内衬，实测墨迹间距 12px）。 */
.site-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 红数字/圆点是读站内信的入口，得看着能点（图标本体是刷新，另有 cursor） */
.site-unread-badge {
  :deep(.ant-badge-count),
  :deep(.ant-badge-dot) {
    cursor: pointer;
  }
}

.favicon-hover-bg {
  border-radius: 50%;
  transition: background 0.2s;
  display: inline-flex;
  padding: 4px;
}

.favicon-hover-bg:hover {
  background: rgba(0, 0, 0, 0.3);
}
</style>
