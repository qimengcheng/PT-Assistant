<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  CheckCircleFilled,
  CloseCircleFilled,
  DeleteOutlined,
  ExclamationCircleOutlined,
  FileTextOutlined,
  KeyOutlined,
  LinkOutlined,
  LockOutlined,
  QuestionCircleOutlined,
  SyncOutlined,
} from "@antdv-next/icons";

import type { TableColumnsType } from "antdv-next";
import type {
  CTorrent,
  CTorrentFile,
  CTorrentPeer,
  CTorrentTracker,
  CTrackerState,
  TorrentClientMetaData,
  TorrentFilePriority,
} from "@ptd/downloader";
import { sendMessage } from "@/messages.ts";
import { formatSize, formatDate } from "@/options/utils.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";

import TorrentStateTd from "./TorrentStateTd.vue";

const showDialog = defineModel<boolean>();
const { torrent } = defineProps<{
  torrent: CTorrent | null;
}>();

const { t } = useI18n();

const activeTab = ref<string>("info");

// 下载器能力元数据（feature 声明）
const metaData = ref<TorrentClientMetaData | null>(null);

// 文件
const files = ref<CTorrentFile[]>([]);
const filesLoading = ref(false);
const filesLoaded = ref(false);

// peers
const peers = ref<CTorrentPeer[]>([]);
const peersLoading = ref(false);
const peersLoaded = ref(false);

// trackers
const trackers = ref<CTorrentTracker[]>([]);
const trackersLoading = ref(false);
const trackersLoaded = ref(false);
const trackerInput = ref("");

// options 的 label 键必须叫 `label`：a-select 的默认 optionLabelProp 取的是
// `options[i].label`，写成 `title` 只会被当成原生 title 属性，label 恒为 undefined
// → 下拉项和回显全部显示原始 value（skip / low / …）。
const priorityItems: Array<{ label: string; value: TorrentFilePriority }> = [
  { label: t("MyClient.detail.prioritySkip"), value: "skip" },
  { label: t("MyClient.detail.priorityLow"), value: "low" },
  { label: t("MyClient.detail.priorityNormal"), value: "normal" },
  { label: t("MyClient.detail.priorityHigh"), value: "high" },
  { label: t("MyClient.detail.priorityHighest"), value: "highest" },
];

const trackerStatusIcon: Record<CTrackerState, any> = {
  unknown: QuestionCircleOutlined,
  working: CheckCircleFilled,
  updating: SyncOutlined,
  disabled: CloseCircleFilled,
  error: ExclamationCircleOutlined,
};

/**
 * a-table 的 #bodyCell 插槽拿到的 record 是 any（该插槽不携带列泛型），
 * 直接拿它去索引 Record<CTrackerState> 会报 TS7053，这里收一道类型再查表。
 */
function trackerStatusIconOf(status: CTrackerState): unknown {
  return trackerStatusIcon[status];
}

function featureAllowed(feature: keyof NonNullable<TorrentClientMetaData["feature"]>): boolean {
  return metaData.value?.feature?.[feature]?.allowed ?? false;
}

// ============================================================================
// 详情页三张表的列定义。
// 原来是手搓 <table class="plain-table">，表头底色 / 斑马纹 / 边框全部写死在 CSS 里
// （其中条纹底色 #fafafa 与 vuetify-compat.css 的 .table-stripe 同值，是当初互相抄的，
// 并不是 Table 的 rowHoverBg token）。换成 a-table 后这些交给组件按 token 生成。
// 列定义放 computed 是因为标题走 t()，要跟着 locale 变。
// ============================================================================
const fileColumns = computed<TableColumnsType<CTorrentFile>>(() => [
  { title: t("MyClient.detail.fileColumnName"), dataIndex: "path", key: "path" },
  { title: t("MyClient.detail.fileColumnSize"), dataIndex: "size", key: "size", align: "right" },
  { title: t("MyClient.detail.fileColumnProgress"), dataIndex: "progress", key: "progress", align: "right" },
  {
    title: t("MyClient.detail.fileColumnPriority"),
    dataIndex: "priority",
    key: "priority",
    align: "right",
    width: 150,
  },
]);

