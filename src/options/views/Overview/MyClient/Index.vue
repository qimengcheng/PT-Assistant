<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useTemplateRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  CloudUploadOutlined,
  ClockCircleOutlined,
  ColumnWidthOutlined,
  DeleteOutlined,
  EyeOutlined,
  FieldTimeOutlined,
  FileSearchOutlined,
  PauseOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SearchOutlined,
  StopOutlined,
  SwapOutlined,
  TagsOutlined,
  ThunderboltOutlined,
  VerticalAlignBottomOutlined,
  VerticalAlignTopOutlined,
} from "@antdv-next/icons";
import type { TableColumnsType, TableRowSelection } from "antdv-next";

import {
  CTorrentState,
  getDownloaderIcon,
  getDownloaderMetaData,
  type CTorrent,
  type TorrentClientMetaData,
  type TorrentQueueDirection,
} from "@ptd/downloader";
import { sendMessage } from "@/messages.ts";
import { formatSize, formatDate } from "@/options/utils.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { useConfigStore } from "@/options/stores/config.ts";
import { buildSortOrderMap, isPageSizePicked, toPagination, toTableColumns } from "@/options/components/tableSorters.ts";
import { useAutoFitPageSize } from "@/options/directives/useAutoFitPageSize.ts";

import DeleteDialog from "./DeleteDialog.vue";
import PushToDownloaderDialog from "./PushToDownloaderDialog.vue";
import TorrentStateTd from "./TorrentStateTd.vue";
import ClientStatusDialog from "./ClientStatusDialog.vue";
import TorrentDetailDialog from "./TorrentDetailDialog.vue";
import SpeedLimitDialog from "./SpeedLimitDialog.vue";
import LabelDialog from "./LabelDialog.vue";
import RecheckConfirmDialog from "./RecheckConfirmDialog.vue";

import {
  torrents,
  selectedDownloaderIds,
  suspendedDownloaders,
  autoRefreshRunning,
  globalRefreshInterval,
  useClientRefresh,
} from "./utils.ts";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const metadataStore = useMetadataStore();
const runtimeStore = useRuntimeStore();
const configStore = useConfigStore();

const {
  activeDownloaderIds,
  loadSingleDownloader,
  scheduleDownloaderRefresh,
  stopAllTimers,
  toggleAutoRefresh,
} = useClientRefresh();

// ── state ──────────────────────────────────────────────────────────────────
const loading = ref(false);

const tableSelected = ref<CTorrent[]>([]);
const searchText = ref("");

/** 工具条那排状态筛选的取值：`all` 或七个种子状态之一 */
type AllOrState = "all" | CTorrentState;
/**
 * 按状态筛选（用户 2026-10-08：「加个 radio button group，可以按状态分类筛选」）。
 * 与搜索框是叠加关系；不持久化 —— 这一页的搜索框、下载器筛选都不存，单独把这一档存下来反而不一致。
 */
const stateFilter = ref<AllOrState>("all");

// delete dialog
const showDeleteDialog = ref(false);
const toDeleteTorrents = ref<CTorrent[]>([]);

// push to downloader dialog
const showPushToDownloaderDialog = ref(false);

// detail dialog
const showDetailDialog = ref(false);
const detailTorrent = ref<CTorrent | null>(null);

// speed limit dialog
const showSpeedLimitDialog = ref(false);

// label dialog
const showLabelDialog = ref(false);

// recheck confirm dialog
const showRecheckDialog = ref(false);
const toRecheckTorrents = ref<CTorrent[]>([]);

// client status dialog
const showClientStatusDialog = ref(false);

const totalUpSpeed = computed(() => allTorrents.value.reduce((acc, t) => acc + (t.uploadSpeed ?? 0), 0));
const totalDlSpeed = computed(() => allTorrents.value.reduce((acc, t) => acc + (t.downloadSpeed ?? 0), 0));

// ── computed ───────────────────────────────────────────────────────────────
const allTorrents = computed(() => Object.values(torrents.value).flat());

const filteredTorrents = computed(() => {
  const active = activeDownloaderIds.value;
  let base = active.flatMap((id) => torrents.value[id] ?? []);
  if (stateFilter.value !== "all") {
    base = base.filter((torrent) => torrent.state === stateFilter.value);
  }
  if (!searchText.value) return base;
  const q = searchText.value.toLowerCase();
  return base.filter(
    (t) =>
      t.name.toLowerCase().includes(q) ||
      t.infoHash.toLowerCase().includes(q) ||
      (t.label ?? "").toLowerCase().includes(q) ||
      t.savePath.toLowerCase().includes(q),
  );
});

