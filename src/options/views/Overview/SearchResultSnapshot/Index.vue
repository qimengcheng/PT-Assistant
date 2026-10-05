<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { refDebounced } from "@vueuse/core";
import {
  DeleteOutlined,
  EditOutlined,
  FileSearchOutlined,
  MinusOutlined,
  SearchOutlined,
} from "@antdv-next/icons";
import type { TableColumnsType } from "antdv-next";

import { useTableBehavior } from "@/options/directives/useTableBehavior.ts";
import { formatDate } from "@/options/utils.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import { type ISearchSnapshotMetadata, type TSearchSnapshotKey } from "@/shared/types.ts";

import DeleteDialog from "@/options/components/DeleteDialog.vue";
import EditNameDialog from "./EditNameDialog.vue";

const { t } = useI18n();
const router = useRouter();
const metadataStore = useMetadataStore();

const showEditNameDialog = ref<boolean>(false);
const showDeleteDialog = ref<boolean>(false);

const tableSelected = ref<TSearchSnapshotKey[]>([]);
const tableWaitFilter = ref("");
const tableFilter = refDebounced(tableWaitFilter, 500); // 延迟搜索过滤词的生成

const { sortOrderOf, pagination, handleTableChange } = useTableBehavior("SearchResultSnapshot", {
  defaultPageSize: 25,
  size: "small",
  showTotal: (total: number) => `${total}`,
});

const columns = computed<TableColumnsType<ISearchSnapshotMetadata>>(() => [
  {
    title: t("SearchResultSnapshot.table.header.name"),
    dataIndex: "name",
    key: "name",
    align: "left",
    sorter: (a, b) => a.name.localeCompare(b.name),
    sortOrder: sortOrderOf("name"),
  },
  {
    title: t("SearchResultSnapshot.table.header.recordCount"),
    dataIndex: "recordCount",
    key: "recordCount",
    align: "right",
    width: 100,
    sorter: (a, b) => a.recordCount - b.recordCount,
    sortOrder: sortOrderOf("recordCount"),
  },
  {
    title: t("SearchResultSnapshot.table.header.createdAt"),
    dataIndex: "createdAt",
    key: "createdAt",
    align: "center",
    width: 180,
    sorter: (a, b) => a.createdAt - b.createdAt,
    sortOrder: sortOrderOf("createdAt"),
  },
  {
    title: t("common.action"),
    key: "action",
    align: "center",
    width: 140,
  },
]);

const filteredItems = computed(() => {
  const list = metadataStore.getSearchSnapshotList as ISearchSnapshotMetadata[];
  const keyword = tableFilter.value.trim().toLowerCase();
  if (!keyword) return list;
  return list.filter((item) => item.name.toLowerCase().includes(keyword));
});

function viewSnapshot(searchSnapshotId: TSearchSnapshotKey) {
  router.push({
    name: "SearchEntity",
    query: {
      snapshot: searchSnapshotId,
    },
  });
}

const toEditId = ref<TSearchSnapshotKey | null>(null);
function editSnapshotName(searchSnapshotId: TSearchSnapshotKey) {
  toEditId.value = searchSnapshotId;
  showEditNameDialog.value = true;
}

const toDeleteIds = ref<TSearchSnapshotKey[]>([]);
function tryToDeleteSearchSnapshot(searchSnapshotId: TSearchSnapshotKey[]) {
  toDeleteIds.value = searchSnapshotId;
  showDeleteDialog.value = true;
}

async function confirmDeleteSearchSnapshot(searchSnapshotId: TSearchSnapshotKey) {
  tableSelected.value = tableSelected.value.filter((id) => id !== searchSnapshotId);
  return await metadataStore.removeSearchSnapshotData(searchSnapshotId);
}
</script>

<template>
  <a-card size="small">
    <!-- 筛选框走 a-card 的 extra：在卡片右上角固定，不随内容滚动 -->
    <template #extra>
      <a-input
        v-model:value="tableWaitFilter"
        allow-clear
        size="small"
        class="toolbar-filter"
        :placeholder="t('SearchResultSnapshot.table.filterLabel')"
      >
        <template #prefix>
          <SearchOutlined />
        </template>
      </a-input>
    </template>

        <template #title>
      <a-button danger :disabled="tableSelected.length === 0" @click="tryToDeleteSearchSnapshot(tableSelected)"><template #icon><MinusOutlined /></template><span>{{ t('common.remove') }}</span></a-button>
    </template>

    <a-table
      :columns="columns"
      :data-source="filteredItems"
      :pagination="pagination"
      :row-selection="{
        selectedRowKeys: tableSelected,
        onChange: (keys: (string | number)[]) => (tableSelected = keys as TSearchSnapshotKey[]),
      }"
      row-key="id"
      size="small"
      :scroll="{ y: 'calc(100vh - 300px)' }"
      @change="handleTableChange"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'createdAt'">
          <span class="text-no-wrap">{{ formatDate(record.createdAt) }}</span>
        </template>
        <template v-else-if="column.key === 'action'">
          <a-space :size="0">
            <a-tooltip :title="t('SearchResultSnapshot.table.action.view')">
              <a-button size="small" type="text" @click="viewSnapshot(record.id)">
                <template #icon>
                  <FileSearchOutlined />
                </template>
              </a-button>
            </a-tooltip>
            <a-tooltip :title="t('SearchResultSnapshot.table.action.editTitle')">
              <a-button size="small" type="text" @click="editSnapshotName(record.id)">
                <template #icon>
                  <EditOutlined />
                </template>
              </a-button>
            </a-tooltip>
            <a-tooltip :title="t('common.remove')">
              <a-button danger size="small" type="text" @click="tryToDeleteSearchSnapshot([record.id])">
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

  <EditNameDialog v-model="showEditNameDialog" :edit-id="toEditId!" />
  <DeleteDialog v-model="showDeleteDialog" :to-delete-ids="toDeleteIds" :confirm-delete="confirmDeleteSearchSnapshot" />
</template>

<style scoped lang="scss">
.toolbar-filter {
  max-width: 320px;
}
</style>
