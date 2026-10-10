<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useTemplateRef } from "vue";
import { useI18n } from "vue-i18n";
import { type TableColumnsType } from "antdv-next";
import {
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  LinkOutlined,
  NumberOutlined,
  QuestionCircleOutlined,
  SyncOutlined,
} from "@antdv-next/icons";

import type { CTorrent } from "@ptd/downloader";
import type { IKeepUploadTask, TKeepUploadTaskKey } from "@/shared/types.ts";
import { sendMessage } from "@/messages.ts";
import { formatSize, formatDate } from "@/options/utils.ts";
import { useTableBehavior } from "@/options/directives/useTableBehavior.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";

import SiteFavicon from "@/options/components/SiteFavicon/Index.vue";
import KeepUploadUsageDialog from "@/options/components/KeepUploadUsageDialog.vue";
import { useConfirmDanger } from "@/options/components/useConfirmDanger.ts";

import { buildReseedAddTorrentOptions } from "./autoReseed.ts";
import {
  judgeReseedTorrent,
  linkItemToTorrent,
  reseedStage,
  shouldPauseReseed,
  summarizeReseed,
  type IReseedItemStatus,
  type TReseedStage,
  type TReseedVerdict,
} from "./seedVerify.ts";

const { t } = useI18n();
const runtimeStore = useRuntimeStore();
const metadataStore = useMetadataStore();

const tasks = ref<IKeepUploadTask[]>([]);
// 表格 row-key 为 id，因此选中项保存的是任务ID（TKeepUploadTaskKey）而非任务对象
const selectedTasks = ref<TKeepUploadTaskKey[]>([]);
const loading = ref(false);
const showUsageDialog = ref(false);
const pagePanel = useTemplateRef<HTMLDivElement>("pagePanel");

/**
 * 正在发送的那一颗：任务 id → 哪一路。
 * 发送是页内手写的 sendMessage("downloadTorrent")，一条要等后台下载 + add 完才回来（几秒），
 * 期间界面原先什么都不动 —— 他 2026-10-09 报「点了没反应，过了几秒才提示发送成功，会以为功能失效」。
 * 记到「哪一路」是为了只让被点的那颗转圈，同时把同任务其它发送键暂时按住（三路发的集合有重叠）。
 */
type TSendKind = "base" | "other" | "all" | `one:${number}`;
const sending = ref<Record<string, TSendKind | undefined>>({});
const sendingOf = (id: string) => sending.value[id];

const { sortOrderOf, pagination, handleTableChange } = useTableBehavior("KeepUploadTask", {
  // 这一档必须等于 config.ts 里 tableBehavior.KeepUploadTask.itemsPerPage，
  // 否则「他挑过一档没有」判错（见 AGENTS.md §3.4 那条）
  defaultPageSize: 25,
  size: "small",
  // 一页放得下就不出分页条（用户 2026-10-07 的全站口径）
  totalRows: () => tasks.value.length,
  // 每页条数按面板实高算（用户 2026-10-08：「既不能出现滚动条又要把页面铺满」）
  autoFit: { container: () => pagePanel.value, rows: () => tasks.value },
  // 这页没有默认排序档，所以「点第三下取消」要真能取消，否则存的档会把箭头按回去
  clearOnEmpty: true,
});

/** 没存过排序时整条 sortOrder 都不带：显式给 null 会被 antd 判成受控，点了不排 */
function persistedSort(key: string) {
  const order = sortOrderOf(key);
  return order ? { sortOrder: order } : {};
}

// computed：表头有 t()，setup 里一次性求值的话切语言不会重算
const columns = computed<TableColumnsType<ITaskRow>>(() => [
  { title: t("KeepUploadTask.table.site"), key: "site", align: "center", width: 72 },
  { title: t("KeepUploadTask.table.title"), key: "title", align: "left", ellipsis: true },
  { title: t("KeepUploadTask.table.savePath"), key: "savePath", align: "left", width: 220 },
  {
    title: t("KeepUploadTask.recheck.col"),
    key: "seedState",
    align: "center",
    // 150 是按这一列最长的那句量的：「基准在下 100%」+ 下面那行「1 条没正常做种」
    width: 150,
    // 排的是结论的严重度档位，不是那一格显示的文字 —— 文字带着条数，
    // 按字符串排会让「10 条在做种」排在「2 条在做种」前面。
    // 排完只动任务行，条目行跟着自己的父行走（树形数据的排序发生在顶层）。
    // 注意这里排的是**结论严重度**，而界面上显示的是**进度阶段**：两套不一样是故意的
    // （见下面 RESEED_RANK 那段），排序要的是「越该先看越靠前」，不是「走到哪一步」
    sorter: (a, b) => reseedRank(a.task) - reseedRank(b.task),
    ...persistedSort("seedState"),
  },
  {
    title: t("KeepUploadTask.table.size"),
    key: "size",
    align: "right",
    width: 110,
    sorter: (a, b) => a.task.size - b.task.size,
    ...persistedSort("size"),
  },
  {
    title: t("KeepUploadTask.table.count"),
    key: "count",
    align: "center",
    width: 80,
    sorter: (a, b) => a.task.items.length - b.task.items.length,
    ...persistedSort("count"),
  },
  {
    title: t("KeepUploadTask.table.time"),
    key: "time",
    align: "center",
    width: 170,
    sorter: (a, b) => a.task.time - b.task.time,
    ...persistedSort("time"),
  },
  {
    // 「完成时间」= 这一条走到「辅种完成」（其余每条都在做种/停着、且没有认不出的）那一档的时刻，
    // 由后台每分钟那一轮写进 `autoState.completedAt`。没走到就是 "-"。
    // 边界要说清：**没开「自动辅种」的任务这一列永远是 "-"** —— 那一档只有后台在算，
    // 页面上手动「回查」不写时间（它拿的是同一份判据，但没有每一轮的时刻可记）。
    title: t("KeepUploadTask.table.completedAt"),
    key: "completedAt",
    align: "center",
    width: 170,
    // 没完成的那些没有这一项，按 0 参与比较会混进「最早完成」那一头，所以缺值一律排到已完成的
    // 后面（升序降序都如此）；两条都没完成时返回 0，不返回 Infinity-Infinity（那是 NaN，比较器不许）
    sorter: (a, b) => {
      const x = a.task.autoState?.completedAt;
      const y = b.task.autoState?.completedAt;
      if (x === undefined) return y === undefined ? 0 : 1;
      if (y === undefined) return -1;
      return x - y;
    },
    ...persistedSort("completedAt"),
  },
  {
    title: t("common.action"),
    key: "action",
    align: "center",
    // 140 是量出来的，不是估的（台架 ?m=row，真 DOM）：这一格最宽的是**父行**那 5 颗图标键 = 120px，
    // 加左右内衬 8+8 是 136，再留 4px 给亚像素取整；条目行那三颗只有 72px。
    // 这一条从 180 → 210 → 140 的来回都是同一件事的两端：内容比格子宽时，居中对齐会把两侧一起
    // 推到列外，而 `.ant-table-content` 是 overflow:auto —— 伸出去的那截直接把它撑出一条横向滚动条
    // （v0.61.1 那次事故就是「↑」伸出去 21px）。那时那一格要装三个汉字的文字键（194px），
    // 2026-10-10 换成图标键之后就只需要装图标了。
    width: 140,
  },
]);

