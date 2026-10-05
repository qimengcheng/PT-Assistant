<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  ExportOutlined,
  ReloadOutlined,
  StopOutlined,
} from "@antdv-next/icons";

import { getDownloaderIcon, type TorrentClientStatus } from "@ptd/downloader";
import { sendMessage } from "@/messages.ts";
import { formatSize } from "@/options/utils.ts";

import {
  torrents,
  selectedDownloaderIds,
  suspendedDownloaders,
  useClientRefresh,
  autoRefreshRunning,
} from "./utils.ts";

const showDialog = defineModel<boolean>();

const { t } = useI18n();
const { enabledDownloaders, resumeDownloaderRefresh, clearDownloaderTimer } = useClientRefresh();

const clientStatuses = ref<Record<string, TorrentClientStatus>>({});
const clientVersions = ref<Record<string, string>>({});
const clientLoading = ref<Record<string, boolean>>({});

/** a-avatar 只吃组件插槽，这里直接用 img（与 SetBackup / SentToDownloaderDialog 一致） */
function downloaderIcon(type: string) {
  return chrome.runtime.getURL(getDownloaderIcon(type));
}

/** Returns true when the downloader's torrents are included in the current filter. */
function isDownloaderActive(id: string) {
  return selectedDownloaderIds.value.length === 0 || selectedDownloaderIds.value.includes(id);
}

/** Toggle a downloader in/out of the torrent filter. */
function toggleDownloaderFilter(id: string) {
  const idx = selectedDownloaderIds.value.indexOf(id);
  if (idx >= 0) {
    selectedDownloaderIds.value.splice(idx, 1);
  } else {
    selectedDownloaderIds.value.push(id);
  }
}

function torrentCountFor(id: string) {
  return (torrents.value[id] ?? []).length;
}

function formatSizeOrDash(v: number | undefined): string {
  return typeof v !== "undefined" ? (formatSize(v) as string) : "-";
}

async function fetchStatusFor(id: string) {
  clientLoading.value[id] = true;
  try {
    // client version 只获取一次即可
    if (typeof clientVersions.value[id] === "undefined") {
      clientVersions.value[id] = (await sendMessage("getDownloaderVersion", id)) ?? "—";
    }

    const status = await sendMessage("getDownloaderStatus", id);
    if (status) clientStatuses.value[id] = status;
  } finally {
    clientLoading.value[id] = false;
  }
}

function suspendedDownloader(id: string) {
  suspendedDownloaders.value.add(id);
  clearDownloaderTimer(id);
}

async function fetchAll() {
  await Promise.allSettled(enabledDownloaders.value.map((d) => fetchStatusFor(d.id)));
}

function onEnter() {
  fetchAll();
}
</script>

