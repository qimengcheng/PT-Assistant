<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
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

function dialogEnter() {
  if (clientId) {
    clientConfig.value = { ...metadataStore.backupServers[clientId] }; // 防止直接修改父组件的数据
  }
}

function editClientConfig() {
  metadataStore.addBackupServer(clientConfig.value as IBackupServerMetadata);
  showDialog.value = false;
}
</script>

<template>
  <a-modal
    v-model:open="showDialog"
    :title="t('SetDownloader.edit.title')"
    :width="800"
    :after-open-change="(open: boolean) => open && dialogEnter()"
  >
    <Editor v-if="clientConfig" v-model="clientConfig" />

    <template #footer>
      <div class="dialog-footer">
        <a-button color="danger" variant="text" @click="showDialog = false">
          <template #icon>
            <CloseCircleOutlined />
          </template>
          {{ t("common.dialog.cancel") }}
        </a-button>

        <a-button color="green" variant="text" @click="editClientConfig">
          <template #icon>
            <CheckCircleOutlined />
          </template>
          {{ t("common.dialog.ok") }}
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