/**
 * 标签全部走字面 `t()`：防线③（check-locale-keys）看不见 `t("前缀" + x)` 这种拼出来的键，
 * 而这里七个状态名和表格里那颗 chip 共用同一批键 —— 写成动态的就等于把这七处交给肉眼核对。
 */
const stateFilterOptions = computed(() => [
  { value: "all" as AllOrState, label: t("MyClient.stateFilterAll") },
  { value: CTorrentState.downloading, label: t("MyClient.state.downloading") },
  { value: CTorrentState.seeding, label: t("MyClient.state.seeding") },
  { value: CTorrentState.queued, label: t("MyClient.state.queued") },
  { value: CTorrentState.checking, label: t("MyClient.state.checking") },
  { value: CTorrentState.paused, label: t("MyClient.state.paused") },
  { value: CTorrentState.error, label: t("MyClient.state.error") },
  { value: CTorrentState.unknown, label: t("MyClient.state.unknown") },
]);

// 当前选中种子的下载器类型对应的能力元数据（用于显示可用操作）
const clientMetaMap = ref<Record<string, TorrentClientMetaData>>({});

async function ensureClientMeta(clientId: string) {
  const type = metadataStore.downloaders[clientId]?.type;
  if (type && !clientMetaMap.value[type]) {
    clientMetaMap.value[type] = await getDownloaderMetaData(type);
  }
}

/** 判断某个 feature 在该下载器上是否可用 */
function isFeatureAllowed(clientId: string, feature: keyof TorrentClientMetaData["feature"]): boolean {
  const type = metadataStore.downloaders[clientId]?.type;
  return clientMetaMap.value[type]?.feature?.[feature]?.allowed !== false;
}

// 在表格渲染时按需加载选中/可见种子的客户端能力元数据
async function loadVisibleClientMeta() {
  const ids = new Set(allTorrents.value.map((t) => t.clientId));
  await Promise.all([...ids].map(ensureClientMeta));
}

// ── table headers ─────────────────────────────────────────────────────────
const fullTableHeader = computed(
  () =>
    [
      { title: t("MyClient.table.client"), key: "clientId", align: "center", width: 120, props: { disabled: true } },
      { title: t("MyClient.table.name"), key: "name", align: "start", props: { disabled: true } },
      { title: t("MyClient.table.size"), key: "totalSize", align: "end", width: 110 },
      { title: t("MyClient.table.progress"), key: "progress", align: "end", width: 90 },
      { title: t("MyClient.table.status"), key: "state", align: "center", width: 110 },
      { title: t("MyClient.table.upSpeed"), key: "uploadSpeed", align: "end", width: 100 },
      { title: t("MyClient.table.dlSpeed"), key: "downloadSpeed", align: "end", width: 100 },
      { title: t("MyClient.table.totalUploaded"), key: "totalUploaded", align: "end", width: 100 },
      { title: t("MyClient.table.totalDownloaded"), key: "totalDownloaded", align: "end", width: 100 },
      { title: t("MyClient.table.ratio"), key: "ratio", align: "end", width: 80 },
      { title: t("MyClient.table.savePath"), key: "savePath", align: "start" },
      { title: t("MyClient.table.addedAt"), key: "dateAdded", align: "center", width: 160 },
      {
        title: t("common.action"),
        key: "action",
        align: "center",
        sortable: false,
        width: 120,
        props: { disabled: true },
      },
    ] as any[],
);

/**
 * 列定义。⚠️ 必须给每列都带上真正的 compare 函数（makeSorter）：
 * 原来这里只做了 `{ ...item, dataIndex: item.key }`，整张表一个 sorter 都没有，
 * 而 antd 只在列上带 sorter 时才渲染排序箭头 —— 结果是「客户端」页面完全无法排序，
 * handleTableChange 收到的 sorter 恒为空对象，configStore.tableBehavior.MyClient.sortBy
 * 是个死配置（表格可以排但排完记不下来）。
 */