<template>
  <a-modal
    v-model:open="showDialog"
    :title="t('MyClient.clientStatusDialog.title')"
    :width="800"
    :footer="null"
    :after-open-change="(open: boolean) => open && onEnter()"
  >
    <!-- 刷新按钮原先挂在 #title 插槽里，会和右上角关闭按钮重叠，移到内容区顶部 -->
    <div class="d-flex justify-end">
      <a-button type="text" size="small" :title="t('MyClient.refresh')" @click="fetchAll">
        <template #icon>
          <ReloadOutlined />
        </template>
      </a-button>
    </div>

    <a-divider class="ma-0" />

    <!-- 原 <v-list>/<v-list-item>：antdv-next 没有 a-list（只有虚拟滚动的 AList），改用普通 div -->
    <div class="client-list">
      <div
        v-for="d in enabledDownloaders"
        :key="d.id"
        class="client-row"
        :class="{ 'client-row--active': isDownloaderActive(d.id) }"
        @click="toggleDownloaderFilter(d.id)"
      >
        <img :src="downloaderIcon(d.type)" :alt="d.type" class="client-icon" />

        <div class="client-main">
          <div class="d-flex align-center client-name">
            <span class="font-weight-bold">{{ d.name }}</span>
            <span v-if="clientVersions[d.id]" class="ml-2 text-body-small text-grey">
              {{ clientVersions[d.id] }}
            </span>
            <a-tooltip v-if="suspendedDownloaders.has(d.id)" :title="t('MyClient.autoRefresh.suspendedTip')">
              <ReloadOutlined class="ml-1" :style="{ color: '#cf1322' }" />
            </a-tooltip>
          </div>
          <a
            :href="d.address"
            class="client-address text-body-small"
            rel="noopener noreferrer nofollow"
            target="_blank"
            @click.stop
          >
            {{ d.address }}
          </a>
        </div>

        <a-spin v-if="clientLoading[d.id]" size="small" class="mr-4" />
        <div v-else class="client-status text-end text-body-small mr-2">
          <div class="d-flex align-center justify-end">
            <ArrowUpOutlined class="cell-icon cell-icon--green" />
            <span class="text-no-wrap">
              {{ formatSizeOrDash(clientStatuses[d.id]?.upSpeed) }}/s ({{
                formatSizeOrDash(clientStatuses[d.id]?.upData)
              }})
            </span>
          </div>
          <div class="d-flex align-center justify-end">
            <ArrowDownOutlined class="cell-icon cell-icon--red" />
            <span class="text-no-wrap">
              {{ formatSizeOrDash(clientStatuses[d.id]?.dlSpeed) }}/s ({{
                formatSizeOrDash(clientStatuses[d.id]?.dlData)
              }})
            </span>
          </div>
          <div class="text-grey">
            {{ t("MyClient.clientStatusDialog.torrentCount", { count: torrentCountFor(d.id) }) }}
          </div>
        </div>

        <a-divider type="vertical" class="mx-2" />

        <div class="client-actions">
          <a-tooltip v-if="suspendedDownloaders.has(d.id)" :title="t('MyClient.autoRefresh.resumeDownloader')">
            <a-button type="text" color="red" size="small" @click.stop="resumeDownloaderRefresh(d.id)">
              <template #icon>
                <ReloadOutlined />
              </template>
            </a-button>
          </a-tooltip>
          <a-tooltip v-else :title="t('MyClient.autoRefresh.stopDownloader')">
            <a-button
              type="text"
              color="gold"
              size="small"
              :disabled="!autoRefreshRunning"
              @click.stop="() => suspendedDownloader(d.id)"
            >
              <template #icon>
                <StopOutlined />
              </template>
            </a-button>
          </a-tooltip>

          <a-tooltip :title="t('MyClient.clientStatusDialog.openClient')">
            <a-button
              type="text"
              size="small"
              :href="d.address"
              rel="noopener noreferrer nofollow"
              target="_blank"
              @click.stop
            >
              <template #icon>
                <ExportOutlined />
              </template>
            </a-button>
          </a-tooltip>
        </div>
      </div>

      <a-empty v-if="enabledDownloaders.length === 0" class="my-4" />
    </div>
  </a-modal>
</template>

<style scoped lang="scss">
/* 标题栏：标题 + 刷新 + 关闭（原来放在 v-toolbar 的 #append 上，antd 标题插槽需自行排版） */
.client-list {
  max-height: 70vh;
  overflow-y: auto;
}

.client-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border-radius: 4px;
  cursor: pointer;

  &:hover {
    background: rgba(0, 0, 0, 0.04);
  }
}

/* 对应 v-list-item 的 :active（已纳入当前筛选的下载器） */
.client-row--active {
  background: rgba(22, 119, 255, 0.1);
}

.client-icon {
  flex: none;
  width: 32px;
  height: 32px;
}

.client-main {
  flex: 1 1 0;
  min-width: 0;
}

.client-name {
  line-height: 1.4;
}

.client-address {
  display: inline-block;
  color: #1677ff;
  text-decoration: underline;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
}

.client-status {
  flex: none;
}

.client-actions {
  flex: none;
  display: flex;
  align-items: center;
}

.cell-icon {
  font-size: 14px; /* 原 <v-icon size="small"> */
  margin-right: 4px;
}
.cell-icon--green {
  color: #388e3c; /* Vuetify green-darken-4 */
}
.cell-icon--red {
  color: #c62828; /* Vuetify red-darken-4 */
}
</style>
