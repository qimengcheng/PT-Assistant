<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, useTemplateRef } from "vue";
import { useI18n } from "vue-i18n";
import {
  DeleteOutlined,
  DownloadOutlined,
  FilterOutlined,
  MinusOutlined,
  SearchOutlined,
  SyncOutlined,
} from "@antdv-next/icons";
import type { TableColumnsType } from "antdv-next";

import { sendMessage } from "@/messages.ts";
import { useTableBehavior } from "@/options/directives/useTableBehavior.ts";
import { formatDate } from "@/options/utils.ts";
import type {
  ITorrentDownloadMetadata,
  TTorrentDownloadKey,
  TTorrentDownloadStatus,
} from "@/shared/types.ts";

import SiteFavicon from "@/options/components/SiteFavicon/Index.vue";
import SiteName from "@/options/components/SiteName.vue";
import TorrentTitleTd from "@/options/components/TorrentTitleTd.vue";
import DeleteDialog from "@/options/components/DeleteDialog.vue";
import HoverTip from "@/options/components/HoverTip.vue";
import DownloaderLabel from "@/options/components/DownloaderLabel.vue";
import ReDownloadSelectDialog from "./ReDownloadSelectDialog.vue";
import AdvanceFilterGenerateDialog from "./AdvanceFilterGenerateDialog.vue";

import {
  downloadHistory,
  downloadHistoryList,
  downloadStatusMap,
  triggerMetaOf,
  tableCustomFilter,
  clearWatchingMap,
  isLoadingHistory,
  throttleLoadDownloadHistory,
  type IDownloadTagMeta,
} from "./utils.ts"; // <-- 主要方法

const { t } = useI18n();
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
  // 同一套预算，两头各量一次：中文最长是「未记录」（台架实量标签 62.6），英文最长是「Not recorded」（91.7），
  // 加上单元格左右内衬各 8 → 132 都装得下（富余 12.5~40）。按更宽的那一头给。
  { title: t("DownloadHistory.table.trigger"), key: "trigger", align: "center", width: 132 },
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

/**
 * 「选中全部失败记录」吃的是**当前过滤结果**，不是整张表：过滤框已经能把范围收到某一个站、
 * 一段时间，那一句「全选错误的」要在这个范围里才说得出意思。
 *
 * 一次给全而不是按当前页 —— 这一页 11 条 / 几百页，逐页勾等于没做。
 */
const failedIds = computed<TTorrentDownloadKey[]>(() =>
  filteredItems.value
    .filter(
      (item): item is ITorrentDownloadMetadata & { id: TTorrentDownloadKey } =>
        item.downloadStatus === "failed" && typeof item.id === "number",
    )
    .map((item) => item.id),
);

const selectedIdSet = computed(() => new Set(tableSelected.value));

/** 全中 → 勾上；一条没中 → 空；中了一部分（他自己又勾过别的页）→ 半选，与列表页那套三态口径一致 */
const allFailedSelected = computed(
  () => failedIds.value.length > 0 && failedIds.value.every((id) => selectedIdSet.value.has(id)),
);
const someFailedSelected = computed(
  () => !allFailedSelected.value && failedIds.value.some((id) => selectedIdSet.value.has(id)),
);

function toggleFailedSelection(checked: boolean) {
  const next = new Set(tableSelected.value);
  for (const id of failedIds.value) {
    if (checked) next.add(id);
    else next.delete(id);
  }
  tableSelected.value = [...next];
}

/**
 * 删除键上带条数：一次选中几千条时，界面上只有当前那一页的十来个勾是看得见的，
 * 没有这个数就没人知道自己究竟按下去了多少条。
 */
const removeLabel = computed(() =>
  tableSelected.value.length > 0
    ? t("DownloadHistory.removeSelected", [tableSelected.value.length])
    : t("common.remove"),
);

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
function statusOf(record: unknown): IDownloadTagMeta | undefined {
  const status = (record as ITorrentDownloadMetadata)?.downloadStatus as TTorrentDownloadStatus | undefined;
  return status ? downloadStatusMap[status] : undefined;
}

