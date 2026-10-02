<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { computedAsync } from "@vueuse/core";
import { nanoid } from "nanoid";
import { AppstoreAddOutlined, QuestionCircleOutlined } from "@antdv-next/icons";

import type { IDownloaderMetadata } from "@/shared/types.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import {
  entityList,
  getDownloaderDefaultConfig,
  getDownloaderIcon,
  getDownloaderMetaData,
  type TorrentClientMetaData,
} from "@ptd/downloader";

import Editor from "./Editor.vue";

import { REPO_URL } from "~/helper.ts";

const showDialog = defineModel<boolean>();

const { t } = useI18n();
const metadataStore = useMetadataStore();

const currentStep = ref<0 | 1>(0);
const selectedClientType = ref<string | null>(null);
const storedDownloaderConfig = ref<IDownloaderMetadata>({} as IDownloaderMetadata);

const allTorrentClientMetaData = computedAsync(async () => {
  const clientMetaData: Record<string, TorrentClientMetaData & { type: string }> = {};
  for (const type of entityList) {
    clientMetaData[type] = { type, ...(await getDownloaderMetaData(type)) };
  }
  return clientMetaData;
}, {});

const clientTypeOptions = computed(() =>
  Object.values(allTorrentClientMetaData.value).map((m) => ({ value: m.type, label: m.type })),
);

function resetDialog() {
  currentStep.value = 0;
  selectedClientType.value = null;
  storedDownloaderConfig.value = {} as IDownloaderMetadata;
}

async function updateStoredDownloaderConfigByDefault(type: string) {
  storedDownloaderConfig.value = {
    ...(await getDownloaderDefaultConfig(type)),
    enabled: true,
    id: nanoid(),
    advanceAddTorrentOptions: {},
    sortIndex: 100,
  };
}

async function saveStoredDownloaderConfig() {
  await metadataStore.addDownloader(storedDownloaderConfig.value);

  // 只有一个下载器时，自动设为默认
  if (metadataStore.getDownloaders.length === 1) {
    metadataStore.defaultDownloader = { id: storedDownloaderConfig.value.id!, folder: "", tags: "" };
    metadataStore.$save();
  }

  showDialog.value = false;
}

const selectedDescription = computed(() => {
  if (!selectedClientType.value) return t("SetDownloader.add.NoneSelectNotice");
  return allTorrentClientMetaData.value[selectedClientType.value]?.description ?? "";
});
</script>

<template>
  <a-modal
    v-model:open="showDialog"
    :title="t('SetDownloader.add.title')"
    width="800px"
    :footer="null"
    @after-close="resetDialog"
  >
    <a-steps :current="currentStep" size="small" style="margin-bottom: 24px">
      <a-step :title="t('SetDownloader.add.selectPlaceholder')" />
      <a-step :title="t('SetDownloader.common.name')" />
    </a-steps>

    <div v-show="currentStep === 0">
      <a-select
        v-model:value="selectedClientType"
        :options="clientTypeOptions"
        :placeholder="t('SetDownloader.add.selectPlaceholder')"
        style="width: 100%"
        @change="(e: string) => updateStoredDownloaderConfigByDefault(e)"
      >
        <template #option="{ value }">
          <div style="display: flex; align-items: center; gap: 8px">
            <img :src="getDownloaderIcon(value as string)" :alt="value" style="width: 20px; height: 20px" />
            <span>{{ value }}</span>
          </div>
        </template>
      </a-select>
      <a-alert v-if="selectedDescription" type="info" show-icon style="margin-top: 12px">
        <template #message>{{ selectedDescription }}</template>
      </a-alert>
    </div>

    <div v-show="currentStep === 1">
      <Editor v-if="storedDownloaderConfig.type" v-model="storedDownloaderConfig" />
    </div>

    <div style="text-align: right; margin-top: 16px">
      <a
        v-if="currentStep === 0"
        :href="`${REPO_URL}/tree/master/src/packages/downloader`"
        target="_blank"
        rel="noopener noreferrer nofollow"
        style="float: left; line-height: 32px"
      >
        <QuestionCircleOutlined />
        <span style="margin-left: 4px">{{ t("SetDownloader.add.newType") }}</span>
      </a>

      <a-button type="text" danger @click="showDialog = false" style="margin-right: 8px">
        {{ t("common.dialog.cancel") }}
      </a-button>

      <a-button v-if="currentStep === 1" @click="currentStep--" style="margin-right: 8px">
        {{ t("common.dialog.prev") }}
      </a-button>

      <a-button
        v-if="currentStep === 0"
        type="primary"
        :disabled="selectedClientType == null"
        @click="currentStep++"
      >
        {{ t("common.dialog.next") }}
      </a-button>

      <a-button v-if="currentStep === 1" type="primary" @click="saveStoredDownloaderConfig">
        {{ t("common.dialog.ok") }}
      </a-button>
    </div>
  </a-modal>
</template>
