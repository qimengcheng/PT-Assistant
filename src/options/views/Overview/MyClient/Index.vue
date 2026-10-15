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
  DownOutlined,
  FieldTimeOutlined,
  FileSearchOutlined,
  PauseOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  RightOutlined,
  SearchOutlined,
  StopOutlined,
  SwapOutlined,
  TagsOutlined,
  ThunderboltOutlined,
  VerticalAlignBottomOutlined,
  VerticalAlignTopOutlined,
} from "@antdv-next/icons";
import type { TableColumnsType, TablePaginationConfig, TableRowSelection } from "antdv-next";

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
import { buildSortOrderMap, isPageSizePicked, makeSorter, toPagination, toTableColumns } from "@/options/components/tableSorters.ts";
import type { IKeepUploadTask } from "@/shared/types/storages/keepUploadTask.ts";
import { useAutoFitPageSize } from "@/options/directives/useAutoFitPageSize.ts";

import DeleteDialog from "./DeleteDialog.vue";
import PushToDownloaderDialog from "./PushToDownloaderDialog.vue";
import {
  assignGroups,
  buildTaskGroups,
  collapseGroups,
  groupSiblingsOf,
  type IGroupMeta,
  type IRowForGroup,
} from "./reseedGroups.ts";
import TorrentStateTd from "./TorrentStateTd.vue";
import ClientStatusDialog from "./ClientStatusDialog.vue";
import TorrentDetailDialog from "./TorrentDetailDialog.vue";
import SpeedLimitDialog from "./SpeedLimitDialog.vue";
import LabelDialog from "./LabelDialog.vue";
import RecheckConfirmDialog from "./RecheckConfirmDialog.vue";
import HoverTip from "@/options/components/HoverTip.vue";

import {
  torrents,
  selectedDownloaderIds,
  suspendedDownloaders,
  autoRefreshRunning,
  globalRefreshInterval,
  toPercent,
  useClientRefresh,
} from "./utils.ts";
import { countText, etaText, labelChips } from "./columnText.ts";

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

/**
 * 「设置标签」弹窗里那一排可以点的已有标签（用户 2026-10-13 要求把它摆出来，别只留一个空输入框）。
 * 两路并起来，都限定在**这批选中种子所在的那几台下载器**上：
 * ① 这些种子上真在用的 label（客户端里有什么，这里就有什么）；
 * ② 那几台在下载器设置里配好的候选 `suggestTags`（与辅种检测那颗标签框同源）。
 * 排序按「在用的条数」从多到少、同数按字面 —— 常用的排最前，点得到而不用翻。
 */
const existingLabels = computed<string[]>(() => {
  const clients = new Set(tableSelected.value.map((t) => t.clientId));
  if (clients.size === 0) return [];
  const used = new Map<string, number>();
  for (const t of allTorrents.value) {
    if (!clients.has(t.clientId)) continue;
    const label = (t.label ?? "").trim();
    if (label) used.set(label, (used.get(label) ?? 0) + 1);
  }
  for (const id of clients) {
    for (const tag of metadataStore.downloaders[id]?.suggestTags ?? []) {
      const label = tag.trim();
      if (label && !used.has(label)) used.set(label, 0);
    }
  }
  return [...used.keys()].sort((a, b) => (used.get(b) ?? 0) - (used.get(a) ?? 0) || a.localeCompare(b));
});

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
      // 标签也在搜索范围内：占位文案里就写了「标签」，而 qBittorrent 的 label 是分类、
      // 真正的标签住在 tags 里，只查 label 会让那颗按标签筛的入口落空
      (t.tags ?? []).some((tag) => tag.toLowerCase().includes(q)) ||
      t.savePath.toLowerCase().includes(q),
  );
});

/**
 * 辅种任务台账。折叠判据要它才能精确认出「这几条是同一批辅种发出去的」，
 * 走的是辅种任务页同一条消息（同一份数据，不另开一条路）。取失败不影响这一页：
 * 判据第二层（内容指纹）本来就独立于台账。
 */
