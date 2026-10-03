<script setup lang="ts">
/**
 * 媒体条目详情对话框（antdv-next 平移）。
 * 封面、简介、标签、时长/大小、媒体流信息（音轨/字幕悬停展开）、观看与喜欢状态。
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import {
  BlockOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  ExportOutlined,
  FileTextOutlined,
  HddOutlined,
  HeartFilled,
  HeartOutlined,
  SoundOutlined,
  TagsOutlined,
  VideoCameraOutlined,
} from "@antdv-next/icons";
import type { IMediaServerItem } from "@ptd/mediaServer";

import { formatSize } from "./utils.ts";

const { t } = useI18n();

const showDialog = defineModel<boolean>();
const { item } = defineProps<{
  item: IMediaServerItem;
}>();

function streamsOf(type: string) {
  return computed(() => (item.streams ?? []).filter((s) => s.type === type));
}

const videoStreams = streamsOf("Video");
const audioStreams = streamsOf("Audio");
const subtitleStreams = streamsOf("Subtitle");

function openItem() {
  window.open(item.url, "_blank", "noopener,noreferrer,nofollow");
}

/**
 * 秒 → 人类可读的钟面时长（H:MM:SS / M:SS）。
 * 旧实现反向转成 ISO-8601 的 "PT1H30M" 机器码直接展示给用户，已修正。
 */
function formatDuration(rawSeconds: number) {
  let seconds = Math.floor(Math.abs(rawSeconds));
  const hours = Math.floor(seconds / 3600);
  seconds %= 3600;
  const minutes = Math.floor(seconds / 60);
  seconds = seconds % 60;

  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${minutes}:${ss}`;
}
</script>

<template>
  <a-modal
    v-model:open="showDialog"
    :title="t('MediaServerEntity.ItemInformationDialog.title')"
    :width="800"
    :footer="null"
  >
    <a-row :gutter="16" align="middle">
      <a-col :xs="24" :md="8">
        <a-image v-if="item.poster" :src="item.poster" :alt="item.name" class="poster-img" />
      </a-col>
      <a-col :xs="24" :md="16">
        <a :href="item.url" :title="item.name" class="item-title" rel="noopener noreferrer nofollow" target="_blank">
          {{ item.name }}
        </a>
        <p class="item-desc">{{ item.description ?? "" }}</p>

        <div v-if="item.tags && item.tags.length > 0" class="info-row">
          <span class="info-label"><TagsOutlined /> {{ t("MediaServerEntity.ItemInformationDialog.type") }}</span>
          <a-space :size="4" wrap>
            <a-tag v-for="tag in item.tags ?? []" :key="tag.name" color="orange">
              <a v-if="tag.url" :href="tag.url" rel="noopener noreferrer nofollow" target="_blank">{{ tag.name }}</a>
              <span v-else>{{ tag.name }}</span>
            </a-tag>
          </a-space>
        </div>

        <div v-if="item.duration" class="info-row">
          <span class="info-label">{{ t("MediaServerEntity.ItemInformationDialog.duration") }}</span>
          <a-tag color="green">
            <ClockCircleOutlined />
            {{ formatDuration(item.duration ?? 0) }}
          </a-tag>
        </div>

        <div v-if="item.size" class="info-row">
          <span class="info-label">{{ t("MediaServerEntity.ItemInformationDialog.size") }}</span>
          <a-tag color="purple">
            <HddOutlined />
            {{ formatSize(item.size ?? 0) }}
          </a-tag>
        </div>

        <div v-if="item.streams && item.streams.length > 0" class="info-row">
          <span class="info-label">{{ t("MediaServerEntity.ItemInformationDialog.mediaInfo") }}</span>
          <a-space :size="4" wrap>
            <a-tag v-if="item.format" color="blue">
              <BlockOutlined />
              {{ item.format?.toUpperCase() }}
            </a-tag>

            <a-tag v-if="videoStreams.length > 0" color="blue">
              <VideoCameraOutlined />
              {{ videoStreams[0].title }}
            </a-tag>

            <a-popover v-if="audioStreams.length > 0" trigger="hover">
              <a-tag color="blue" class="cursor-pointer">
                <SoundOutlined />
                {{ audioStreams.length }}
              </a-tag>
              <template #content>
                <div v-for="stream in audioStreams" :key="stream.title" class="stream-line">
                  <SoundOutlined /> {{ stream.title }}
                </div>
              </template>
            </a-popover>

            <a-popover v-if="subtitleStreams.length > 0" trigger="hover">
              <a-tag color="blue" class="cursor-pointer">
                <FileTextOutlined />
                {{ subtitleStreams.length }}
              </a-tag>
              <template #content>
                <div v-for="stream in subtitleStreams" :key="stream.title" class="stream-line">
                  <FileTextOutlined /> {{ stream.title }}
                </div>
              </template>
            </a-popover>
          </a-space>
        </div>

        <a-divider class="my-2" />

        <div class="status-row">
          <CheckCircleFilled v-if="item.user?.IsPlayed" class="status-icon played" />
          <HeartFilled v-if="item.user?.IsFavorite" class="status-icon favorite" />
          <HeartOutlined v-else class="status-icon favorite-outline" />
          <a-button type="primary" class="visit-btn" @click="openItem">
            <ExportOutlined />
            {{ t("common.visit") }}
          </a-button>
        </div>
      </a-col>
    </a-row>
  </a-modal>
</template>

<style scoped>
.poster-img {
  width: 100%;
  border-radius: 8px;
  overflow: hidden;
}
.item-title {
  display: inline-block;
  width: 100%;
  font-size: 20px;
  font-weight: 600;
  margin-bottom: 8px;
}
.item-desc {
  color: #666;
  font-size: 13px;
}
.info-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 8px;
}
.info-label {
  flex: 0 0 auto;
  min-width: 84px;
  color: #666;
}
.stream-line {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 0;
}
.cursor-pointer {
  cursor: pointer;
}
.status-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.status-icon {
  font-size: 28px;
}
.status-icon.played {
  color: #52c41a;
}
.status-icon.favorite {
  color: #ff4d4f;
}
.status-icon.favorite-outline {
  color: #bfbfbf;
}
.visit-btn {
  margin-left: auto;
}
</style>