/**
 * 表格行：任务行，加上它展开出来的条目行。两种行**共用同一批列**。
 *
 * 原先条目是 `#expandedRowRender` 里一个自由布局的 `<ul>` —— 那块内容不在 `<table>` 里，
 * 列宽对不上，标题跑到中间、状态和按钮挤出「操作」列外（他 2026-10-09：「展开之后内容也要在
 * 标题所在的列，现在完全乱的」）。改成 rc-table 的树形数据（`children`）后，子行由同一次
 * flatten 渲染、和父行同一张 `<table>` 的同一批 `<col>`，对齐是结构给的，不靠抄宽度。
 */
type TTaskItem = IKeepUploadTask["items"][number];

interface IItemRow {
  id: string;
  kind: "item";
  task: IKeepUploadTask;
  item: TTaskItem;
  index: number;
}

interface ITaskRow {
  id: TKeepUploadTaskKey;
  kind: "task";
  task: IKeepUploadTask;
  children: IItemRow[];
}

type TTableRow = ITaskRow | IItemRow;

/**
 * 每次重新映射出新行对象，**不把 `children` 写回任务本身**：那些对象是要经
 * `updateKeepUploadTask` 落进 IDB 的，塞进去就是往用户数据里多存一份派生字段。
 * 所以模板里取任务一律走 `record.task`（条目行也带 `.task`，两种行同一个写法）。
 */
const tableRows = computed<ITaskRow[]>(() =>
  tasks.value.map((task) => ({
    id: task.id,
    kind: "task" as const,
    task,
    children: task.items.map((item, index) => ({
      id: `${String(task.id)}#${index}`,
      kind: "item" as const,
      task,
      item,
      index,
    })),
  })),
);

/** 条目行不给复选框：批量删除删的是任务，勾选一条子种子没有对应动作 */
const rowCheckboxProps = (row: TTableRow) => (row.kind === "item" ? { style: { display: "none" } } : {});

// —— 两种行共用的取值：条目行取自己那条，任务行取任务本身 ——
const rowTitle = (row: TTableRow) => (row.kind === "item" ? row.item.title : row.task.title);
const rowSubTitle = (row: TTableRow) => (row.kind === "item" ? row.item.subTitle : row.task.subTitle);
const rowLink = (row: TTableRow) => (row.kind === "item" ? row.item.link : row.task.items[0]?.link);
const rowSiteId = (row: TTableRow) => (row.kind === "item" ? row.item.site : row.task.items[0]?.site);
const rowSize = (row: TTableRow) => (row.kind === "item" ? row.item.size : row.task.size);

/** 保存路径那一列第一行：列头已经写着「保存路径」，所以这里不再重复那个前缀 */
function savePathLine(record: IKeepUploadTask) {
  const path = record.downloadOptions?.savePath;
  return `${record.downloadOptions?.clientName ?? "-"} -> ${path || t("KeepUploadTask.defaultPath")}`;
}

function baseLocalLine(record: IKeepUploadTask) {
  return `${t("KeepUploadTask.baseLocal")}${record.baseLocal?.name ?? ""}`;
}

/** 页面开着时跟着后台那一分钟的节奏取一次任务，见 `refreshTasksFromStorage` */
const AUTO_REFRESH_MS = 60_000;
let autoRefreshTimer: number | undefined;

async function loadTasks() {
  loading.value = true;
  try {
    tasks.value = await sendMessage("getKeepUploadTasks", undefined);
  } catch (e) {
    console.error("Failed to load keep upload tasks:", e);
    tasks.value = [];
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  loadTasks();
  autoRefreshTimer = window.setInterval(refreshTasksFromStorage, AUTO_REFRESH_MS);
});

/**
 * 后台那条自动辅种每分钟把结论写回任务（`autoState`），而这一页原本只在打开时读一次 ——
 * 不刷新的话用户看到的是「没查过」，而种子其实一分钟前就被后台停了。
 *
 * 不走 `loadTasks`：那颗 `loading` 是给整张表套一层 Spin（AGENTS §3.4「轮询的表不许翻 loading」），
 * 每分钟把整页暗一下、遮罩期间还点不动，比迟一分钟看到更新更糟。
 * 回包先比一次，内容没变就不换数组引用，免得每分钟白重排一遍整张表。
 */
async function refreshTasksFromStorage() {
  try {
    const next = await sendMessage("getKeepUploadTasks", undefined);
    if (JSON.stringify(next) === JSON.stringify(tasks.value)) return;
    tasks.value = next;
  } catch {
    // 静默：这一轮没拿到就下一轮再拿，用户随时能手动刷新
  }
}

// 统一走公共实现（原先这里是本仓库第一份手写副本，现已抽到 components/useConfirmDanger.ts）
const { confirmDanger } = useConfirmDanger();

async function deleteTask(task: IKeepUploadTask) {
  if (!(await confirmDanger(t("KeepUploadTask.deleteConfirm"), "danger", t("common.remove")))) return;

  try {
    await sendMessage("deleteKeepUploadTask", task.id);
    tasks.value = tasks.value.filter((item) => item.id !== task.id);
    runtimeStore.showSnakebar(t("KeepUploadTask.deleteSuccess"), { color: "success" });
  } catch (e) {
    runtimeStore.showSnakebar(t("KeepUploadTask.deleteError"), { color: "error" });
  }
}

async function deleteSelectedTasks() {
  if (selectedTasks.value.length === 0) return;
  const msg = t("KeepUploadTask.deleteSelectedConfirm", { count: selectedTasks.value.length });
  if (!(await confirmDanger(msg, "danger", t("common.remove")))) return;

  try {
    for (const taskId of selectedTasks.value) {
      await sendMessage("deleteKeepUploadTask", taskId);
    }
    tasks.value = tasks.value.filter((item) => !selectedTasks.value.includes(item.id));
    selectedTasks.value = [];
    runtimeStore.showSnakebar(t("KeepUploadTask.deleteSuccess"), { color: "success" });
  } catch (e) {
    runtimeStore.showSnakebar(t("KeepUploadTask.deleteError"), { color: "error" });
  }
}

async function clearAllTasks() {
  if (!(await confirmDanger(t("KeepUploadTask.clearConfirm"), "danger", t("KeepUploadTask.clearAll")))) return;

  try {
    await sendMessage("clearKeepUploadTasks", undefined);
    tasks.value = [];
    runtimeStore.showSnakebar(t("KeepUploadTask.clearSuccess"), { color: "success" });
  } catch (e) {
    runtimeStore.showSnakebar(t("KeepUploadTask.clearError"), { color: "error" });
  }
}