const reseedTasks = ref<IKeepUploadTask[]>([]);

async function loadReseedTasks() {
  try {
    reseedTasks.value = await sendMessage("getKeepUploadTasks", undefined);
  } catch (e) {
    console.error("[MyClient] 读取辅种任务台账失败，同内容折叠退回只按内容指纹判：", e);
  }
}

/** 展开着哪些组。空集 = 全部折叠（用户 2026-10-13：默认折叠） */
const expandedGroups = ref<Set<string>>(new Set());

function toggleGroup(group: string) {
  const next = new Set(expandedGroups.value);
  if (next.has(group)) next.delete(group);
  else next.add(group);
  expandedGroups.value = next;
}

/**
 * 排序由这一页自己做，不交给 a-table。
 *
 * 原因：分组要求同组的行**相邻**，而 a-table 是在拿到 dataSource 之后按列的 compare 再排一遍 ——
 * 它一重排，代表行和它的组员就被分到两个位置，折叠就没了意义（展开时那一组会散在整页里）。
 * 所以下面 tableHeader 里 sorter 给的是 `true` 而不是 compare（这确实是 AGENTS §3.4 记着的那条
 * 「箭头动、数据不排」的形状，但这里是故意的：排已经在上游排完了），比较函数仍用公共那一份
 * `makeSorter`，不抄第二套。
 *
 * 他没点任何一列时用「添加时间」当默认排序（用户 2026-10-13：「按添加的时间排序」）：
 * 折叠态露出来的那一行就是这一组里**最早加进去**的那条，展开后组员从旧到新排下去。
 * 各下载器原生返回的顺序不统一（qBittorrent 按 hash、Transmission 按 id），拿它当分组基准
 * 会让同一组的位置每次刷新都漂。
 */
const byAddedAt = makeSorter<CTorrent>("dateAdded");
const sortedTorrents = computed<CTorrent[]>(() => {
  const sortBy = configStore.tableBehavior["MyClient"]?.sortBy ?? [];
  if (sortBy.length === 0) return [...filteredTorrents.value].sort(byAddedAt);
  const sorters = sortBy.map((s) => ({ compare: makeSorter<CTorrent>(s.key), desc: s.order === "desc" }));
  return [...filteredTorrents.value].sort((a, b) => {
    for (const s of sorters) {
      const r = s.compare(a, b);
      if (r !== 0) return s.desc ? -r : r;
    }
    return 0;
  });
});

/** collapseGroups 要的行形状：CTorrent 上没有 `key`，包一层而不是复制整条记录 */
interface IGroupEntry extends IRowForGroup {
  row: CTorrent;
}

/**
 * 折叠后的那一列行，连同两组附属信息：
 * `meta` 给名称那一格挂「N 条同内容」那颗标记，`members` 给勾选代表行时连着整组一起算。
 */
const grouped = computed(() => {
  const taskByHash = buildTaskGroups(reseedTasks.value);
  const entries: IGroupEntry[] = sortedTorrents.value.map((t) => ({
    key: torrentKey(t),
    clientId: t.clientId,
    name: t.name,
    totalSize: t.totalSize,
    savePath: t.savePath,
    infoHash: t.infoHash,
    row: t,
  }));
  const groupMap = assignGroups(entries, taskByHash);
  const result = collapseGroups<IGroupEntry>(entries, (e) => groupMap.get(e.key) ?? null, expandedGroups.value);
  return {
    rows: result.rows.map((e) => e.row),
    meta: result.meta,
    members: result.members,
  };
});

/**
 * 名称那一格那颗折叠标记要的三个数。
 *
 * 只有**代表行**有值：折叠态下组员根本不在 `grouped.rows` 里，展开态下它们又都在，
 * 所以标记挂组员身上会画出一排重复的「12 条同内容」—— 挂在代表行、点一下整组进出才对。
 * 三次调用都是 Map 取值，一页最多三十来行，不做缓存。
 */
