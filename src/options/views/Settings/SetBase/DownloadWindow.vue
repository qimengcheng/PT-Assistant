<script setup lang="ts">
/**
 * 下载与推送（这一节原先在目录里叫「下载」）：本地下载方式、推送行为、下载历史。
 *
 * 排在「搜索」后面是因为它就是下一步：勾完种子往下载器推的那一路全在这儿配。
 * 「下载器本身」（加几个、地址、账号）不在这儿 —— 那是左侧「下载器」那一页的表格。
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
    <!-- 子组顺序按「多久碰一次」排，不是照字段名字母序：发送到下载器那五颗每天都在起作用，
         本地下载方式（谁去取那个 .torrent）基本是配一次，下载历史只有一条。 -->
    <a-form layout="vertical" class="compact-form">
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
        <div class="group-title">{{ t("SetBase.DownloadWindow.groupDownloadHistory") }}</div>
        <div class="switch-item">
          <a-switch v-model:checked="configStore.download.saveDownloadHistory" size="small" />
          <span class="label">{{ t("SetBase.DownloadWindow.saveDownloadHistory") }}</span>
        </div>
      </div>
    </a-form>
  </div>
</template>