// 发送种子到下载器。返回「这一趟有没有真发出去」—— 行内那颗「发送并换为基准」要等它成功才挪基准
async function sendTorrentsToDownloader(
  task: IKeepUploadTask,
  items: IKeepUploadTask["items"],
  kind: TSendKind,
): Promise<boolean> {
  if (items.length === 0) return false;
  if (sending.value[task.id]) return false;

  const downloader = metadataStore.downloaders[task.downloadOptions.downloaderId];
  if (!downloader) {
    runtimeStore.showSnakebar(t("KeepUploadTask.downloaderNotFound"), { color: "error" });
    return false;
  }

  sending.value[task.id] = kind;
  // 点下去就得有东西动：这一趟要等后台把 .torrent 下回来再 add，通常好几秒
  runtimeStore.showSnakebar(t("KeepUploadTask.sending", { count: items.length }), { color: "info" });

  try {
    // 「列表第一条、而基准又不是下载器里那条」= 这一条真要下全量，那一条不许跳过校验（见 sendOptions.ts）
    const baseEntry = task.baseLocal ? null : task.items[0];
    for (const item of items) {
      // 拼选项那份算式在 autoReseed.ts —— 后台那条自动链发的必须是**同一份**选项，
      // 抄第二份的话改一处漏一处，表现就是「手动发的能挂上、自动发的挂不上」
      const addTorrentOptions = buildReseedAddTorrentOptions({
        task,
        item,
        baseEntry,
        downloader,
        siteName: await metadataStore.getSiteName(item.site),
      });

      const result = await sendMessage("downloadTorrent", {
        torrent: {
          site: item.site,
          title: item.title,
          subTitle: item.subTitle,
          link: item.url,
          // item.link 是详情页；下载链接为空时，后台需要它来动态解析真实下载地址。
          url: item.link,
          size: item.size,
        },
        downloaderId: task.downloadOptions.downloaderId,
        addTorrentOptions,
      });
      if (result.downloadStatus === "failed") {
        throw new Error(result.errorMessage || item.title);
      }
    }
    runtimeStore.showSnakebar(t("KeepUploadTask.sendSingleSuccess"), { color: "success" });
    // 发出去不等于在做种：跳过校验之后「数据其实不在」只会以状态的形式冒出来，所以自己回来查一趟
    scheduleAutoRecheck(task.id);
    return true;
  } catch (e) {
    const rawReason = e instanceof Error ? e.message : String(e);
    const reason = rawReason.trim() === "Fails." ? t("KeepUploadTask.qBittorrentLegacyFails") : rawReason;
    runtimeStore.showSnakebar(t("KeepUploadTask.sendSingleErrorWithReason", { reason }), { color: "error" });
    return false;
  } finally {
    sending.value[task.id] = undefined;
  }
}

// 设为基准种子（移动到第一位并更新存储）
async function setAsBaseTorrent(task: IKeepUploadTask, itemIndex: number) {
  if (itemIndex === 0) {
    return;
  }

  // 将选中的种子移动到第一位
  const item = task.items.splice(itemIndex, 1)[0];
  task.items.unshift(item);

  // 更新任务存储
  try {
    await sendMessage("updateKeepUploadTask", task);
    runtimeStore.showSnakebar(t("KeepUploadTask.setBaseSuccess"), { color: "success" });
  } catch (e) {
    runtimeStore.showSnakebar(t("KeepUploadTask.setBaseError"), { color: "error" });
  }
}

/**
 * 发送之后过一会儿自动回查一次。18 秒不是拍的：qBittorrent 那份列表走 `/sync/maindata`，
 * 客户端实例是带缓存复用的，而它自己那条闸写死 15 秒（`qBittorrent.ts:419`）——
 * 发完立刻查会拿到旧快照，刚加的那条根本还没进去，于是报「查不到」。
 */
const AUTO_RECHECK_DELAY_MS = 18_000;

const rechecking = ref(false);
/**
 * 回查结果：taskId -> (infoHash -> 结论)。按 hash 存而不是按序号存，因为「设为基准种子」
 * 会把 items 重排，序号存的那一份会跟着错位。
 */
const reseedStatuses = ref<Record<string, Record<string, IReseedItemStatus>>>({});
/**
 * 上面那一份是**什么时候**查的（taskId -> 毫秒）。
 * 后台那条自动辅种每分钟把结论写进 `task.autoState.statuses`，这一份是用户点「回查」或发送后延迟查的，
 * 两边都有就得比时间 —— 不比的话，后台刚把某条暂停，界面还在拿半小时前那次「一切正常」给他看。
 */
const reseedStatusesAt = ref<Record<string, number>>({});
const autoRecheckTimers = new Set<number>();

onUnmounted(() => {
  autoRecheckTimers.forEach((id) => window.clearTimeout(id));
  autoRecheckTimers.clear();
  if (autoRefreshTimer !== undefined) window.clearInterval(autoRefreshTimer);
});

function scheduleAutoRecheck(taskId: string) {
  const id = window.setTimeout(() => {
    autoRecheckTimers.delete(id);
    recheckSeeding([taskId]);
  }, AUTO_RECHECK_DELAY_MS);
  autoRecheckTimers.add(id);
}

/** 这一条任务里能拿去和下载器对账的那些（没记 infoHash 的要先走下面那条自动认亲） */
function trackableItems(task: IKeepUploadTask) {
  return task.items.filter((item) => String(item.hash ?? "").trim() !== "");
}

/**
 * 这一条任务此刻该用哪一份对账结果：页面自己查的那份，还是后台自动辅种写进任务里的那份，**谁新用谁**。
 *
 * 回落不是锦上添花：开了自动辅种的任务，后台每分钟在动种子，而用户从没点过「回查」时
 * `reseedStatuses` 里压根没有这一条 —— 那一格就会写「没查过」，而其实一分钟前刚查过、还把两条停了。
 * 反过来用户刚点过回查，也不该被更早的后台那一份盖掉。
 */
function reseedStatusSource(task: IKeepUploadTask): Record<string, IReseedItemStatus> | undefined {
  const manualAt = reseedStatusesAt.value[task.id] ?? 0;
  const autoAt = task.autoState?.statuses ? (task.autoState.lastRunAt ?? 0) : 0;
  if (autoAt > manualAt) return task.autoState?.statuses;
  return reseedStatuses.value[task.id];
}

/**
 * 拿下载器那边报的状态回查每条发出去的种子。
 * 结论是 `seedVerify.ts` 折的（那一份能直接跑断言）；这里只做取数、认亲、暂停、汇总。
 *
 * 「认亲」这一步是替用户补的：任务里没记 infoHash 的那些（旧任务、以及建任务那一步没拿到 hash 的），
 * 光报一句「重新建一次就有了」是把活儿推回给人 —— 下载器列表里往往就有那一条，按标题（其次按大小）
 * 能唯一对上的就把 hash 写回任务、照常对账。**对不出唯一的那条不动**：猜错等于把 A 站的状态记到
 * B 站种子头上，那比查不到更糟。
 */
