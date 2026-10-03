<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef } from "vue";
import { useI18n } from "vue-i18n";
import {
  DeleteOutlined,
  DownloadOutlined,
  FilterOutlined,
  MinusOutlined,
  ReloadOutlined,
  SearchOutlined,
  SyncOutlined,
} from "@antdv-next/icons";
import { useBreakpoint } from "antdv-next";
import type { TableColumnsType } from "antdv-next";

import { sendMessage } from "@/messages.ts";
import { useTableBehavior } from "@/options/directives/useTableBehavior.ts";
import { formatDate } from "@/options/utils.ts";
import { useConfigStore } from "@/options/stores/config.ts";
import type {
  ITorrentDownloadMetadata,
  TTorrentDownloadKey,
  TTorrentDownloadStatus,
} from "@/shared/types.ts";

import SiteFavicon from "@/options/components/SiteFavicon/Index.vue";
import SiteName from "@/options/components/SiteName.vue";
import TorrentTitleTd from "@/options/components/TorrentTitleTd.vue";
import DeleteDialog from "@/options/components/DeleteDialog.vue";
import DownloaderLabel from "@/options/components/DownloaderLabel.vue";
import ReDownloadSelectDialog from "./ReDownloadSelectDialog.vue";
import AdvanceFilterGenerateDialog from "./AdvanceFilterGenerateDialog.vue";

import {
  downloadHistory,
  downloadHistoryList,
  downloadStatusMap,
  tableCustomFilter,
  clearWatchingMap,
  throttleLoadDownloadHistory,
  type IDownloadStatusMeta,
} from "./utils.ts"; // <-- 主要方法

const { t } = useI18n();
const configStore = useConfigStore();
const screens = useBreakpoint();
const isNarrow = computed(() => screens.value?.xs === true || screens.value?.sm === true);

const { tableFilterRef, tableWaitFilterRef, tableFilterFn } = tableCustomFilter;

const { sortOrderOf, pagination, handleTableChange } = useTableBehavior("DownloadHistory", {
  defaultPageSize: 10,
  size: "small",
});

const columns = computed<TableColumnsType<ITorrentDownloadMetadata>>(() => [
  { title: t("common.site"), key: "siteId", align: "center", width: 96 },
  {
    title: t("DownloadHistory.table.title"),
    key: "title",
    align: "left",
    ellipsis: true,
    ...(isNarrow.value ? { width: 260 } : {}),
  },
  { title: t("DownloadHistory.table.downloader"), key: "downloaderId", align: "left", width: 200 },
  {
    title: t("DownloadHistory.table.downloadAt"),
    dataIndex: "downloadAt",
    key: "downloadAt",
    align: "center",
    width: 180,
    sorter: (a, b) => (a.downloadAt ?? 0) - (b.downloadAt ?? 0),
    sortOrder: sortOrderOf("downloadAt"),
  },
  { title: t("DownloadHistory.table.status"), key: "downloadStatus", align: "center", width: 120 },
  { title: t("common.action"), key: "action", align: "center", width: 110 },
]);

/**
 * tableFilterFn 是 Vuetify 时代的签名 `(value, query, item)`，且内部取 `item.raw`。
 * 这里在调用点适配，不去改 useAdvanceFilter（SearchEntity 仍以 Vuetify 方式消费它）。
 */
const filteredItems = computed(() => {
  const list = downloadHistoryList.value as ITorrentDownloadMetadata[];
  if (!tableFilterRef.value.trim()) return list;
  return list.filter((item) => tableFilterFn(item.id, tableFilterRef.value, { raw: item }));
});

const tableSelected = ref<TTorrentDownloadKey[]>([]);

const showAdvanceFilterDialog = ref<boolean>(false);

const showReDownloadSelectDialog = ref<boolean>(false);
const reDownloadTorrentListRef = shallowRef<ITorrentDownloadMetadata[]>([]);

function reDownloadTorrent(downloadHistoryIds: TTorrentDownloadKey[]) {
  const reDownloadTorrentList = [];
  for (const downloadHistoryId of downloadHistoryIds) {
    const history: ITorrentDownloadMetadata = downloadHistory.value[downloadHistoryId];
    if (history) {
      reDownloadTorrentList.push(history);
    }
  }
  reDownloadTorrentListRef.value = reDownloadTorrentList;
  showReDownloadSelectDialog.value = true;
}

const showDeleteDialog = ref<boolean>(false);
const toDeleteIds = ref<TTorrentDownloadKey[]>([]);

async function deleteDownloadHistory(downloadHistoryIds: TTorrentDownloadKey[]) {
  toDeleteIds.value = downloadHistoryIds;
  showDeleteDialog.value = true;
}

async function confirmDeleteDownloadHistory(downloadHistoryId: TTorrentDownloadKey) {
  tableSelected.value = tableSelected.value.filter((id) => id !== downloadHistoryId);
  return await sendMessage("deleteDownloadHistoryById", downloadHistoryId);
}

const showDownloadDetailDialog = ref<boolean>(false);
const downloadDetail = ref<Partial<ITorrentDownloadMetadata>>({});

/**
 * `#bodyCell` 插槽的 record 是 antd 的 AnyObject（各字段 any），直接用它索引
 * downloadStatusMap 会让结果退化成隐式 any。这里集中做一次显式收窄。
 */
