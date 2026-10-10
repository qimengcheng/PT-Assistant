<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { CloseCircleOutlined, ExportOutlined } from "@antdv-next/icons";
import { message } from "antdv-next";

import { BackupFields, type TBackupFields } from "@/shared/types.ts";
import { sendMessage } from "@/messages.ts";

const showDialog = defineModel<boolean>();
const { t } = useI18n();

const backupFields = ref<TBackupFields[]>([]);

const exporting = ref(false);

async function doLocalExport() {
  // ⚠️ 原来这里既不 await 也不 catch、OK 键还没有 loading —— 连点就是并发导出，
  // 抛错时既没有提示也不关窗（弹窗停在那儿，用户不知道成没成）。
  if (exporting.value) return;
  if (backupFields.value.length === 0) {
    message.warning(t("SetBackup.LocalExportConfirmDialog.selectAtLeastOne"));
    return;
  }

  exporting.value = true;
  try {
    const ok = await sendMessage("exportBackupData", {
      backupFields: backupFields.value,
      backupServerId: "local",
    });
    if (ok) {
      message.success(t("SetBackup.LocalExportConfirmDialog.exported"));
      showDialog.value = false;
    } else {
      message.error(t("SetBackup.LocalExportConfirmDialog.exportFailed"));
    }
  } catch (e) {
    message.error(t("SetBackup.LocalExportConfirmDialog.exportFailed"));
    console.error("[SetBackup] local export failed", e);
  } finally {
    exporting.value = false;
  }
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
    :after-open-change="(open: boolean) => open && dialogEnter()"
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
      <a-flex justify="flex-end" align="center" gap="small">
        <a-button color="danger" variant="text" @click="showDialog = false">
          <template #icon>
            <CloseCircleOutlined />
          </template>
          {{ t("common.dialog.cancel") }}
        </a-button>
        <a-button type="primary" :loading="exporting" :disabled="backupFields.length === 0" @click="doLocalExport">
          <template #icon>
            <ExportOutlined />
          </template>
          {{ t("common.export") }}
        </a-button>
      </a-flex>
    </template>
  </a-modal>
</template>