function groupAnchorMeta(record: CTorrent): IGroupMeta | undefined {
  const meta = grouped.value.meta.get(torrentKey(record));
  return meta?.anchor ? meta : undefined;
}

const isGroupExpanded = (record: CTorrent) => {
  const meta = groupAnchorMeta(record);
  return !!meta && expandedGroups.value.has(meta.group);
};

const groupCountOf = (record: CTorrent) => groupAnchorMeta(record)?.count ?? 0;

function toggleGroupFor(record: CTorrent) {
  const meta = groupAnchorMeta(record);
  if (meta) toggleGroup(meta.group);
}

/**
 * 组员行挂入场动画用的类（用户 2026-10-14：「展开的时候加点动画，现在太突兀了」）。
 *
 * 只给组员，不给代表行：代表行本来就一直摆在表里，DOM 节点不换引用，给它挂 `animation`
 * 等于每次展开都让那一行闪一下。组员是展开那一刻才插进来的新节点，动画正好只在那时跑。
 */
function torrentRowClass(record: CTorrent) {
  const meta = grouped.value.meta.get(torrentKey(record));
  return meta && !meta.anchor ? "torrent-group-member" : "";
}

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
/**
 * 本页的列定义。`toTableColumns` 只吃 key / sortable / props，`title` 给「自定义列」面板
 * 显示、`align` / `width` 由适配层原样透传给 antd。
 * 原先这里整条数组挂着 `as any[]`，于是列名拼错、档位写错都不报错。
 */
interface IMyClientColumn {
  key: string;
  title: string;
  align?: "start" | "center" | "end";
  width?: number;
  sortable?: boolean;
  props?: { disabled?: boolean };
}

const fullTableHeader = computed(
  () =>
    [
      { title: t("MyClient.table.client"), key: "clientId", align: "center", width: 120, props: { disabled: true } },
      { title: t("MyClient.table.name"), key: "name", align: "start", props: { disabled: true } },
      { title: t("MyClient.table.size"), key: "totalSize", align: "end", width: 110 },
      { title: t("MyClient.table.progress"), key: "progress", align: "end", width: 90 },
      { title: t("MyClient.table.status"), key: "state", align: "center", width: 110 },
      { title: t("MyClient.table.seeds"), key: "seeds", align: "end", width: 76 },
      { title: t("MyClient.table.peers"), key: "peers", align: "end", width: 76 },
      { title: t("MyClient.table.upSpeed"), key: "uploadSpeed", align: "end", width: 100 },
      { title: t("MyClient.table.dlSpeed"), key: "downloadSpeed", align: "end", width: 100 },
      { title: t("MyClient.table.totalUploaded"), key: "totalUploaded", align: "end", width: 100 },
      { title: t("MyClient.table.totalDownloaded"), key: "totalDownloaded", align: "end", width: 100 },
      { title: t("MyClient.table.ratio"), key: "ratio", align: "end", width: 80 },
      { title: t("MyClient.table.eta"), key: "eta", align: "end", width: 110 },
      { title: t("MyClient.table.label"), key: "label", align: "start", width: 120 },
      { title: t("MyClient.table.tracker"), key: "tracker", align: "start", width: 180 },
      { title: t("MyClient.table.savePath"), key: "savePath", align: "start" },
      { title: t("MyClient.table.addedAt"), key: "dateAdded", align: "center", width: 160 },
      { title: t("MyClient.table.completedAt"), key: "completedDate", align: "center", width: 160 },
      {
        title: t("common.action"),
        key: "action",
        align: "center",
        sortable: false,
        width: 120,
        props: { disabled: true },
      },
    ] as IMyClientColumn[],
);

