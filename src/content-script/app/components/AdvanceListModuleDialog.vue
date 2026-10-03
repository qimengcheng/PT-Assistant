<script setup lang="ts">
import { ref, computed, inject } from "vue";
import { useI18n } from "vue-i18n";
import { useWindowSize } from "@vueuse/core";
import {
  CloudDownloadOutlined,
  CopyOutlined,
  DownloadOutlined,
  InboxOutlined,
  MinusCircleOutlined,
  SaveOutlined,
} from "@antdv-next/icons";
import { ETorrentStatus, ITorrent } from "@ptd/site";
import type { TableColumnsType } from "antdv-next";

import { formatDate, formatSize } from "@/options/utils.ts";
import { sendMessage } from "@/messages.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";

import type { IRemoteDownloadDialogData } from "../types.ts";

import TorrentTitleTd from "@/options/components/TorrentTitleTd.vue";

const { t } = useI18n();

const showDialog = defineModel<boolean>();

const { height: windowHeight } = useWindowSize();

const { torrentItems } = defineProps<{
  torrentItems: ITorrent[];
}>();

const runtimeStore = useRuntimeStore();
const metadataStore = useMetadataStore();

const tableHeaders = computed<TableColumnsType<ITorrent>>(
  () =>
    [
      { title: t("SearchEntity.index.table.category"), dataIndex: "category", key: "category", align: "center", width: 60 },
      { title: t("SearchEntity.index.table.title"), dataIndex: "title", key: "title", align: "start", width: 400 },
      { title: t("SearchEntity.index.table.size"), dataIndex: "size", key: "size", align: "end", width: 80 },
      { title: t("SearchEntity.index.table.seeders"), dataIndex: "seeders", key: "seeders", align: "end", width: 60 },
      { title: t("SearchEntity.index.table.leechers"), dataIndex: "leechers", key: "leechers", align: "end", width: 60 },
      { title: t("SearchEntity.index.table.completed"), dataIndex: "completed", key: "completed", align: "end", width: 60 },
      { title: t("SearchEntity.index.table.time"), dataIndex: "time", key: "time", align: "center", width: 90 },
    ] as TableColumnsType<ITorrent>,
);

const selectedTorrentIds = ref<ITorrent["id"][]>([]);
const selectedTorrents = computed(() => torrentItems.filter((x) => selectedTorrentIds.value.includes(x.id)));
const hasSelectedTorrent = computed(() => selectedTorrentIds.value.length > 0);
const selectedTorrentsCount = computed(() => selectedTorrentIds.value.length);
const selectedTorrentsSize = computed(() =>
  selectedTorrents.value.reduce((acc, torrent) => acc + (torrent.size ?? 0), 0),
);

const localDownloadMultiStatus = ref<boolean>(false);
async function handleLocalDownloadMulti() {
  localDownloadMultiStatus.value = true;
  try {
    for (const torrent of selectedTorrents.value) {
      await sendMessage("downloadTorrent", { torrent, downloaderId: "local" });
    }
  } catch (e) {
    // 必须 try/finally：中途抛错时 localDownloadMultiStatus 会永远停在 true，按钮永久转圈
    console.error("[PTD] batch download failed", e);
    runtimeStore.showSnakebar(t("contentScript.parsePageFailed"), { color: "error" });
  } finally {
    localDownloadMultiStatus.value = false;
  }
}

const linkCopyMultiStatus = ref<boolean>(false);
async function handleLinkCopyMulti() {
  linkCopyMultiStatus.value = true;
  const downloadUrls = [] as string[];

  try {
    for (const torrent of selectedTorrents.value) {
      const downloadUrl = await sendMessage("getTorrentDownloadLink", torrent);
      downloadUrls.push(downloadUrl);
    }

    await navigator.clipboard.writeText(downloadUrls.join("\n").trim());
    runtimeStore.showSnakebar(t("contentScript.copyLinkSuccess"), { color: "success" });
  } catch (e) {
    runtimeStore.showSnakebar(t("contentScript.copyLinkFailed"), { color: "error" });
  } finally {
    linkCopyMultiStatus.value = false;
  }
}

const remoteDownloadDialogData = inject<IRemoteDownloadDialogData>("remoteDownloadDialogData")!;

