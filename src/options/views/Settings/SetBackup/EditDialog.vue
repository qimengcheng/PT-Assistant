<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { cloneDeep } from "es-toolkit";
import { message } from "antdv-next";
import { CheckCircleOutlined, CloseCircleOutlined } from "@antdv-next/icons";

import { useMetadataStore } from "@/options/stores/metadata.ts";
import type { IBackupServerMetadata, TBackupServerKey } from "@/shared/types.ts";

import Editor from "./Editor.vue";

const showDialog = defineModel<boolean>();
const { clientId } = defineProps<{
  clientId: TBackupServerKey;
}>();
const clientConfig = ref<IBackupServerMetadata>();

const { t } = useI18n();
const metadataStore = useMetadataStore();

const saving = ref(false);

/**
 * Editor 播报的表单有效性（AddDialog 一直吃这条，编辑这条漏了）：
 * 不门控的话，把名称清空照样能存回 store —— 和 SetDownloader/EditDialog 一并收口。
 */
const isFormValid = ref(false);

function dialogEnter() {
  const stored = clientId ? metadataStore.backupServers[clientId] : undefined;
  // ⚠️ 同 SetDownloader/EditDialog：脏 id（服务器被删）时原来仍会挂一个
  // 空 Editor，用户点确定就落库一条空记录。这里显式挡住并关窗。
  if (!stored) {
    clientConfig.value = undefined;
    message.error(t("SetBackup.edit.notFound"));
    showDialog.value = false;
    return;
  }

  // ⚠️ 必须深拷贝：{...store[id]} 只展开顶层，
  // auth / retentionRules 这些嵌套对象与 store 同引用 —— 备份服务器带的是
  // 加密密钥，用户在弹窗里改一个字段再点「取消」，store 里那条密钥就已经变了。
  clientConfig.value = cloneDeep(stored);
}

async function editClientConfig() {
  if (saving.value) return;
  saving.value = true;
  try {
    await metadataStore.addBackupServer(clientConfig.value as IBackupServerMetadata);
    showDialog.value = false;
  } catch (e) {
    message.error(t("SetBackup.edit.saveFailed"));
    console.error("[SetBackup] edit save failed", e);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <a-modal
    v-model:open="showDialog"
    :title="t('SetBackup.edit.title')"
    :width="800"
    :after-open-change="(open: boolean) => open && dialogEnter()"
  >
    <Editor v-if="clientConfig" v-model="clientConfig" @update:config-valid="(v) => (isFormValid = v)" />

    <template #footer>
      <a-flex justify="flex-end" align="center" gap="small">
        <a-button color="danger" variant="text" @click="showDialog = false">
          <template #icon>
            <CloseCircleOutlined />
          </template>
          {{ t("common.dialog.cancel") }}
        </a-button>

        <a-button
          type="primary"
          :disabled="!clientConfig || !isFormValid"
          :loading="saving"
          @click="editClientConfig"
        >
          <template #icon>
            <CheckCircleOutlined />
          </template>
          {{ t("common.dialog.ok") }}
        </a-button>
      </a-flex>
    </template>
  </a-modal>
</template>