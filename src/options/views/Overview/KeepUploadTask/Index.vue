<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useTemplateRef } from "vue";
import { useI18n } from "vue-i18n";
import { type TableColumnsType } from "antdv-next";
import {
  ArrowUpOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  LinkOutlined,
  NumberOutlined,
  QuestionCircleOutlined,
  SyncOutlined,
} from "@antdv-next/icons";

import type { CAddTorrentOptions, CTorrent } from "@ptd/downloader";
import type { IKeepUploadTask, TKeepUploadTaskKey } from "@/shared/types.ts";
import { sendMessage } from "@/messages.ts";
import { formatSize, formatDate } from "@/options/utils.ts";
import { useTableBehavior } from "@/options/directives/useTableBehavior.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";

import SiteFavicon from "@/options/components/SiteFavicon/Index.vue";
import KeepUploadUsageDialog from "@/options/components/KeepUploadUsageDialog.vue";
import { useConfirmDanger } from "@/options/components/useConfirmDanger.ts";

import { withReseedSkipChecking } from "./sendOptions.ts";
import {
  judgeReseedTorrent,
  linkItemToTorrent,
  shouldPauseReseed,
  summarizeReseed,
  type IReseedItemStatus,
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
const columns = computed<TableColumnsType<IKeepUploadTask>>(() => [
  { title: t("KeepUploadTask.table.site"), key: "site", align: "center", width: 72 },
  { title: t("KeepUploadTask.table.title"), dataIndex: "title", key: "title", align: "left", ellipsis: true },
  { title: t("KeepUploadTask.table.savePath"), key: "savePath", align: "left", width: 220 },
  {
    title: t("KeepUploadTask.recheck.col"),
    key: "seedState",
    align: "center",
    width: 120,
    // 排的是结论的严重度档位，不是那一格显示的文字 —— 文字带着条数，
    // 按字符串排会让「10 条在做种」排在「2 条在做种」前面
    sorter: (a, b) => reseedRank(a) - reseedRank(b),
    ...persistedSort("seedState"),
  },
  {
    title: t("KeepUploadTask.table.size"),
    dataIndex: "size",
    key: "size",
    align: "right",
    width: 110,
    sorter: (a, b) => a.size - b.size,
    ...persistedSort("size"),
  },
  {
    title: t("KeepUploadTask.table.count"),
    key: "count",
    align: "center",
    width: 80,
    sorter: (a, b) => a.items.length - b.items.length,
    ...persistedSort("count"),
  },
  {
    title: t("KeepUploadTask.table.time"),
    dataIndex: "time",
    key: "time",
    align: "center",
    width: 170,
    sorter: (a, b) => a.time - b.time,
    ...persistedSort("time"),
  },
  { title: t("common.action"), key: "action", align: "center", width: 180 },
]);

/** 保存路径那一列第一行：列头已经写着「保存路径」，所以这里不再重复那个前缀 */
function savePathLine(record: IKeepUploadTask) {
  const path = record.downloadOptions?.savePath;
  return `${record.downloadOptions?.clientName ?? "-"} -> ${path || t("KeepUploadTask.defaultPath")}`;
}

function baseLocalLine(record: IKeepUploadTask) {
  return `${t("KeepUploadTask.baseLocal")}${record.baseLocal?.name ?? ""}`;
}

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
});

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

