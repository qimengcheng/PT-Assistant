<script setup lang="ts">
/**
 * 备份基础设置：备份加密密钥 + PT-Plugin-Plus 旧数据导入入口。
 */
import JSZip from "jszip";
import { nanoid } from "nanoid";
import { ref, shallowRef, watch } from "vue";
import { useThrottledRefHistory } from "@vueuse/core";
import { message } from "antdv-next";
import { KeyOutlined, RollbackOutlined } from "@antdv-next/icons";

import { useConfigStore } from "@/options/stores/config.ts";
import type { IPtppDumpUserInfo } from "@/shared/types.ts";

import RestorePtppUserDataDialog from "./RestorePtppUserDataDialog.vue";

import { REPO_NAME } from "~/helper.ts";

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
    message.error("文件格式无效：请选择 PT-Plugin-Plus 导出的备份 zip（内含 userdatas.json）或该 json 文件本身");
  } finally {
    ptppUserDataFile.value = [];
  }
}
</script>

<template>
  <div class="backup-window">
    <a-form layout="vertical" class="compact-form">
      <div class="group">
        <div class="group-title">备份加密</div>
        <a-form-item label="备份文件加密密钥" extra="导出与远程备份将使用该密钥加密（AES），恢复时需要填写相同密钥。留空表示不加密。">
          <a-space>
            <a-input-password
              v-model:value="encryptionKey"
              placeholder="留空则不加密"
              style="width: 320px"
              autocomplete="new-password"
            />
            <a-tooltip title="随机生成一个密钥">
              <a-button @click="randomEncryptionKey">
                <KeyOutlined /> 随机生成
              </a-button>
            </a-tooltip>
            <a-tooltip v-if="history.length > 1" title="撤销到上一个密钥">
              <a-button @click="undoEncryptionKey">
                <RollbackOutlined /> 撤销
              </a-button>
            </a-tooltip>
          </a-space>
        </a-form-item>
      </div>

      <div class="group">
        <div class="group-title">导入 PT-Plugin-Plus 用户数据</div>
        <a-alert class="mb-2" type="info" show-icon>
          <template #message>
            将 PT-Plugin-Plus 导出的备份中的用户数据导入到本扩展（站点需在 340 个内置定义中）。
          </template>
          <template #description>
            1. 在 PT-Plugin-Plus 中打开「备份 &amp; 恢复」→ 导出备份（zip），或直接使用其 userdatas.json；<br />
            2. 在下方选择该文件；<br />
            3. 在弹出的窗口中勾选要导入的站点并确认导入。
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
            选择 PT-Plugin-Plus 备份文件（zip 或 userdatas.json）
          </a-button>
        </a-upload>
      </div>
    </a-form>

    <RestorePtppUserDataDialog v-model="showRestorePtppUserDataDialog" :ptpp-user-data="parsedPtppUserData!" />
  </div>
</template>