const tableHeader = computed<TableColumnsType<CTorrent>>(
  () =>
    toTableColumns<CTorrent>(
      fullTableHeader.value.filter(
        (item) => item?.props?.disabled || (configStore.tableBehavior["MyClient"] as any)?.columns?.includes(item.key),
      ),
      tableSortOrder.value,
    ),
);

/** 列显隐多选：v-model 走 configStore，setter 里调 updateTableBehavior 保持原「双写」语义 */
const selectedColumnKeys = computed<string[]>({
  get: () => (configStore.tableBehavior["MyClient"] as any)?.columns ?? [],
  set: (v) => {
    (configStore.tableBehavior["MyClient"] as any).columns = v;
    configStore.updateTableBehavior("MyClient", "columns", v);
  },
});

/**
 * 列显隐面板：工具条只留一个「自定义列」按钮，点开 modal 用 3 列开关逐个切。
 * 原先那是一个 mode="multiple" 的 a-select，10 个列名摊成 tag 把右上角撑成一整块。
 * 切换即时写入 configStore（沿用旧多选框语义），所以没有草稿态、也不需要「确定」。
 */
type ColumnItem = { key: string; label: string; fixed: boolean };

const showColumnDialog = ref<boolean>(false);

const columnItems = computed<ColumnItem[]>(() =>
  fullTableHeader.value.map((item) => ({ key: item.key, label: item.title, fixed: !!item.props?.disabled })),
);

/**
 * 固定列（`props.disabled`：下载器、种子名称、操作）永远会显示 —— tableHeader 的过滤条件是
 * `props.disabled || 已选`。所以它们的开关显示成「开且不可改」，而不是拨了没反应。
 */
const fixedColumnKeys = computed(() => fullTableHeader.value.filter((i) => i.props?.disabled).map((i) => i.key));

const columnVisible = (key: string) => selectedColumnKeys.value.includes(key) || fixedColumnKeys.value.includes(key);

const toggleColumn = (key: string, on: boolean) => {
  const next = new Set(selectedColumnKeys.value);
  if (on) next.add(key);
  else next.delete(key);
  selectedColumnKeys.value = [...next];
};

// ── data loading ──────────────────────────────────────────────────────────
/** Manual full refresh: fetch all active downloaders, skipping the circuit-broken ones. */
async function loadTorrents() {
  const targetIds = activeDownloaderIds.value.filter((id) => !suspendedDownloaders.value.has(id));
  if (targetIds.length === 0) {
    // 全被熔断时点刷新会"什么都没发生"，必须说清去哪恢复
    if (activeDownloaderIds.value.length > 0) {
      runtimeStore.showSnakebar(t("MyClient.allSuspended"), { color: "warning", timeout: 8 });
    }
    return;
  }
  loading.value = true;
  tableSelected.value = [];
  try {
    await Promise.allSettled(targetIds.map((id) => loadSingleDownloader(id)));
  } finally {
    loading.value = false;
    await loadVisibleClientMeta();
    if (autoRefreshRunning.value) {
      for (const id of activeDownloaderIds.value) {
        scheduleDownloaderRefresh(id);
      }
    }
  }
}

onMounted(async () => {
  // 两条分支都读异步水合的 store：`downloaders` 决定 `?downloader=<id>` 能不能预选上，
  // `download.initDownloaderTorrentOnEnter` 决定进来要不要自动拉种子列表。
  // 不等水合就是：从「下载器」页跳过来时预选丢失、自动加载按默认值走 —— 都是静默的。
  await Promise.all([metadataStore.$onReady(), configStore.$onReady()]);

  // 支持从 SetDownloader 等页面通过 ?downloader=<id> 预选单个下载服务器
  const queryDownloaderId = route.query.downloader as string | undefined;
  if (queryDownloaderId && metadataStore.downloaders[queryDownloaderId]) {
    selectedDownloaderIds.value = [queryDownloaderId];
    // 预选是一次性导航行为，清除 URL query 避免刷新页面后重复预选
    void router.replace({ path: "/my-client" });
    loadTorrents();
  } else if (configStore.download.initDownloaderTorrentOnEnter) {
    loadTorrents();
  }
});

onUnmounted(() => {
  stopAllTimers();
});

