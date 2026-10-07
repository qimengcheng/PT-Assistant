<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
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
} from "@antdv-next/icons";

import type { CAddTorrentOptions } from "@ptd/downloader";
import type { IKeepUploadTask, TKeepUploadTaskKey } from "@/shared/types.ts";
import { sendMessage } from "@/messages.ts";
import { formatSize, formatDate } from "@/options/utils.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";

import SiteFavicon from "@/options/components/SiteFavicon/Index.vue";
import { useConfirmDanger } from "@/options/components/useConfirmDanger.ts";

const { t } = useI18n();
const runtimeStore = useRuntimeStore();
const metadataStore = useMetadataStore();

const tasks = ref<IKeepUploadTask[]>([]);
// 表格 row-key 为 id，因此选中项保存的是任务ID（TKeepUploadTaskKey）而非任务对象
const selectedTasks = ref<TKeepUploadTaskKey[]>([]);
const loading = ref(false);

// computed：表头有 t()，setup 里一次性求值的话切语言不会重算
const columns = computed<TableColumnsType<IKeepUploadTask>>(() => [
  { title: t("KeepUploadTask.table.site"), key: "site", align: "center", width: 72 },
  { title: t("KeepUploadTask.table.title"), dataIndex: "title", key: "title", align: "left", ellipsis: true },
  {
    title: t("KeepUploadTask.table.size"),
    dataIndex: "size",
    key: "size",
    align: "right",
    width: 110,
    sorter: (a, b) => a.size - b.size,
  },
  {
    title: t("KeepUploadTask.table.count"),
    key: "count",
    align: "center",
    width: 80,
    sorter: (a, b) => a.items.length - b.items.length,
  },
  {
    title: t("KeepUploadTask.table.time"),
    dataIndex: "time",
    key: "time",
    align: "center",
    width: 170,
    sorter: (a, b) => a.time - b.time,
  },
  { title: t("common.action"), key: "action", align: "center", width: 180 },
]);

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
      const addTorrentOptions: CAddTorrentOptions = {
        localDownload: true,
        // 与普通下载保持一致：是否暂停由下载器的“自动开始”设置决定。
        addAtPaused: !(downloader.feature?.DefaultAutoStart ?? true),
        savePath: task.downloadOptions.savePath || "",
        ...task.downloadOptions.addTorrentOptions,
      };

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

// 发送基准种子到下载器
function sendBaseTorrent(task: IKeepUploadTask) {
  const items = task.items.slice(0, 1);
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

        <a-button
          href="https://github.com/pt-plugins/PT-Plugin-Plus/wiki/keep-upload-task"
          target="_blank"
          rel="noopener noreferrer nofollow"
        >
          <template #icon>
            <QuestionCircleOutlined />
          </template>
          <span class="ml-1">{{ t("common.howToUse") }}</span>
        </a-button>
      </a-flex>
    </a-flex>

    <!-- 面板只负责给表格一块白底表面；这页的表格没有 scroll.y，内部滚动就由面板接管 -->
    <div class="page-panel">
    <a-table
      bordered
      :columns="columns"
      :data-source="tasks"
      :loading="loading"
      :pagination="false"
      :expandable="{ showExpandColumn: true }"
      :row-selection="{
        selectedRowKeys: selectedTasks,
        onChange: (keys: (string | number)[]) => (selectedTasks = keys as TKeepUploadTaskKey[]),
      }"
      row-key="id"
      size="small"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'site'">
          <SiteFavicon :site-id="record.items[0]?.site" :size="18" />
        </template>

        <template v-else-if="column.key === 'title'">
          <div>
            <!-- 标题可能很长：用 a-typography-text 的 ellipsis.tooltip 一步拿到「截断 + 悬停完整文案」。
             原来是 <a class="text-truncate">，而 <a> 是 inline 元素，text-overflow 对 inline 不生效，
             标题实际上从不截断，一直把表格单元格撑宽。 -->
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
            <div class="text-body-small text-grey text-no-wrap">
              {{ t("KeepUploadTask.savePath") }}{{ record.downloadOptions?.clientName }} ->
              {{ record.downloadOptions?.savePath || t("KeepUploadTask.defaultPath") }}
            </div>
            <div class="text-body-small">{{ t("KeepUploadTask.torrentCount") }}{{ record.items.length }}</div>
          </div>
        </template>

        <template v-else-if="column.key === 'size'">
          {{ formatSize(record.size) }}
        </template>

        <template v-else-if="column.key === 'count'">
          {{ record.items.length }}
        </template>

        <template v-else-if="column.key === 'time'">
          {{ formatDate(record.time) }}
        </template>

        <template v-else-if="column.key === 'action'">
          <a-space :size="0">
            <a-tooltip :title="t('KeepUploadTask.sendBaseTorrent')">
              <a-button size="small" type="text" @click="sendBaseTorrent(record)">
                <template #icon>
                  <NumberOutlined />
                </template>
              </a-button>
            </a-tooltip>
            <a-tooltip :title="t('KeepUploadTask.sendOtherTorrents')">
              <a-button size="small" type="text" @click="sendOtherTorrents(record)">
                <template #icon>
                  <CopyOutlined />
                </template>
              </a-button>
            </a-tooltip>
            <a-tooltip :title="t('KeepUploadTask.sendAllTorrents')">
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
              <div class="text-body-small text-grey">
                {{ formatSize(subItem.size) }}, {{ t("KeepUploadTask.seeders") }}{{ subItem.seeders ?? "-" }},
                {{ t("KeepUploadTask.leechers") }}{{ subItem.leechers ?? "-" }}
              </div>
            </div>
            <a-tooltip :title="t('KeepUploadTask.setAsBaseTorrent')">
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
</template>

<style scoped lang="scss">
.task-title {
  font-size: 14px;
  font-weight: 500;
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
</style>
