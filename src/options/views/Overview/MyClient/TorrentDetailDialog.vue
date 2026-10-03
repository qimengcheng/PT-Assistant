<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  CalendarOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  CopyOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  ExclamationCircleOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  KeyOutlined,
  LineChartOutlined,
  LinkOutlined,
  LockOutlined,
  QuestionCircleOutlined,
  SyncOutlined,
  TagsOutlined,
} from "@antdv-next/icons";

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

const priorityItems: Array<{ title: string; value: TorrentFilePriority }> = [
  { title: t("MyClient.detail.prioritySkip"), value: "skip" },
  { title: t("MyClient.detail.priorityLow"), value: "low" },
  { title: t("MyClient.detail.priorityNormal"), value: "normal" },
  { title: t("MyClient.detail.priorityHigh"), value: "high" },
  { title: t("MyClient.detail.priorityHighest"), value: "highest" },
];

const trackerStatusIcon: Record<CTrackerState, any> = {
  unknown: QuestionCircleOutlined,
  working: CheckCircleFilled,
  updating: SyncOutlined,
  disabled: CloseCircleFilled,
  error: ExclamationCircleOutlined,
};

function featureAllowed(feature: keyof NonNullable<TorrentClientMetaData["feature"]>): boolean {
  return metaData.value?.feature?.[feature]?.allowed ?? false;
}

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