const peerColumns = computed<TableColumnsType<CTorrentPeer>>(() => [
  { title: t("MyClient.detail.peersColumnIp"), dataIndex: "ip", key: "ip" },
  { title: t("MyClient.detail.peersColumnClient"), dataIndex: "client", key: "client" },
  { title: t("MyClient.detail.peersColumnProgress"), dataIndex: "progress", key: "progress", align: "right" },
  { title: t("MyClient.detail.peersColumnDownloadSpeed"), dataIndex: "downloadSpeed", key: "downloadSpeed", align: "right" },
  { title: t("MyClient.detail.peersColumnUploadSpeed"), dataIndex: "uploadSpeed", key: "uploadSpeed", align: "right" },
  { title: t("MyClient.detail.peersColumnEncrypted"), dataIndex: "encrypted", key: "encrypted", align: "center" },
  { title: t("MyClient.detail.peersColumnCountry"), dataIndex: "country", key: "country", align: "center" },
]);

// 最后一列（删除 tracker）只有客户端声明了 TrackerManage 能力时才存在，
// 所以它得跟着 featureAllowed 动态进出列定义，而不是在单元格里 v-if。
const trackerColumns = computed<TableColumnsType<CTorrentTracker>>(() => {
  const columns: TableColumnsType<CTorrentTracker> = [
    { title: t("MyClient.detail.trackerColumnUrl"), dataIndex: "url", key: "url" },
    { title: t("MyClient.detail.trackerColumnTier"), dataIndex: "tier", key: "tier", align: "center", width: 80 },
    { title: t("MyClient.detail.trackerColumnStatus"), dataIndex: "status", key: "status", align: "center", width: 90 },
    { title: t("MyClient.detail.trackerColumnSeeds"), dataIndex: "seeds", key: "seeds", align: "right", width: 90 },
    { title: t("MyClient.detail.trackerColumnLeeches"), dataIndex: "leeches", key: "leeches", align: "right", width: 90 },
    {
      title: t("MyClient.detail.trackerColumnLastAnnounce"),
      dataIndex: "lastAnnounce",
      key: "lastAnnounce",
      width: 140,
    },
  ];
  if (featureAllowed("TrackerManage")) {
    columns.push({ title: "", dataIndex: "action", key: "action", align: "center", width: 70 });
  }
  return columns;
});

async function loadMetaData() {
  if (!torrent || metaData.value) return;
  try {
    metaData.value = (await sendMessage("getDownloaderMetaData", torrent.clientId)) ?? null;
  } catch {
    metaData.value = null;
  }
}

async function loadFiles() {
  if (!torrent || filesLoaded.value) return;
  filesLoading.value = true;
  try {
    files.value = await sendMessage("getClientTorrentFiles", { downloaderId: torrent.clientId, torrent });
    filesLoaded.value = true;
  } catch {
    files.value = [];
  } finally {
    filesLoading.value = false;
  }
}

async function updateFilePriority(file: CTorrentFile, priority: TorrentFilePriority | null) {
  if (!torrent || !priority || priority === file.priority) return;
  try {
    const ok = await sendMessage("setClientTorrentFilePriority", {
      downloaderId: torrent.clientId,
      torrent,
      selections: [{ index: file.index, priority }],
    });
    if (ok) {
      file.priority = priority;
      file.wanted = priority !== "skip";
    }
  } catch {
    // 静默失败，优先级保持原值
  }
}

async function loadPeers() {
  if (!torrent || peersLoaded.value) return;
  peersLoading.value = true;
  try {
    peers.value = await sendMessage("getClientTorrentPeers", { downloaderId: torrent.clientId, torrent });
    peersLoaded.value = true;
  } catch {
    peers.value = [];
  } finally {
    peersLoading.value = false;
  }
}

async function loadTrackers() {
  if (!torrent || trackersLoaded.value) return;
  trackersLoading.value = true;
  try {
    trackers.value = await sendMessage("getClientTorrentTrackersDetail", {
      downloaderId: torrent.clientId,
      torrent,
    });
    trackersLoaded.value = true;
  } catch {
    trackers.value = [];
  } finally {
    trackersLoading.value = false;
  }
}