async function recheckSeeding(only?: TKeepUploadTaskKey[]) {
  const list = tasks.value.filter((task) => !only || only.includes(task.id));
  if (list.length === 0) {
    runtimeStore.showSnakebar(t("KeepUploadTask.recheck.none"), { color: "warning" });
    return;
  }

  // 同一台下载器只拉一次列表，多个任务共用那份
  const byDownloader = new Map<string, IKeepUploadTask[]>();
  for (const task of list) {
    const group = byDownloader.get(task.downloadOptions.downloaderId) ?? [];
    group.push(task);
    byDownloader.set(task.downloadOptions.downloaderId, group);
  }

  rechecking.value = true;
  const next: Record<string, Record<string, IReseedItemStatus>> = { ...reseedStatuses.value };
  let checked = 0;
  let seeding = 0;
  let wrong = 0;
  let pauseFailed = 0;
  let unreachable = 0;
  let linked = 0;
  let unlinked = 0;
  /** 这一轮真的查到过东西的任务，用来给 `reseedStatusesAt` 打时间戳（连不上的那台不算） */
  const touched = new Set<string>();

  try {
    for (const [downloaderId, group] of byDownloader) {
      let torrents: CTorrent[];
      try {
        torrents = await sendMessage("getClientTorrents", downloaderId);
      } catch {
        // 连不上只当这一台没结果，别把已经查到的那几台一起报成失败
        unreachable++;
        continue;
      }

      // 先认亲：这一台名下、任务里没记 hash 的那些，认上了写回任务，下面才查得到
      const dirty = new Set<IKeepUploadTask>();
      for (const task of group) {
        for (const item of task.items) {
          if (String(item.hash ?? "").trim() !== "") continue;
          const outcome = linkItemToTorrent({ title: item.title, size: item.size }, torrents);
          if (outcome.kind === "linked") {
            item.hash = outcome.infoHash;
            dirty.add(task);
            linked++;
          } else {
            unlinked++;
          }
        }
      }
      for (const task of dirty) {
        await sendMessage("updateKeepUploadTask", task);
      }

      const index = new Map(torrents.map((t) => [String(t.infoHash).toLowerCase(), t]));
      for (const task of group) {
        // 基准那条的「还在下」是进度，不是故障 —— 判成 wrong 会被下面那句自动暂停把基准停掉
        const baseHash = task.baseLocal ? "" : String(task.items[0]?.hash ?? "").toLowerCase();
        for (const item of trackableItems(task)) {
          const hash = String(item.hash).toLowerCase();
          checked++;
          touched.add(task.id);
          const found = index.get(hash);
          const status = judgeReseedTorrent(
            found
              ? {
                  state: found.state,
                  rawState: found.raw?.state,
                  progress: found.progress,
                  isCompleted: found.isCompleted,
                }
              : undefined,
            { isBase: hash !== "" && hash === baseHash },
          );
          next[task.id] = { ...(next[task.id] ?? {}), [hash]: status };
          if (status.verdict === "seeding") seeding++;
          // 「校验失败要立刻暂停该种子」：判据里只有 wrong 会走到这里，中间态（正在校验、
          // 刚发出去还没进列表）不动它
          if (shouldPauseReseed(status.verdict)) {
            wrong++;
            try {
              if (!(await sendMessage("pauseClientTorrent", { downloaderId, id: found?.id }))) pauseFailed++;
            } catch {
              pauseFailed++;
            }
          }
        }
      }
    }
    reseedStatuses.value = next;
    const at = Date.now();
    const stamp = { ...reseedStatusesAt.value };
    for (const taskId of touched) stamp[taskId] = at;
    reseedStatusesAt.value = stamp;
  } finally {
    rechecking.value = false;
  }

  if (linked > 0) {
    runtimeStore.showSnakebar(t("KeepUploadTask.recheck.linked", { count: linked }), { color: "info" });
  }

  if (checked === 0) {
    // 一条都没查成。两种来路要分开说：那几台没连上 ≠ 任务没记 infoHash，
    // 报错了原因会把人往错的方向引（台架 c=offline 那趟量出来的）
    if (unreachable > 0) {
      runtimeStore.showSnakebar(t("KeepUploadTask.recheck.unreachable", { count: unreachable }), { color: "warning" });
    } else {
      runtimeStore.showSnakebar(t("KeepUploadTask.recheck.none"), { color: "warning" });
    }
    return;
  }

  if (wrong > 0) {
    runtimeStore.showSnakebar(
      t(pauseFailed > 0 ? "KeepUploadTask.recheck.wrongAndPauseFailed" : "KeepUploadTask.recheck.wrong", {
        count: wrong,
        failed: pauseFailed,
      }),
      { color: "error", timeout: 12 },
    );
  } else if (unreachable > 0) {
    runtimeStore.showSnakebar(t("KeepUploadTask.recheck.unreachable", { count: unreachable }), { color: "warning" });
  } else {
    runtimeStore.showSnakebar(t("KeepUploadTask.recheck.summary", { total: checked, seeding }), { color: "success" });
  }

  if (unlinked > 0) {
    runtimeStore.showSnakebar(t("KeepUploadTask.recheck.unlinked", { count: unlinked }), {
      color: "warning",
      timeout: 12,
    });
  }
}

const reseedVerdictText = computed<Record<TReseedVerdict, string>>(() => ({
  seeding: t("KeepUploadTask.recheck.state.seeding"),
  wrong: t("KeepUploadTask.recheck.state.wrong"),
  paused: t("KeepUploadTask.recheck.state.paused"),
  pending: t("KeepUploadTask.recheck.state.pending"),
  notFound: t("KeepUploadTask.recheck.state.notFound"),
}));

/**
 * 一条结论在界面上怎么说。两处用（展开行那一颗徽标 + 悬停里逐条明细），只这一份判法 ——
 * 同一页两个说法是他反复指过的那类缺陷。
 *
 * `pending` 里要单独拎出「其实已经判出来了：它正在下载」那一半。基准那条「还在下」之所以翻成
 * `pending`，只是为了别被 `wrong` 一路带去自动暂停（v0.59.1），可「待确认」说的是「还没判出来」，
 * 于是那一格读起来像卡住了 —— 他 2026-10-10 指着它说「这个应该是下载中(0%)」。
 * 结论本身不动（`wrong` / 暂停 / 排序档位都不受影响），只换措辞。
 */
function itemVerdictText(status?: IReseedItemStatus): string {
  if (status?.verdict === "pending" && status.downloading) {
    const label = t("KeepUploadTask.recheck.state.downloading");
    // 没报进度就只说「下载中」，不替下载器编一个 0%
    return typeof status.progress === "number" ? `${label} ${Math.round(status.progress)}%` : label;
  }
  return reseedVerdictText.value[status?.verdict ?? "notFound"];
}

/**
 * 进度阶段那一行的标签。写成 computed 而不是顶层常量：切语言要重算（AGENTS §3.4 那条）。
 * `wrong` 那一档不在这里 —— 它的文字带着条数，见 `stageText`。
 */
const reseedStageLabel = computed<Record<Exclude<TReseedStage, "wrong">, string>>(() => ({
  idle: t("KeepUploadTask.recheck.stage.idle"),
  baseMissing: t("KeepUploadTask.recheck.stage.baseMissing"),
  baseDownloading: t("KeepUploadTask.recheck.stage.baseDownloading"),
  baseReady: t("KeepUploadTask.recheck.stage.baseReady"),
  reseeding: t("KeepUploadTask.recheck.stage.reseeding"),
  done: t("KeepUploadTask.recheck.stage.done"),
}));

