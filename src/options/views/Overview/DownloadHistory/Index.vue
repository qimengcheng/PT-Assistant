<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, useTemplateRef } from "vue";
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
  isLoadingHistory,
  throttleLoadDownloadHistory,
  type IDownloadStatusMeta,
} from "./utils.ts"; // <-- 主要方法

const { t } = useI18n();
const configStore = useConfigStore();
const pagePanel = useTemplateRef<HTMLDivElement>("pagePanel");

const { tableFilterRef, tableWaitFilterRef, tableFilterFn } = tableCustomFilter;

const { sortOrderOf, pagination, handleTableChange } = useTableBehavior("DownloadHistory", {
  defaultPageSize: 10,
  size: "small",
  // 一页放得下就不出分页条（用户 2026-10-07：条数少的时候不要启用分页）
  totalRows: () => filteredItems.value.length,
  // 每页条数按面板实高算（用户 2026-10-08：「既不能出现滚动条又要把页面铺满」）
  autoFit: { container: () => pagePanel.value, rows: () => filteredItems.value },
});

const columns = computed<TableColumnsType<ITorrentDownloadMetadata>>(() => [
  { title: t("common.site"), key: "siteId", align: "center", width: 96 },
  {
    title: t("DownloadHistory.table.title"),
    key: "title",
    align: "left",
    // 故意不给 width：本页 tableLayout 是 fixed（标题列带 ellipsis 就会进那一档），
    // 只有留一个没有宽度的列，它才吃得到剩下的全部宽度。
    // 原先这里写的是 `...(isNarrow ? { width: 260 } : {})`，而 isNarrow 判的是
    // `screens.xs || screens.sm` —— antd 的 sm 是 `(min-width: 576px)`，**不是**「576~767」，
    // 所以桌面宽度下恒为 true，260 永远在。所有列都定了宽度之后，fixed 布局会把它们
    // 按比例一起放大去填满容器（实测 1812px 的容器 ÷ 1026px 的列宽合计 = 1.77 倍：
    // 站点 96→169、下载状态 120→211），标题列反而被压成 260。
    ellipsis: true,
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
  // 一格内容 = 一个 a-tag（图标 14 + 间距 8 + 最长「已完成」3 字 42 + 标签内衬 16）+ 单元格内衬 16 ≈ 96
  { title: t("DownloadHistory.table.status"), key: "downloadStatus", align: "center", width: 104 },
  // 两颗 small 图标按钮（各 ≈28）+ a-space 无间隙 + 单元格内衬 16 ≈ 72，留到 96 防换行撑高行
  { title: t("common.action"), key: "action", align: "center", width: 96 },
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
  <div class="page">
    <a-flex align="center" gap="small" wrap justify="space-between" class="page-bar">
      <a-flex align="center" gap="small" wrap>
        <a-button type="primary" :loading="isLoadingHistory" @click="() => throttleLoadDownloadHistory()"><template #icon><SyncOutlined /></template><span>{{ t('DownloadHistory.refresh') }}</span></a-button>
        <a-button :disabled="tableSelected.length === 0" @click="() => reDownloadTorrent(tableSelected)"><template #icon><DownloadOutlined /></template><span>{{ t('DownloadHistory.reDownload') }}</span></a-button>
        <a-button type="primary" danger :disabled="tableSelected.length === 0" @click="deleteDownloadHistory(tableSelected)"><template #icon><MinusOutlined /></template><span>{{ t('common.remove') }}</span></a-button>
      </a-flex>

      <!-- 筛选框独立成右组：原来吃 a-card 的 extra 定位，换成网格骨架后要自己靠右 -->
      <div class="page-bar-extra">
        <a-input
          v-model:value="tableWaitFilterRef"
          allow-clear
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
    </a-flex>

    <div ref="pagePanel" class="page-panel">
    <a-table
      bordered
      :columns="columns"
      :data-source="filteredItems"
      :loading="isLoadingHistory"
      :pagination="pagination"
      :row-selection="{
        selectedRowKeys: tableSelected,
        onChange: (keys: (string | number)[]) => (tableSelected = keys as TTorrentDownloadKey[]),
      }"
      row-key="id"
      size="small"
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
          <!-- 图标必须走 #icon 插槽：antd 的 Tag 只取默认插槽的**第一个**子节点
               （`filterEmpty(slots.default())[0]`），把图标当默认子节点写会让后面的文字整个被丢掉 -->
          <a-tag
            v-if="statusOf(record)"
            :color="statusOf(record)!.color"
            class="status-tag"
            @click="() => viewDownloadDetail(record)"
          >
            <template #icon><component :is="statusOf(record)!.icon" /></template>
            {{ statusOf(record)!.title }}
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
              <a-button danger size="small" type="primary" @click="() => deleteDownloadHistory([record.id!])">
                <template #icon>
                  <DeleteOutlined />
                </template>
              </a-button>
            </a-tooltip>
          </a-space>
        </template>
      </template>
    </a-table>
    </div>
  </div>

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

  <a-modal v-model:open="showDownloadDetailDialog" :title="t('DownloadHistory.table.status')" :width="800" :footer="null">
    <a-alert
      v-if="downloadDetail.errorMessage"
      class="mb-3"
      type="error"
      show-icon
      :title="t('DownloadHistory.detail.errorMessage')"
      :description="downloadDetail.errorMessage"
    />
    <pre class="detail-json">{{ JSON.stringify(downloadDetail, null, 2) }}</pre>
  </a-modal>
</template>

<style scoped lang="scss">
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