async function addTracker() {
  if (!torrent || !trackerInput.value.trim()) return;
  const url = trackerInput.value.trim();
  try {
    const ok = await sendMessage("addClientTorrentTracker", { downloaderId: torrent.clientId, torrent, url });
    if (ok) {
      trackers.value = await sendMessage("getClientTorrentTrackersDetail", {
        downloaderId: torrent.clientId,
        torrent,
      });
      trackerInput.value = "";
    }
  } catch {
    // 静默失败
  }
}

async function removeTracker(tracker: CTorrentTracker) {
  if (!torrent) return;
  try {
    const ok = await sendMessage("removeClientTorrentTracker", {
      downloaderId: torrent.clientId,
      torrent,
      url: tracker.url,
    });
    if (ok) {
      trackers.value = await sendMessage("getClientTorrentTrackersDetail", {
        downloaderId: torrent.clientId,
        torrent,
      });
    }
  } catch {
    // 静默失败
  }
}

function resetDialog() {
  activeTab.value = "info";
  metaData.value = null;
  files.value = [];
  filesLoaded.value = false;
  peers.value = [];
  peersLoaded.value = false;
  trackers.value = [];
  trackersLoaded.value = false;
  trackerInput.value = "";
}

async function afterEnter() {
  await loadMetaData();
  // Tracker 列表最常被查看，随对话框打开预加载；文件/peers 在首次切换到对应 tab 时加载
  await loadTrackers();
}

function onTabChange(value: string | null | undefined) {
  if (value === "files") {
    loadFiles();
  } else if (value === "peers") {
    loadPeers();
  }
}

/**
 * 磁力链接没有对应的 copyable 文本节点（它不对应界面上一段可见文案），仍需手写一次复制。
 * 原先的 copyToClipboard 是裸的 navigator.clipboard.writeText，既没有失败提示，
 * 也没告诉用户「复制的是磁力链接」—— 这里把两者都补上。
 */
async function copyMagnet() {
  if (!torrent) return;
  try {
    await navigator.clipboard.writeText(magnetLink(torrent));
    useRuntimeStore().showSnakebar(t("MyClient.detail.copyMagnetSuccess"), { color: "success" });
  } catch (e) {
    console.error("[PTD] copy magnet link failed", torrent.infoHash, e);
    useRuntimeStore().showSnakebar(t("MyClient.detail.copyFailed"), { color: "error" });
  }
}

function magnetLink(torrent: CTorrent): string {
  return `magnet:?xt=urn:btih:${torrent.infoHash}&dn=${encodeURIComponent(torrent.name)}`;
}

/** 格式化速度：0 / undefined 显示 "-"（避免 filesize(undefined) 抛错渲染为空） */
function formatSpeed(speed: number | undefined): string {
  return speed && speed > 0 ? `${formatSize(speed)}/s` : "-";
}

/** 格式化总量：undefined 显示 "-"，0 显示 "0 B" */
function formatTotal(total: number | undefined): string {
  return typeof total === "number" ? (formatSize(total) as string) : "-";
}

/** 格式化时间戳（秒）：undefined 显示 "-" */
function formatTimestamp(timestamp: number | undefined): string {
  return typeof timestamp === "number" && timestamp > 0 ? formatDate(timestamp * 1000) : "-";
}
</script>

