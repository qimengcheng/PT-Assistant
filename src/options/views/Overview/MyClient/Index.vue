<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useTemplateRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  CloudSyncOutlined,
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
  ScanOutlined,
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
import { buildSortOrderMap, makeSorter, toPagination, toTableColumns } from "@/options/components/tableSorters.ts";
import type { IKeepUploadTask } from "@/shared/types/storages/keepUploadTask.ts";
import type { IReseedScanResult } from "@/shared/types/storages/reseedScan.ts";
import type { ITransferSourceRow } from "@/shared/upload/types.ts";
import { reseedHandoffLabelOf } from "@/shared/reseedScanHandoff.ts";
import { countAutoTagSkips, planAutoTagRows } from "@/shared/torrentAutoTag.ts";
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
import { buildReseedFacts, buildReseedLocalBases, buildReseedScanScope, type IReseedRow, type IReseedScanScope } from "./reseedCandidateView.ts";
import ReseedScanDialog from "./ReseedScanDialog.vue";
import TorrentStateTd from "./TorrentStateTd.vue";
import ClientStatusDialog from "./ClientStatusDialog.vue";
import TorrentDetailDialog from "./TorrentDetailDialog.vue";
import SpeedLimitDialog from "./SpeedLimitDialog.vue";
import LabelDialog from "./LabelDialog.vue";
import RecheckConfirmDialog from "./RecheckConfirmDialog.vue";
import HoverTip from "@/options/components/HoverTip.vue";
import TransferUploadDialog from "@/options/components/TransferUploadDialog/Index.vue";

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

/**
 * 「只看可辅种」那颗勾（用户 2026-10-18：「能不能增加一个检测下载器中还有哪些种子可以辅种的功能」）。
 * 判据与行上那枚「待辅 N 站」标记同一条，不另开一套；与状态筛选、搜索框是叠加关系。
 */
const reseedOnly = ref(false);

// delete dialog
const showDeleteDialog = ref(false);
const toDeleteTorrents = ref<CTorrent[]>([]);

// push to downloader dialog
const showPushToDownloaderDialog = ref(false);

/**
 * 转种（转载发布）：把下载器里的这一颗交到**另一个站的上传页**，与上面那颗「推送种子」
 * 不是一件事 —— 那个是把种子发给另一台下载器，这个要回源站取原始种子、填目标站的发布表单。
 */
const showTransferUploadDialog = ref(false);

/**
 * 递给转种对话框的那几列。刻意收成窄类型而不是把整个 `CTorrent` 传进去：
 * 那一步离开这一页之后只认这五个字段，多传的部分只会变成一处没人核对的隐式依赖。
 */
const transferSourceRows = computed<ITransferSourceRow[]>(() =>
  tableSelected.value.map((t) => ({
    downloaderId: t.clientId,
    id: t.id,
    name: t.name,
    totalSize: t.totalSize,
    // 各家报的 tracker 可能是空的；空串交给反查那一步当「认不出来」处理，不给它 undefined
    tracker: t.tracker ?? "",
    infoHash: t.infoHash,
  })),
);

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

/** 「可辅种扫描」面板（逐站到站点上真查一遍这条种子在不在） */
const showReseedScanDialog = ref(false);

/**
 * 扫描结论整表。行上那枚标记要按「这条内容已经查过哪些站」决定说「待查」还是「已查」，
 * 所以这份事实得住在**页面**里，不能只住在弹窗里 —— 弹窗一关就把标记打回「待查」，
 * 那正是用户 2026-10-18 要撤掉的形状。
 *
 * 只在进这一页、以及关掉扫描面板时各读一次，不挂定时器：一次扫描是几十到几百次站点请求，
 * 结论也就这个量级，为它轮询等于给一屏表格加一条没人要的整表重画（v0.109.2 那条同族）。
 */
const scanResults = ref<IReseedScanResult[]>([]);

async function loadScanResults() {
  scanResults.value = await sendMessage("getReseedScanResults", undefined).catch(() => [] as IReseedScanResult[]);
}

/** 关掉扫描面板就重读一次：人在那一屏查完，行上那枚标记要当场跟着变，不等下一次进这一页 */
watch(showReseedScanDialog, (open) => {
  if (!open) void loadScanResults();
});

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

/**
 * 正在收起、还留在表里演退场的那几组（用户 2026-10-16：「展开的时候能看到动画了，
 * 但是收起来的时候没有」）。
 *
 * 为什么非得留一会儿再摘：组员行是 `collapseGroups` 在折叠时**根本不放出来**的，节点一摘掉，
 * CSS 动画就没有载体 —— 想要退场，只能「先让它还在列表里演完这 180ms，再真的摘掉」。
 * 所以这是一份**只影响渲染**的集合：只有 `shownGroups`（展开 ∪ 正在收起）决定组员出不出现在
 * 列表里；那颗「N 条同内容」标记的文字、勾整组、分页总数这些折叠判据仍然只看 `expandedGroups`，
 * 所以点下去的**那一帧**界面就认它是收起了。
 */
const collapsingGroups = ref<Set<string>>(new Set());
const collapseTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** 退场时长，必须与样式里那两条 `*-out` 一致 */
const GROUP_EXIT_MS = 180;

/** 展开 ∪ 正在收起 */
const shownGroups = computed(() => new Set([...expandedGroups.value, ...collapsingGroups.value]));

