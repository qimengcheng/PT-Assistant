<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { TableColumnsType, TableRowSelection } from "antdv-next";
import {
  CloudUploadOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  EditOutlined,
  FilterOutlined,
  ImportOutlined,
  MinusOutlined,
  PlusOutlined,
  UnorderedListOutlined,
} from "@antdv-next/icons";
import { getBackupServerIcon } from "@ptd/backupServer";
import { hasBackupRetentionToApply } from "@ptd/backupServer/utils.ts";

import { useMetadataStore } from "@/options/stores/metadata.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { formatDate } from "@/options/utils.ts";
import { BackupFields, type IBackupServerMetadata, type TBackupServerKey } from "@/shared/types.ts";
import { sendMessage } from "@/messages.ts";

import DeleteDialog from "@/options/components/DeleteDialog.vue";
import AddDialog from "./AddDialog.vue";
import EditDialog from "./EditDialog.vue";
import LocalExportConfirmDialog from "./LocalExportConfirmDialog.vue";
import HistoryDialog from "./HistoryDialog.vue";
import RestoreDialog from "./RestoreDialog.vue";

const { t } = useI18n();
const runtimeStore = useRuntimeStore();
const metadataStore = useMetadataStore();

const showAddDialog = ref<boolean>(false);
const showLocalExportConfirmDialog = ref<boolean>(false);
const showHistoryDialog = ref<boolean>(false);
const showEditDialog = ref<boolean>(false);
const showRestoreDialog = ref<boolean>(false);
const showDeleteDialog = ref<boolean>(false);

// antd 的列定义：title / dataIndex / key / align（不再用 vuetify 的 DataTableHeader）
const fullTableHeader: TableColumnsType<IBackupServerMetadata> = [
  { title: t("common.type"), key: "type", dataIndex: "type", align: "center" },
  { title: t("common.name"), key: "name", dataIndex: "name", align: "start" },
  { title: t("SetBackup.table.backupFields"), key: "backupFields", dataIndex: "backupFields", align: "start" },
  { title: t("SetBackup.table.backupInterval"), key: "backupInterval", dataIndex: "backupInterval", align: "center" },
  { title: t("SetBackup.table.retention"), key: "retention", dataIndex: "retention", align: "center" },
  { title: t("SetBackup.table.lastBackupAt"), key: "lastBackupAt", dataIndex: "lastBackupAt", align: "end" },
  { title: t("common.enable"), key: "enabled", dataIndex: "enabled", align: "center" },
  { title: t("common.action"), key: "action", align: "center" },
];

const tableSelected = ref<TBackupServerKey[]>([]);
/** a-table 没有 v-model:selectedRowKeys，行选择要显式给 row-selection */
const rowSelection = computed<TableRowSelection<IBackupServerMetadata>>(() => ({
  selectedRowKeys: tableSelected.value,
  onChange: (keys) => {
    tableSelected.value = keys.map(String);
  },
}));

/** 自动备份间隔（小时），支持小数以表达不足 1 小时的间隔 */
function formatBackupInterval(serverConfig: IBackupServerMetadata): string {
  const interval = serverConfig.backupInterval ?? 0;
  if (!(interval > 0)) {
    return "";
  }
  return t("SetBackup.table.everyNHour", { n: Number(interval.toFixed(2)) });
}

const localBackup = Symbol("localBackup");
const doBackupStatus = ref<Record<TBackupServerKey | symbol, boolean>>({});
async function doBackup(backupServerId: TBackupServerKey | symbol) {
  doBackupStatus.value[backupServerId] = true;

  if (typeof backupServerId == "string") {
    const serverConfig = metadataStore.backupServers[backupServerId];
    const backupFields = serverConfig.backupFields ?? [...BackupFields];
    const backupStatus = await sendMessage("exportBackupData", { backupFields, backupServerId });
    if (backupStatus) {
      // 备份成功后的保留策略清理由 exportBackupData 内部完成，此处仅对启用了保留策略的服务器加以提示
      const hasRetention = hasBackupRetentionToApply(serverConfig?.retention);
      runtimeStore.showSnakebar(
        t(hasRetention ? "SetBackup.snackbar.successWithRetention" : "SetBackup.snackbar.success"),
        {
          color: "success",
        },
      );
    } else {
      runtimeStore.showSnakebar(t("SetBackup.snackbar.failure"), { color: "error" });
    }
  } else if (backupServerId == localBackup) {
    showLocalExportConfirmDialog.value = true;
  } else {
    console.log('"doBackup" without valid backupServerId');
  }

  doBackupStatus.value[backupServerId] = false;
}

const toEditBackupServerId = ref<TBackupServerKey | null>(null);
function editBackupServer(id: TBackupServerKey) {
  toEditBackupServerId.value = id;
  showEditDialog.value = true;
}

const toShowHistoryBackupServerId = ref<TBackupServerKey | null>(null);
function showHistory(id: TBackupServerKey) {
  toShowHistoryBackupServerId.value = id;
  showHistoryDialog.value = true;
}

const toDeleteIds = ref<TBackupServerKey[]>([]);
function deleteBackupServer(ids: TBackupServerKey[]) {
  toDeleteIds.value = ids;
  showDeleteDialog.value = true;
}

async function confirmDeleteBackupServer(id: TBackupServerKey) {
  return await metadataStore.removeBackupServer(id);
}
</script>