// ── actions ───────────────────────────────────────────────────────────────
async function pauseTorrents(torrents: CTorrent[]) {
  if (torrents.length === 0) return;
  const results = await Promise.allSettled(
    torrents.map((t) => sendMessage("pauseClientTorrent", { downloaderId: t.clientId, id: t.id })),
  );
  const succeeded = results.filter((r) => r.status === "fulfilled" && Boolean(r.value)).length;
  runtimeStore.showSnakebar(t("MyClient.action.pauseSelectedSuccess", { count: succeeded }), { color: "success" });
  const affectedIds = [...new Set(torrents.map((t) => t.clientId))];
  await Promise.allSettled(affectedIds.map(loadSingleDownloader));
}

async function resumeTorrents(torrents: CTorrent[]) {
  if (torrents.length === 0) return;
  const results = await Promise.allSettled(
    torrents.map((t) => sendMessage("resumeClientTorrent", { downloaderId: t.clientId, id: t.id })),
  );
  const succeeded = results.filter((r) => r.status === "fulfilled" && Boolean(r.value)).length;
  runtimeStore.showSnakebar(t("MyClient.action.resumeSelectedSuccess", { count: succeeded }), { color: "success" });
  const affectedIds = [...new Set(torrents.map((t) => t.clientId))];
  await Promise.allSettled(affectedIds.map(loadSingleDownloader));
}

function openDeleteDialog(torrentList: CTorrent[]) {
  toDeleteTorrents.value = torrentList;
  showDeleteDialog.value = true;
}

function openDetailDialog(item: CTorrent) {
  detailTorrent.value = item;
  showDetailDialog.value = true;
}

function openRecheckDialog(torrentList: CTorrent[]) {
  if (torrentList.length === 0) return;
  toRecheckTorrents.value = torrentList;
  showRecheckDialog.value = true;
}

async function recheckTorrents() {
  const torrentList = toRecheckTorrents.value;
  if (torrentList.length === 0) return;
  const results = await Promise.allSettled(
    torrentList.map((t) => sendMessage("recheckClientTorrent", { downloaderId: t.clientId, id: t.id })),
  );
  const succeeded = results.filter((r) => r.status === "fulfilled" && Boolean(r.value)).length;
  runtimeStore.showSnakebar(t("MyClient.action.recheckSelectedSuccess", { count: succeeded }), {
    color: succeeded > 0 ? "success" : "error",
  });
  const affectedIds = [...new Set(torrentList.map((t) => t.clientId))];
  await Promise.allSettled(affectedIds.map(loadSingleDownloader));
}

async function moveTorrentsInQueue(torrentList: CTorrent[], direction: TorrentQueueDirection) {
  if (torrentList.length === 0) return;
  const results = await Promise.allSettled(
    torrentList.map((t) => sendMessage("moveClientTorrentInQueue", { downloaderId: t.clientId, id: t.id, direction })),
  );
  const succeeded = results.filter((r) => r.status === "fulfilled" && Boolean(r.value)).length;
  runtimeStore.showSnakebar(t("MyClient.action.moveQueueSuccess", { count: succeeded }), {
    color: succeeded > 0 ? "success" : "error",
  });
  const affectedIds = [...new Set(torrentList.map((t) => t.clientId))];
  await Promise.allSettled(affectedIds.map(loadSingleDownloader));
}

// Called per-item by DeleteDialog
async function confirmDeleteTorrent(torrentKey_: string, removeData: boolean): Promise<void> {
  const torrent = toDeleteTorrents.value.find((t) => torrentKey(t) === torrentKey_);
  if (!torrent) return;
  await sendMessage("deleteClientTorrent", {
    downloaderId: torrent.clientId,
    id: torrent.id,
    removeData,
  });
}

function clientName(clientId: string) {
  return metadataStore.downloaders[clientId]?.name ?? clientId;
}

function clientIcon(clientId: string) {
  const type = metadataStore.downloaders[clientId]?.type;
  return type ? getDownloaderIcon(type) : undefined;
}

/** 清除下载器预选筛选（恢复显示全部下载器） */
function clearDownloaderFilter() {
  selectedDownloaderIds.value = [];
  void loadTorrents();
}

function torrentKey(torrent: CTorrent) {
  return `${torrent.clientId}:${String(torrent.id)}`;
}

