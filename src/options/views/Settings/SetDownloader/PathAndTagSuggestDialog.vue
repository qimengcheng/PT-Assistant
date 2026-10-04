<script setup lang="ts">
/**
 * 下载器预设下载路径 / 标签对话框（antdv-next 平移）。
 * suggestFolders / suggestTags 用于推送种子时的路径与标签候选，支持关键字模板与一键导入客户端已有配置。
 */
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ClearOutlined, ImportOutlined } from "@antdv-next/icons";
import { getDownloader, getDownloaderMetaData, type TorrentClientMetaData } from "@ptd/downloader";

import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import type { IDownloaderMetadata } from "@/shared/types.ts";

const showDialog = defineModel<boolean>();
const { clientId } = defineProps<{
  clientId: string;
}>();

const { t } = useI18n();
const runtimeStore = useRuntimeStore();
const metadataStore = useMetadataStore();

const clientConfig = ref<IDownloaderMetadata>();
const clientMetadata = ref<TorrentClientMetaData>();
const activeKeys = ref<string[]>(["note"]);

// [key (for i18n), value, example]
const pathReplaceMap: [string, string, string][] = [
  // 在 torrent 相关字段中，因为对应的 title subTitle 为对应 torrent 的字段，所以这里用 . 来分隔
  ["torrentTitle", "$torrent.title$", "/volume1/$torrent.title$ -> /volume1/TorrentTitle"],
  ["torrentSubTitle", "$torrent.subTitle$", "/volume1/$torrent.subTitle$ -> /volume1/TorrentSubTitle"],
  ["torrentSite", "$torrent.site$", "/volume1/$torrent.site$/music -> /volume1/opencd/music"],
  ["torrentSiteName", "$torrent.siteName$", "/volume1/$torrent.siteName$/music -> /volume1/OpenCD/music"],
  // 而在 search, date 等字段中，则是全局字段，所以用 : 来分隔
  ["searchKeyword", "$search:keyword$", "/volume1/$search:keyword$/music -> /volume1/keyword/music"],
  ["searchPlan", "$search:plan$", "/volume1/$search:plan$/music -> /volume1/all/music"],
  ["dateYear", "$date:YYYY$", "/volume1/$date:YYYY$/music -> /volume1/2019/music"],
  ["dateMonth", "$date:MM$", "/volume1/$date:MM$/music -> /volume1/10/music"],
  ["dateDay", "$date:DD$", "/volume1/$date:DD$/music -> /volume1/01/music"],
  ["custom", "<...>", "/volume1/<...>/music -> prompt for input 'test' -> /volume1/test/music"],
];

const noteRows = pathReplaceMap.map(([key, token, example]) => ({ key, token, example }));

const noteColumns = computed(() => [
  { title: t("SetDownloader.PathAndTag.note.table.keywords"), dataIndex: "token", width: 200 },
  { title: t("SetDownloader.PathAndTag.note.table.note"), dataIndex: "key", width: 180 },
  { title: t("SetDownloader.PathAndTag.note.table.example"), dataIndex: "example" },
]);

watch(
  showDialog,
  async (visible) => {
    if (visible && clientId) {
      // 防止直接修改 store 中的数据
      clientConfig.value = { suggestFolders: [], suggestTags: [], ...metadataStore.downloaders[clientId] };
      clientMetadata.value = await getDownloaderMetaData(clientConfig.value.type);
    }
  },
  { immediate: true },
);

const suggestFolderInput = computed<string>({
  get: () => (clientConfig.value?.suggestFolders ?? []).join("\n"),
  set: (value) => {
    clientConfig.value!.suggestFolders = value
      .split("\n")
      .map((v) => v.trim())
      .filter(Boolean);
  },
});

const isLoadingClientFolders = ref<boolean>(false);
async function loadClientFolders() {
  isLoadingClientFolders.value = true;
  const client = await getDownloader(clientConfig.value!);
  try {
    const clientPaths = await client.getClientPaths();
    for (const path of clientPaths) {
      if ((clientConfig.value?.suggestFolders ?? []).includes(path)) continue; // 避免重复添加
      suggestFolderInput.value += "\n" + path;
    }
  } catch {
    runtimeStore.showSnakebar(t("SetDownloader.PathAndTag.downloadPath.autoImportFail"), { color: "error" });
  }

  isLoadingClientFolders.value = false;
}

const suggestTagInput = computed<string>({
  get: () => (clientConfig.value?.suggestTags ?? []).join("\n"),
  set: (value) => {
    clientConfig.value!.suggestTags = value
      .split("\n")
      .map((v) => v.trim())
      .filter(Boolean);
  },
});

const isLoadingClientLabels = ref<boolean>(false);
async function loadClientLabels() {
  isLoadingClientLabels.value = true;
  const client = await getDownloader(clientConfig.value!);
  try {
    const clientLabels = await client.getClientLabels();
    for (const label of clientLabels) {
      if ((clientConfig.value?.suggestTags ?? []).includes(label)) continue; // 避免重复添加
      suggestTagInput.value += "\n" + label;
    }
  } catch {
    runtimeStore.showSnakebar(t("SetDownloader.PathAndTag.tags.autoImportFail"), { color: "error" });
  }

  isLoadingClientLabels.value = false;
}

