<script setup lang="ts">
import { ref, shallowRef } from "vue";
import { useI18n } from "vue-i18n";
import { CloudDownloadOutlined, ReloadOutlined, SaveOutlined } from "@antdv-next/icons";
import type { Component } from "vue";

import type { CAddTorrentOptions } from "@ptd/downloader";
import { sendMessage } from "@/messages.ts";
import { useResetableRef } from "@/options/directives/useResetableRef.ts";
import type { ITorrentDownloadMetadata } from "@/shared/types.ts";

import SentToDownloaderDialog from "@/options/components/SentToDownloaderDialog/Index.vue";

const { t } = useI18n();

const showDialog = defineModel<boolean>();
const emit = defineEmits<{
  (e: "reDownloadComplete"): void;
}>();

const { torrentItems } = defineProps<{
  torrentItems: ITorrentDownloadMetadata[];
}>();

type TReDownloadType = "old" | "local" | "downloader";

const { ref: isReDownloading, reset: resetIsReDownloading } = useResetableRef<Record<TReDownloadType, boolean>>(() => ({
  old: false,
  local: false,
  downloader: false,
}));

const disableLocalDownload = ref<boolean>(false);
const showSentToDownloaderDialog = ref<boolean>(false);
const downloadTorrentsRef = shallowRef<ITorrentDownloadMetadata["torrent"][]>([]);

const btnItem: Record<TReDownloadType, { icon: Component; title: string }> = {
  old: { icon: ReloadOutlined, title: t("DownloadHistory.ReDownloadSelectDialog.oldMethod") },
  local: { icon: SaveOutlined, title: t("downloaderLabel.localDownload") },
  downloader: { icon: CloudDownloadOutlined, title: t("DownloadHistory.ReDownloadSelectDialog.selectDownloader") },
};

function submitDownloadFinish(reDownloadType: TReDownloadType) {
  isReDownloading.value[reDownloadType] = false;
  emit("reDownloadComplete");
  showDialog.value = false;
}

function reDownload(reDownloadType: TReDownloadType) {
  isReDownloading.value[reDownloadType] = true;
  if (reDownloadType === "downloader") {
    // 对 downloader 则弹出 SentToDownloaderDialog 进行下一步操作
    downloadTorrentsRef.value = torrentItems.map((x) => x.torrent);
    showSentToDownloaderDialog.value = true;
  } else {
    // 对 old 和 local 直接调用下载方法
    const promises = [];

    for (const history of torrentItems) {
      if (history) {
        const historyTorrent = history.torrent;
        if (reDownloadType === "local" || history.downloaderId === "local") {
          promises.push(sendMessage("downloadTorrent", { torrent: historyTorrent, downloaderId: "local" }));
        } else {
          promises.push(
            sendMessage("downloadTorrent", {
              torrent: historyTorrent,
              downloaderId: history.downloaderId,
              addTorrentOptions: (history.addTorrentOptions ?? {}) as CAddTorrentOptions,
            }),
          );
        }
      }
    }

    Promise.all(promises).finally(() => {
      submitDownloadFinish(reDownloadType);
    });
  }
}

function dialogEnter() {
  resetIsReDownloading();

  // 如果传入的种子列表中有 magnet 链接，则禁用本地下载按钮
  disableLocalDownload.value = torrentItems.some((item) => item?.torrent?.link?.startsWith("magnet:"));
}
</script>

<template>
  <a-modal
    v-model:open="showDialog"
    :title="t('DownloadHistory.ReDownloadSelectDialog.title', [torrentItems.length])"
    :width="600"
    :footer="null"
    @after-open-change="(open: boolean) => open && dialogEnter()"
  >

    <a-space class="redownload-actions" direction="vertical">
      <a-button
        v-for="(value, key) in btnItem"
        :key="key"
        :disabled="key === 'local' && disableLocalDownload"
        block
        size="large"
        :loading="isReDownloading[key as TReDownloadType]"
        @click="reDownload(key as TReDownloadType)"
      >
        <template #icon>
          <component :is="value.icon" />
        </template>
        {{ value.title }}
      </a-button>
    </a-space>
  </a-modal>

  <SentToDownloaderDialog
    v-model="showSentToDownloaderDialog"
    :torrent-items="downloadTorrentsRef"
    @cancel="() => (isReDownloading.downloader = false)"
    @done="() => submitDownloadFinish('downloader')"
  />
</template>

<style scoped lang="scss">
.redownload-actions {
  width: 100%;

  :deep(.ant-btn) {
    width: 100%;
  }
}
</style>
