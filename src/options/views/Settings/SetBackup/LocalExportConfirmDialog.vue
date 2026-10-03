<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { CloseCircleOutlined, ExportOutlined } from "@antdv-next/icons";

import { BackupFields, TBackupFields } from "@/shared/types.ts";
import { sendMessage } from "@/messages.ts";

const showDialog = defineModel<boolean>();
const { t } = useI18n();

const backupFields = ref<TBackupFields[]>([]);

async function doLocalExport() {
  await sendMessage("exportBackupData", { backupFields: backupFields.value, backupServerId: "local" });
}

function dialogEnter() {
  backupFields.value = [...BackupFields];
}
</script>

<template>
  <a-modal
    v-model:open="showDialog"
    :title="t('SetBackup.LocalExportConfirmDialog.title')"
    :width="600"
    @after-open-change="(open: boolean) => open && dialogEnter()"
  >
    <!-- v-switch + 数组 v-model + :value 是 Vuetify 的复选语义，antd 对应 a-checkbox-group -->
    <a-checkbox-group v-model:value="backupFields">
      <a-row :gutter="[0, 8]">
        <a-col v-for="backupField in BackupFields" :key="backupField" :span="12" :md="6">
          <a-checkbox :value="backupField">
            {{ t(`SetBackup.fields.${backupField}`) }}
          </a-checkbox>
        </a-col>
      </a-row>
    </a-checkbox-group>

    <template #footer>
      <div class="dialog-footer">
        <a-button color="danger" variant="text" @click="showDialog = false">
          <template #icon>
            <CloseCircleOutlined />
          </template>
          {{ t("common.dialog.cancel") }}
        </a-button>
        <a-button color="green" variant="text" @click="() => doLocalExport()">
          <template #icon>
            <ExportOutlined />
          </template>
          {{ t("common.export") }}
        </a-button>
      </div>
    </template>
  </a-modal>
</template>

<style scoped lang="scss">
/* 底部操作按钮统一右对齐 */
.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>