// ── table glue ────────────────────────────────────────────────────────────
/** antd 无 v-model：受控选择，等价于 v-data-table 的 v-model + return-object */
const rowSelection = computed<TableRowSelection<CTorrent>>(() => ({
  selectedRowKeys: tableSelected.value.map((t) => torrentKey(t)),
  onChange: (keys: (string | number)[]) => {
    // 用 Set 查找：原来在 filter 回调里 keys.map(String).includes(...)，
    // 每行都重新 map + 线性扫描，5000 行 × 100 选中 = 每次选择变化 50 万次字符串比较。
    const keySet = new Set(keys.map(String));
    tableSelected.value = filteredTorrents.value.filter((t) => keySet.has(torrentKey(t)));
  },
}));

const tablePage = ref(1);
// 换筛选条件要回到第 1 页：分页是受控的（tablePage 只由翻页回调写），
// 停在第 5 页时筛到只剩两行，切出来的那一页是空的 —— 看着像筛坏了而不是筛窄了。
watch([searchText, stateFilter], () => (tablePage.value = 1));
const pageSize = computed(() => (configStore.tableBehavior["MyClient"] as any)?.itemsPerPage ?? 25);

// 每页条数按面板实高算（用户 2026-10-08：「既不能出现滚动条又要把页面铺满」）
const pagePanel = useTemplateRef<HTMLDivElement>("pagePanel");
/** 他挑过一档之后仍要量：那一档以实测容量为上限 */
const pickedSize = computed(() => {
  const behavior = (configStore.tableBehavior as Record<string, any>).MyClient;
  return isPageSizePicked(behavior?.itemsPerPage, 25, behavior?.pageSizePicked);
});
const { fitted: fitPageSize } = useAutoFitPageSize({
  container: () => pagePanel.value,
  rows: () => filteredTorrents.value,
});

// 分页统一走 toPagination：它兜底 Vuetify 遗留的 -1/0（原先这页直接把 -1 交给 antd，
// 会让 slice(0,-1) 吃掉最后一行），并带上「一页放得下就不出分页条」（用户 2026-10-07）。
const tablePagination = computed(() =>
  toPagination(pageSize.value, 25, {
    size: "small",
    totalRows: filteredTorrents.value.length,
    fitSize: fitPageSize.value,
    picked: pickedSize.value,
    extraConfig: { current: tablePage.value, total: filteredTorrents.value.length },
  }),
);

const tableSortOrder = computed(() =>
  buildSortOrderMap((configStore.tableBehavior["MyClient"] as any)?.sortBy),
);

function handleTableChange(pagination: any, _filters: any, sorter: any) {
  const s = Array.isArray(sorter) ? sorter : [sorter];
  const next: { key: string; order: "asc" | "desc" }[] = [];
  for (const item of s) {
    if (item?.order && item?.columnKey) {
      next.push({ key: item.columnKey as string, order: item.order === "descend" ? "desc" : "asc" });
    }
  }
  configStore.updateTableBehavior("MyClient", "sortBy", next);
  // 只有「报回来的档 ≠ 界面上正在显示的那一档」才算他改了尺寸：翻页与排序同样带着
  // 当前那一档回来，照 `if (pagination?.pageSize)` 判会把他第一次翻页就误判成挑档。
  const displayed = tablePagination.value === false ? 0 : tablePagination.value?.pageSize ?? 0;
  if (pagination?.pageSize && displayed && pagination.pageSize !== displayed) {
    configStore.updateTableBehavior("MyClient", "itemsPerPage", pagination.pageSize);
    // 挑档 = 明确意图，从此不再被实测条数盖掉
    configStore.updateTableBehavior("MyClient", "pageSizePicked", true);
  }
  tablePage.value = pagination?.current ?? 1;
}
</script>

