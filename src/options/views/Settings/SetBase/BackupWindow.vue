<script setup lang="ts">
/**
 * 备份基础设置：备份加密密钥 + PT-Plugin-Plus 旧数据导入入口。
 */
import JSZip from "jszip";
import { nanoid } from "nanoid";
import { ref, shallowRef, watch } from "vue";
import { useThrottledRefHistory } from "@vueuse/core";
import { useI18n } from "vue-i18n";
import { message } from "antdv-next";
import { KeyOutlined, RollbackOutlined } from "@antdv-next/icons";

import { useConfigStore } from "@/options/stores/config.ts";
import type { IPtppDumpUserInfo } from "@/shared/types.ts";

import RestorePtppUserDataDialog from "./RestorePtppUserDataDialog.vue";

import { REPO_NAME } from "~/helper.ts";

const { t } = useI18n();
const configStore = useConfigStore();

const encryptionKey = shallowRef<string>(configStore.backup.encryptionKey);
const { history, undo: undoEncryptionKey } = useThrottledRefHistory(encryptionKey, { throttle: 50 });
watch(encryptionKey, (newValue) => {
  configStore.backup.encryptionKey = newValue; // 将 encryptionKey 同步回 configStore
});

function randomEncryptionKey() {
  encryptionKey.value = nanoid();
}

// ===== PT-Plugin-Plus 旧数据导入 =====
const showRestorePtppUserDataDialog = ref<boolean>(false);
const ptppUserDataFile = ref<File[]>([]);
const parsedPtppUserData = shallowRef<IPtppDumpUserInfo>();

async function loadPTPPBackupFile() {
  const file = ptppUserDataFile.value?.[0];
  if (!(file instanceof File)) return;

  let ptppUserDataFileRawContent: string | undefined;
  if (file.name.match(/^PT-Plugin-Plus-Backup-.+\.zip$/)) {
    const zip = new JSZip();
    const zipContent = await zip.loadAsync(file);
    ptppUserDataFileRawContent = (await zipContent.file("userdatas.json")?.async("string")) || undefined;
  } else if (file.name === "userdatas.json") {
    ptppUserDataFileRawContent = await file.text();
  }

  try {
    if (!ptppUserDataFileRawContent || !ptppUserDataFileRawContent.startsWith("{")) {
      throw new Error("Invalid file format");
    }
    parsedPtppUserData.value = JSON.parse(ptppUserDataFileRawContent);
    showRestorePtppUserDataDialog.value = true;
  } catch (e) {
    message.error(t("SetBase.BackupWindow.invalidFileFormat"));
  } finally {
    ptppUserDataFile.value = [];
  }
}
</script>

<template>
  <div class="backup-window">
    <a-form layout="vertical" class="compact-form">
      <div class="group">
        <div class="group-title">{{ t("SetBase.BackupWindow.groupEncryption") }}</div>
        <a-form-item
          :label="t('SetBase.BackupWindow.encryptionKey')"
          :extra="t('SetBase.BackupWindow.encryptionKeyHint')"
        >
          <a-space>
            <a-input-password
              v-model:value="encryptionKey"
              :placeholder="t('SetBase.BackupWindow.encryptionKeyPlaceholder')"
              style="width: 320px"
              autocomplete="new-password"
            />
            <a-tooltip :title="t('SetBase.BackupWindow.randomKeyTooltip')">
              <a-button @click="randomEncryptionKey">
                <KeyOutlined /> {{ t("SetBase.BackupWindow.randomKey") }}
              </a-button>
            </a-tooltip>
            <a-tooltip v-if="history.length > 1" :title="t('SetBase.BackupWindow.undoKeyTooltip')">
              <a-button @click="undoEncryptionKey">
                <RollbackOutlined /> {{ t("SetBase.BackupWindow.undo") }}
              </a-button>
            </a-tooltip>
          </a-space>
        </a-form-item>
      </div>

      <div class="group">
        <div class="group-title">{{ t("SetBase.BackupWindow.groupImportPtpp") }}</div>
        <a-alert class="mb-2" type="info" show-icon>
          <template #message>{{ t("SetBase.BackupWindow.importPtppMessage") }}</template>
          <template #description>
            {{ t("SetBase.BackupWindow.importPtppStep1") }}<br />
            {{ t("SetBase.BackupWindow.importPtppStep2") }}<br />
            {{ t("SetBase.BackupWindow.importPtppStep3") }}
          </template>
        </a-alert>
        <a-upload
          :max-count="1"
          accept="application/zip, application/json"
          :before-upload="() => false"
          :file-list="ptppUserDataFile"
          @change="(info: any) => (ptppUserDataFile = info.fileList)"
        >
          <a-button>
            {{ t("SetBase.BackupWindow.selectPtppFile") }}
          </a-button>
        </a-upload>
      </div>
    </a-form>

    <RestorePtppUserDataDialog v-model="showRestorePtppUserDataDialog" :ptpp-user-data="parsedPtppUserData!" />
  </div>
</template>
