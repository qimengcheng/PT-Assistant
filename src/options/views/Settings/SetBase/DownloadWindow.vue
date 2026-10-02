<script setup lang="ts">
/**
 * 下载设置：本地下载方式、推送行为、下载历史。
 */
import { useConfigStore } from "@/options/stores/config.ts";
import { LocalDownloadMethod } from "@/shared/types/common/download.ts";

const configStore = useConfigStore();

const localMethodOptions = [
  { value: "web", label: "打开种子页面（由浏览器接管）" },
  { value: "browser", label: "扩展直接下载（默认）" },
  { value: "extension", label: "扩展解析后保存（高级，可控制文件名）" },
];
</script>

<template>
  <div class="download-window">
    <a-form layout="vertical" class="compact-form">
      <div class="group">
        <div class="group-title">本地下载方式</div>
        <div class="switch-item" style="margin-bottom: 10px">
          <span class="label" style="min-width: 110px">下载种子文件的方式</span>
          <a-select v-model:value="configStore.download.localDownloadMethod" :options="localMethodOptions" style="width: 280px" />
        </div>
        <div class="switch-grid">
          <div class="switch-item">
            <a-switch v-model:checked="configStore.download.ignoreSiteDownloadIntervalWhenLocalDownload" size="small" />
            <span class="label">本地下载时忽略站点的下载间隔限制</span>
          </div>
        </div>
      </div>

      <div class="group">
        <div class="group-title">发送到下载器</div>
        <div class="switch-grid">
          <div class="switch-item">
            <a-switch v-model:checked="configStore.download.allowDirectSendToClient" size="small" />
            <span class="label">允许直接推送到下载器（不弹确认）</span>
          </div>
          <div class="switch-item">
            <a-switch v-model:checked="configStore.download.useQuickSendToClient" size="small" />
            <span class="label">启用快速推送（使用默认下载器）</span>
          </div>
          <div class="switch-item">
            <a-switch v-model:checked="configStore.download.saveLastDownloader" size="small" />
            <span class="label">记住上一次使用的下载器</span>
          </div>
          <div class="switch-item">
            <a-switch v-model:checked="configStore.download.initDownloaderTorrentOnEnter" size="small" />
            <span class="label">进入下载器页面时自动刷新列表</span>
          </div>
          <div class="switch-item">
            <a-switch v-model:checked="configStore.download.allowDownloaderFilterForSite" size="small" />
            <span class="label">允许为下载器配置站点过滤器</span>
          </div>
        </div>
      </div>

      <div class="group">
        <div class="group-title">下载历史</div>
        <div class="switch-item">
          <a-switch v-model:checked="configStore.download.saveDownloadHistory" size="small" />
          <span class="label">保存下载历史记录</span>
        </div>
      </div>
    </a-form>
  </div>
</template>
