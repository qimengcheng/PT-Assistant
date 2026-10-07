<script setup lang="ts">
/**
 * 下载设置：本地下载方式、推送行为、下载历史。
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useConfigStore } from "@/options/stores/config.ts";
import { LocalDownloadMethod } from "@/shared/types/common/download.ts";

const { t } = useI18n();
const configStore = useConfigStore();

// computed：label 里有 t()，setup 里一次性求值的话切语言不会重算
const localMethodOptions = computed(() => [
  { value: "web", label: t("SetBase.DownloadWindow.methodWeb") },
  { value: "browser", label: t("SetBase.DownloadWindow.methodBrowser") },
  { value: "extension", label: t("SetBase.DownloadWindow.methodExtension") },
]);
</script>

<template>
  <div class="download-window">
    <a-form layout="vertical" class="compact-form">
      <div class="group">
        <div class="group-title">{{ t("SetBase.DownloadWindow.groupLocalDownload") }}</div>
        <div class="switch-item" style="margin-bottom: 10px">
          <span class="label" style="min-width: 110px">{{ t("SetBase.DownloadWindow.localDownloadMethod") }}</span>
          <a-select v-model:value="configStore.download.localDownloadMethod" :options="localMethodOptions" style="width: 280px" />
        </div>
        <div class="switch-grid">
          <div class="switch-item">
            <a-switch v-model:checked="configStore.download.ignoreSiteDownloadIntervalWhenLocalDownload" size="small" />
            <span class="label">{{ t("SetBase.DownloadWindow.ignoreSiteDownloadInterval") }}</span>
          </div>
        </div>
      </div>

      <div class="group">
        <div class="group-title">{{ t("SetBase.DownloadWindow.groupSendToDownloader") }}</div>
        <div class="switch-grid">
          <div class="switch-item">
            <a-switch v-model:checked="configStore.download.allowDirectSendToClient" size="small" />
            <span class="label">{{ t("SetBase.DownloadWindow.allowDirectSendToClient") }}</span>
          </div>
          <div class="switch-item">
            <a-switch v-model:checked="configStore.download.useQuickSendToClient" size="small" />
            <span class="label">{{ t("SetBase.DownloadWindow.useQuickSendToClient") }}</span>
          </div>
          <div class="switch-item">
            <a-switch v-model:checked="configStore.download.saveLastDownloader" size="small" />
            <span class="label">{{ t("SetBase.DownloadWindow.saveLastDownloader") }}</span>
          </div>
          <div class="switch-item">
            <a-switch v-model:checked="configStore.download.initDownloaderTorrentOnEnter" size="small" />
            <span class="label">{{ t("SetBase.DownloadWindow.initDownloaderTorrentOnEnter") }}</span>
          </div>
          <div class="switch-item">
            <a-switch v-model:checked="configStore.download.allowDownloaderFilterForSite" size="small" />
            <span class="label">{{ t("SetBase.DownloadWindow.allowDownloaderFilterForSite") }}</span>
          </div>
        </div>
      </div>

      <div class="group">
        <div class="group-title">{{ t("SetBase.DownloadWindow.groupDownloadHistory") }}</div>
        <div class="switch-item">
          <a-switch v-model:checked="configStore.download.saveDownloadHistory" size="small" />
          <span class="label">{{ t("SetBase.DownloadWindow.saveDownloadHistory") }}</span>
        </div>
      </div>
    </a-form>
  </div>
</template>