async function copyToClipboard(text: string) {
  await navigator.clipboard.writeText(text);
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
    @after-open-change="(open: boolean) => open && afterEnter()"
    @after-close="resetDialog"
  >

    <template v-if="torrent">
      <a-tabs v-model:active-key="activeTab" @change="onTabChange">
        <a-tab-pane key="info" :tab="t('MyClient.detail.title')" />
        <a-tab-pane v-if="featureAllowed('FileList')" key="files" :tab="t('MyClient.detail.fileTitle')" />
        <a-tab-pane v-if="featureAllowed('PeerList')" key="peers" :tab="t('MyClient.detail.peersTitle')" />
        <a-tab-pane v-if="featureAllowed('TrackerList')" key="trackers" :tab="t('MyClient.detail.trackers')" />
        <a-tab-pane key="raw" :tab="t('MyClient.action.viewRaw')" />
      </a-tabs>

      <!-- 基本信息 -->
      <div v-if="activeTab === 'info'">
        <div class="detail-row">
          <FileTextOutlined />
          <span class="font-weight-bold">{{ torrent.name }}</span>
        </div>

        <div class="detail-row">
          <KeyOutlined />
          <code class="text-body-small">{{ torrent.infoHash }}</code>
          <a-tooltip :title="t('MyClient.detail.copyHash')">
            <a-button type="text" size="small" @click="copyToClipboard(torrent.infoHash)">
              <template #icon><CopyOutlined /></template>
            </a-button>
          </a-tooltip>
          <a-tooltip :title="t('MyClient.detail.copyMagnet')">
            <a-button type="text" size="small" @click="copyToClipboard(magnetLink(torrent))">
              <template #icon><LinkOutlined /></template>
            </a-button>
          </a-tooltip>
        </div>

        <a-divider />

        <a-row :gutter="12">
          <a-col :span="12">
            <div class="detail-row">
              <LineChartOutlined />
              <TorrentStateTd :item="torrent" />
            </div>
            <div class="detail-row">
              <DatabaseOutlined />
              <span>{{ torrent.progress.toFixed(2) }}%</span>
            </div>
            <div class="detail-row">
              <DatabaseOutlined />
              <span>{{ formatSize(torrent.totalSize) }}</span>
            </div>
          </a-col>
          <a-col :span="12">
            <div class="detail-row">
              <ArrowUpOutlined style="color: #389e0d" />
              <span>
                {{ formatSpeed(torrent.uploadSpeed) }}
                <span class="text-grey text-body-small ml-1">({{ formatTotal(torrent.totalUploaded) }})</span>
              </span>
            </div>
            <div class="detail-row">
              <ArrowDownOutlined style="color: #cf1322" />
              <span>
                {{ formatSpeed(torrent.downloadSpeed) }}
                <span class="text-grey text-body-small ml-1">({{ formatTotal(torrent.totalDownloaded) }})</span>
              </span>
            </div>
            <div class="detail-row">
              <LineChartOutlined />
              <span :class="torrent.ratio >= 1 ? 'text-green' : 'text-red'">
                {{ torrent.ratio.toFixed(2) }}
              </span>
            </div>
          </a-col>
        </a-row>

        <a-divider />

        <div class="detail-row">
          <FolderOpenOutlined />
          <span class="text-body-small">{{ torrent.savePath }}</span>
        </div>
        <div class="detail-row">
          <TagsOutlined />
          <span>{{ torrent.label || "-" }}</span>
        </div>
        <div class="detail-row">
          <CalendarOutlined />
          <span>{{ formatDate(torrent.dateAdded * 1000) }}</span>
        </div>
      </div>

      <!-- 原始数据 -->
      <pre v-else-if="activeTab === 'raw'" class="text-body-medium raw-json">{{ JSON.stringify(torrent, null, 2) }}</pre>

      <!-- 文件管理 -->
      <div v-else-if="activeTab === 'files'">
        <div v-if="filesLoading" class="loading-box">
          <a-spin />
        </div>
        <table v-else-if="files.length > 0" class="plain-table">
          <thead>
            <tr>
              <th>{{ t("MyClient.detail.fileColumnName") }}</th>
              <th class="text-end">{{ t("MyClient.detail.fileColumnSize") }}</th>
              <th class="text-end">{{ t("MyClient.detail.fileColumnProgress") }}</th>
              <th class="text-end" style="width: 150px">{{ t("MyClient.detail.fileColumnPriority") }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="file in files" :key="file.index">
              <td class="text-body-small">{{ file.path }}</td>
              <td class="text-end text-body-small">{{ formatSize(file.size) }}</td>
              <td class="text-end text-body-small">{{ file.progress.toFixed(1) }}%</td>
              <td class="text-end">
                <a-select
                  v-if="featureAllowed('FilePriority')"
                  :value="file.priority"
                  :options="priorityItems"
                  size="small"
                  @change="(value: TorrentFilePriority | null) => updateFilePriority(file, value)"
                />
                <span v-else class="text-body-small">{{ file.priority }}</span>
              </td>
            </tr>
          </tbody>
        </table>
        <a-alert v-else type="info" show-icon banner>{{ t("MyClient.detail.noFiles") }}</a-alert>
      </div>

      <!-- Peers -->
      <div v-else-if="activeTab === 'peers'">
        <div v-if="peersLoading" class="loading-box">
          <a-spin />
        </div>
        <table v-else-if="peers.length > 0" class="plain-table">
          <thead>
            <tr>
              <th>{{ t("MyClient.detail.peersColumnIp") }}</th>
              <th>{{ t("MyClient.detail.peersColumnClient") }}</th>
              <th class="text-end">{{ t("MyClient.detail.peersColumnProgress") }}</th>
              <th class="text-end">{{ t("MyClient.detail.peersColumnDownloadSpeed") }}</th>
              <th class="text-end">{{ t("MyClient.detail.peersColumnUploadSpeed") }}</th>
              <th class="text-center">{{ t("MyClient.detail.peersColumnEncrypted") }}</th>
              <th class="text-center">{{ t("MyClient.detail.peersColumnCountry") }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(peer, index) in peers" :key="`${peer.ip}-${index}`">
              <td class="text-body-small">{{ peer.ip }}</td>
              <td class="text-body-small">{{ peer.client || "-" }}</td>
              <td class="text-end text-body-small">{{ peer.progress.toFixed(1) }}%</td>
              <td class="text-end text-body-small">{{ formatSize(peer.downloadSpeed) }}/s</td>
              <td class="text-end text-body-small">{{ formatSize(peer.uploadSpeed) }}/s</td>
              <td class="text-center">
                <LockOutlined v-if="peer.encrypted" style="font-size: 12px" />
                <span v-else>-</span>
              </td>
              <td class="text-center text-body-small">{{ peer.country || "-" }}</td>
            </tr>
          </tbody>
        </table>
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
        <table v-else-if="trackers.length > 0" class="plain-table">
          <thead>
            <tr>
              <th>{{ t("MyClient.detail.trackerColumnUrl") }}</th>
              <th class="text-center" style="width: 80px">{{ t("MyClient.detail.trackerColumnTier") }}</th>
              <th class="text-center" style="width: 90px">{{ t("MyClient.detail.trackerColumnStatus") }}</th>
              <th class="text-end" style="width: 90px">{{ t("MyClient.detail.trackerColumnSeeds") }}</th>
              <th class="text-end" style="width: 90px">{{ t("MyClient.detail.trackerColumnLeeches") }}</th>
              <th style="width: 140px">{{ t("MyClient.detail.trackerColumnLastAnnounce") }}</th>
              <th v-if="featureAllowed('TrackerManage')" class="text-center" style="width: 70px"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="tracker in trackers" :key="tracker.url">
              <td class="text-body-small">{{ tracker.url }}</td>
              <td class="text-center text-body-small">{{ tracker.tier }}</td>
              <td class="text-center">
                <component :is="trackerStatusIcon[tracker.status]" style="font-size: 12px" />
              </td>
              <td class="text-end text-body-small">{{ tracker.seeds ?? "-" }}</td>
              <td class="text-end text-body-small">{{ tracker.leeches ?? "-" }}</td>
              <td class="text-body-small">{{ formatTimestamp(tracker.lastAnnounce) }}</td>
              <td v-if="featureAllowed('TrackerManage')" class="text-center">
                <a-button
                  type="text"
                  size="small"
                  :title="t('MyClient.detail.removeTracker')"
                  @click="removeTracker(tracker)"
                >
                  <template #icon><DeleteOutlined /></template>
                </a-button>
              </td>
            </tr>
          </tbody>
        </table>
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

.plain-table {
  width: 100%;
  border-collapse: collapse;

  th,
  td {
    padding: 6px 8px;
    border-bottom: 1px solid #f0f0f0;
    text-align: left;
  }

  th {
    font-weight: 500;
    color: #8c8c8c;
    background: #fafafa;
  }

  tbody tr:nth-of-type(odd) {
    background: #fafafa;
  }
}

// 原始 JSON 内容较长，展开后自带滚动区，避免依赖 dialog/tabs 外层布局的滚动
.raw-json {
  max-height: 60vh;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
