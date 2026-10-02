<script setup lang="ts">
import { computed, type Component } from "vue";
import { useI18n } from "vue-i18n";
import { CloudOutlined, DownloadOutlined } from "@antdv-next/icons";

import { getDownloaderIcon } from "@ptd/downloader";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import type { TDownloaderKey } from "@/shared/types.ts";

const { downloader } = defineProps<{
  downloader: TDownloaderKey;
}>();

const { t } = useI18n();
const metadataStore = useMetadataStore();

const downloaderConfig = metadataStore.downloaders[downloader];

/**
 * 三种形态：本地下载（图标）/ 已配置的下载器（品牌图）/ 配置已被删除（灰色云图标）。
 * 拆成两个 computed 而不是返回联合类型，方便模板里做互斥分支而不必对对象做 `in` 收窄。
 */
const iconImage = computed(() =>
  downloader !== "local" && downloaderConfig ? getDownloaderIcon(downloaderConfig.type) : null,
);
const IconComponent = computed<Component | null>(() => {
  if (downloader === "local") return DownloadOutlined;
  if (!downloaderConfig) return CloudOutlined;
  return null;
});
const iconColor = computed(() => (downloader === "local" ? "#faad14" : "#9e9e9e"));
</script>

<template>
  <slot :config="downloaderConfig" :icon="{ image: iconImage, component: IconComponent, color: iconColor }">
    <div class="downloader_label">
      <div class="pa-0 downloader_icon">
        <img v-if="iconImage" class="downloader_avatar" :src="iconImage" alt="" />
        <component v-else-if="IconComponent" :is="IconComponent" class="downloader_glyph" :style="{ color: iconColor }" />
      </div>
      <div class="downloader_info align-self-center">
        <span class="font-weight-bold">
          <template v-if="downloader === 'local'">{{ t("downloaderLabel.localDownload") }}</template>
          <template v-else-if="downloaderConfig">{{ downloaderConfig.name }}</template>
          <template v-else>
            <span class="text-decoration-line-through text-no-wrap">[{{ downloader }}]</span>
          </template>
        </span>
        <template v-if="downloaderConfig">
          <br />
          <a :href="downloaderConfig.address" class="text-body-small" target="_blank" rel="noopener noreferrer">
            [{{ downloaderConfig.address }}]
          </a>
        </template>
      </div>
    </div>
  </slot>
</template>

<style scoped lang="scss">
.downloader_label {
  display: grid;
  grid-column-gap: 4px;
  grid-row-gap: 4px;
  justify-content: left;

  .downloader_icon {
    grid-area: 1 / 1 / 2 / 2;
  }

  .downloader_info {
    grid-area: 1 / 2 / 2 / 3;
  }
}

.downloader_avatar {
  width: 24px;
  height: 24px;
  object-fit: contain;
}

.downloader_glyph {
  font-size: 24px;
  line-height: 24px;
}
</style>
