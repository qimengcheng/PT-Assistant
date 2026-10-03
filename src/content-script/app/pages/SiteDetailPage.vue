<script setup lang="ts">
import { computed, inject } from "vue";
import { useI18n } from "vue-i18n";
import { CloudDownloadOutlined, CopyOutlined, DownloadOutlined, SearchOutlined } from "@antdv-next/icons";

import { sendMessage } from "@/messages.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";

import type { IRemoteDownloadDialogData } from "../types.ts";
import { copyTextToClipboard, doKeywordSearch, siteInstance, type IPtdData } from "../utils.ts";

import SpeedDialBtn from "../components/SpeedDialBtn.vue";

const metadataStore = useMetadataStore();
const runtimeStore = useRuntimeStore();
const { t } = useI18n();

const ptdData = inject<IPtdData>("ptd_data", {});
const enabledDownloadersBySite = computed(() => {
  return metadataStore.getEnabledDownloadersBySite(ptdData.siteId ?? "");
});

async function parseDetailPage() {
  // 必须传克隆文档：站点的 transformDetailPage 常带 DOM 查询/属性改写副作用，
  // 直接传宿主 document 会把副作用作用在站点真实页面上。
  // 同目录的 SiteListPage 与 SocialSitePage 也都是传克隆，保持一致。
  const parsedResult = await siteInstance.value?.transformDetailPage(document.cloneNode(true) as Document);

  if (typeof parsedResult?.link === "undefined") {
    runtimeStore.showSnakebar(t("contentScript.cannotParseDetailLink"), { color: "error" });
    throw new Error("无法解析当前页面种子链接");
  }

  // 更新搜索状态，方便 SentToDownloaderDialog 中替换
  runtimeStore.search.searchPlanKey = "all";
  runtimeStore.search.searchKey = parsedResult?.title ?? "";

  return parsedResult!;
}

const remoteDownloadDialogData = inject<IRemoteDownloadDialogData>("remoteDownloadDialogData")!;

/**
 * parseDetailPage 在解析失败时会 throw，调用点必须兜底：
 * 原来三个调用点都是裸 .then()，解析失败只会在控制台留下 unhandled rejection，
 * 用户看到的是一个点了没反应（还可能一直转圈）的按钮。
 */
function runWithDetailPage(doWork: (torrent: NonNullable<Awaited<ReturnType<typeof parseDetailPage>>>) => Promise<void> | void) {
  return () => {
    parseDetailPage().then(doWork).catch((e) => {
      console.error("[PTD] detail page action failed", e);
      runtimeStore.showSnakebar(t("contentScript.cannotParseDetailLink"), { color: "error" });
    });
  };
}

function handleLinkCopy() {
  return runWithDetailPage(async (torrent) => {
    const downloadUrl = await sendMessage("getTorrentDownloadLink", torrent);

    const copied = await copyTextToClipboard(downloadUrl);
    runtimeStore.showSnakebar(copied ? t("contentScript.copyLinkSuccess") : t("contentScript.copyLinkFailed"), {
      color: copied ? "success" : "error",
    });
  })();
}

function handleRemoteDownload(isDefaultSend = false) {
  return runWithDetailPage((torrent) => {
    remoteDownloadDialogData.torrents = [torrent];
    remoteDownloadDialogData.isDefaultSend = isDefaultSend;
    remoteDownloadDialogData.show = true;
  })();
}

function handleSearch() {
  return runWithDetailPage((torrent) => {
    doKeywordSearch(torrent.title || "");
  })();
}
</script>

<template>
  <SpeedDialBtn
    key="copy"
    color="#1890ff"
    :icon="CopyOutlined"
    :title="t('contentScript.copyLink')"
    @click="handleLinkCopy"
  />
  <SpeedDialBtn
    key="download"
    :disabled="enabledDownloadersBySite.length === 0"
    color="#1890ff"
    :icon="CloudDownloadOutlined"
    :title="t('contentScript.pushTo')"
    @click="() => handleRemoteDownload()"
  />
  <SpeedDialBtn
    key="download_default"
    v-if="metadataStore.defaultDownloader?.id"
    :disabled="enabledDownloadersBySite.length === 0"
    color="#1890ff"
    :icon="DownloadOutlined"
    :title="t('contentScript.pushToDefault')"
    @click="handleRemoteDownload(true)"
  />
  <SpeedDialBtn
    key="search"
    color="#722ed1"
    :icon="SearchOutlined"
    :title="t('contentScript.quickSearch')"
    @click="handleSearch"
  />
</template>

<style scoped lang="scss"></style>