/**
 * 列定义。⚠️ 必须给每列都带上真正的 compare 函数（makeSorter）：
 * 原来这里只做了 `{ ...item, dataIndex: item.key }`，整张表一个 sorter 都没有，
 * 而 antd 只在列上带 sorter 时才渲染排序箭头 —— 结果是「客户端」页面完全无法排序，
 * handleTableChange 收到的 sorter 恒为空对象，configStore.tableBehavior.MyClient.sortBy
 * 是个死配置（表格可以排但排完记不下来）。
 *
 * ⚠️ 但 compare 现在**不能**交给 a-table 用：排序已经在上游 `sortedTorrents` 做完了
 * （同组的行必须相邻，见那一段的注释），所以这里把 sorter 换成字面 `true` —— antd 只画箭头、
 * 报 @change，不再自己重排。这正是 AGENTS §3.4 里「箭头动、数据不排」那条的形状，
 * 区别是这一页的数据确实排过了，只是不由它排。别顺手把 compare 加回来，那会让折叠散架。
 */
const tableHeader = computed<TableColumnsType<CTorrent>>(
  () =>
    toTableColumns<CTorrent>(
      fullTableHeader.value.filter(
        (item) => item?.props?.disabled || configStore.tableBehavior["MyClient"]?.columns?.includes(item.key),
      ),
      tableSortOrder.value,
    ).map((col) => ({ ...col, sorter: col.sorter === false ? false : true })),
);

