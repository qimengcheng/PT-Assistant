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
  <a-space-compact :size="btnSize" class="table-action">
    <a-button
      v-if="metadataStore.defaultDownloader?.id"
      :disabled="torrentItems.length == 0"
      type="text"
      :title="t('SearchEntity.ActionTd.sendToDefault')"
      @click="() => sendToDownloader(true)"
    >
      <template #icon><DownloadOutlined /></template>
    </a-button>

    <!-- 下载到服务器 -->
    <a-button
      :disabled="torrentItems.length == 0"
      type="text"
      :title="t('SearchEntity.ActionTd.sendToDownloader')"
      @click="() => sendToDownloader()"
    >
      <template #icon><CloudDownloadOutlined /></template>
    </a-button>
    <!-- 复制下载链接 -->
    <a-button
      :disabled="torrentItems.length == 0"
      :loading="copyTorrentDownloadLinkBtnStatus"
      type="text"
      :title="t('SearchEntity.ActionTd.copyLink')"
      @click="() => copyTorrentDownloadLink()"
    >
      <template #icon><CopyOutlined /></template>
    </a-button>
    <!-- 下载种子文件到本地 -->
    <a-button
      :disabled="torrentItems.length == 0"
      :loading="localDlTorrentDownloadLinkBtnStatus"
      type="text"
      :title="t('SearchEntity.ActionTd.localDownload')"
      @click="() => localDlTorrentDownloadLink()"
    >
      <template #icon><SaveOutlined /></template>
    </a-button>
    <!-- 辅种检测 -->
    <a-button
      v-if="showKeepUploadBtn"
      :disabled="torrentItems.length < 2"
      type="text"
      :title="t('SearchEntity.KeepUploadDialog.keepUpload')"
      @click="openKeepUploadDialog"
    >
      <template #icon><BranchesOutlined /></template>
    </a-button>
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