/** 同上，另外替「字段缺失」补上未记录那一档（v0.103.0 之前落库的存量与备份导入的老数据都没有 trigger） */
function metaOfTrigger(record: unknown): IDownloadTagMeta {
  return triggerMetaOf((record as ITorrentDownloadMetadata)?.trigger);
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
        <a-button type="primary" danger :disabled="tableSelected.length === 0" @click="deleteDownloadHistory(tableSelected)"><template #icon><MinusOutlined /></template><span>{{ removeLabel }}</span></a-button>
        <!-- 这是一颗复选框而不是第四颗动作键：它是「选中辅助」，不是对数据的动作，
             而且它自己的状态就说清了现在全选完了没有（实心勾 = 全中，半选 = 只中了一部分）。
             吃当前过滤结果，所以先收窄范围再勾上，就只选这一片里的失败记录。 -->
        <a-checkbox
          :checked="allFailedSelected"
          :indeterminate="someFailedSelected"
          :disabled="failedIds.length === 0"
          @update:checked="toggleFailedSelection"
        >
          {{ t("DownloadHistory.selectAllFailed") }}
        </a-checkbox>
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
        // 一次「选中全部失败记录」选的条目远超当前页。antd 在勾选态变化时把选中键过一遍
        // `conductCheck`（实体表由 dataSource + preserve 缓存建），**不在实体表里的键会被整批丢掉** ——
        // 这一页的 dataSource 是整份过滤结果、所以翻页丢不了，但改过滤词之后被滤掉的那几条就丢定了。
        // 打开 preserve 让它们留在键集里（机制见 dist/table/hooks/useSelection.js 的 keyEntities / setSelectedKeys）。
        preserveSelectedRowKeys: true,
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
            class="download-tag status-tag"
            @click="() => viewDownloadDetail(record)"
          >
            <template #icon><component :is="statusOf(record)!.icon" /></template>
            {{ t(statusOf(record)!.titleKey) }}
          </a-tag>
        </template>

        <template v-else-if="column.key === 'trigger'">
          <!-- 这一档只说「记录里有没有写明是谁发起的」，不替存量数据编一个来源：
               自动辅种与辅种任务页的手动发送落到库里的 addTorrentOptions 一字不差，反推只会一半标错。
               「未记录」那一条挂一句说明，告诉他这一档是从哪一版才开始有的。 -->
          <HoverTip :text="record.trigger ? undefined : t('DownloadHistory.trigger.unknownHint')">
            <a-tag :color="metaOfTrigger(record).color" class="download-tag">
              <template #icon><component :is="metaOfTrigger(record).icon" /></template>
              {{ t(metaOfTrigger(record).titleKey) }}
            </a-tag>
          </HoverTip>
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
  >
    <template #append-text>
      <!-- 一次能勾上千条，所以这句要紧：这一页的「删除」只删扩展自己存的那条历史记录，
           下载器里的种子、已经落盘的数据都不动 —— 那是「我的下载器」那一页的动作。 -->
      <div class="delete-scope">{{ t("DownloadHistory.dialog.recordOnly") }}</div>
    </template>
  </DeleteDialog>

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
}

// 「下载状态」与「发起方式」是相邻两列、同一族标签，排版必须一套（这层 flex 只为把 #icon
// 的图标与文字摆在同一条线上）。cursor 单独挂在可点的那一列上，别让它骗人说发起方式也能点。
.download-tag {
  display: inline-flex;
  align-items: center;
}

.detail-json {
  max-height: 50vh;
  overflow: auto;
  font-size: 12px;
}

// 确认框里那句「只删记录、不动种子」的说明，与全站确认框的次级说明同档（12px 灰字）
.delete-scope {
  margin-top: 4px;
  color: rgba(0, 0, 0, 0.45);
  font-size: 12px;
}
</style>