/** 列显隐多选：v-model 走 configStore，setter 里调 updateTableBehavior 保持原「双写」语义 */
const selectedColumnKeys = computed<string[]>({
  get: () => configStore.tableBehavior["MyClient"]?.columns ?? [],
  set: (v) => {
    configStore.tableBehavior["MyClient"].columns = v;
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
  // 台账和种子列表一起取：折叠判据的第一层吃它，晚一步就是先画一排「没在台账里」的组、
  // 下一次刷新又并到任务组去，同一份内容两组来回跳。
  void loadReseedTasks();
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
  // 不等水合就是：从「下载器管理」页跳过来时预选丢失、自动加载按默认值走 —— 都是静默的。
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
  } else {
    // 这两条分支都会经 loadTorrents 取台账，只有「进来不自动拉列表」这条路不会。
    // 而种子列表是模块级 ref，从别的页切回来时行还在 —— 不补这一次读取就只剩内容指纹
    // 那一层判据，跨站改过名的辅种组会折不上。
    void loadReseedTasks();
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

/** 确认框里每一条前面要不要勾选框（只有行内那颗键、且这一条在同内容组里时才要） */
const deleteSelectable = ref(false);

function openDeleteDialog(torrentList: CTorrent[], selectable = false) {
  toDeleteTorrents.value = torrentList;
  deleteSelectable.value = selectable;
  showDeleteDialog.value = true;
}

/**
 * 行内那颗删除键：这一条属于同内容组时，把整组一起端进确认框，并让他能勾。
 *
 * 用户 2026-10-14：「点删除的时候只删除了一条，应该可以选择一起删除」—— 折叠态下组员根本不在
 * 列表里，行内键只送一条就等于把同内容的其余几条永远留在那儿，一条条点着删。
 * 默认全勾（他要的就是「一起」），但每条可取消 —— 不然「只删这一条」反而没了入口。
 * 组里只有一条 / 这一条不成组时走原样：单条、不出勾选框。
 */
function openDeleteDialogForRow(record: CTorrent) {
  const siblings = groupSiblingsOf(torrentKey(record), grouped.value.meta, grouped.value.members);
  if (siblings.length <= 1) {
    openDeleteDialog([record]);
    return;
  }
  const byKey = new Map(sortedTorrents.value.map((t) => [torrentKey(t), t]));
  const rows = siblings.map((k) => byKey.get(k)).filter((t): t is CTorrent => !!t);
  openDeleteDialog(rows.length > 1 ? rows : [record], rows.length > 1);
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
/** antd 无 v-model：受控选择，等价于 v-data-table 的 v-model + return-object；key 走 torrentKey */
const rowSelection = computed<TableRowSelection<CTorrent>>(() => ({
  selectedRowKeys: tableSelected.value.map((t) => torrentKey(t)),
  onChange: (keys: (string | number)[]) => {
    const before = new Set(tableSelected.value.map((t) => torrentKey(t)));
    const next = new Set(keys.map(String));
    // 勾代表行 = 勾整组。折叠时组员根本不在列表里，不连着算就没法一次处理一整组
    // （批量暂停 / 删除本来就是按 tableSelected 走的）；取消代表行的勾选时整组一起退出。
    // 只在「新选中 / 新取消」那一刻展开，否则 antd 每次回调都会把没勾的组员又捞回来。
    for (const list of grouped.value.members.values()) {
      const anchor = list[0];
      if (!anchor) continue;
      if (next.has(anchor) && !before.has(anchor)) list.forEach((k) => next.add(k));
      else if (!next.has(anchor) && before.has(anchor)) list.forEach((k) => next.delete(k));
    }
    // 用 Set 查找：原来在 filter 回调里 keys.map(String).includes(...)，
    // 每行都重新 map + 线性扫描，5000 行 × 100 选中 = 每次选择变化 50 万次字符串比较。
    tableSelected.value = filteredTorrents.value.filter((t) => next.has(torrentKey(t)));
  },
}));

const tablePage = ref(1);
// 换筛选条件要回到第 1 页：分页是受控的（tablePage 只由翻页回调写），
// 停在第 5 页时筛到只剩两行，切出来的那一页是空的 —— 看着像筛坏了而不是筛窄了。
watch([searchText, stateFilter], () => (tablePage.value = 1));
const pageSize = computed(() => configStore.tableBehavior["MyClient"]?.itemsPerPage ?? 25);

// 每页条数按面板实高算（用户 2026-10-08：「既不能出现滚动条又要把页面铺满」）
const pagePanel = useTemplateRef<HTMLDivElement>("pagePanel");
/** 他挑过一档之后仍要量：那一档以实测容量为上限 */
const pickedSize = computed(() => {
  const behavior = configStore.tableBehavior["MyClient"];
  return isPageSizePicked(behavior?.itemsPerPage, 25, behavior?.pageSizePicked);
});
const { fitted: fitPageSize } = useAutoFitPageSize({
  container: () => pagePanel.value,
  // 量的是**折叠后真正出现**的那些行：每页条数要按看得见的行数铺满，不是按台账条数
  rows: () => grouped.value.rows,
});

// 分页统一走 toPagination：它兜底 Vuetify 遗留的 -1/0（原先这页直接把 -1 交给 antd，
// 会让 slice(0,-1) 吃掉最后一行），并带上「一页放得下就不出分页条」（用户 2026-10-07）。
// 总数用折叠后的行数 —— 折叠的意义就是「一屏放得下的条目变多了」，还按 523 条算会白切页。
const tablePagination = computed(() =>
  toPagination(pageSize.value, 25, {
    size: "small",
    totalRows: grouped.value.rows.length,
    fitSize: fitPageSize.value,
    picked: pickedSize.value,
    extraConfig: { current: tablePage.value, total: grouped.value.rows.length },
  }),
);

const tableSortOrder = computed(() => buildSortOrderMap(configStore.tableBehavior["MyClient"]?.sortBy));

/** a-table 的 @change 第三参：开多列排序时是数组。这里只吃 order 与 columnKey 两件 */
type TSorterItem = { order?: "ascend" | "descend"; columnKey?: string | number };

function handleTableChange(pagination: TablePaginationConfig, _filters: unknown, sorter: TSorterItem | TSorterItem[]) {
  const s = Array.isArray(sorter) ? sorter : [sorter];
  const next: { key: string; order: "asc" | "desc" }[] = [];
  for (const item of s) {
    if (item?.order && item?.columnKey) {
      next.push({ key: String(item.columnKey), order: item.order === "descend" ? "desc" : "asc" });
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
              name="my-client-refresh-interval"
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
        <a-radio-group v-model:value="stateFilter" name="my-client-state-filter" button-style="solid">
          <a-radio-button v-for="opt in stateFilterOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </a-radio-button>
        </a-radio-group>

        <a-tag v-if="selectedDownloaderIds.length === 1" color="blue" closable @close="clearDownloaderFilter">
          <template #icon><img class="client-tag-icon" :src="clientIcon(selectedDownloaderIds[0])" alt="" /></template>
          {{ clientName(selectedDownloaderIds[0]) }}
        </a-tag>

        <HoverTip :text="t('MyClient.clientStatusDialog.openBtn')">
          <a-button type="primary" @click="showClientStatusDialog = true">
            <template #icon><ThunderboltOutlined /></template>
            {{ allTorrents.length }}
            <ArrowUpOutlined style="color: #389e0d" />
            {{ formatSize(totalUpSpeed) }}/s
            <ArrowDownOutlined style="color: #cf1322" />
            {{ formatSize(totalDlSpeed) }}/s
          </a-button>
        </HoverTip>

        <a-button @click="showColumnDialog = true">
          <template #icon><ColumnWidthOutlined /></template>
          <span>{{ t("MyClient.columnSelector") }}</span>
        </a-button>

        <!--
          200px 是量出来的，不是目测的。`.page` 把工具条那一行钉在 `minmax(48px, auto)`（style.css:312），
          而这一排的自然宽（左组 401.6 + 缝 8 + 右端那一组）超过容器时，`wrap` 会把右端整组
          甩到第二行 —— 界面表现就是用户报的「排版错位」。
          台架（`.tmp-build/bench-myclientbar`，真组件 + 真文案 + token fontSize 13）在他那一栏的
          实宽 1609 CSS px 下逐档扫过：搜索框 300 / 260 / 220 都还在两行（220 只差 1.6px），
          200 起条高回到 48.0 一行。那一趟**是带着**那颗「只选了一个下载器」才出现的标签量的
          （+72），所以 200 已经含了最坏一档，余量 18px；没有标签时余量 90px。
          代价说清：占位文案「搜索种子名称、Hash、标签、路径」实测 260 完整、220 起被截断，
          所以这一档那行提示语会缺尾巴（原生 placeholder 只裁、不加省略号）。
        -->
        <a-input v-model:value="searchText" name="my-client-torrent-search" :placeholder="t('MyClient.searchPlaceholder')" allow-clear style="width: 200px">
          <template #prefix><SearchOutlined /></template>
        </a-input>
      </a-flex>
    </a-flex>

    <div ref="pagePanel" class="page-panel">
    <a-table
      bordered
      :columns="tableHeader"
      :data-source="grouped.rows"
      :row-key="(record: CTorrent) => torrentKey(record)"
      :row-class-name="torrentRowClass"
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
            <!-- 名称只给一行，剩下的交给 popover（用户 2026-10-13：长标题折行把行高撑得很高，不好看）。
                 这一页每页条数是 useAutoFitPageSize 按实测行高算的，标题多折一行就少一整条。
                 全文揭示走 a-popover 而不是原生 title，规格与搜索页的 TorrentTitleTd.vue 同一条。
                 「N 条同内容」那颗和标题排在同一行：再单独占一行就等于把上面那条高度预算还回去。 -->
            <div class="torrent-name-row">
              <a-popover trigger="hover" placement="topLeft" :mouse-enter-delay="0.4">
                <template #content>
                  <div class="reveal-text">{{ record.name }}</div>
                </template>
                <div class="torrent-name font-weight-medium text-truncate">{{ record.name }}</div>
              </a-popover>
              <a-button
                v-if="groupAnchorMeta(record)"
                class="torrent-group-toggle"
                size="small"
                type="text"
                @click="toggleGroupFor(record)"
              >
                <!-- 图标走 #icon 而不是默认插槽：默认插槽那一档会带一段宽度过渡，点一下就把列撑宽 -->
                <template #icon>
                  <DownOutlined v-if="isGroupExpanded(record)" />
                  <RightOutlined v-else />
                </template>
                {{ t("MyClient.table.sameContent", { count: groupCountOf(record) }) }}
              </a-button>
            </div>
            <!-- 分类（qBittorrent 的 category / 各家的主标签）与全部标签一起摆出来：
                 原先只有 record.label 一个值，用户 2026-10-13 指着这行说「只显示了分类，
                 要把标签也显示出来」。判据在 columnText.ts 的 labelChips（去重 + 丢空）。 -->
            <div
              v-if="labelChips(record.label, record.tags).length"
              class="torrent-labels text-body-small text-grey"
            >
              <TagsOutlined class="torrent-labels__icon" />
              <span v-for="chip in labelChips(record.label, record.tags)" :key="chip" class="torrent-labels__chip">
                {{ chip }}
              </span>
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
            v-if="toPercent(record.progress) !== null"
            type="circle"
            :percent="toPercent(record.progress) ?? 0"
            :size="36"
            :stroke-color="record.isCompleted ? '#389e0d' : '#1890ff'"
          />
          <span v-else class="text-grey">-</span>
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

        <!-- 完成时间：没下完的种子里这一格是空的（各家回 0 或干脆没这个字段） -->
        <template v-else-if="column.key === 'completedDate'">
          <span class="text-no-wrap text-body-small">
            {{ record.completedDate ? formatDate(record.completedDate * 1000) : "-" }}
          </span>
        </template>

        <!-- 做种数 / 下载数：0 是真值（没人做种、没人下载），只有「这家压根没报」才空 -->
        <template v-else-if="column.key === 'seeds'">
          <span class="text-no-wrap">{{ countText(record.seeds) }}</span>
        </template>

        <template v-else-if="column.key === 'peers'">
          <span class="text-no-wrap">{{ countText(record.peers) }}</span>
        </template>

        <!-- 剩余时间 -->
        <template v-else-if="column.key === 'eta'">
          <span class="text-no-wrap text-body-small">{{ etaText(record.eta, configStore.lang === "zh_CN") }}</span>
        </template>

        <!-- 分类 / 标签：与名称下面那一行同源（columnText.ts 的 labelChips）。
             各家语义不同：qBittorrent 的 label 是分类、Transmission 是 labels[0]、
             Flood 是 tags[0]，完整标签集在 tags 里，两边都要摆出来才不丢信息。 -->
        <template v-else-if="column.key === 'label'">
          <div v-if="labelChips(record.label, record.tags).length" class="torrent-labels text-body-small text-grey">
            <span v-for="chip in labelChips(record.label, record.tags)" :key="chip" class="torrent-labels__chip">
              {{ chip }}
            </span>
          </div>
          <span v-else class="text-body-small text-grey">-</span>
        </template>

        <!-- Tracker -->
        <template v-else-if="column.key === 'tracker'">
          <span class="text-body-small text-no-wrap">{{ record.tracker || "-" }}</span>
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
              <a-button type="primary" size="small" danger @click="() => openDeleteDialogForRow(record)">
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
    :torrents="toDeleteTorrents"
    :selectable="deleteSelectable"
    :confirm-delete="confirmDeleteTorrent"
    @all-delete="loadTorrents"
  />

  <PushToDownloaderDialog v-model="showPushToDownloaderDialog" />

  <ClientStatusDialog v-model="showClientStatusDialog" />

  <TorrentDetailDialog v-model="showDetailDialog" :torrent="detailTorrent" />

  <SpeedLimitDialog v-model="showSpeedLimitDialog" :torrents="tableSelected" />

  <LabelDialog v-model="showLabelDialog" :torrents="tableSelected" :suggest-labels="existingLabels" />

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

/**
 * 名称那一行的宽度上限。这张表是 auto 布局（没有 scroll.y、没有固定列），td 的宽度跟着内容走，
 * 所以截断**必须给一个绝对宽度**才成立 —— 只挂 `.text-truncate` 不给上限，它会一直撑下去、
 * 永远不截（`.text-truncate` 是 overflow: hidden + ellipsis + nowrap，见 vuetify-compat.css）。
 * 420 是一档布局预算：这一列再宽就要开始吃别的列的可视区，全文本来就不指望在这一格里读完
 * （popover 给）。要更宽或更窄改这一个数。
 */
.torrent-name {
  max-width: 420px;
}

/**
 * 标题那一行：名称 + 那颗「N 条同内容」。
 *
 * 台架实测（.tmp-build/bench-group，真 a-table、容器 391）两条：
 * ① 那颗 chip 实测 106px，直接并排会把表的 max-content 从 497 顶到 612 —— 折叠省下十几行，
 *    却换来整张表加宽 115px，不划算。所以有 chip 的那一行把标题上限从 420 让到 306
 *    （306 + 8 缝 + 106 = 420，正好是原来那一列的宽度），实测表宽回到 498、标题照旧截断。
 *    `:has()` 万一不支持就是这条规则整体失效，退化成加宽 115px，不会把内容截没了。
 * ② 不需要补 `min-width: 0`：`.text-truncate` 自带 `overflow: hidden`，而 flex 子项的自动最小
 *    尺寸只在 overflow 可见时才生效 —— 台架把那条规则拿掉做对照组，量到与线上写法一字不差。
 */
.torrent-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.torrent-name-row:has(.torrent-group-toggle) .torrent-name {
  max-width: 306px;
}

.torrent-group-toggle {
  flex: 0 0 auto;
}

/* popover 里的全文：与搜索页 TorrentTitleTd.vue 同一条规格（480 上限 + 换行铺开 +
   overflow-wrap:anywhere 处理种子标题里那种无空格长串）。 */
.reveal-text {
  max-width: 480px;
  white-space: normal;
  overflow-wrap: anywhere;
}

/**
 * 名称下面那行的「分类 + 标签」。
 *
 * 刻意不用 `a-tag`：antd 那颗默认 20px 高 + `margin-inline-end: 8px`，挂进这一格会把
 * 行高从「一行小字」顶到 22px 以上，而这一页的行高是 `useAutoFitPageSize` 实测出来算每页
 * 条数的 —— 一行标签就让整页条数掉一档。这里压到 16px，跟原来的小字行同高。
 */
.torrent-labels {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}

.torrent-labels__icon {
  font-size: 10px;
}

.torrent-labels__chip {
  display: inline-flex;
  align-items: center;
  height: 16px;
  padding: 0 5px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.045);
}

/* 展开一组同内容时，组员行从代表行下面滑出来，而不是整块直接出现在位置上。
   `<tr>` 由 a-table 内部组件渲染，拿不到本组件的 scope id，所以必须走 :deep ——
   编译后是 `[data-v-*] .torrent-group-member`，靠本组件模板里那层 `.page-panel` 提供 scope id。
   时长压到 180ms：再长就开始觉得「等一下」，而 19 条一起动也只有一帧的差别。 */
:deep(.torrent-group-member) {
  animation: torrent-group-row-in 180ms ease-out;
}

@keyframes torrent-group-row-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
}

/* 系统开了「减少动态效果」就不滑，只留下原本的直接出现 */
@media (prefers-reduced-motion: reduce) {
  :deep(.torrent-group-member) {
    animation: none;
  }
}
</style>
