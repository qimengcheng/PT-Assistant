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
        <a-form-item label="下载种子文件的方式">
          <a-select v-model:value="configStore.download.localDownloadMethod" :options="localMethodOptions" />
        </a-form-item>
        <a-form-item>
          <a-switch v-model:checked="configStore.download.ignoreSiteDownloadIntervalWhenLocalDownload" />
          <span class="label">本地下载时忽略站点的下载间隔限制</span>
        </a-form-item>
      </div>

      <div class="group">
        <div class="group-title">发送到下载器</div>
        <a-form-item>
          <a-switch v-model:checked="configStore.download.allowDirectSendToClient" />
          <span class="label">允许直接推送到下载器（不经过确认对话框）</span>
        </a-form-item>
        <a-form-item>
          <a-switch v-model:checked="configStore.download.useQuickSendToClient" />
          <span class="label">启用快速推送（使用默认下载器）</span>
        </a-form-item>
        <a-form-item>
          <a-switch v-model:checked="configStore.download.saveLastDownloader" />
          <span class="label">记住上一次使用的下载器</span>
        </a-form-item>
        <a-form-item>
          <a-switch v-model:checked="configStore.download.initDownloaderTorrentOnEnter" />
          <span class="label">进入下载器页面时自动刷新种子列表</span>
        </a-form-item>
        <a-form-item>
          <a-switch v-model:checked="configStore.download.allowDownloaderFilterForSite" />
          <span class="label">允许为每个下载器配置可用的站点过滤器</span>
        </a-form-item>
      </div>

      <div class="group">
        <div class="group-title">下载历史</div>
        <a-form-item>
          <a-switch v-model:checked="configStore.download.saveDownloadHistory" />
          <span class="label">保存下载历史记录</span>
        </a-form-item>
      </div>
    </a-form>
  </div>
</template>

<style scoped>
.compact-form :deep(.ant-form-item) {
  margin-bottom: 10px;
}

.group {
  margin-bottom: 16px;
  padding: 12px 16px;
  border: 1px solid #f0f0f0;
  border-radius: 6px;
}

.group-title {
  font-weight: 600;
  margin-bottom: 10px;
}

.label {
  margin-left: 10px;
}
</style>
