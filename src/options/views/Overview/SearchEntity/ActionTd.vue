<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  BranchesOutlined,
  CloudDownloadOutlined,
  CopyOutlined,
  DownloadOutlined,
  SaveOutlined,
} from "@antdv-next/icons";

import { sendMessage } from "@/messages.ts";
import type { ISearchResultTorrent } from "@/shared/types.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";

import SentToDownloaderDialog from "@/options/components/SentToDownloaderDialog/Index.vue";
import KeepUploadDialog from "./KeepUploadDialog.vue";

const {
  torrentItems,
  density = "default",
  showKeepUploadBtn = true,
} = defineProps<{
  torrentItems: ISearchResultTorrent[];
  density?: "compact" | "default";
  showKeepUploadBtn?: boolean;
}>();

/** antd 的 size 取值为 small / middle / large，没有 Vuetify 的 "default" */
const btnSize = computed(() => {
  return density === "compact" ? "small" : "middle";
});

const { t } = useI18n();
const metadataStore = useMetadataStore();
const runtimeStore = useRuntimeStore();

async function getTorrentDownloadLinks() {
  const downloadUrls = [];

  for (const torrent of torrentItems) {
    const downloadUrl = await sendMessage("getTorrentDownloadLink", torrent);
    sendMessage("logger", { msg: `torrent ${torrent} download link: ${downloadUrl}` }).catch();
    downloadUrls.push({ torrent, downloadUrl });
  }

  return downloadUrls;
}

const copyTorrentDownloadLinkBtnStatus = ref(false);
async function copyTorrentDownloadLink() {
  copyTorrentDownloadLinkBtnStatus.value = true;
  const downloadUrls = await getTorrentDownloadLinks();
  try {
    await navigator.clipboard.writeText(
      downloadUrls
        .map((x) => x.downloadUrl)
        .join("\n")
        .trim(),
    );
    runtimeStore.showSnakebar(t("SearchEntity.ActionTd.copyLinkSuccess"), { color: "success" });
  } catch (e) {
    runtimeStore.showSnakebar(t("SearchEntity.ActionTd.copyLinkFailed"), { color: "error" });
  }

  copyTorrentDownloadLinkBtnStatus.value = false;
}

const localDlTorrentDownloadLinkBtnStatus = ref(false);
async function localDlTorrentDownloadLink() {
  localDlTorrentDownloadLinkBtnStatus.value = true;
  await Promise.allSettled(
    torrentItems.map((torrent) => sendMessage("downloadTorrent", { torrent, downloaderId: "local" })),
  );
  localDlTorrentDownloadLinkBtnStatus.value = false;
}

const showDownloadClientDialog = ref(false);
const isDefaultSend = ref(false);

function sendToDownloader(defaultDownload = false) {
  isDefaultSend.value = defaultDownload;
  showDownloadClientDialog.value = true;
}

const showKeepUploadDialog = ref(false);

function openKeepUploadDialog() {
  showKeepUploadDialog.value = true;
}
</script>

<template>
  <!-- v-btn-group variant="text" → a-space-compact（一组贴合排列的按钮） -->
  <!-- 纯图标按钮统一用 a-tooltip 包裹：antd Button 没有 title prop，写 :title 只会
       透传到原生 button，与本项目其余页面（MyClient/Index.vue 等）的 a-tooltip 风格不一致。 -->
  <a-space-compact :size="btnSize" class="table-action">
    <a-tooltip v-if="metadataStore.defaultDownloader?.id" :title="t('SearchEntity.ActionTd.sendToDefault')">
      <a-button
        :disabled="torrentItems.length == 0"
        type="text"
        @click="() => sendToDownloader(true)"
      >
        <template #icon><DownloadOutlined /></template>
      </a-button>
    </a-tooltip>

    <!-- 下载到服务器 -->
    <a-tooltip :title="t('SearchEntity.ActionTd.sendToDownloader')">
      <a-button
        :disabled="torrentItems.length == 0"
        type="text"
        @click="() => sendToDownloader()"
      >
        <template #icon><CloudDownloadOutlined /></template>
      </a-button>
    </a-tooltip>
    <!-- 复制下载链接 -->
    <a-tooltip :title="t('SearchEntity.ActionTd.copyLink')">
      <a-button
        :disabled="torrentItems.length == 0"
        :loading="copyTorrentDownloadLinkBtnStatus"
        type="text"
        @click="() => copyTorrentDownloadLink()"
      >
        <template #icon><CopyOutlined /></template>
      </a-button>
    </a-tooltip>
    <!-- 下载种子文件到本地 -->
    <a-tooltip :title="t('SearchEntity.ActionTd.localDownload')">
      <a-button
        :disabled="torrentItems.length == 0"
        :loading="localDlTorrentDownloadLinkBtnStatus"
        type="text"
        @click="() => localDlTorrentDownloadLink()"
      >
        <template #icon><SaveOutlined /></template>
      </a-button>
    </a-tooltip>
    <!-- 辅种检测。原先要勾中 ≥2 条才点得动，因为基准取的是列表里第一条；
         现在 1 条也能进 —— 那种情形是「下载器早就下完了，只要再挂这一站」，
         基准改从下载器的本地索引里挑（见 KeepUploadDialog 的 isSingleMode 那一档） -->
    <a-tooltip :title="t('SearchEntity.KeepUploadDialog.keepUpload')">
      <a-button
        v-if="showKeepUploadBtn"
        :disabled="torrentItems.length < 1"
        type="text"
        @click="openKeepUploadDialog"
      >
        <template #icon><BranchesOutlined /></template>
      </a-button>
    </a-tooltip>
  </a-space-compact>

  <!-- 在点击发送到远程服务器时，弹出选择下载器及其他自定义选项 -->
  <SentToDownloaderDialog
    v-model="showDownloadClientDialog"
    :torrent-items="torrentItems"
    :is-default-send="isDefaultSend"
  />

  <!-- 辅种检测对话框 -->
  <KeepUploadDialog v-if="showKeepUploadBtn" v-model="showKeepUploadDialog" :torrent-items="torrentItems" />
</template>

<style scoped lang="scss"></style>
