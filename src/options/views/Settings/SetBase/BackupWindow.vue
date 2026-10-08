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
import { InboxOutlined, KeyOutlined, RollbackOutlined } from "@antdv-next/icons";

import { useConfigStore } from "@/options/stores/config.ts";
import type { IPtppDumpUserInfo } from "@/shared/types.ts";

import RestorePtppUserDataDialog from "./RestorePtppUserDataDialog.vue";

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
const parsedPtppUserData = shallowRef<IPtppDumpUserInfo>();

async function loadPTPPBackupFile(file: File) {
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
  } catch {
    message.error(t("SetBase.BackupWindow.invalidFileFormat"));
  }
}

/**
 * 导入的触发点。上游那份是 v-file-input 的 `@update:model-value="loadPTPPBackupFile"`，
 * antdv-next 的 a-upload 没有对应事件：beforeUpload 返回 false 时 rc-upload 不建条目，
 * change 事件里的 fileList 也就取不到 File（同仓 PushToDownloaderDialog.vue 记过同一件事），
 * 所以在这里直接把 File 接住。返回 false 表示不发任何上传请求。
 */
function pickPtppFile(file: File) {
  void loadPTPPBackupFile(file);
  return false;
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
          <a-space-compact>
            <a-input-password
              v-model:value="encryptionKey"
              class="key-input"
              :placeholder="t('SetBase.BackupWindow.encryptionKeyPlaceholder')"
              autocomplete="new-password"
            />
            <a-tooltip :title="t('SetBase.BackupWindow.randomKeyTooltip')">
              <a-button @click="randomEncryptionKey">
                <template #icon>
                  <KeyOutlined />
                </template>
                {{ t("SetBase.BackupWindow.randomKey") }}
              </a-button>
            </a-tooltip>
            <a-tooltip v-if="history.length > 1" :title="t('SetBase.BackupWindow.undoKeyTooltip')">
              <a-button @click="undoEncryptionKey">
                <template #icon>
                  <RollbackOutlined />
                </template>
                {{ t("SetBase.BackupWindow.undo") }}
              </a-button>
            </a-tooltip>
          </a-space-compact>
        </a-form-item>
      </div>

      <div class="group">
        <div class="group-title">{{ t("SetBase.BackupWindow.groupImportPtpp") }}</div>
        <a-alert class="import-alert" type="info" show-icon>
          <template #message>{{ t("SetBase.BackupWindow.importPtppMessage") }}</template>
          <template #description>
            <div class="steps-lead">{{ t("SetBase.BackupWindow.importPtppStepsLead") }}</div>
            <ol class="import-steps">
              <li>{{ t("SetBase.BackupWindow.importPtppStep1") }}</li>
              <li>{{ t("SetBase.BackupWindow.importPtppStep2") }}</li>
              <li>{{ t("SetBase.BackupWindow.importPtppStep3") }}</li>
            </ol>
          </template>
        </a-alert>
        <a-upload-dragger
          class="ptpp-dragger"
          accept="application/zip, application/json"
          :max-count="1"
          :show-upload-list="false"
          :before-upload="pickPtppFile"
        >
          <p class="drop-icon">
            <InboxOutlined />
          </p>
          <p class="drop-title">{{ t("SetBase.BackupWindow.dropTitle") }}</p>
          <p class="drop-hint">{{ t("SetBase.BackupWindow.dropHint") }}</p>
        </a-upload-dragger>
      </div>
    </a-form>

    <RestorePtppUserDataDialog v-model="showRestorePtppUserDataDialog" :ptpp-user-data="parsedPtppUserData!" />
  </div>
</template>

<style scoped>
/* 与同目录 NativeBridgeWindow 同一档：控件收进 720 这一列。
   不然三步说明被整条 1280 竖栏拉成一行读到头。这一列由 SetBase/Index.vue 那条
   `.set-base .backup-window { margin-inline: auto }` 居中，不贴竖栏左沿。 */
.backup-window {
  max-width: 720px;
}

.key-input {
  flex: 1 1 auto;
  min-width: 0;
}

.import-alert {
  margin-bottom: 12px;
}

.steps-lead {
  margin: 6px 0 2px;
}

/* 编号交给 ol：文案里手写「1.」的话，条目换行时编号会和文字一起缩进，对不齐 */
.import-steps {
  margin: 0;
  padding-inline-start: 20px;
}

.import-steps li {
  margin-block-end: 4px;
}

.ptpp-dragger .drop-icon {
  margin: 0 0 8px;
  font-size: 32px;
  line-height: 1;
}

.drop-title {
  margin: 0 0 4px;
}

.drop-hint {
  margin: 0;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
}
</style>