/** 系统开了「减少动态效果」就不演退场 —— 那 180ms 的滞留本身就是一档动效，不该留下 */
const prefersReducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

function toggleGroup(group: string) {
  const next = new Set(expandedGroups.value);
  const opening = !next.has(group);
  if (opening) next.add(group);
  else next.delete(group);
  expandedGroups.value = next;

  // 又点开了：取消那一组的退场滞留。行本来就没被摘走，类一换回入场那一档，动画自然重跑
  const pending = collapseTimers.get(group);
  if (pending) {
    clearTimeout(pending);
    collapseTimers.delete(group);
    const rest = new Set(collapsingGroups.value);
    rest.delete(group);
    collapsingGroups.value = rest;
  }
  if (opening || prefersReducedMotion()) return;

  collapsingGroups.value = new Set(collapsingGroups.value).add(group);
  collapseTimers.set(
    group,
    setTimeout(() => {
      collapseTimers.delete(group);
      const rest = new Set(collapsingGroups.value);
      rest.delete(group);
      collapsingGroups.value = rest;
    }, GROUP_EXIT_MS),
  );
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
  if (sortBy.length === 0) return [...visibleTorrents.value].sort(byAddedAt);
  const sorters = sortBy.map((s) => ({ compare: makeSorter<CTorrent>(s.key), desc: s.order === "desc" }));
  return [...visibleTorrents.value].sort((a, b) => {
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
  const result = collapseGroups<IGroupEntry>(entries, (e) => groupMap.get(e.key) ?? null, shownGroups.value);
  return {
    rows: result.rows.map((e) => e.row),
    meta: result.meta,
    members: result.members,
  };
});

/**
 * 「这一条还可以往几个站辅」——行 key → 判据结果。拼法全在 `reseedCandidateView.ts`
 * （那文件头写清了三条取数口径与「不看分享率」的理由），这里只把界面上看得见的那几列递进去：
 * Tracker 那一列的同一份 `record.tracker`、折叠用的同一套分组判据（台账 + 内容指纹）、
 * 以及「已添加且没标离线」的站点。
 *
 * `isDead`（站点定义里那档「已停服」）刻意没算进来：它只在异步的合并元数据里，
 * 为一枚标记去 import 整片定义不划算，而那几站通常已被用户自己标成离线。
 */
const usableReseedSites = computed(() =>
  Object.keys(metadataStore.sites).filter((siteId) => metadataStore.sites[siteId]?.isOffline !== true),
);

/**
 * 参与「可辅种」两条路（行上那枚标记、扫描面板的范围清单）的行。
 *
 * 只有一份：这两件产品必须吃同一批字段拼出来的同一份行，不然标记说有 N 站、扫描却按另一套
 * 已挂集合排计划，界面上就是同一屏两句互相打脸（v0.106.2 那条「同一圈里既写又读的字段」同族）。
 */
const reseedRows = computed<IReseedRow[]>(() =>
  allTorrents.value.map((row) => ({
    key: torrentKey(row),
    clientId: row.clientId,
    name: row.name,
    totalSize: row.totalSize,
    savePath: row.savePath,
    infoHash: row.infoHash,
    tracker: row.tracker,
    contentPath: row.contentPath,
    completed: row.isCompleted === true,
    progress: row.progress,
  })),
);

const hostSiteEntries = computed(() => Object.entries(metadataStore.siteHostMap));

const reseedFacts = computed(() =>
  buildReseedFacts(reseedRows.value, hostSiteEntries.value, usableReseedSites.value, reseedTasks.value, {
    results: scanResults.value,
    now: Date.now(),
  }),
);

/**
 * 「按所属站点自动补标签」这一档要扫的那些行。
 *
 * 范围：**勾了就用勾选的，没勾就用这一台/几台下载器报回来的全部行** —— 他要补的是存量那一堆
 * （一键辅种 v0.110.2 之前推出去的那批什么都没带），一页 12 条地勾不现实。
 * 判据本体在 `@/shared/torrentAutoTag`（只碰 `tags` 为空的那些条，认不出站点就跳过，不猜）。
 */
const autoTagSource = computed(() => (tableSelected.value.length > 0 ? tableSelected.value : allTorrents.value));

const autoTagPlan = computed(() =>
  planAutoTagRows(
    autoTagSource.value.map((row) => ({
      downloaderId: row.clientId,
      id: row.id,
      tracker: row.tracker,
      tags: row.tags,
    })),
    {
      hostSiteEntries: hostSiteEntries.value,
      siteNameOf: (siteId) => metadataStore.siteNameMap[siteId] ?? siteId,
    },
  ),
);

const autoTagSkipped = computed(() => countAutoTagSkips(autoTagPlan.value.skipped));

/**
 * 行上那枚标记吃三档：`candidate` 说「还差 N 站没查」，`scanned` 说「没挂的那些站都查过了」，
 * `incomplete` 且进度报满的那一档说「这条只下载了部分文件，压根没进扫描范围」。
 *
 * 只有 `all-covered`（添加的站全挂上了）继续安静，是刻意的：那是个好结果，标出来只会让人以为出了岔子。
 * 原先还有一档也安静 —— Tracker 认不出属于哪个站（v0.117.0 之前的 `no-site`）。用户 2026-10-19
 * 第三次指着两行问「这两个还是没有待查的标记」之后判掉了：那一档的沉默不是保守，它让那条内容
 * **既没有标记、又进不了「待查」的扫描范围**（`pendingRowKeys` 只认 candidate），等于永久看不见。
 * 现在它照旧报缺口，只把浮层第一句换成「认不出来源站点」，见下面两处 `covered === 0` 分支。
 */
function reseedBadgeOf(record: CTorrent) {
  const verdict = reseedFacts.value.get(torrentKey(record));
  if (verdict?.kind === "candidate" || verdict?.kind === "scanned") return verdict;
  if (verdict?.kind === "incomplete" && verdict.partial) return verdict;
  return undefined;
}

/** 标记文字与浮层各算一次判据 —— 模板里不许为非空写感叹号 */
function reseedBadgeText(record: CTorrent): string {
  const verdict = reseedBadgeOf(record);
  if (!verdict) return "";
  if (verdict.kind === "incomplete") return t("MyClient.reseedCandidate.partialBadge");
  if (verdict.kind === "scanned") {
    // 查到有的那一档单独说：它是「现在就能去辅」的那一句，比「已查 N 站」更能让人接着往下做
    return verdict.tally.hasIt > 0
      ? t("MyClient.reseedCandidate.foundBadge", { count: verdict.tally.hasIt })
      : t("MyClient.reseedCandidate.scannedBadge", { count: verdict.scanned });
  }
  return t("MyClient.reseedCandidate.badge", { pending: verdict.pending });
}

function reseedBadgeTip(record: CTorrent): string {
  const verdict = reseedBadgeOf(record);
  if (!verdict) return "";
  if (verdict.kind === "incomplete") return t("MyClient.reseedCandidate.partialTip");
  if (verdict.kind === "scanned") {
    // 四档各报一个数、不并档：把「这次没查成」折进「那个站没有」会让人从此不去辅那个站
    const tally = {
      covered: verdict.covered,
      scanned: verdict.scanned,
      hasIt: verdict.tally.hasIt,
      suspect: verdict.tally.suspect,
      noMatch: verdict.tally.noMatch,
      failed: verdict.tally.failed,
    };
    // 「已挂在 0 个站点」不是事实，「Tracker 认不出属于哪个站」才是 —— 这两句只在 covered 为 0 时分岔
    return verdict.covered === 0
      ? t("MyClient.reseedCandidate.scannedBadgeTipUnknownSite", tally)
      : t("MyClient.reseedCandidate.scannedBadgeTip", tally);
  }
  return verdict.covered === 0
    ? t("MyClient.reseedCandidate.badgeTipUnknownSite", { pending: verdict.pending })
    : t("MyClient.reseedCandidate.badgeTip", { covered: verdict.covered, pending: verdict.pending });
}

/** 查到有的那一枚标绿，「只下了部分文件」那枚标灰（它说的是排除，不是结果），其余照旧蓝 */
function reseedBadgeColor(record: CTorrent): string {
  const verdict = reseedBadgeOf(record);
  if (verdict?.kind === "incomplete") return "default";
  return verdict?.kind === "scanned" && verdict.tally.hasIt > 0 ? "success" : "blue";
}

/**
 * 当前列表里还**有待查站点**的那几条：开关上那个数与勾上之后剩下的行共用这一份，不许各算一遍。
 * 查完的那些不在这一档里 —— 它们已经不需要「只看」就能被那枚「已查」标记认出来。
 */
const reseedCandidateRows = computed(() =>
  filteredTorrents.value.filter((row) => reseedFacts.value.get(torrentKey(row))?.kind === "candidate"),
);

/** 表格真正要吃的那一列行（`filteredTorrents` 只管状态与搜索，这一层再管「只看待查」） */
const visibleTorrents = computed(() => (reseedOnly.value ? reseedCandidateRows.value : filteredTorrents.value));

/**
 * 扫描面板的范围清单：一条内容一项，`knownSites` 是整组副本反查出来的并集。
 * 取数与行上那枚标记同源（同一份 `reseedRows` + 同一份分组判据），所以不会出现
 * 「标记说有 3 站、面板却排出 5 站」这种同一屏互相打脸的数。
 */
const reseedScanItems = computed(() => buildReseedScanScope(reseedRows.value, hostSiteEntries.value, reseedTasks.value));

/**
 * 一键辅种时的基准来源：同一份 `reseedRows` 按**与上面同一个内容键**折一遍，
 * 于是「扫描说查到了」与「一键说找不到基准」不会各说一套。
 *
 * 标签按**这颗基准所在下载器**现算（口径 `reseedHandoffLabelOf`，与搜索页那颗「辅种检测」弹窗的
 * 默认值同一份）：那一屏的下载器是按内容各定的，不能拿「当前选中的下载器」去套。
 */
const reseedLocalBases = computed(() => {
  // 「记住上次下载器」那颗开关关着时不传 remembered（与弹窗那一步的取法一致，一道开关只读一遍）
  const remembered = configStore.download.saveLastDownloader ? metadataStore.lastKeepUpload : undefined;
  const defaultTags = metadataStore.defaultDownloader?.tags;
  return buildReseedLocalBases(
    reseedRows.value,
    Object.fromEntries(Object.entries(metadataStore.downloaders).map(([id, item]) => [id, item?.name])),
    (downloaderId) => reseedHandoffLabelOf({ downloaderId, remembered, defaultTags }),
  );
});

/** 「还差站点」的那几条的行键：判据就是标记那一条，这里不另判一套 */
const pendingRowKeys = computed(
  () => new Set(reseedRows.value.filter((row) => reseedFacts.value.get(row.key)?.kind === "candidate").map((row) => row.key)),
);

/**
 * 扫描面板上的三档范围。
 *
 * 条数按**整片表**算，不跟着搜索框与状态筛选走：那两样只影响看得见的行，
 * 而「这次要查多少条」是发请求的预算，跟着筛选漂会让人以为少发了。
 */
const reseedScanScopes = computed<IReseedScanScope[]>(() => {
  const items = reseedScanItems.value;
  const selectedKeys = new Set(tableSelected.value.map((row) => torrentKey(row)));
  const hits = (item: (typeof items)[number], keys: Set<string>) => item.memberKeys.some((key) => keys.has(key));
  const pending = items.filter((item) => hits(item, pendingRowKeys.value));
  const picked = items.filter((item) => hits(item, selectedKeys));
  return [
    { key: "pending", label: t("MyClient.reseedScan.scope.pending", { count: pending.length }), targets: pending },
    { key: "completed", label: t("MyClient.reseedScan.scope.completed", { count: items.length }), targets: items },
    { key: "selected", label: t("MyClient.reseedScan.scope.selected", { count: picked.length }), targets: picked },
  ];
});

/**
 * 扫描要读哪几台下载器的本地指纹：表里出现过的全给它。
 * 多给的那几台只会多建一次 30 分钟的索引缓存，不影响结论 —— 比对是按内容键找的。
 */
const reseedScanDownloaderIds = computed(() => [...new Set(reseedRows.value.map((row) => row.clientId))]);

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
 * 展开着 / 正在收起的那一组，行上要挂的 class（用户 2026-10-16：「背景色要和普通的不一样，
 * 这样一眼就能看到这两条是一组的」，以及同日一句「展开的时候能看到动画了，但是收起来的时候没有」）。
 *
 * - `torrent-group-row`：整组（代表行 + 组员行）共用的底色。**只在展开时挂** —— 折叠态只有
 *   代表行一条露在外面，给它上「这是一组」的颜色等于凭空说「这一行不一样」而说不出哪里不一样，
 *   满屏的组锚行还会把这一页刷成一片蓝。
 * - `torrent-group-member`：只有组员行有，代表行本来就一直摆在表里、DOM 节点不换引用，
 *   给它挂入场动画等于每次展开都让那一行闪一下。组员是展开那一刻才插进来的新节点。
 * - `torrent-group-exit` / `torrent-group-member-exit`：收起那 180ms 的退场档。前者整组都有
 *   （只退底色，代表行不能整行淡出 —— 它收完还在原位），后者只有组员，连行一起滑走。
 *   这两条**不带** `torrent-group-row`：底色那条的收势靠 keyframes 的隐式 100% 帧回到级联自己的值，
 *   留着它就会变成「从蓝淡到蓝」。
 */
function torrentRowClass(record: CTorrent) {
  const meta = grouped.value.meta.get(torrentKey(record));
  if (!meta) return "";
  // 正在收起：整组（含代表行）先退底色，组员再连行一起滑走
  if (collapsingGroups.value.has(meta.group)) {
    return meta.anchor ? "torrent-group-exit" : "torrent-group-exit torrent-group-member-exit";
  }
  if (!expandedGroups.value.has(meta.group)) return "";
  return meta.anchor ? "torrent-group-row" : "torrent-group-member torrent-group-row";
}

/**
 * 组员逐条错开入场用的序号，挂在行内 CSS 变量上（`--group-in-index`）。
 *
 * 一次放出十几条时，「整块同时滑进来」读起来还是一次跳变；一条隔 45ms 排着出来才看得出
 * 是从代表行下面**长出来的一组**。序号取组内位置（代表行 0，组员从 1 起），并且钉到 6 为止 ——
 * 再往后只是让最后几条白等，19 条一组时那已经是一秒开外了。
 *
 * 走 `on-row` 而不是给每个序号写一条 class：antdv-next 的 Table 声明了 `onRow`
 * （`dist/table/Table.js`），它返回的 `style` 由 @v-c/table 的 BodyRow 合进 `<tr>`。
 */
function torrentRowAttrs(record: CTorrent) {
  const key = torrentKey(record);
  const meta = grouped.value.meta.get(key);
  if (!meta || meta.anchor || !expandedGroups.value.has(meta.group)) return {};
  const list = grouped.value.members.get(meta.group) ?? [];
  const index = Math.max(0, list.indexOf(key));
  return { style: { "--group-in-index": String(Math.min(index, 6)) } };
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

  // 扫描结论与种子列表互不依赖：它只喂行上那枚「待查 / 已查」标记，不等下载器回包
  void loadScanResults();

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
  // 退场那 180ms 的计时器：页面都走了，留着它只会在下一次挂载之后突然改一次状态
  for (const t of collapseTimers.values()) clearTimeout(t);
  collapseTimers.clear();
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
watch([searchText, stateFilter, reseedOnly], () => (tablePage.value = 1));
const pageSize = computed(() => configStore.tableBehavior["MyClient"]?.itemsPerPage ?? 25);

// 每页条数按面板实高算（用户 2026-10-08：「既不能出现滚动条又要把页面铺满」）
const pagePanel = useTemplateRef<HTMLDivElement>("pagePanel");
/** 本次进入这一页之内他挑的那一档：挑过就照他挑的（容量不再压），不持久 —— 重新进来回到实测那档 */
const sessionSize = ref<number | null>(null);
const { fitted: fitPageSize } = useAutoFitPageSize({
  container: () => pagePanel.value,
  // 量的是**折叠后真正出现**的那些行：每页条数要按看得见的行数铺满，不是按台账条数
  rows: () => grouped.value.rows,
});

// 分页统一走 toPagination：它兜底 Vuetify 遗留的 -1/0（原先这页直接把 -1 交给 antd，
// 会让 slice(0,-1) 吃掉最后一行），并带上「一页放得下就不出分页条」（用户 2026-10-07）。
// 总数用折叠后的行数 —— 折叠的意义就是「一屏放得下的条目变多了」，还按 523 条算会白切页。
const tablePagination = computed(() =>
  toPagination(sessionSize.value ?? pageSize.value, 25, {
    size: "small",
    totalRows: grouped.value.rows.length,
    fitSize: fitPageSize.value,
    picked: sessionSize.value !== null,
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
    // 挑档只活在本次进入里：不写 store（写了也没人读），重新进来又是实测那一档
    sessionSize.value = pagination.pageSize;
  }
  tablePage.value = pagination?.current ?? 1;
}
</script>

<template>
  <!-- 顶部那条 a-alert 去掉了：左侧导航已经标出当前页。它 #action 里的两件事没丢 ——
       下载器筛选标签与状态按钮一起并进工具条右端。骨架见 style.css 的 .page。 -->
  <div class="page">
    <a-flex align="center" gap="small" wrap class="page-bar">
      <a-flex align="center" gap="small" wrap>
      <!-- 这一排（含右端那一组）一律 size="small"：2026-10-18 用户看了 v0.108.0 的截图说
           「宽度又不够了，要不这个页面用 size 为 small 的组件吧」。台架量的省幅与阈值见下面
           搜索框那段注释；这一页的表体本来就是 `size="small"`，工具条降档反而与它齐平。 -->
      <a-tooltip :title="t('MyClient.pushToDownloader.navBtn')">
        <a-button size="small" type="text" @click="showPushToDownloaderDialog = true">
          <template #icon><CloudUploadOutlined /></template>
        </a-button>
      </a-tooltip>

      <!-- 转种：把选中的这一颗交到另一个站的上传页。与上面那颗「推送种子」并排 —— 两件事都是
           「把这一颗发出去」，区别只在发到另一台下载器 / 另一个站。同样只放图标：这一排的宽度
           预算按台架量过（见下面搜索框那段），多一颗 small 图标档约 32px，英文那一档 1540.2 →
           1572.2 仍在 1591 之内。 -->
      <a-tooltip :title="t('MyClient.transferUpload.entry')">
        <a-button size="small" type="text" :disabled="tableSelected.length === 0" @click="showTransferUploadDialog = true">
          <template #icon><CloudSyncOutlined /></template>
        </a-button>
      </a-tooltip>

      <a-divider type="vertical" />

      <a-tooltip :title="t('MyClient.resumeSelected')">
        <a-button size="small" type="text" :disabled="tableSelected.length === 0" @click="() => resumeTorrents(tableSelected)">
          <template #icon><PlayCircleOutlined /></template>
        </a-button>
      </a-tooltip>
      <a-tooltip :title="t('MyClient.pauseSelected')">
        <a-button size="small" type="text" :disabled="tableSelected.length === 0" @click="() => pauseTorrents(tableSelected)">
          <template #icon><PauseOutlined /></template>
        </a-button>
      </a-tooltip>
      <a-tooltip :title="t('MyClient.deleteSelected')">
        <a-button size="small" type="primary" danger :disabled="tableSelected.length === 0" @click="() => openDeleteDialog(tableSelected)">
          <template #icon><DeleteOutlined /></template>
        </a-button>
      </a-tooltip>
      <a-tooltip :title="t('MyClient.recheckSelected')">
        <a-button size="small" type="text" :disabled="tableSelected.length === 0" @click="() => openRecheckDialog(tableSelected)">
          <template #icon><ReloadOutlined /></template>
        </a-button>
      </a-tooltip>
      <a-tooltip :title="t('MyClient.speedLimit.batchBtn')">
        <a-button size="small" type="text" :disabled="tableSelected.length === 0" @click="showSpeedLimitDialog = true">
          <template #icon><FieldTimeOutlined /></template>
        </a-button>
      </a-tooltip>
      <!-- 不再「没勾选就灰」：自动那一档不勾任何一条 = 对这一台下载器的全部种子补标签，
           他要处理的正是存量那一堆（一页 12 条地勾不现实）。 -->
      <a-tooltip :title="t('MyClient.label.batchBtn')">
        <a-button size="small" type="text" @click="showLabelDialog = true">
          <template #icon><TagsOutlined /></template>
        </a-button>
      </a-tooltip>

      <a-divider type="vertical" />

      <a-tooltip :title="t('MyClient.refresh')">
        <a-button size="small" type="text" @click="loadTorrents">
          <template #icon><ReloadOutlined /></template>
        </a-button>
      </a-tooltip>

      <!-- auto-refresh controls -->
      <a-dropdown trigger="click">
        <a-tooltip :title="t('MyClient.autoRefresh.btnTitle')">
          <a-button size="small" type="text">
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

      <!-- 「可辅种扫描」的独立入口（用户 2026-10-19：「这个界面加一个辅种扫描的独立按钮」）。
           原先这一屏唯一的入口是名称下面那枚「待查 N 站」标记，它要先扫到候选才画得出来 —— 一条都没扫过
           的时候界面上没有第二处能打开面板的地方。这一档只放图标、不带文字：台架按用户那一栏实宽
           （容器 1609 / 内容 1591，small 档、搜索框 200）量过，图标档自然宽 1411.2 → 1443.2 仍是一行，
           而带上「可辅种扫描」四个字是 1520.8，再加上那颗下载器标签就 1592.4 掉到两行（条高 57.6）；
           英文那一趟图标档 1540.2 → 1572.2 还在一行，文字档 1656.2 已经出界。所以文字档两种语言里
           只能选一种保一行，不替他重排那一排。 -->
      <a-tooltip :title="t('MyClient.reseedScan.openBtn')">
        <a-button size="small" type="text" @click="showReseedScanDialog = true">
          <template #icon><ScanOutlined /></template>
        </a-button>
      </a-tooltip>
      </a-flex>

      <!-- 工具条右端：状态筛选 + 下载器筛选标签 + 状态按钮（原 a-alert 的 #action）、自定义列、搜索框。
           这一组**不**靠右钉住（`.bar-group` 把 `.page-bar-extra` 的 `margin-left: auto` 关掉）：
           整排降到 small 档之后中间空出 ~180px，靠右钉住会把那段空白整个留在左组与这一组之间，
           用户 2026-10-18 指着那道缝说「这里还有空间，可以把按钮往这边挪一挪」⇒ 改成跟着左组顺排，
           空白落到整条工具条的右端。窄窗口下两组仍然一起 wrap 换行（`.page-bar-extra` 的 `min-width: 0` 留着）。 -->
      <a-flex align="center" gap="small" wrap class="page-bar-extra bar-group">
        <!-- 固定几选一一律 a-radio-group + button-style="solid"（选中实心蓝底白字），不用 a-segmented：
             segmented 的选中态是灰底轨道上一块白浮标，落在那条浅灰栏里几乎看不出选的是哪个（AGENTS §3.4）。
             `size="small"` 只管到这一排的外观，不改判据。注意 `a-checkbox` 与 `a-tag` **没有** size 这个
             prop（实测注册表 props），所以那一勾和那颗标签仍按默认档画 —— 这一排是**部分**降档。 -->
        <a-radio-group v-model:value="stateFilter" name="my-client-state-filter" button-style="solid" size="small">
          <a-radio-button v-for="opt in stateFilterOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </a-radio-button>
        </a-radio-group>

        <!-- 「只看待查」：与行上那枚标记同一份判据（reseedBadgeOf），括号里的数就是勾上会剩下几条 -->
        <a-checkbox v-model:checked="reseedOnly">
          {{ t("MyClient.reseedCandidate.filterLabel", { count: reseedCandidateRows.length }) }}
        </a-checkbox>

        <a-tag v-if="selectedDownloaderIds.length === 1" color="blue" closable @close="clearDownloaderFilter">
          <template #icon><img class="client-tag-icon" :src="clientIcon(selectedDownloaderIds[0])" alt="" /></template>
          {{ clientName(selectedDownloaderIds[0]) }}
        </a-tag>

        <HoverTip :text="t('MyClient.clientStatusDialog.openBtn')">
          <a-button size="small" type="primary" @click="showClientStatusDialog = true">
            <template #icon><ThunderboltOutlined /></template>
            {{ allTorrents.length }}
            <ArrowUpOutlined style="color: #389e0d" />
            {{ formatSize(totalUpSpeed) }}/s
            <ArrowDownOutlined style="color: #cf1322" />
            {{ formatSize(totalDlSpeed) }}/s
          </a-button>
        </HoverTip>

        <a-button size="small" @click="showColumnDialog = true">
          <template #icon><ColumnWidthOutlined /></template>
          <span>{{ t("MyClient.columnSelector") }}</span>
        </a-button>

        <!--
          200px 是量出来的，不是目测的。`.page` 把工具条那一行钉在 `minmax(48px, auto)`（style.css 的 .page），
          而这一排的自然宽（左组 + 缝 8 + 右端那一组）超过容器内容宽（栏宽 − 左右内衬 8+8 − 边框 1+1）时，
          `wrap` 会把右端整组甩到第二行 —— 界面表现就是用户报的「排版错位」。

          台架（`.tmp-build/bench-myclientbar`，真组件 + 真文案 + token fontSize 13）两档并排量到：
            默认档 自然宽 1643.2（中文，当下没有下载器标签）/ 1714.8（带上那颗标签）/ 1772.2（英文）
            small 档 1411.2 / 1482.8 / 1540.2            —— 也就是这一排降档省 232.0 px
          他那一栏 `.page` 实宽 1609（本轮又从他这张截图二次核对：面板高 99 设备 px ÷ 1.375 = 72 CSS，
          同一张图里那颗实心蓝按钮盒高 44 ÷ 1.375 = 32 ⇒ 条高正是台架那两行的一档 73.6）。
          内容宽 1591，所以默认档怎么都放不下，small + 200 一行、余量 179.8。

          为什么仍留 200 而不是放回 260：small 省出来的宽度够把搜索框抬到 260（中文那一档 1471.2 还是一行，
          占位文案「搜索种子名称、Hash、标签、路径」实测 260 起才完整），但**英文**那一档 260 是 1600.2 > 1591，
          会掉回两行 —— 于是这一档那行提示语照旧缺尾巴（原生 placeholder 只裁、不加省略号）。
        -->
        <a-input v-model:value="searchText" name="my-client-torrent-search" size="small" :placeholder="t('MyClient.searchPlaceholder')" allow-clear style="width: 200px">
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
      :on-row="torrentRowAttrs"
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
                 要把标签也显示出来」。判据在 columnText.ts 的 labelChips（去重 + 丢空）。
                 「待辅 N 站」那枚也排在这一行：单独占一行就等于把名称那一行的高度预算还回去
                 （这一页每页条数是按实测行高算的）。 -->
            <div
              v-if="labelChips(record.label, record.tags).length || reseedBadgeText(record)"
              class="torrent-labels text-body-small text-grey"
            >
              <template v-if="labelChips(record.label, record.tags).length">
                <TagsOutlined class="torrent-labels__icon" />
                <span v-for="chip in labelChips(record.label, record.tags)" :key="chip" class="torrent-labels__chip">
                  {{ chip }}
                </span>
              </template>
              <HoverTip
                v-if="reseedBadgeText(record)"
                :text="reseedBadgeTip(record)"
                placement="topLeft"
                :delay="0.4"
              >
                <!-- 用 a-tag 而不是自绘 chip：底色与前景由 antd 的 token 算，深浅色主题与对比度都不用手写十六进制赌。
                     这颗标记也是「可辅种扫描」的入口（点它打开面板），v0.114.4 起不再是唯一的那一个 —— 工具条
                     添了独立按钮。当时把它挂在这枚标记上的理由是「那一排放不下新控件」（台架量到带那颗勾的自然宽
                     1713 > 用户那一栏的 1609），那次量的是**默认档 + 带文字**；整排降到 small 之后余量其实只够
                     **图标档**（1411.2 → 1443.2 仍一行；带「可辅种扫描」四个字 1520.8，再加一颗下载器标签
                     1592.4 就掉两行）。标记留着不撤：这一行没有可辅缺口时它画不出来，两处的用处不同。 -->
                <a-tag :color="reseedBadgeColor(record)" class="reseed-candidate-tag" @click="showReseedScanDialog = true">
                  {{ reseedBadgeText(record) }}
                </a-tag>
              </HoverTip>
            </div>
          </div>
        </template>

        <!-- size column -->
        <template v-else-if="column.key === 'totalSize'">
          <span class="text-no-wrap">{{ formatSize(record.totalSize) }}</span>
        </template>

        <!-- progress column -->
        <template v-else-if="column.key === 'progress'">
          <!-- 36 → 28（用户 2026-10-16：「这个图标大了点，和整体不太和谐」）。同一行里另一颗圆的东西是
               `.client-avatar` 那颗 22px 的下载器图标，36 比它大 1.6 倍，两枚并排就是一头沉。
               为什么停在 28 而不是更小的 24 / 22：台架挂真组件按 36/28/24/22 各量一遍，
               描边四档都是 3px（不随尺寸缩），所以圈内的横向净空 = 尺寸 − 6；而未完成那档圈里是读数，
               「62%」三个字符的墨迹实测 21.63 / 19.35 / 18.21 / 17.64px —— 对 30 / 22 / 18 / 16 的净空，
               24 档已经差 0.21px 顶到环上，22 档超 1.64px。28 档留 1.3px 余量，是能保住读数不碰环的下界。 -->
          <a-progress
            v-if="toPercent(record.progress) !== null"
            type="circle"
            :percent="toPercent(record.progress) ?? 0"
            :size="28"
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

  <!-- 转种：源种子由 offscreen 回源站按 infoHash 认出来，见 TransferUploadDialog 的文件头 -->
  <TransferUploadDialog v-model="showTransferUploadDialog" :torrents="transferSourceRows" />

  <!-- 「可辅种扫描」：两处入口 —— 工具条左端末尾那颗图标按钮，与名称下面那枚可辅种标记（见标记处注释）。
       范围三档与本地指纹要读的下载器都在这里算好传进去，面板自己不再判第二遍。 -->
  <ReseedScanDialog
    v-model="showReseedScanDialog"
    :scopes="reseedScanScopes"
    :downloader-ids="reseedScanDownloaderIds"
    :usable-sites="usableReseedSites"
    :bases="reseedLocalBases"
  />

  <ClientStatusDialog v-model="showClientStatusDialog" />

  <TorrentDetailDialog v-model="showDetailDialog" :torrent="detailTorrent" />

  <SpeedLimitDialog v-model="showSpeedLimitDialog" :torrents="tableSelected" />

  <LabelDialog
    v-model="showLabelDialog"
    :torrents="tableSelected"
    :suggest-labels="existingLabels"
    :auto-tag-adds="autoTagPlan.adds"
    :auto-tag-skipped="autoTagSkipped"
    :auto-tag-scope="autoTagSource.length"
    @done="loadTorrents"
  />

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

/* 关掉全站那条「工具条右端那一组靠右钉住」（style.css 的 .page-bar-extra）。
   scoped 选择器自带 (0,2,0)，压得过全局那条 (0,1,0)，不用 !important。 */
.bar-group {
  margin-left: 0;
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

/* 「待查 N 站」那枚。a-tag 自带 8px 右外边距与一档 line-height，而这一行已经用 flex gap 排、
   行高由 useAutoFitPageSize 实测（撑高一分就少摆一条）—— 所以把这两样压回这一行的档，
   底色与前景仍交给 antd 的 token（不手写十六进制，深浅色主题都跟着走）。
   它同时是「可辅种扫描」的入口，所以给 pointer：不给就看不出这一枚可点。 */
.reseed-candidate-tag {
  cursor: pointer;
  margin-inline-end: 0;
  font-size: inherit;
  line-height: 16px;
}

/* ===== 展开一组同内容：入场动画 + 整组底色 =====
   `<tr>` 由 a-table 内部组件渲染，拿不到本组件的 scope id，所以这几条都必须走 :deep ——
   编译后是 `[data-v-*] .ant-table-tbody > tr…`，靠本组件模板里那层 `.page-panel` 提供 scope id。

   位移从 4px 加到 12px、时长从 180ms 加到 240ms，再按组内序号每条错开 45ms（`--group-in-index`
   由 torrentRowAttrs 挂在行内）。原先那 4px 不是空转：台架挂真 a-table 把动画钉在时间轴上量过，
   `from` 那一帧组员行的盒确实上移 12px（204.80 → 216.80，`getComputedStyle` 给
   `matrix(1,0,0,1,0,-12)`，Chrome 150）—— 它只是小到读不成「一组长出来」，
   整块同时挪 4px 只会被看成一次跳变。`both` 是必须的：没有它，被延迟的那几条会在自己
   那一拍之前先以最终态闪一下。 */
:deep(.ant-table-tbody > tr.torrent-group-member) {
  animation: torrent-group-row-in 240ms cubic-bezier(0.22, 0.61, 0.36, 1) both;
  animation-delay: calc(var(--group-in-index, 0) * 45ms);
}

@keyframes torrent-group-row-in {
  from {
    opacity: 0;
    transform: translateY(-12px);
  }
}

/* 整组底色。两条判据都是量出来的，不是排着好看：
   ① 不用灰 —— 全站口径是「灰只能当 8px 缝」，而这一档要说的是「这几条是一组」，
      跟斑马纹抢同一种颜色就永远说不清。取主色 rgba(22,119,255,…) 两档。
   ② 特异度必须**高于** style.css 那两条（斑马纹 0,3,2、悬停 0,4,2），否则组行会被条纹
      或悬停盖掉；编译后带 `[data-v-*]` 这一档属性选择器，基础那条正好 0,5,2、悬停那条 0,6,2。
   两条都带 `:not(.ant-table-row-selected)`：被勾上的那一行根本不被这两条匹配，
   所以 antd 自己的选中档一律赢 —— 选中态不需要再跟它比特异度。
   底色落在 <td> 上，和 style.css 那两条同一个元素（条纹落 <tr> 会被悬停/选中盖掉的教训见那里）。 */
:deep(.ant-table-tbody > tr.ant-table-row.torrent-group-row:not(.ant-table-row-selected) > td) {
  background: rgba(22, 119, 255, 0.08);
  /* 代表行是「一直在那儿」的那一条：它上色时没有入场动画可跟，靠这一条淡入才不会突然变一块蓝 */
  transition: background-color 180ms linear;
}

:deep(.ant-table-tbody > tr.ant-table-row.torrent-group-row:not(.ant-table-row-selected):hover > td) {
  background: rgba(22, 119, 255, 0.15);
}

/* 退场那一档（收起）。两半分开挂：
   - `torrent-group-exit` 落在**整组**的 td 上，只把底色收掉。代表行不能整行淡出 ——
     它收完还留在原位，淡出再淡回来就是原地闪一下。
   - `torrent-group-member-exit` 只落在组员行上，连行一起淡出 + 上移，和入场那条反向。
   底色这条**只写 `from`**：100% 那一帧由级联自己算（奇数行回到条纹、偶数行回到白），
   所以收尾不会跳一下；这也是为什么退场档不许同时带 `torrent-group-row` —— 带着它，
   隐式 100% 算出来还是蓝，等于从蓝淡到蓝。 */
:deep(.ant-table-tbody > tr.ant-table-row.torrent-group-exit > td) {
  animation: torrent-group-tint-out 180ms linear;
}

:deep(.ant-table-tbody > tr.ant-table-row.torrent-group-member-exit) {
  animation: torrent-group-row-out 180ms cubic-bezier(0.4, 0, 0.7, 0.2) both;
}

@keyframes torrent-group-row-out {
  to {
    opacity: 0;
    transform: translateY(-12px);
  }
}

@keyframes torrent-group-tint-out {
  from {
    background: rgba(22, 119, 255, 0.08);
  }
}

/* 系统开了「减少动态效果」就不滑、不错开，只留下原本的直接出现（底色那一档与动效无关，照旧）。
   JS 那一边同步撤掉 180ms 的退场滞留（`prefersReducedMotion`），不然这里只撤动画、
   那几行却还多留在列表里一瞬 —— 看着像卡了一下。 */
@media (prefers-reduced-motion: reduce) {
  :deep(.ant-table-tbody > tr.torrent-group-member),
  :deep(.ant-table-tbody > tr.ant-table-row.torrent-group-exit > td),
  :deep(.ant-table-tbody > tr.ant-table-row.torrent-group-member-exit) {
    animation: none;
  }
}
</style>
