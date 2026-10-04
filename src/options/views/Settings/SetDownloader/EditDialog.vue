<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";

import type { IDownloaderMetadata, TDownloaderKey } from "@/shared/types.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";

import Editor from "./Editor.vue";

const showDialog = defineModel<boolean>();
const { clientId } = defineProps<{
  clientId: TDownloaderKey;
}>();

const { t } = useI18n();
const metadataStore = useMetadataStore();

const clientConfig = ref<IDownloaderMetadata>();

function dialogEnter() {
  if (clientId && metadataStore.downloaders[clientId]) {
    // 拷贝一份，避免直接修改 store 中的数据
    clientConfig.value = {
      sortIndex: 100,
      advanceAddTorrentOptions: {},
      ...metadataStore.downloaders[clientId],
    };
  }
}

function editClientConfig() {
  metadataStore.addDownloader(clientConfig.value as IDownloaderMetadata);
  showDialog.value = false;
}
</script>

<template>
  <a-modal
    v-model:open="showDialog"
    :title="t('SetDownloader.edit.title')"
    width="800px"
    :ok-text="t('common.dialog.ok')"
    :cancel-text="t('common.dialog.cancel')"
    :after-open-change="(open: boolean) => open && dialogEnter()"
    @ok="editClientConfig"
  >
    <Editor v-model="clientConfig" />
  </a-modal>
</template>