function statusOf(record: unknown): IDownloadStatusMeta | undefined {
  const status = (record as ITorrentDownloadMetadata)?.downloadStatus as TTorrentDownloadStatus | undefined;
  return status ? downloadStatusMap[status] : undefined;
}

function viewDownloadDetail(history: ITorrentDownloadMetadata) {
  downloadDetail.value = history;
  showDownloadDetailDialog.value = true;
}

onMounted(() => {
  throttleLoadDownloadHistory();
});

onUnmounted(() => {
  clearWatchingMap();
});
</script>

<template>
  <a-card size="small">
    <template #title>
      <div class="toolbar">
        <a-button type="primary" @click="() => throttleLoadDownloadHistory()"><template #icon><SyncOutlined /></template><span class="ml-1">{{ t('DownloadHistory.refresh') }}</span></a-button>
        <a-divider type="vertical" class="mx-2" />
        <a-button type="primary" :disabled="tableSelected.length === 0" @click="() => reDownloadTorrent(tableSelected)"><template #icon><DownloadOutlined /></template><span class="ml-1">{{ t('DownloadHistory.reDownload') }}</span></a-button>
        <a-button danger :disabled="tableSelected.length === 0" @click="deleteDownloadHistory(tableSelected)"><template #icon><MinusOutlined /></template><span class="ml-1">{{ t('common.remove') }}</span></a-button>
        <div class="toolbar-spacer" />
        <a-input
          v-model:value="tableWaitFilterRef"
          allow-clear
          size="small"
          class="toolbar-filter"
          :placeholder="t('DownloadHistory.filterPlaceholder')"
        >
          <template #prefix>
            <FilterOutlined class="filter-trigger" @click="showAdvanceFilterDialog = true" />
          </template>
          <template #suffix>
            <SearchOutlined />
          </template>
        </a-input>
      </div>
    </template>

    <a-table
      :columns="columns"
      :data-source="filteredItems"
      :pagination="pagination"
      :row-selection="{
        selectedRowKeys: tableSelected,
        onChange: (keys: (string | number)[]) => (tableSelected = keys as TTorrentDownloadKey[]),
      }"
      row-key="id"
      size="small"
      :scroll="{ y: 'calc(100vh - 300px)' }"
      @change="handleTableChange"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'siteId'">
          <div class="site-cell">
            <SiteFavicon :site-id="record.siteId" :size="18" />
            <SiteName :site-id="record.siteId" />
          </div>
        </template>

        <template v-else-if="column.key === 'title'">
          <TorrentTitleTd v-if="record.torrent" :item="record.torrent" />
        </template>

        <template v-else-if="column.key === 'downloaderId'">
          <DownloaderLabel :downloader="record.downloaderId" />
        </template>

        <template v-else-if="column.key === 'downloadAt'">
          <span class="text-no-wrap">{{ formatDate(record.downloadAt ?? 0) }}</span>
        </template>

        <template v-else-if="column.key === 'downloadStatus'">
          <a-tag
            v-if="statusOf(record)"
            :color="statusOf(record)!.color"
            class="status-tag"
            @click="() => viewDownloadDetail(record)"
          >
            <component :is="statusOf(record)!.icon" />
            <span class="ml-1">{{ statusOf(record)!.title }}</span>
          </a-tag>
        </template>

        <template v-else-if="column.key === 'action'">
          <a-space :size="0">
            <a-tooltip :title="t('DownloadHistory.reDownload')">
              <a-button size="small" type="text" @click="() => reDownloadTorrent([record.id!])">
                <template #icon>
                  <DownloadOutlined />
                </template>
              </a-button>
            </a-tooltip>
            <a-tooltip :title="t('common.remove')">
              <a-button danger size="small" type="text" @click="() => deleteDownloadHistory([record.id!])">
                <template #icon>
                  <DeleteOutlined />
                </template>
              </a-button>
            </a-tooltip>
          </a-space>
        </template>
      </template>
    </a-table>
  </a-card>

  <ReDownloadSelectDialog
    v-model="showReDownloadSelectDialog"
    :torrent-items="reDownloadTorrentListRef"
    @re-download-complete="() => throttleLoadDownloadHistory()"
  />

  <AdvanceFilterGenerateDialog v-model="showAdvanceFilterDialog" />

  <DeleteDialog
    v-model="showDeleteDialog"
    :to-delete-ids="toDeleteIds"
    :confirm-delete="confirmDeleteDownloadHistory"
    @all-delete="() => throttleLoadDownloadHistory()"
  />

  <a-modal v-model:open="showDownloadDetailDialog" :width="800" :footer="null">
    <template #title>{{ t("DownloadHistory.table.status") }}</template>
    <a-alert
      v-if="downloadDetail.errorMessage"
      class="mb-3"
      type="error"
      show-icon
      :message="t('DownloadHistory.detail.errorMessage')"
      :description="downloadDetail.errorMessage"
    />
    <pre class="detail-json">{{ JSON.stringify(downloadDetail, null, 2) }}</pre>
  </a-modal>
</template>

<style scoped lang="scss">
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toolbar-spacer {
  flex: 1 1 0;
}

.toolbar-filter {
  max-width: 360px;
}

.filter-trigger {
  cursor: pointer;
}

.site-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.status-tag {
  cursor: pointer;
  display: inline-flex;
  align-items: center;
}

.detail-json {
  max-height: 50vh;
  overflow: auto;
  font-size: 12px;
}
</style>