const RESEED_STAGE_COLOR: Record<TReseedStage, string> = {
  idle: "default",
  baseMissing: "warning",
  baseDownloading: "processing",
  baseReady: "warning",
  reseeding: "processing",
  done: "success",
  wrong: "error",
};

/**
 * 这一条任务走到哪一步了（他 2026-10-09：「要能看到辅种进度」）。
 * 判据本身在 `seedVerify.ts` 的 `reseedStage`（那份能直接跑断言），这里只负责把任务摊成它要的输入：
 * 基准 = `baseLocal` 那种任务不在 items 里（基准是下载器已有的另一条），否则就是 items[0]
 * —— 发送那颗「基准」的一直是第一颗。
 */
function taskStage(task: IKeepUploadTask) {
  const perTask = reseedStatusSource(task);
  const list = trackableItems(task);
  const baseLocal = !!task.baseLocal;
  const statusOf = (item: IKeepUploadTask["items"][number]) => perTask?.[String(item.hash).toLowerCase()];
  return reseedStage({
    checked: !!perTask,
    baseLocal,
    base: baseLocal || !list[0] ? undefined : statusOf(list[0]),
    others: (baseLocal ? list : list.slice(1)).map(statusOf),
    untracked: task.items.length - list.length,
  });
}

const stageColorOf = (task: IKeepUploadTask) => RESEED_STAGE_COLOR[taskStage(task).stage];

/** 阶段那一行的文字：只有百分比和 x/y 计数接在标签后面（标签本身不带参数，切语言才重算得动） */
function stageText(task: IKeepUploadTask): string {
  const info = taskStage(task);
  const stage = info.stage;
  // wrong 那一档直接报数，不写「没正常做种」再在第二行重复一遍条数
  if (stage === "wrong") return t("KeepUploadTask.recheck.stage.wrong", { count: info.wrongCount });
  const label = reseedStageLabel.value[stage];
  // 没报进度就只说「基准在下」，不替下载器编一个 0%（同 v0.60.3 那条 `toPercent` 的口径）
  if (stage === "baseDownloading") {
    return typeof info.progress === "number" ? `${label} ${Math.round(info.progress)}%` : label;
  }
  // x/y 的分母是除基准外的条数：基准是前提，不算进「辅种进度」
  if ((stage === "reseeding" || stage === "done") && info.totalCount > 0) {
    return `${label} ${info.doneCount}/${info.totalCount}`;
  }
  return label;
}

/**
 * 第二行：阶段那个词装不下的那条信息 —— 有几条压根没记下 infoHash，连查都没法查。
 * 不写这一行，「辅种完成 3/3」会被读成「全都对上了」，而那 2 条其实没人看过。
 */
function stageDetail(task: IKeepUploadTask): string {
  const untracked = task.items.length - trackableItems(task).length;
  return untracked > 0 ? t("KeepUploadTask.recheck.stage.untracked", { count: untracked }) : "";
}

/** 徽标报出来的那一档结论是哪一种（排序按它折权重，不按显示文字） */
type TReseedKind = "seeding" | "paused" | "pending" | "untracked" | "notFound" | "wrong";

/** 这一条任务现在最该说出口的那个结论（异常优先报出来） */
function reseedSummary(
  record: IKeepUploadTask,
): { color: string; text: string; kind: TReseedKind } | null {
  const perTask = reseedStatusSource(record);
  if (!perTask) return null;
  const sum = summarizeReseed(
    trackableItems(record).map((item) => perTask[String(item.hash).toLowerCase()]),
    record.items.length - trackableItems(record).length,
  );
  if (sum.wrong > 0)
    return { kind: "wrong", color: "error", text: t("KeepUploadTask.recheck.count.wrong", { count: sum.wrong }) };
  if (sum.notFound > 0)
    return { kind: "notFound", color: "warning", text: t("KeepUploadTask.recheck.count.notFound", { count: sum.notFound }) };
  if (sum.pending > 0)
    return {
      kind: "pending",
      color: "processing",
      text: t("KeepUploadTask.recheck.count.pending", { count: sum.pending }),
    };
  if (sum.paused > 0)
    return { kind: "paused", color: "default", text: t("KeepUploadTask.recheck.count.paused", { count: sum.paused }) };
  if (sum.seeding > 0)
    return { kind: "seeding", color: "success", text: t("KeepUploadTask.recheck.count.seeding", { count: sum.seeding }) };
  if (sum.untracked > 0)
    return { kind: "untracked", color: "default", text: t("KeepUploadTask.recheck.state.untracked") };
  return { kind: "notFound", color: "default", text: t("KeepUploadTask.recheck.state.notFound") };
}

/**
 * 「做种状态」列的排序权重。
 *
 * 这套序**不是**上面那条「最该说出口」的优先级：那条在有正常项时会让「在做种」盖过少数派
 * （4 条正常 + 1 条认不出 → 徽标报在做种），而排序要的是「越该先看的排前面」，
 * 所以「认不出」（等于完全没法判）压在「在做种」之上。两套混成一套会有一边说谎。
 * 「没查过」单独给最低一档：它不是一个结论，不该挤在结论中间。
 */
const RESEED_RANK: Record<TReseedKind, number> = {
  seeding: 1,
  paused: 2,
  pending: 3,
  untracked: 4,
  notFound: 5,
  wrong: 6,
};

function reseedRank(record: IKeepUploadTask): number {
  const sum = reseedSummary(record);
  return sum ? RESEED_RANK[sum.kind] : 0;
}

/** 悬停里逐条列明：标题 + 结论 + 下载器那边那条的原样状态 */
function reseedRows(record: IKeepUploadTask) {
  const perTask = reseedStatusSource(record) ?? {};
  return record.items.map((item, index) => {
    const hash = String(item.hash ?? "").toLowerCase();
    const status = hash ? perTask[hash] : undefined;
    return {
      key: hash || String(index),
      title: item.title,
      text: hash ? itemVerdictText(status) : t("KeepUploadTask.recheck.state.untracked"),
      raw: status?.rawState ?? "",
    };
  });
}

/**
 * 展开列表里那一条在下载器那边的结论。
 *
 * 数据就是「做种状态」列悬停明细那一份（`reseedStatusSource` 挑出来的那份，按 infoHash 存），这里只是换个地方摆出来 ——
 * 不另算一套判据，否则同一页会出现两个说法。
 * 「还没查过」单独一档：那不是一个结论，把它写成「下载器里没有」是骗人（他 2026-10-09 要的就是这一列能在每条上看到）。
 */