// 发送种子到下载器
async function sendTorrentsToDownloader(task: IKeepUploadTask, items: IKeepUploadTask["items"]) {
  if (items.length === 0) return;

  const downloader = metadataStore.downloaders[task.downloadOptions.downloaderId];
  if (!downloader) {
    runtimeStore.showSnakebar(t("KeepUploadTask.downloaderNotFound"), { color: "error" });
    return;
  }

  try {
    for (const item of items) {
      const now = new Date();
      const replacements: Record<string, string> = {
        "torrent.title": item.title,
        "torrent.subTitle": item.subTitle ?? "",
        "torrent.category": String(item.category ?? ""),
        "torrent.site": item.site,
        "torrent.siteName": await metadataStore.getSiteName(item.site),
        "date:YYYY": formatDate(now, "yyyy"),
        "date:MM": formatDate(now, "MM"),
        "date:DD": formatDate(now, "dd"),
      };
      const addTorrentOptions: CAddTorrentOptions = withReseedSkipChecking({
        localDownload: true,
        // 与普通下载保持一致：是否暂停由下载器的“自动开始”设置决定。
        addAtPaused: !(downloader.feature?.DefaultAutoStart ?? true),
        savePath: task.downloadOptions.savePath || "",
        ...task.downloadOptions.addTorrentOptions,
      });

      for (const key of ["savePath", "label"] as const) {
        if (!addTorrentOptions[key]) continue;
        for (const [templateKey, value] of Object.entries(replacements)) {
          addTorrentOptions[key] = addTorrentOptions[key]!.replaceAll(`$${templateKey}$`, value);
        }
      }

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
  } catch (e) {
    const rawReason = e instanceof Error ? e.message : String(e);
    const reason = rawReason.trim() === "Fails." ? t("KeepUploadTask.qBittorrentLegacyFails") : rawReason;
    runtimeStore.showSnakebar(t("KeepUploadTask.sendSingleErrorWithReason", { reason }), { color: "error" });
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
const autoRecheckTimers = new Set<number>();

onUnmounted(() => {
  autoRecheckTimers.forEach((id) => window.clearTimeout(id));
  autoRecheckTimers.clear();
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
        for (const item of trackableItems(task)) {
          const hash = String(item.hash).toLowerCase();
          checked++;
          const found = index.get(hash);
          const status = judgeReseedTorrent(found ? { state: found.state, rawState: found.raw?.state } : undefined);
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

/** 徽标报出来的那一档结论是哪一种（排序按它折权重，不按显示文字） */
type TReseedKind = "seeding" | "paused" | "pending" | "untracked" | "notFound" | "wrong";

/** 这一条任务现在最该说出口的那个结论（异常优先报出来） */
function reseedSummary(
  record: IKeepUploadTask,
): { color: string; text: string; kind: TReseedKind } | null {
  const perTask = reseedStatuses.value[record.id];
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
  const perTask = reseedStatuses.value[record.id] ?? {};
  return record.items.map((item, index) => {
    const hash = String(item.hash ?? "").toLowerCase();
    const status = hash ? perTask[hash] : undefined;
    return {
      key: hash || String(index),
      title: item.title,
      text: hash ? reseedVerdictText.value[status?.verdict ?? "notFound"] : t("KeepUploadTask.recheck.state.untracked"),
      raw: status?.rawState ?? "",
    };
  });
}

// 发送基准种子到下载器
function sendBaseTorrent(task: IKeepUploadTask) {  const items = task.items.slice(0, 1);
  sendTorrentsToDownloader(task, items);
}

// 发送其他种子到下载器
async function sendOtherTorrents(task: IKeepUploadTask) {
  if (task.items.length <= 1) return;
  if (!(await confirmDanger(t("KeepUploadTask.sendConfirm", { count: task.items.length - 1 })))) return;
  const items = task.items.slice(1);
  sendTorrentsToDownloader(task, items);
}

// 发送所有种子到下载器
async function sendAllTorrents(task: IKeepUploadTask) {
  if (!(await confirmDanger(t("KeepUploadTask.sendConfirm", { count: task.items.length })))) return;
  const items = task.items.slice(0);
  sendTorrentsToDownloader(task, items);
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
      :data-source="tasks"
      :loading="loading"
      :pagination="pagination"
      :expandable="{ showExpandColumn: true }"
      :scroll="{ x: 1320 }"
      :row-selection="{
        selectedRowKeys: selectedTasks,
        onChange: (keys: (string | number)[]) => (selectedTasks = keys as TKeepUploadTaskKey[]),
      }"
      row-key="id"
      size="small"
      @change="handleTableChange"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'site'">
          <SiteFavicon :site-id="record.items[0]?.site" :size="18" />
        </template>

        <!-- 这一格只放标题：主标题 + 副标题两行，和搜索结果那一列同一个形状。
             保存路径 / 基准种子原先挤在这里，现在自成一列（见下面的 savePath 分支）。
             每行外面包一层 div：a-typography 的单行省略是 inline-block，
             两个挨在一起的 inline-block 会并排而不是换行。 -->
        <template v-else-if="column.key === 'title'">
          <div>
            <div>
              <a-typography-text class="task-title" :ellipsis="{ tooltip: record.title }">
                <a
                  :href="record.items[0]?.link"
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  class="text-decoration-none"
                >
                  {{ record.title }}
                </a>
              </a-typography-text>
            </div>
            <div v-if="record.subTitle">
              <a-typography-text class="task-subtitle" :ellipsis="{ tooltip: record.subTitle }">
                {{ record.subTitle }}
              </a-typography-text>
            </div>
          </div>
        </template>

        <template v-else-if="column.key === 'savePath'">
          <div>
            <div>
              <a-typography-text class="task-line" :ellipsis="{ tooltip: savePathLine(record) }">
                {{ savePathLine(record) }}
              </a-typography-text>
            </div>
            <!-- 基准不在任务里的那种任务：数据是下载器里已有的另一条，得说清楚是哪条，
                 否则用户看到的是「只有一颗种子的辅种任务」，不知道它在往什么上挂 -->
            <div v-if="record.baseLocal">
              <a-typography-text class="task-line" :ellipsis="{ tooltip: baseLocalLine(record) }">
                {{ baseLocalLine(record) }}
              </a-typography-text>
            </div>
          </div>
        </template>

        <template v-else-if="column.key === 'size'">
          {{ formatSize(record.size) }}
        </template>

        <!-- 回查下载器那边折出来的结论。没查过时这一格写「没查过」而不是留空、更不是「正常」
             —— 那一列替用户说过「没问题」而其实没看过，是会比报错更糟的谎。
             悬停看逐条明细，含客户端原样的状态串：判据要是不对，人自己能看出是哪一条折错了。 -->
        <template v-else-if="column.key === 'seedState'">
          <a-popover
            v-if="reseedSummary(record)"
            trigger="hover"
            placement="left"
            :mouse-enter-delay="0.4"
          >
            <template #content>
              <div class="reseed-detail">
                <div v-for="row in reseedRows(record)" :key="row.key" class="reseed-detail-row">
                  <span class="reseed-detail-title">{{ row.title }}</span>
                  <span>{{ row.text }}</span>
                  <span v-if="row.raw" class="text-grey">{{ row.raw }}</span>
                </div>
              </div>
            </template>
            <a-tag :color="reseedSummary(record)?.color">{{ reseedSummary(record)?.text }}</a-tag>
          </a-popover>
          <span v-else class="text-body-small text-grey">{{ t("KeepUploadTask.recheck.state.idle") }}</span>
        </template>

        <template v-else-if="column.key === 'count'">
          {{ record.items.length }}
        </template>

        <template v-else-if="column.key === 'time'">
          {{ formatDate(record.time) }}
        </template>

        <template v-else-if="column.key === 'action'">
          <a-space :size="0">
            <!-- baseLocal 那种任务里只有一条，而那一条就是「要挂上去的本站」，不是基准：
                 基准在下载器里。所以「发基准」「发其他」两颗都没有对象，直接不出现，
                 留下「发送所有种子」= 发这一条 -->
            <a-tooltip v-if="!record.baseLocal" :title="t('KeepUploadTask.sendBaseTorrent')">
              <a-button size="small" type="text" @click="sendBaseTorrent(record)">
                <template #icon>
                  <NumberOutlined />
                </template>
              </a-button>
            </a-tooltip>
            <a-tooltip v-if="!record.baseLocal" :title="t('KeepUploadTask.sendOtherTorrents')">
              <a-button size="small" type="text" @click="sendOtherTorrents(record)">
                <template #icon>
                  <CopyOutlined />
                </template>
              </a-button>
            </a-tooltip>
            <a-tooltip :title="record.baseLocal ? t('KeepUploadTask.sendReseedOne') : t('KeepUploadTask.sendAllTorrents')">
              <a-button size="small" type="text" @click="sendAllTorrents(record)">
                <template #icon>
                  <DownloadOutlined />
                </template>
              </a-button>
            </a-tooltip>
            <a-tooltip :title="t('KeepUploadTask.copyLinks')">
              <a-button size="small" type="text" @click="copyLinksToClipboard(record)">
                <template #icon>
                  <LinkOutlined />
                </template>
              </a-button>
            </a-tooltip>
            <a-tooltip :title="t('common.remove')">
              <a-button danger size="small" type="primary" @click="deleteTask(record)">
                <template #icon>
                  <DeleteOutlined />
                </template>
              </a-button>
            </a-tooltip>
          </a-space>
        </template>
      </template>

      <template #expandedRowRender="{ record }">
        <ul class="task-items">
          <li v-for="(subItem, index) in record.items" :key="index" class="task-item">
            <SiteFavicon :site-id="subItem.site" :size="16" />
            <div class="task-item-main">
              <a :href="subItem.link" target="_blank" rel="noopener noreferrer nofollow">
                {{ subItem.title }}
              </a>
              <!-- 副标题：和上面主标题那一列一样，逐条也要有两行（旧任务里没这一项，就不出这一行） -->
              <div v-if="subItem.subTitle" class="text-body-small text-grey">
                {{ subItem.subTitle }}
              </div>
              <div class="text-body-small text-grey">
                {{ formatSize(subItem.size) }}, {{ t("KeepUploadTask.seeders") }}{{ subItem.seeders ?? "-" }},
                {{ t("KeepUploadTask.leechers") }}{{ subItem.leechers ?? "-" }}
              </div>
            </div>
            <a-tooltip v-if="!record.baseLocal" :title="t('KeepUploadTask.setAsBaseTorrent')">
              <a-button
                size="small"
                type="text"
                :disabled="index === 0"
                @click="setAsBaseTorrent(record as IKeepUploadTask, index)"
              >
                <template #icon>
                  <ArrowUpOutlined />
                </template>
              </a-button>
            </a-tooltip>
          </li>
        </ul>
      </template>

    </a-table>

    <!-- 空态用 a-empty 而不是 a-alert：a-alert 是「提示/警告」语义，
         这里要表达的是「暂无数据」，同项目其它三处（MediaServerEntity/Index.vue、
         MyClient/ClientStatusDialog.vue、SetDownloader/SiteFilterDialog.vue）都用 a-empty -->
    <a-empty v-if="!loading && tasks.length === 0" class="my-4" :description="t('KeepUploadTask.emptyNotice')" />

    <!-- 这条警告是这一页的内容（辅种风险须知），不是页标题，所以留在面板里跟着表格一起滚：
         .page 是「工具条 + 面板」两行的网格，多一个直接子项会被排进隐式第三行、把面板那一行挤窄。 -->
    <a-alert class="mt-4" type="warning" show-icon :title="t('KeepUploadTask.warning.title')">
      <!-- a-alert 的 description 渲染为普通 div，字符串里的 \n 不会换行，
           旧写法三条注意事项会被压成一行；改用插槽逐条渲染 -->
      <template #description>
        <div>1. {{ t('KeepUploadTask.warning.item1') }}</div>
        <div>2. {{ t('KeepUploadTask.warning.item2') }}</div>
        <div>3. {{ t('KeepUploadTask.warning.item3') }}</div>
      </template>
    </a-alert>
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

/* 副标题与保存路径那两行要「比标题小一档、灰」。
   写成带 data-v 的选择器才抢得过 antd 的 `.ant-typography`（同特异度、cssinjs 运行时注入在后面），
   这也是上面 .task-title 能生效的同一个原因 —— 别改回挂 .text-grey / .text-body-small。 */
.task-subtitle,
.task-line {
  font-size: 12px;
  color: #6b7280;
}

.task-items {
  margin: 0;
  padding: 0 0 0 40px;
  list-style: none;
}

.task-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}

.task-item-main {
  flex: 1 1 0;
  min-width: 0;
}

/* 回查那一列悬停里的明细：一行一条，标题吃剩下宽度并截断（种子标题动辄上百字符，
   不截断会把浮层撑得比屏幕还宽），后面跟结论和客户端原样的状态串 */
.reseed-detail {
  max-width: 480px;
}

.reseed-detail-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 0;
}

.reseed-detail-title {
  flex: 1 1 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
