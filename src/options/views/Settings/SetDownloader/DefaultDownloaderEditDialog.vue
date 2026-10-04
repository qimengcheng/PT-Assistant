<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";

import type { IDefaultDownloaderConfig, TDownloaderKey } from "@/shared/types/storages/metadata.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import { getDownloaderIcon } from "@ptd/downloader";

const showDialog = defineModel<boolean>();

const { t } = useI18n();
const metadataStore = useMetadataStore();

const defaultDownloaderConfig = ref<Required<IDefaultDownloaderConfig>>({
  id: "",
  folder: "",
  tags: "",
});

const suggests = ref<{ folder: string[]; tags: string[] }>({ folder: [], tags: [] });

function updateDefaultDownloaderInput(downloaderId: TDownloaderKey, clean: boolean = true) {
  if (clean) {
    defaultDownloaderConfig.value.folder = "";
    defaultDownloaderConfig.value.tags = "";
  }
  suggests.value = {
    folder: metadataStore.downloaders?.[downloaderId]?.suggestFolders ?? [],
    tags: metadataStore.downloaders?.[downloaderId]?.suggestTags ?? [],
  };
}

function saveDefaultDownloader() {
  metadataStore.defaultDownloader = defaultDownloaderConfig.value;
  metadataStore.$save();
  showDialog.value = false;
}

function enterDialog() {
  defaultDownloaderConfig.value = { id: "", folder: "", tags: "" };
  suggests.value = { folder: [], tags: [] };

  if (metadataStore.defaultDownloader?.id) {
    defaultDownloaderConfig.value = { ...metadataStore.defaultDownloader } as Required<IDefaultDownloaderConfig>;
    updateDefaultDownloaderInput(defaultDownloaderConfig.value.id, false);
  }
}
</script>

<template>
  <a-modal
    v-model:open="showDialog"
    :title="t('SetDownloader.index.editDefaultDownloaderBtn')"
    width="600px"
    :footer="null"
    :after-open-change="(open: boolean) => open && enterDialog()"
  >
    <a-form layout="vertical">
      <a-form-item :label="t('SetDownloader.index.editDefaultDownloaderBtn')">
        <a-select
          v-model:value="defaultDownloaderConfig.id"
          :options="metadataStore.getEnabledDownloaders.map((d) => ({ value: d.id, label: d.name }))"
          style="width: 100%"
          @change="(e: string) => updateDefaultDownloaderInput(e)"
        >
          <template #option="{ value }">
            <div style="display: flex; align-items: center; gap: 8px">
              <img
                :src="getDownloaderIcon((metadataStore.downloaders[value as string] as any)?.type)"
                style="width: 20px; height: 20px"
              />
              <span>{{ (metadataStore.downloaders[value as string] as any)?.name }}</span>
              <span style="color: rgba(0,0,0,0.45)">{{ (metadataStore.downloaders[value as string] as any)?.address }}</span>
            </div>
          </template>
        </a-select>
      </a-form-item>

      <a-form-item :label="t('SetDownloader.PathAndTag.downloadPath.title')">
        <a-select
          v-model:value="defaultDownloaderConfig.folder"
          mode="tags"
          :options="suggests.folder.map((f) => ({ value: f, label: f }))"
          style="width: 100%"
          placeholder=""
        />
      </a-form-item>

      <a-form-item :label="t('SetDownloader.PathAndTag.tags.title')">
        <a-select
          v-model:value="defaultDownloaderConfig.tags"
          mode="tags"
          :options="suggests.tags.map((tag) => ({ value: tag, label: tag }))"
          style="width: 100%"
          placeholder=""
        />
      </a-form-item>
    </a-form>

    <div style="text-align: right">
      <a-button type="primary" @click="saveDefaultDownloader">
        {{ t("common.dialog.ok") }}
      </a-button>
    </div>
  </a-modal>
</template>