function saveClientConfig() {
  metadataStore.addDownloader(clientConfig.value as IDownloaderMetadata);
  showDialog.value = false;
}
</script>

<template>
  <a-modal
    :open="showDialog"
    :title="t('SetDownloader.PathAndTag.title', [clientConfig?.name ?? clientId])"
    :width="1000"
    :ok-text="t('common.dialog.ok')"
    :cancel-text="t('common.dialog.cancel')"
    @update:open="(v: boolean) => (showDialog = v)"
    @ok="saveClientConfig"
  >
    <a-collapse v-model:active-key="activeKeys">
      <a-collapse-panel key="path" :disabled="clientMetadata?.feature?.CustomPath?.allowed === false">
        <template #label>
          <span>{{ t("SetDownloader.PathAndTag.downloadPath.title") }}</span>
          <a-tag :color="(clientConfig?.suggestFolders?.length ?? 0) > 0 ? 'blue' : 'default'" style="margin-left: 8px">
            +{{ clientConfig?.suggestFolders?.length ?? 0 }}
          </a-tag>
        </template>

        <a-alert
          v-if="clientMetadata?.feature?.CustomPath?.description"
          type="info"
          title="clientMetadata.feature.CustomPath.description"
          show-icon
          style="margin-bottom: 8px"
        />

        <div class="field-actions">
          <a-space>
            <a-button size="small" :loading="isLoadingClientFolders" @click="loadClientFolders">
              <template #icon><ImportOutlined /></template>
              {{ t("SetDownloader.PathAndTag.downloadPath.autoImport") }}
            </a-button>
            <a-button size="small" danger @click="suggestFolderInput = ''">
              <template #icon><ClearOutlined /></template>
              {{ t("SetDownloader.PathAndTag.downloadPath.clear") }}
            </a-button>
          </a-space>
        </div>
        <a-textarea
          v-model:value="suggestFolderInput"
          :placeholder="t('SetDownloader.PathAndTag.downloadPath.addInputLabel')"
          :rows="6"
          class="field-textarea"
        />
        <div class="chip-group">
          <a-tag
            v-for="pathReplace in pathReplaceMap"
            :key="pathReplace[1]"
            :title="pathReplace[2]"
            class="kw-chip"
            color="blue"
            @click="() => (suggestFolderInput += '/' + pathReplace[1])"
          >
            {{ pathReplace[1] }}
          </a-tag>
        </div>
      </a-collapse-panel>

      <a-collapse-panel key="tag">
        <template #label>
          <span>{{ t("SetDownloader.PathAndTag.tags.title") }}</span>
          <a-tag :color="(clientConfig?.suggestTags?.length ?? 0) > 0 ? 'blue' : 'default'" style="margin-left: 8px">
            +{{ clientConfig?.suggestTags?.length ?? 0 }}
          </a-tag>
        </template>

        <div class="field-actions">
          <a-space>
            <a-button size="small" :loading="isLoadingClientLabels" @click="loadClientLabels">
              <template #icon><ImportOutlined /></template>
              {{ t("SetDownloader.PathAndTag.tags.autoImport") }}
            </a-button>
            <a-button size="small" danger @click="suggestTagInput = ''">
              <template #icon><ClearOutlined /></template>
              {{ t("SetDownloader.PathAndTag.tags.clear") }}
            </a-button>
          </a-space>
        </div>
        <a-textarea
          v-model:value="suggestTagInput"
          :placeholder="t('SetDownloader.PathAndTag.tags.addInputLabel')"
          :rows="6"
          class="field-textarea"
        />
        <div class="chip-group">
          <a-tag
            v-for="pathReplace in pathReplaceMap"
            :key="pathReplace[1]"
            :title="pathReplace[2]"
            class="kw-chip"
            color="blue"
            @click="() => (suggestTagInput += pathReplace[1])"
          >
            {{ pathReplace[1] }}
          </a-tag>
        </div>
      </a-collapse-panel>

      <a-collapse-panel key="note" :title="t('SetDownloader.PathAndTag.note.title')">
        <a-alert type="info" show-icon style="margin-bottom: 8px">
          <template #message>{{ t("SetDownloader.PathAndTag.note.index") }}</template>
        </a-alert>
        <a-table
          :columns="noteColumns"
          :data-source="noteRows"
          :pagination="false"
          size="small"
          :scroll="{ y: 260 }"
          row-key="token"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.dataIndex === 'token'"><code>{{ record.token }}</code></template>
            <template v-else-if="column.dataIndex === 'key'">
              {{ t(`SetDownloader.PathAndTag.note.replaceNote.${record.key}`) }}
            </template>
            <template v-else-if="column.dataIndex === 'example'">
              <pre class="example-pre">{{ record.example }}</pre>
            </template>
          </template>
        </a-table>
      </a-collapse-panel>
    </a-collapse>
  </a-modal>
</template>

<style scoped>
.field-actions {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 6px;
}
.field-textarea {
  font-family: ui-monospace, Menlo, Consolas, monospace;
}
.chip-group {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 8px;
}
.kw-chip {
  cursor: pointer;
  margin-inline-end: 0;
  font-family: ui-monospace, Menlo, Consolas, monospace;
}
.example-pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
  font-size: 12px;
}
</style>