<template>
  <!-- 顶部那条 a-alert 去掉了：左侧导航已经标出当前页。它 #action 里的两件事没丢 ——
       下载器筛选标签与状态按钮一起并进工具条右端。骨架见 style.css 的 .page。 -->
  <div class="page">
    <a-flex align="center" gap="small" wrap justify="space-between" class="page-bar">
      <a-flex align="center" gap="small" wrap>
      <a-tooltip :title="t('MyClient.pushToDownloader.navBtn')">
        <a-button type="text" @click="showPushToDownloaderDialog = true">
          <template #icon><CloudUploadOutlined /></template>
        </a-button>
      </a-tooltip>

      <a-divider type="vertical" />

      <a-tooltip :title="t('MyClient.resumeSelected')">
        <a-button type="text" :disabled="tableSelected.length === 0" @click="() => resumeTorrents(tableSelected)">
          <template #icon><PlayCircleOutlined /></template>
        </a-button>
      </a-tooltip>
      <a-tooltip :title="t('MyClient.pauseSelected')">
        <a-button type="text" :disabled="tableSelected.length === 0" @click="() => pauseTorrents(tableSelected)">
          <template #icon><PauseOutlined /></template>
        </a-button>
      </a-tooltip>
      <a-tooltip :title="t('MyClient.deleteSelected')">
        <a-button type="primary" danger :disabled="tableSelected.length === 0" @click="() => openDeleteDialog(tableSelected)">
          <template #icon><DeleteOutlined /></template>
        </a-button>
      </a-tooltip>
      <a-tooltip :title="t('MyClient.recheckSelected')">
        <a-button type="text" :disabled="tableSelected.length === 0" @click="() => openRecheckDialog(tableSelected)">
          <template #icon><ReloadOutlined /></template>
        </a-button>
      </a-tooltip>
      <a-tooltip :title="t('MyClient.speedLimit.batchBtn')">
        <a-button type="text" :disabled="tableSelected.length === 0" @click="showSpeedLimitDialog = true">
          <template #icon><FieldTimeOutlined /></template>
        </a-button>
      </a-tooltip>
      <a-tooltip :title="t('MyClient.label.batchBtn')">
        <a-button type="text" :disabled="tableSelected.length === 0" @click="showLabelDialog = true">
          <template #icon><TagsOutlined /></template>
        </a-button>
      </a-tooltip>

      <a-divider type="vertical" />

      <a-tooltip :title="t('MyClient.refresh')">
        <a-button type="text" @click="loadTorrents">
          <template #icon><ReloadOutlined /></template>
        </a-button>
      </a-tooltip>

      <!-- auto-refresh controls -->
      <a-dropdown trigger="click">
        <a-tooltip :title="t('MyClient.autoRefresh.btnTitle')">
          <a-button type="text">
            <template #icon><ClockCircleOutlined /></template>
          </a-button>
        </a-tooltip>
        <template #popupRender>
          <a-card size="small" style="min-width: 240px; padding: 12px">
            <div style="margin-bottom: 8px">{{ t("MyClient.autoRefresh.intervalLabel") }}</div>
            <a-input-number
              v-model:value="globalRefreshInterval"
              :min="0"
              :max="3600"
              size="small"
              style="width: 100%"
            />
            <a-button
              block
              style="margin-top: 8px"
              :type="autoRefreshRunning ? 'primary' : 'default'"
              :danger="autoRefreshRunning"
              :disabled="!autoRefreshRunning && globalRefreshInterval <= 0"
              @click="toggleAutoRefresh"
            >
              <template #icon><component :is="autoRefreshRunning ? StopOutlined : PlayCircleOutlined" /></template>
              {{ autoRefreshRunning ? t("MyClient.autoRefresh.stop") : t("MyClient.autoRefresh.start") }}
            </a-button>
          </a-card>
        </template>
      </a-dropdown>
      </a-flex>

      <!-- 工具条右端：状态筛选 + 下载器筛选标签 + 状态按钮（原 a-alert 的 #action）、自定义列、搜索框 -->
      <a-flex align="center" gap="small" wrap class="page-bar-extra">
        <!-- 固定几选一一律 a-radio-group + button-style="solid"（选中实心蓝底白字），不用 a-segmented：
             segmented 的选中态是灰底轨道上一块白浮标，落在那条浅灰栏里几乎看不出选的是哪个（AGENTS §3.4）。
             工具条里的控件不写 size —— 这一排是 32px 档，跟同栏那几颗按钮齐平。 -->
        <a-radio-group v-model:value="stateFilter" button-style="solid">
          <a-radio-button v-for="opt in stateFilterOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </a-radio-button>
        </a-radio-group>

        <a-tag v-if="selectedDownloaderIds.length === 1" color="blue" closable @close="clearDownloaderFilter">
          <template #icon><img class="client-tag-icon" :src="clientIcon(selectedDownloaderIds[0])" alt="" /></template>
          {{ clientName(selectedDownloaderIds[0]) }}
        </a-tag>

        <a-button type="primary" :title="t('MyClient.clientStatusDialog.openBtn')" @click="showClientStatusDialog = true">
          <template #icon><ThunderboltOutlined /></template>
          {{ allTorrents.length }}
          <ArrowUpOutlined style="color: #389e0d" />
          {{ formatSize(totalUpSpeed) }}/s
          <ArrowDownOutlined style="color: #cf1322" />
          {{ formatSize(totalDlSpeed) }}/s
        </a-button>

        <a-button @click="showColumnDialog = true">
          <template #icon><ColumnWidthOutlined /></template>
          <span>{{ t("MyClient.columnSelector") }}</span>
        </a-button>

        <a-input
          v-model:value="searchText"
          :placeholder="t('MyClient.searchPlaceholder')"
          allow-clear
          style="width: 300px"
        >
          <template #prefix><SearchOutlined /></template>
        </a-input>
      </a-flex>
    </a-flex>

    <div ref="pagePanel" class="page-panel">
    <a-table
      bordered
      :columns="tableHeader"
      :data-source="filteredTorrents"
      :row-key="(record: CTorrent) => torrentKey(record)"
      :row-selection="rowSelection"
      :loading="loading"
      :pagination="tablePagination"
      size="small"
      class="table-header-no-wrap"
      @change="handleTableChange"
    >
      <!-- client column -->
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'clientId'">
          <div style="display: flex; flex-direction: column; align-items: center">
            <img class="client-avatar" :src="clientIcon(record.clientId)" alt="" />
            <span class="text-body-small text-no-wrap">{{ clientName(record.clientId) }}</span>
          </div>
        </template>

        <!-- name column -->
        <template v-else-if="column.key === 'name'">
          <div>
            <span class="font-weight-medium">{{ record.name }}</span>
            <div v-if="record.label" class="text-body-small text-grey">
              <TagsOutlined style="font-size: 10px" /> {{ record.label }}
            </div>
          </div>
        </template>

        <!-- size column -->
        <template v-else-if="column.key === 'totalSize'">
          <span class="text-no-wrap">{{ formatSize(record.totalSize) }}</span>
        </template>

        <!-- progress column -->
        <template v-else-if="column.key === 'progress'">
          <a-progress
            type="circle"
            :percent="record.progress"
            :size="36"
            :stroke-color="record.isCompleted ? '#389e0d' : '#1890ff'"
          />
        </template>

        <!-- state column -->
        <template v-else-if="column.key === 'state'">
          <TorrentStateTd :item="record" />
        </template>

        <!-- upload speed -->
        <template v-else-if="column.key === 'uploadSpeed'">
          <span v-if="record.uploadSpeed > 0" class="text-no-wrap" style="color: #389e0d">
            {{ formatSize(record.uploadSpeed) }}/s
          </span>
          <span v-else class="text-grey">-</span>
        </template>

        <!-- download speed -->
        <template v-else-if="column.key === 'downloadSpeed'">
          <span v-if="record.downloadSpeed > 0" class="text-no-wrap" style="color: #1890ff">
            {{ formatSize(record.downloadSpeed) }}/s
          </span>
          <span v-else class="text-grey">-</span>
        </template>

        <!-- total uploaded -->
        <template v-else-if="column.key === 'totalUploaded'">
          <span class="text-no-wrap" style="color: #389e0d">{{ formatSize(record.totalUploaded) }}</span>
        </template>

        <!-- total downloaded -->
        <template v-else-if="column.key === 'totalDownloaded'">
          <span class="text-no-wrap" style="color: #1890ff">{{ formatSize(record.totalDownloaded) }}</span>
        </template>

        <!-- ratio column -->
        <template v-else-if="column.key === 'ratio'">
          <span :class="record.ratio >= 1 ? 'text-green' : 'text-red'">
            {{ record.ratio.toFixed(2) }}
          </span>
        </template>

        <!-- save path -->
        <template v-else-if="column.key === 'savePath'">
          <span class="text-body-small text-no-wrap">{{ record.savePath }}</span>
        </template>

        <!-- date added -->
        <template v-else-if="column.key === 'dateAdded'">
          <span class="text-no-wrap text-body-small">{{ formatDate(record.dateAdded * 1000) }}</span>
        </template>

        <!-- actions -->
        <template v-else-if="column.key === 'action'">
          <a-space :size="2">
            <a-tooltip v-if="record.state === CTorrentState.downloading || record.state === CTorrentState.seeding" :title="t('MyClient.action.pause')">
              <a-button type="text" size="small" @click="() => pauseTorrents([record])">
                <template #icon><PauseOutlined /></template>
              </a-button>
            </a-tooltip>
            <a-tooltip v-else-if="record.state === CTorrentState.paused || record.state === CTorrentState.error" :title="t('MyClient.action.resume')">
              <a-button type="text" size="small" @click="() => resumeTorrents([record])">
                <template #icon><PlayCircleOutlined /></template>
              </a-button>
            </a-tooltip>

            <!-- 重新校验 -->
            <a-tooltip v-if="isFeatureAllowed(record.clientId, 'Recheck')" :title="t('MyClient.action.recheck')">
              <a-button type="text" size="small" @click="() => openRecheckDialog([record])">
                <template #icon><ReloadOutlined /></template>
              </a-button>
            </a-tooltip>

            <!-- 队列调整 -->
            <a-dropdown v-if="isFeatureAllowed(record.clientId, 'Queue')" trigger="click">
              <a-tooltip :title="t('MyClient.action.queue')">
                <a-button type="text" size="small">
                  <template #icon><SwapOutlined /></template>
                </a-button>
              </a-tooltip>
              <template #popupRender>
                <a-menu>
                  <a-menu-item @click="() => moveTorrentsInQueue([record], 'top')">
                    <template #icon><VerticalAlignTopOutlined /></template>
                    {{ t("MyClient.action.queueTop") }}
                  </a-menu-item>
                  <a-menu-item @click="() => moveTorrentsInQueue([record], 'up')">
                    <template #icon><ArrowUpOutlined /></template>
                    {{ t("MyClient.action.queueUp") }}
                  </a-menu-item>
                  <a-menu-item @click="() => moveTorrentsInQueue([record], 'down')">
                    <template #icon><ArrowDownOutlined /></template>
                    {{ t("MyClient.action.queueDown") }}
                  </a-menu-item>
                  <a-menu-item @click="() => moveTorrentsInQueue([record], 'bottom')">
                    <template #icon><VerticalAlignBottomOutlined /></template>
                    {{ t("MyClient.action.queueBottom") }}
                  </a-menu-item>
                </a-menu>
              </template>
            </a-dropdown>

            <!-- 详情 -->
            <a-tooltip :title="t('MyClient.action.detail')">
              <a-button type="text" size="small" @click="() => openDetailDialog(record)">
                <template #icon><FileSearchOutlined /></template>
              </a-button>
            </a-tooltip>

            <a-tooltip :title="t('MyClient.action.delete')">
              <a-button type="primary" size="small" danger @click="() => openDeleteDialog([record])">
                <template #icon><DeleteOutlined /></template>
              </a-button>
            </a-tooltip>
          </a-space>
        </template>
      </template>
    </a-table>
    </div>
  </div>

  <!-- 列显隐面板：3 列开关（a-row / a-col，:span="8" 一份三列）。
       切换即时生效，所以 :footer="null" 不要「确定/取消」；
       标题走 :title 属性（项目硬规定：不用 #title 插槽、不往标题栏塞控件）。 -->
  <a-modal v-model:open="showColumnDialog" :title="t('MyClient.columnSelector')" :width="520" :footer="null">
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

  <DeleteDialog
    v-model="showDeleteDialog"
    :to-delete-ids="toDeleteTorrents.map((t) => torrentKey(t))"
    :confirm-delete="confirmDeleteTorrent"
    @all-delete="loadTorrents"
  />

  <PushToDownloaderDialog v-model="showPushToDownloaderDialog" />

  <ClientStatusDialog v-model="showClientStatusDialog" />

  <TorrentDetailDialog v-model="showDetailDialog" :torrent="detailTorrent" />

  <SpeedLimitDialog v-model="showSpeedLimitDialog" :torrents="tableSelected" />

  <LabelDialog v-model="showLabelDialog" :torrents="tableSelected" />

  <RecheckConfirmDialog
    v-model="showRecheckDialog"
    :torrent-count="toRecheckTorrents.length"
    :confirm-fn="recheckTorrents"
  />
</template>

<style scoped lang="scss">
.client-avatar {
  width: 22px;
  height: 22px;
  border-radius: 50%;
}

.client-tag-icon {
  width: 14px;
  height: 14px;
  margin-right: 4px;
}
</style>