const RESEED_VERDICT_COLOR: Record<TReseedVerdict, string> = {
  seeding: "success",
  wrong: "error",
  paused: "default",
  pending: "processing",
  notFound: "warning",
};
function itemReseed(record: IKeepUploadTask, item: IKeepUploadTask["items"][number]) {
  const perTask = reseedStatusSource(record);
  if (!perTask) return { color: "default", text: t("KeepUploadTask.recheck.state.idle") };
  const hash = String(item.hash ?? "").toLowerCase();
  if (!hash) return { color: "default", text: t("KeepUploadTask.recheck.state.untracked") };
  const status = perTask[hash];
  if (!status) return { color: "warning", text: reseedVerdictText.value.notFound };
  return { color: RESEED_VERDICT_COLOR[status.verdict], text: itemVerdictText(status) };
}

// 发送基准种子到下载器
function sendBaseTorrent(task: IKeepUploadTask) {
  const items = task.items.slice(0, 1);
  void sendTorrentsToDownloader(task, items, "base");
}

// 发送其他种子到下载器
async function sendOtherTorrents(task: IKeepUploadTask) {
  if (task.items.length <= 1) return;
  if (!(await confirmDanger(t("KeepUploadTask.sendConfirm", { count: task.items.length - 1 })))) return;
  const items = task.items.slice(1);
  void sendTorrentsToDownloader(task, items, "other");
}

// 发送所有种子到下载器
async function sendAllTorrents(task: IKeepUploadTask) {
  if (!(await confirmDanger(t("KeepUploadTask.sendConfirm", { count: task.items.length })))) return;
  const items = task.items.slice(0);
  void sendTorrentsToDownloader(task, items, "all");
}

/**
 * 行内那颗「只发这一条并换它当基准」：他 2026-10-09 的场景是「基准那条下得太慢，想换个站下」。
 *
 * 顺序是**先发、成功后才挪基准** —— 反过来一旦发送失败，任务的基准已经变成一条根本没发出去的种子，
 * 那比「没换」更难发现（界面会开始按错的那条判断做种状态）。
 * 第一条本身就是基准，所以那一行只做发送、不做重排。
 */
async function sendOneAndPromote(task: IKeepUploadTask, index: number) {
  const item = task.items[index];
  if (!item) return;
  const okToSend = await sendTorrentsToDownloader(task, [item], `one:${index}`);
  if (okToSend && index > 0) await setAsBaseTorrent(task, index);
}

/** 「只发送」：把这一条发出去，基准不动（他 2026-10-09：「应该还可以单独发送和单独换基准」） */
async function sendOneOnly(task: IKeepUploadTask, index: number) {
  const item = task.items[index];
  if (!item) return;
  await sendTorrentsToDownloader(task, [item], `one:${index}`);
}

// 复制下载链接
async function copyLinksToClipboard(task: IKeepUploadTask) {
  const urls = task.items.map((item) => item.url).join("\n");
  try {
    await navigator.clipboard.writeText(urls);
    runtimeStore.showSnakebar(t("KeepUploadTask.copySuccess", { count: task.items.length }), { color: "success" });
  } catch (e) {
    runtimeStore.showSnakebar(t("KeepUploadTask.copyError"), { color: "error" });
  }
}
</script>

