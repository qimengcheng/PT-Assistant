<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { computed, ref, shallowRef } from "vue";
import type { IBackupFileInfo } from "@ptd/backupServer";
import type { TableColumnsType, TableRowSelection } from "antdv-next";
import { CloudDownloadOutlined, DeleteOutlined } from "@antdv-next/icons";

import { sendMessage } from "@/messages.ts";
import { formatDate, formatSize } from "@/options/utils.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";

import DeleteDialog from "@/options/components/DeleteDialog.vue";
import RestoreDialog from "./RestoreDialog.vue";

const showDialog = defineModel<boolean>();
const { backupServerId } = defineProps<{
  backupServerId: string;
}>();

const { t } = useI18n();
const metadataStore = useMetadataStore();
const runtimeStore = useRuntimeStore();

const isLoading = ref<boolean>(false);
const backupHistory = shallowRef<IBackupFileInfo[]>([]);

// antd 的列定义：title / dataIndex / key / align / sorter（不再用 vuetify 的 DataTableHeader）
const tableHeaders: TableColumnsType<IBackupFileInfo> = [
  { title: t("SetBackup.HistoryDialog.table.filename"), key: "filename", dataIndex: "filename", align: "left" },
  { title: t("SetBackup.HistoryDialog.table.size"), key: "size", dataIndex: "size", align: "right" },
  {
    title: t("SetBackup.HistoryDialog.table.time"),
    key: "time",
    dataIndex: "time",
    align: "left",
    // 原来是 :sort-by="[{ key: 'time', order: 'desc' }]" + must-sort
    sorter: (a, b) => a.time - b.time,
    defaultSortOrder: "descend",
  },
  { title: t("common.action"), key: "action", align: "center" },
];

const tableSelected = ref<string[]>([]);
/** a-table 没有 v-model:selectedRowKeys，行选择要显式给 row-selection */
const rowSelection = computed<TableRowSelection<IBackupFileInfo>>(() => ({
  selectedRowKeys: tableSelected.value,
  onChange: (keys) => {
    tableSelected.value = keys.map(String);
  },
}));

const showRestoreDialog = ref<boolean>(false);
const restoreMetadata = ref<{ type: "remote"; server: string; path: string }>({ type: "remote", server: "", path: "" });
function restoreBackup(path: string) {
  restoreMetadata.value = { type: "remote", server: backupServerId, path };
  showRestoreDialog.value = true;
}

const showDeleteDialog = ref<boolean>(false);
const toDeleteBackupHistory = ref<string[]>([]);
async function deleteBackupHistory(paths: string[]) {
  showDeleteDialog.value = true;
  toDeleteBackupHistory.value = paths;
}

async function confirmDeleteBackupHistory(toDeleteId: string) {
  const toDeleteName = backupHistory.value.find((item) => item.path === toDeleteId)?.filename ?? toDeleteId;
  const deleteStatus = await sendMessage("deleteBackupHistory", { path: toDeleteId, backupServerId });
  if (!deleteStatus) {
    runtimeStore.showSnakebar(t("SetBackup.HistoryDialog.deleteFailure", { name: toDeleteName }), { color: "error" });
  } else {
    runtimeStore.showSnakebar(t("SetBackup.HistoryDialog.deleteSuccess", { name: toDeleteName }), { color: "success" });
    backupHistory.value = backupHistory.value.filter((item) => item.path !== toDeleteId);
  }
}

async function loadBackupHistory() {
  isLoading.value = true;
  try {
    backupHistory.value = await sendMessage("getBackupHistory", backupServerId);
  } catch (e) {
    console.error("获取备份历史失败", e);
  } finally {
    isLoading.value = false;
  }
}

async function dialogEnter() {
  // noinspection ES6MissingAwait
  loadBackupHistory();
}

async function dialogLeave() {
  backupHistory.value = [];
  tableSelected.value = [];
}
</script>

<template>
  <a-modal
    v-model:open="showDialog"
    :title="
      t('SetBackup.HistoryDialog.title', {
        name: metadataStore.backupServers[backupServerId].name ?? backupServerId,
      })
    "
    :width="1000"
    :after-open-change="(open: boolean) => open && dialogEnter()"
    :after-close="dialogLeave"
  >

    <a-button danger :disabled="tableSelected.length === 0" @click="deleteBackupHistory(tableSelected)"><template #icon><DeleteOutlined /></template><span class="ml-1">{{ t('common.remove') }}</span></a-button>

    <a-table
      :columns="tableHeaders"
      :data-source="backupHistory"
      :row-key="(record: IBackupFileInfo) => record.path"
      :row-selection="rowSelection"
      :loading="isLoading"
      :pagination="false"
      class="table-stripe table-header-no-wrap"
      size="small"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'size'">
          <span class="text-no-wrap">
            {{ record.size !== "N/A" ? formatSize(record.size) : record.size }}
          </span>
        </template>

        <template v-else-if="column.key === 'time'">
          <span class="text-no-wrap">{{ formatDate(record.time) }}</span>
        </template>

        <template v-else-if="column.key === 'action'">
          <a-space>
            <a-button
              type="text"
              color="blue"
              size="small"
              :title="t('SetBackup.HistoryDialog.restore')"
              @click="restoreBackup(record.path)"
            >
              <template #icon>
                <CloudDownloadOutlined />
              </template>
            </a-button>

            <a-button
              type="text"
              color="danger"
              size="small"
              :title="t('common.remove')"
              @click="deleteBackupHistory([record.path])"
            >
              <template #icon>
                <DeleteOutlined />
              </template>
            </a-button>
          </a-space>
        </template>
      </template>
    </a-table>
  </a-modal>

  <RestoreDialog v-model="showRestoreDialog" :restore-metadata="restoreMetadata" />
  <DeleteDialog
    v-model="showDeleteDialog"
    :confirm-delete="confirmDeleteBackupHistory"
    :to-delete-ids="toDeleteBackupHistory"
    @all-delete="loadBackupHistory"
  />
</template>

<style scoped lang="scss"></style>