function handleRemoteDownloadMulti(isDefaultSend = false) {
  remoteDownloadDialogData.torrents = selectedTorrents.value;
  remoteDownloadDialogData.isDefaultSend = isDefaultSend;
  remoteDownloadDialogData.show = true;
}

function handleSelectSeeders() {
  selectedTorrentIds.value = torrentItems.filter((item) => item.seeders).map((x) => x.id);
}

function handleSelectNotSeeding() {
  selectedTorrentIds.value = torrentItems
    .filter(
      (item) =>
        item.status !== undefined && ![ETorrentStatus.seeding, ETorrentStatus.downloading].includes(item.status!),
    )
    .map((x) => x.id);
}

function enterDialog() {
  selectedTorrentIds.value = torrentItems.map((x) => x.id);
}

/** antd 的受控行选择：selectedRowKeys 与 v-data-table 的 v-model 等价 */
const rowSelection = computed(() => ({
  selectedRowKeys: selectedTorrentIds.value,
  onChange: (keys: (string | number)[]) => {
    selectedTorrentIds.value = keys as ITorrent["id"][];
  },
}));
</script>

<template>
  <a-modal
    v-model:open="showDialog"
    :width="1200"
    :footer="null"
    styles="{ body: { maxHeight: `${windowHeight - 256}px`, overflow: 'auto' } }"
    @after-open-change="(open: boolean) => open && enterDialog()"
  >
    <template #title>
      <span style="color: #455a64">
        {{ t("contentScript.AdvanceListModuleDialog.title", [torrentItems.length]) }}
      </span>
    </template>

    <div style="margin-bottom: 8px">
      <a-button type="primary" @click="handleSelectSeeders"><template #icon><InboxOutlined /></template><span class="ml-1">{{ t('contentScript.AdvanceListModuleDialog.selectSeeders') }}</span></a-button>
      <a-button type="primary" @click="handleSelectNotSeeding"><template #icon><MinusCircleOutlined /></template><span class="ml-1">{{ t('contentScript.AdvanceListModuleDialog.selectNotSeeding') }}</span></a-button>
    </div>

    <a-table
      :columns="tableHeaders"
      :data-source="torrentItems"
      :row-key="(record: ITorrent) => record.id"
      :row-selection="rowSelection"
      :pagination="false"
      size="small"
      class="table-stripe table-header-no-wrap"
      :scroll="{ y: windowHeight - 320 }"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'title'">
          <TorrentTitleTd :item="record" :show-social="false" />
        </template>

        <!-- 种子大小 -->
        <template v-else-if="column.key === 'size'">
          <span class="text-no-wrap">{{ formatSize(record.size ?? 0) }}</span>
        </template>

        <template v-else-if="column.key === 'time'">
          <span class="text-no-wrap">
            {{ record.time ? formatDate(record.time) : "-" }}
          </span>
        </template>
      </template>
    </a-table>

    <template #footer>
      <div style="display: flex; align-items: center; gap: 8px">
        <span v-show="hasSelectedTorrent">
          {{
            t("contentScript.AdvanceListModuleDialog.selectedInfo", [
              selectedTorrentsCount,
              formatSize(selectedTorrentsSize),
            ])
          }}
        </span>

        <div style="flex: 1"></div>

        <a-button type="primary" :disabled="!hasSelectedTorrent" :loading="localDownloadMultiStatus" @click="handleLocalDownloadMulti"><template #icon><SaveOutlined /></template><span class="ml-1">{{ t('downloaderLabel.localDownload') }}</span></a-button>

        <a-button type="primary" :disabled="!hasSelectedTorrent" :loading="linkCopyMultiStatus" @click="handleLinkCopyMulti"><template #icon><CopyOutlined /></template><span class="ml-1">{{ t('contentScript.copyLink') }}</span></a-button>

        <a-button type="primary" :disabled="!hasSelectedTorrent" @click="() => handleRemoteDownloadMulti()"><template #icon><CloudDownloadOutlined /></template><span class="ml-1">{{ t('contentScript.pushTo') }}</span></a-button>

        <a-button type="primary" v-if="metadataStore.defaultDownloader?.id" :disabled="!hasSelectedTorrent" @click="() => handleRemoteDownloadMulti(true)"><template #icon><DownloadOutlined /></template><span class="ml-1">{{ t('contentScript.pushToDefault') }}</span></a-button>
      </div>
    </template>
  </a-modal>
</template>

<style scoped lang="scss"></style>