<template>
  <a-alert type="info">
    <template #title>{{ t("route.Settings.SetBackup") }}</template>
  </a-alert>

  <a-card class="set-backup">
    <div class="table-toolbar">
      <a-button type="primary" @click="showAddDialog = true"><template #icon><PlusOutlined /></template><span class="ml-1">{{ t('common.btn.add') }}</span></a-button>
      <a-button danger :disabled="tableSelected.length === 0" @click="deleteBackupServer(tableSelected)"><template #icon><MinusOutlined /></template><span class="ml-1">{{ t('common.remove') }}</span></a-button>

      <div class="toolbar-divider" />

      <a-button type="primary" :loading="doBackupStatus[localBackup]" @click="doBackup(localBackup)"><template #icon><DatabaseOutlined /></template><span class="ml-1">{{ t('SetBackup.localExport') }}</span></a-button>
      <a-button type="primary" @click="() => (showRestoreDialog = true)"><template #icon><ImportOutlined /></template><span class="ml-1">{{ t('SetBackup.localImport') }}</span></a-button>

      <div style="flex: 1" />

      <a-input allow-clear placeholder="Search" size="small" style="width: 320px; max-width: 500px" />
    </div>

    <a-table
      :columns="fullTableHeader"
      :data-source="metadataStore.getBackupServers"
      :row-key="(record: IBackupServerMetadata) => record.id"
      :row-selection="rowSelection"
      :pagination="false"
      class="table-stripe table-header-no-wrap"
      size="small"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'type'">
          <img
            class="server-type-icon"
            :src="getBackupServerIcon(record.type)"
            :alt="record.type"
            :title="record.type"
          />
        </template>

        <template v-else-if="column.key === 'backupFields'">
          <a-tag v-for="backupField in record.backupFields" :key="backupField" class="mr-1 mb-1">
            {{ t(`SetBackup.fields.${backupField}`) }}
          </a-tag>
        </template>

        <template v-else-if="column.key === 'backupInterval'">
          <span v-if="record.backupInterval && record.backupInterval > 0" class="text-no-wrap">
            {{ formatBackupInterval(record) }}
          </span>
          <span v-else class="text-disabled">—</span>
        </template>

        <template v-else-if="column.key === 'retention'">
          <FilterOutlined
            class="retention-icon"
            :style="{ color: hasBackupRetentionToApply(record.retention) ? '#52c41a' : undefined }"
            :title="
              hasBackupRetentionToApply(record.retention)
                ? t('SetBackup.table.retentionEnabled')
                : t('SetBackup.table.retentionDisabled')
            "
          />
        </template>

        <template v-else-if="column.key === 'lastBackupAt'">
          {{ record.lastBackupAt ? formatDate(record.lastBackupAt) : "notBackup" }}
        </template>

        <template v-else-if="column.key === 'enabled'">
          <a-switch
            size="small"
            class="table-switch-btn"
            :checked="record.enabled"
            @change="(v: any) => metadataStore.simplePatch('backupServers', record.id, 'enabled', !!v)"
          />
        </template>

        <template v-else-if="column.key === 'action'">
          <a-space>
            <a-button
              type="text"
              color="green"
              size="small"
              :title="t('SetBackup.table.action.backupNow')"
              :loading="doBackupStatus[record.id]"
              @click="doBackup(record.id)"
            >
              <template #icon>
                <CloudUploadOutlined />
              </template>
            </a-button>

            <a-button
              type="text"
              color="blue"
              size="small"
              :title="t('SetBackup.table.action.viewHistoryBackup')"
              @click="showHistory(record.id)"
            >
              <template #icon>
                <UnorderedListOutlined />
              </template>
            </a-button>

            <a-button
              type="text"
              color="blue"
              size="small"
              :title="t('common.edit')"
              @click="editBackupServer(record.id)"
            >
              <template #icon>
                <EditOutlined />
              </template>
            </a-button>

            <a-button
              type="text"
              color="danger"
              size="small"
              :title="t('common.remove')"
              @click="deleteBackupServer([record.id])"
            >
              <template #icon>
                <DeleteOutlined />
              </template>
            </a-button>
          </a-space>
        </template>
      </template>
    </a-table>
  </a-card>

  <AddDialog v-model="showAddDialog" />
  <EditDialog v-model="showEditDialog" :client-id="toEditBackupServerId!" />
  <DeleteDialog v-model="showDeleteDialog" :to-delete-ids="toDeleteIds" :confirm-delete="confirmDeleteBackupServer" />
  <HistoryDialog v-model="showHistoryDialog" :backup-server-id="toShowHistoryBackupServerId!" />
  <LocalExportConfirmDialog v-model="showLocalExportConfirmDialog" />
  <RestoreDialog v-model="showRestoreDialog" :restore-metadata="{ type: 'file' }" />
</template>

<style scoped lang="scss">
.table-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

/* 竖向分隔线（原来是 <v-divider inset vertical>） */
.toolbar-divider {
  width: 1px;
  height: 24px;
  margin: 0 4px;
  background: rgba(0, 0, 0, 0.15);
}

.server-type-icon {
  width: 24px;
  height: 24px;
}

.retention-icon {
  font-size: 16px;
  color: rgba(0, 0, 0, 0.25);
}
</style>