<template>
  <a-modal
    v-model:open="showDialog"
    :title="t('MyClient.detail.title')"
    :width="900"
    :footer="null"
    destroy-on-hidden
    :after-open-change="(open: boolean) => open && afterEnter()"
    :after-close="resetDialog"
  >

    <template v-if="torrent">
      <a-tabs v-model:active-key="activeTab" @change="onTabChange">
        <a-tab-pane key="info" :tab="t('MyClient.detail.title')" />
        <a-tab-pane v-if="featureAllowed('FileList')" key="files" :tab="t('MyClient.detail.fileTitle')" />
        <a-tab-pane v-if="featureAllowed('PeerList')" key="peers" :tab="t('MyClient.detail.peersTitle')" />
        <a-tab-pane v-if="featureAllowed('TrackerList')" key="trackers" :tab="t('MyClient.detail.trackers')" />
        <a-tab-pane key="raw" :tab="t('MyClient.action.viewRaw')" />
      </a-tabs>

      <!-- 基本信息：名称与 Hash 带复制按钮，单独一行；其余只读字段走 a-descriptions
     （label 直接复用 MyClient.table.* 现有键，不新增 i18n）。 -->
      <div v-if="activeTab === 'info'">
        <div class="detail-row">
          <FileTextOutlined />
          <span class="font-weight-bold">{{ torrent.name }}</span>
        </div>

        <div class="detail-row">
          <KeyOutlined />
          <!-- 用 a-typography-text 的 copyable 取代手写「clipboard API + a-tooltip + a-button」：
               图标、文案、成功提示都由组件内部管，顺带补上原先缺失的复制失败提示 -->
          <a-typography-text
            code
            class="text-body-small"
            :copyable="{
              text: torrent.infoHash,
              tooltips: [t('MyClient.detail.copyHash'), t('common.copied')],
            }"
          >
            {{ torrent.infoHash }}
          </a-typography-text>
          <a-tooltip :title="t('MyClient.detail.copyMagnet')">
            <a-button
              type="text"
              size="small"
              @click="copyMagnet"
            >
              <template #icon><LinkOutlined /></template>
            </a-button>
          </a-tooltip>
        </div>

        <a-divider />

        <a-descriptions bordered size="small" :column="{ xs: 1, sm: 2 }">
          <a-descriptions-item :label="t('MyClient.table.status')">
            <TorrentStateTd :item="torrent" />
          </a-descriptions-item>
          <a-descriptions-item :label="t('MyClient.table.progress')">
            {{ torrent.progress.toFixed(2) }}%
          </a-descriptions-item>
          <a-descriptions-item :label="t('MyClient.table.size')">
            {{ formatSize(torrent.totalSize) }}
          </a-descriptions-item>
          <a-descriptions-item :label="t('MyClient.table.ratio')">
            <span :class="torrent.ratio >= 1 ? 'text-green' : 'text-red'">
              {{ torrent.ratio.toFixed(2) }}
            </span>
          </a-descriptions-item>
          <a-descriptions-item :label="t('MyClient.table.upSpeed')">
            <span>
              {{ formatSpeed(torrent.uploadSpeed) }}
              <span class="text-grey text-body-small ml-1">({{ formatTotal(torrent.totalUploaded) }})</span>
            </span>
          </a-descriptions-item>
          <a-descriptions-item :label="t('MyClient.table.dlSpeed')">
            <span>
              {{ formatSpeed(torrent.downloadSpeed) }}
              <span class="text-grey text-body-small ml-1">({{ formatTotal(torrent.totalDownloaded) }})</span>
            </span>
          </a-descriptions-item>
          <a-descriptions-item :label="t('MyClient.table.savePath')" :span="2">
            <span class="text-body-small">{{ torrent.savePath }}</span>
          </a-descriptions-item>
          <a-descriptions-item :label="t('SetDownloader.PathAndTag.tags.title')">
            {{ torrent.label || "-" }}
          </a-descriptions-item>
          <a-descriptions-item :label="t('MyClient.table.addedAt')">
            {{ formatDate(torrent.dateAdded * 1000) }}
          </a-descriptions-item>
        </a-descriptions>
      </div>

      <!-- 原始数据 -->
      <pre v-else-if="activeTab === 'raw'" class="text-body-medium raw-json">{{ JSON.stringify(torrent, null, 2) }}</pre>

      <!-- 文件管理 -->
      <div v-else-if="activeTab === 'files'">
        <div v-if="filesLoading" class="loading-box">
          <a-spin />
        </div>
        <a-table
          v-else-if="files.length > 0"
          class="detail-table"
          :columns="fileColumns"
          :data-source="files"
          :row-key="(record: CTorrentFile) => record.index"
          :pagination="false"
          size="small"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'size'">{{ formatSize(record.size) }}</template>
            <template v-else-if="column.key === 'progress'">{{ record.progress.toFixed(1) }}%</template>
            <template v-else-if="column.key === 'priority'">
              <a-select
                v-if="featureAllowed('FilePriority')"
                :value="record.priority"
                :options="priorityItems"
                size="small"
                @change="(value: TorrentFilePriority | null) => updateFilePriority(record, value)"
              />
              <span v-else>{{ record.priority }}</span>
            </template>
          </template>
        </a-table>
        <a-alert v-else type="info" show-icon banner>{{ t("MyClient.detail.noFiles") }}</a-alert>
      </div>

      <!-- Peers -->
      <div v-else-if="activeTab === 'peers'">
        <div v-if="peersLoading" class="loading-box">
          <a-spin />
        </div>
        <a-table
          v-else-if="peers.length > 0"
          class="detail-table"
          :columns="peerColumns"
          :data-source="peers"
          :row-key="(record: CTorrentPeer, index: number) => `${record.ip}-${index}`"
          :pagination="false"
          :scroll="{ y: 320 }"
          size="small"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'client'">{{ record.client || "-" }}</template>
            <template v-else-if="column.key === 'progress'">{{ record.progress.toFixed(1) }}%</template>
            <template v-else-if="column.key === 'downloadSpeed'">{{ formatSize(record.downloadSpeed) }}/s</template>
            <template v-else-if="column.key === 'uploadSpeed'">{{ formatSize(record.uploadSpeed) }}/s</template>
            <template v-else-if="column.key === 'encrypted'">
              <LockOutlined v-if="record.encrypted" style="font-size: 12px" />
              <span v-else>-</span>
            </template>
            <template v-else-if="column.key === 'country'">{{ record.country || "-" }}</template>
          </template>
        </a-table>
        <a-alert v-else type="info" show-icon banner>{{ t("MyClient.detail.noPeers") }}</a-alert>
      </div>

      <!-- Tracker 管理 -->
      <div v-else-if="activeTab === 'trackers'">
        <a-space style="margin-bottom: 8px; width: 100%">
          <a-input
            v-model:value="trackerInput"
            :placeholder="t('MyClient.detail.addTrackerTitle')"
            style="width: 320px"
            @press-enter="addTracker"
          />
          <a-button type="primary" :disabled="!trackerInput.trim()" @click="addTracker">
            {{ t("MyClient.detail.addTrackerTitle") }}
          </a-button>
        </a-space>

        <div v-if="trackersLoading" class="loading-box">
          <a-spin />
        </div>
        <a-table
          v-else-if="trackers.length > 0"
          class="detail-table"
          :columns="trackerColumns"
          :data-source="trackers"
          :row-key="(record: CTorrentTracker) => record.url"
          :pagination="false"
          size="small"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'status'">
              <component :is="trackerStatusIconOf(record.status)" style="font-size: 12px" />
            </template>
            <template v-else-if="column.key === 'seeds'">{{ record.seeds ?? "-" }}</template>
            <template v-else-if="column.key === 'leeches'">{{ record.leeches ?? "-" }}</template>
            <template v-else-if="column.key === 'lastAnnounce'">{{ formatTimestamp(record.lastAnnounce) }}</template>
            <template v-else-if="column.key === 'action'">
              <a-tooltip :title="t('MyClient.detail.removeTracker')">
                <a-button
                  type="text"
                  size="small"
                  @click="removeTracker(record)"
                >
                  <template #icon><DeleteOutlined /></template>
                </a-button>
              </a-tooltip>
            </template>
          </template>
        </a-table>
        <a-alert v-else type="info" show-icon banner>{{ t("MyClient.detail.noTrackers") }}</a-alert>
      </div>
    </template>
  </a-modal>
</template>

<style scoped lang="scss">
// 原 <v-list>/<v-list-item>：antdv-next 没有 a-list（只有虚拟滚动的 AList），改用普通 div
.detail-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}

.loading-box {
  display: flex;
  justify-content: center;
  padding: 24px 0;
}

// 原来手搓 <table> 时单元格统一用 text-body-small（12px）；a-table 默认跟随全局
// fontSize:13px，这里压回去保持视觉一致。
.detail-table :deep(.ant-table-tbody td) {
  font-size: 12px;
}

// 原始 JSON 内容较长，展开后自带滚动区，避免依赖 dialog/tabs 外层布局的滚动
.raw-json {
  max-height: 60vh;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
