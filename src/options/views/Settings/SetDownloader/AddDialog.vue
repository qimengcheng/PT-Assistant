<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { computedAsync } from "@vueuse/core";
import { nanoid } from "nanoid";
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  LeftOutlined,
  QuestionCircleOutlined,
  RightOutlined,
} from "@antdv-next/icons";

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

/**
 * antdv-next 的 Steps 只有 `items` 写法（1.5.6 注册名里根本没有 `a-step`，
 * 全量 install 也只有 ASteps），照 Vuetify 的 v-stepper 那样写子组件会渲染成
 * 未知元素、步骤条整条空白。
 */
const stepItems = computed(() => [
  { title: t("SetDownloader.add.selectPlaceholder") },
  { title: t("SetDownloader.common.name") },
]);
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
    :after-close="resetDialog"
  >
    <a-steps :current="currentStep" size="small" :items="stepItems" style="margin-bottom: 24px" />

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

    <template #footer>
      <a-flex align="center" gap="small">
        <a-button
          :href="`${REPO_URL}/tree/master/packages/downloader`"
          color="default"
          variant="solid"
          rel="noopener noreferrer nofollow"
          target="_blank"
        >
          <template #icon>
            <QuestionCircleOutlined />
          </template>
          {{ t("SetDownloader.add.newType") }}
        </a-button>

        <!-- 右侧这组用 flex="auto" 吃掉剩余宽度并自己右对齐，而不是靠外层
             justify="space-between"：步骤 2 时左侧「新建类型」按钮 v-show 隐藏，
             space-between 剩一个子元素会贴到左边，整条按钮组就跑位了。 -->
        <a-flex flex="auto" justify="flex-end" align="center" gap="small">
          <a-button color="danger" variant="text" @click="showDialog = false">
            <template #icon>
              <CloseCircleOutlined />
            </template>
            {{ t("common.dialog.cancel") }}
          </a-button>
          <a-button
            v-if="currentStep === 1"
            color="blue"
            variant="text"
            icon-placement="start"
            @click="currentStep--"
          >
            <template #icon>
              <LeftOutlined />
            </template>
            {{ t("common.dialog.prev") }}
          </a-button>
          <a-button
            v-if="currentStep === 0"
            :disabled="selectedClientType == null"
            color="blue"
            variant="text"
            icon-placement="end"
            @click="currentStep++"
          >
            {{ t("common.dialog.next") }}
            <template #icon>
              <RightOutlined />
            </template>
          </a-button>
          <a-button v-if="currentStep === 1" type="primary" @click="saveStoredDownloaderConfig">
            <template #icon>
              <CheckCircleOutlined />
            </template>
            {{ t("common.dialog.ok") }}
          </a-button>
        </a-flex>
      </a-flex>
    </template>
  </a-modal>
</template>