<template>
  <!-- 顶部那条 a-alert 页标题去掉了：左侧导航已经标出当前页，再占一条只是把表格往下推。
       外壳也不再是 a-card：卡片头的垂直 padding 实测是 0（`padding: 0 headerPadding`，
       高度只靠 min-height），size="small" 下头高 38px，32px 的按钮塞进去只剩上下各 3px ——
       整条贴到窗口顶。现在用 .page 网格：48px 工具条一行 + 白底面板一行（见 style.css）。 -->
  <div class="page">
    <a-flex align="center" gap="small" wrap justify="space-between" class="page-bar">
      <a-flex align="center" gap="small" wrap>
        <a-button type="primary" danger :disabled="selectedTasks.length === 0" @click="deleteSelectedTasks">
          <template #icon>
            <DeleteOutlined />
          </template>
          <span class="ml-1">{{ t("common.remove") }}</span>
        </a-button>

        <a-button type="primary" danger :disabled="tasks.length === 0" @click="clearAllTasks">
          <template #icon>
            <DeleteOutlined />
          </template>
          <span class="ml-1">{{ t("KeepUploadTask.clearAll") }}</span>
        </a-button>

        <a-button :loading="rechecking" @click="recheckSeeding()">
          <template #icon>
            <SyncOutlined />
          </template>
          <span class="ml-1">{{ t("KeepUploadTask.recheck.button") }}</span>
        </a-button>

        <a-button @click="showUsageDialog = true">
          <template #icon>
            <QuestionCircleOutlined />
          </template>
          <span class="ml-1">{{ t("common.howToUse") }}</span>
        </a-button>
      </a-flex>
    </a-flex>

    <!-- 面板只负责给表格一块白底表面；这页的表格没有 scroll.y，内部滚动就由面板接管。
         scroll 只给 x 不给 y：fixed 布局下标题列是唯一的自适应列，窗口比「其它列宽合计」还窄时
         它会被压成 0 宽（实测 822px 视口下标题列 clientWidth = 0，整行看不见标题）。
         这条 min-width 给标题留出下限，窗口再窄就横向滚动，而不是把标题挤没；
         宽窗口下 min-width:100% 仍然铺满，标题跟着变宽。 -->
    <div ref="pagePanel" class="page-panel">
    <a-table
      bordered
      :columns="columns"
      :data-source="tableRows"
      :loading="loading"
      :pagination="pagination"
      :expandable="{ showExpandColumn: true }"
      :scroll="{ x: 1480 }"
      :row-selection="{
        selectedRowKeys: selectedTasks,
        onChange: (keys: (string | number)[]) => (selectedTasks = keys as TKeepUploadTaskKey[]),
        getCheckboxProps: rowCheckboxProps,
      }"
      row-key="id"
      size="small"
      @change="handleTableChange"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'site'">
          <SiteFavicon :site-id="rowSiteId(record)" :size="18" />
        </template>

        <!-- 这一格只放标题：主标题 + 副标题两行，和搜索结果那一列同一个形状。
             保存路径 / 基准种子原先挤在这里，现在自成一列（见下面的 savePath 分支）。
             每行外面包一层 div：块级那一层才是裁切的主体（`text-overflow` 挂在不换行的块上才出省略号）。
             条目行也走这一格（比任务标题小一档、不加粗），展开后标题就在标题列，不再另起一块。

             这里刻意用 CSS 截断 + a-popover，不用 a-typography-text 的 ellipsis：Typography 的
             ellipsis 要把子节点折成纯文本去量宽度，实测那一格渲染出来只剩一个注释占位和一段裸文本 ——
             里面的 a 标签整个被丢掉，也就是说任务行的标题一直点不动（原先只有展开列表那颗能点）。
             换成现在这个写法，两种行都是真链接，全文揭示也不走原生 title（同 TorrentTitleTd.vue 那处注释的理由）。
             ⚠️ 这段注释里不许写字面的标签闭合串：模板解析器会把它当真的结束标签，整份 SFC 编译不过。 -->
        <template v-else-if="column.key === 'title'">
          <div>
            <div class="task-title text-truncate">
              <a-popover trigger="hover" placement="topLeft" :mouse-enter-delay="0.4">
                <template #content>
                  <div class="reveal-text">{{ rowTitle(record) }}</div>
                </template>
                <a :href="rowLink(record)" target="_blank" rel="noopener noreferrer nofollow" class="text-decoration-none">
                  {{ rowTitle(record) }}
                </a>
              </a-popover>
            </div>
            <div v-if="rowSubTitle(record)" class="task-subtitle text-truncate">
              <a-popover trigger="hover" placement="topLeft" :mouse-enter-delay="0.4">
                <template #content>
                  <div class="reveal-text">{{ rowSubTitle(record) }}</div>
                </template>
                <span>{{ rowSubTitle(record) }}</span>
              </a-popover>
            </div>
            <!-- 做种/下载人数只有条目行报得出；任务那一行看「种子数」列的条数 -->
            <div v-if="record.kind === 'item'" class="task-subtitle">
              {{ t("KeepUploadTask.seeders") }}{{ record.item.seeders ?? "-" }},
              {{ t("KeepUploadTask.leechers") }}{{ record.item.leechers ?? "-" }}
            </div>
          </div>
        </template>

        <!-- 保存路径是任务级的：条目行不重复父任务那一格（两行一样的字只会把行撑高） -->
        <template v-else-if="column.key === 'savePath'">
          <div v-if="record.kind === 'task'">
            <div>
              <a-typography-text class="task-line" :ellipsis="{ tooltip: savePathLine(record.task) }">
                {{ savePathLine(record.task) }}
              </a-typography-text>
            </div>
            <!-- 基准不在任务里的那种任务：数据是下载器里已有的另一条，得说清楚是哪条，
                 否则用户看到的是「只有一颗种子的辅种任务」，不知道它在往什么上挂 -->
            <div v-if="record.task.baseLocal">
              <a-typography-text class="task-line" :ellipsis="{ tooltip: baseLocalLine(record.task) }">
                {{ baseLocalLine(record.task) }}
              </a-typography-text>
            </div>
          </div>
        </template>

        <template v-else-if="column.key === 'size'">
          {{ formatSize(rowSize(record)) }}
        </template>

        <!-- 这一列第一行是**进度阶段**（他 2026-10-09：「要能看到现在是已发基准、基准已下完还是在辅种」）。
             原先这一格只有折出来的结论（异常优先），报的是「有没有问题」，不是「走到哪一步」。
             第二行只放阶段那个词装不下的数（几条没正常做种 / 几条没记 infoHash）。
             悬停看逐条明细，含客户端原样的状态串：判据要是不对，人自己能看出是哪一条折错了。
             没查过时老实写「没查过」而不是留空、更不是「正常」—— 替用户说过「没问题」而其实没看过，
             是会比报错更糟的谎。 -->
        <template v-else-if="column.key === 'seedState'">
          <div v-if="record.kind === 'task'">
            <div>
              <a-popover
                v-if="reseedStatusSource(record.task)"
                trigger="hover"
                placement="left"
                :mouse-enter-delay="0.4"
              >
                <template #content>
                  <div class="reseed-detail">
                    <div v-for="row in reseedRows(record.task)" :key="row.key" class="reseed-detail-row">
                      <span class="reseed-detail-title">{{ row.title }}</span>
                      <span>{{ row.text }}</span>
                      <span v-if="row.raw" class="text-grey">{{ row.raw }}</span>
                    </div>
                  </div>
                </template>
                <a-tag :color="stageColorOf(record.task)">{{ stageText(record.task) }}</a-tag>
              </a-popover>
              <a-tag v-else :color="stageColorOf(record.task)">{{ stageText(record.task) }}</a-tag>
            </div>
            <div v-if="stageDetail(record.task)" class="task-subtitle">{{ stageDetail(record.task) }}</div>
          </div>
          <a-tag v-else :color="itemReseed(record.task, record.item).color">
            {{ itemReseed(record.task, record.item).text }}
          </a-tag>
        </template>

        <template v-else-if="column.key === 'count'">
          {{ record.kind === "task" ? record.task.items.length : "" }}
        </template>

        <template v-else-if="column.key === 'time'">
          {{ record.kind === "task" ? formatDate(record.task.time) : "" }}
        </template>

        <template v-else-if="column.key === 'completedAt'">
          {{
            record.kind === "task"
              ? record.task.autoState?.completedAt
                ? formatDate(record.task.autoState.completedAt)
                : "-"
              : ""
          }}
        </template>

        <template v-else-if="column.key === 'action'">
          <a-space v-if="record.kind === 'task'" :size="0">
            <!-- baseLocal 那种任务里只有一条，而那一条就是「要挂上去的本站」，不是基准：基准在下载器里。
                 所以这两颗没有对象 —— 他 2026-10-09 要求的是**按住不给点**而不是藏起来（「这个按钮就应该是不可用的」），
                 藏起来会让人以为这一版没做这个功能，按住了 + 悬停说原因才是「这里确实不需要」。 -->
            <a-tooltip
              :title="record.task.baseLocal ? t('KeepUploadTask.sendBaseDisabled') : t('KeepUploadTask.sendBaseTorrent')"
            >
              <a-button
                size="small"
                type="text"
                :loading="sendingOf(record.task.id) === 'base'"
                :disabled="!!record.task.baseLocal || !!sendingOf(record.task.id)"
                @click="sendBaseTorrent(record.task)"
              >
                <template #icon>
                  <NumberOutlined />
                </template>
              </a-button>
            </a-tooltip>
            <a-tooltip
              :title="
                record.task.baseLocal ? t('KeepUploadTask.sendOtherDisabled') : t('KeepUploadTask.sendOtherTorrents')
              "
            >
              <a-button
                size="small"
                type="text"
                :loading="sendingOf(record.task.id) === 'other'"
                :disabled="!!record.task.baseLocal || !!sendingOf(record.task.id)"
                @click="sendOtherTorrents(record.task)"
              >
                <template #icon>
                  <CopyOutlined />
                </template>
              </a-button>
            </a-tooltip>
            <a-tooltip
              :title="record.task.baseLocal ? t('KeepUploadTask.sendReseedOne') : t('KeepUploadTask.sendAllTorrents')"
            >
              <a-button
                size="small"
                type="text"
                :loading="sendingOf(record.task.id) === 'all'"
                :disabled="!!sendingOf(record.task.id)"
                @click="sendAllTorrents(record.task)"
              >
                <template #icon>
                  <DownloadOutlined />
                </template>
              </a-button>
            </a-tooltip>
            <a-tooltip :title="t('KeepUploadTask.copyLinks')">
              <a-button size="small" type="text" @click="copyLinksToClipboard(record.task)">
                <template #icon>
                  <LinkOutlined />
                </template>
              </a-button>
            </a-tooltip>
            <a-tooltip :title="t('common.remove')">
              <a-button danger size="small" type="primary" @click="deleteTask(record.task)">
                <template #icon>
                  <DeleteOutlined />
                </template>
              </a-button>
            </a-tooltip>
          </a-space>

          <!-- 条目行这一格三颗图标键：只发送 / 只换基准 / 发送并换基准。
               他 2026-10-09：「应该还可以单独发送和单独换基准」—— 原先只有一颗合并键 + 一颗没人认得的「↑」。
               他 2026-10-10 看了那排文字键的截图：「把文字换成图标吧，文字放在 popover 里面」—— 三个汉字
               在一格里会把整排撑成两行，而父行那 5 颗本来就是「图标 + 悬停说法」，这一格跟着同一套写法。
               图标不另造一套语义，按**同一列父行已有的**复用：DownloadOutlined 在那边就是「发到下载器」，
               NumberOutlined 在那边就是「基准」，所以第三颗是两枚并排（发 + 基准）。
               按住不给点而不是藏起来：第一条本来就是基准、基准在下载器里时换基准也没有对象。 -->
          <a-space v-else :size="0">
            <a-tooltip :title="t('KeepUploadTask.sendThisOne')">
              <a-button
                size="small"
                type="text"
                :loading="sendingOf(record.task.id) === `one:${record.index}`"
                :disabled="!!sendingOf(record.task.id)"
                @click="sendOneOnly(record.task, record.index)"
              >
                <template #icon>
                  <DownloadOutlined />
                </template>
              </a-button>
            </a-tooltip>
            <a-tooltip :title="t('KeepUploadTask.setAsBaseTorrent')">
              <a-button
                size="small"
                type="text"
                :disabled="record.index === 0 || !!record.task.baseLocal || !!sendingOf(record.task.id)"
                @click="setAsBaseTorrent(record.task, record.index)"
              >
                <template #icon>
                  <NumberOutlined />
                </template>
              </a-button>
            </a-tooltip>
            <a-tooltip :title="t('KeepUploadTask.sendAndSetBase')">
              <a-button
                size="small"
                type="text"
                :disabled="record.index === 0 || !!record.task.baseLocal || !!sendingOf(record.task.id)"
                @click="sendOneAndPromote(record.task, record.index)"
              >
                <template #icon>
                  <span class="dual-icon">
                    <DownloadOutlined />
                    <NumberOutlined />
                  </span>
                </template>
              </a-button>
            </a-tooltip>
          </a-space>
        </template>
      </template>

    </a-table>

    <!-- 空态用 a-empty 而不是 a-alert：a-alert 是「提示/警告」语义，
         这里要表达的是「暂无数据」，同项目其它三处（MediaServerEntity/Index.vue、
         MyClient/ClientStatusDialog.vue、SetDownloader/SiteFilterDialog.vue）都用 a-empty -->
    <a-empty v-if="!loading && tasks.length === 0" class="my-4" :description="t('KeepUploadTask.emptyNotice')" />
    </div>
  </div>

  <!-- 弹窗是 portal，不参与 .page 网格布局，所以挂在根级而不是 .page 直接子节点 ——
       后者会被排进隐式第三行、把面板那一行挤窄（同 MyData/Index.vue 的写法） -->
  <KeepUploadUsageDialog v-model="showUsageDialog" />
</template>

<style scoped lang="scss">
.task-title {
  font-size: 14px;
  font-weight: 500;
}

/* 「发送并换基准」那颗是两枚图标并排（发到下载器 + 设为基准），缝收到 1px：
   按钮的 #icon 那一档内衬本来就窄，两枚之间再留 anticon 默认的空白就会让这颗比旁边两颗宽一截。 */
.dual-icon {
  display: inline-flex;
  align-items: center;
  gap: 1px;
}

/* 副标题与保存路径那两行要「比标题小一档、灰」。
   `.task-line` 挂在 <a-typography-text> 上，写成带 data-v 的选择器才抢得过 antd 的 `.ant-typography`
   （同特异度、cssinjs 运行时注入在后面）；标题/副标题那两格现在是自己包 div，不再需要这条，
   但保留同一个写法 —— 别改回挂 .text-grey / .text-body-small（那两条是全局原子类，抢不过组件样式）。 */
.task-subtitle,
.task-line {
  font-size: 12px;
  color: #6b7280;
}

/* 标题浮层里的全文：换行铺开 + 宽度上限，同 TorrentTitleTd.vue 那一条（不设上限就是半屏一条长串）。
   overflow-wrap 是给种子标题里那种无空格长串用的。 */
.reveal-text {
  max-width: 480px;
  white-space: normal;
  overflow-wrap: anywhere;
}

/* 回查那一列悬停里的明细：一行一条，标题吃剩下宽度并截断（种子标题动辄上百字符，
   不截断会把浮层撑得比屏幕还宽），后面跟结论和下载器那边原样的状态串 */
.reseed-detail {
  max-width: 480px;
}

.reseed-detail-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 0;
}

/* 站点那一格「图标要居中」（他 2026-10-10 三个箭头指着展开子行那几颗）。
   根因不在图标自己：这一列是这张表的第一列，rc-table 把树形行的**缩进 span + 那颗 ＋/−** 也塞进了
   同一个 td（class `ant-table-cell-with-append`）。父行里 16 的按钮和 18 的图标还挤得下一行；
   子行多了 15 的缩进，图标就被顶到第二行 —— 于是 td 的 `vertical-align: middle` 居中的是
   「两行的整体」，图标看着比行中心低一截。截图量到子行低 12.0 CSS px（父行只低 2.0），
   台架在真 DOM 上量到 11.5 / 1.75，两个量具对得上。
   把展开那两件挪出正常流，图标就是这一格里唯一的内容，横竖都落在格中心；
   ＋/− 靠 absolute 钉回它本来所在的位置（格左沿），点击区域不变。
   不用 `expandable.expandIconColumnIndex` 挪走：antd 会先减 1，传 2 等于默认值（实测数字一字不差），
   传 3 又会把 ＋/− 塞进标题格 —— 标题那两行是块级 div，按钮会变成它们上面多出来的一行，整行被顶高。 */
.page-panel :deep(td.ant-table-cell-with-append) {
  position: relative;
}

.page-panel :deep(td.ant-table-cell-with-append .ant-table-row-indent),
.page-panel :deep(td.ant-table-cell-with-append .ant-table-row-expand-icon) {
  position: absolute;
  top: 50%;
  left: 8px;
  transform: translateY(-50%);
}

/* 那颗 ＋/− 自带 `margin: 2.5px 8px 0 0`：绝对定位之后 `top: 50%` 算的是外边距盒，
   那 2.5 就把按钮整体压低了一截（实测中心比格中心低 2.1px）。行内时的 margin-inline-end
   是用来跟图标留缝的，挪出正常流以后没意义，一并清掉。 */
.page-panel :deep(td.ant-table-cell-with-append .ant-table-row-expand-icon) {
  margin: 0;
}

/* 图标改成块级：行内 `<img>` 的 `vertical-align: middle` 是相对基线对齐的，量出来仍会低 1~2px
   （父行那 1.75 就是这么来的）；块级盒由 td 的 vertical-align 整体居中，才是真居中。 */
.page-panel :deep(td.ant-table-cell-with-append .site-favicon) {
  display: block;
  margin-inline: auto;
}

.reseed-detail-title {
  flex: 1 1 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
