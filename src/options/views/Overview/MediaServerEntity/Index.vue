<script setup lang="ts">
/**
 * 媒体库浏览页（antdv-next 平移）。
 * 跨媒体服务器搜索影片，CSS columns 瀑布流展示，悬停卡片查看详情/访问原页；
 * 支持服务器范围多选、滚动自动加载更多（配置项）与手动加载更多。
 */
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute } from "vue-router";
import { isEmpty } from "es-toolkit/compat";
import {
  CheckOutlined,
  DatabaseOutlined,
  ExportOutlined,
  HeartFilled,
  HeartOutlined,
  HddOutlined,
  InfoCircleOutlined,
  PlaySquareOutlined,
  SearchOutlined,
} from "@antdv-next/icons";
import { getMediaServerIcon, type IMediaServerItem } from "@ptd/mediaServer";

import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import { useConfigStore } from "@/options/stores/config.ts";

import ItemInformationDialog from "./ItemInformationDialog.vue";

import { doSearch, formatSize, searchMediaServerIds } from "./utils.ts";

const { t } = useI18n();
const route = useRoute();
const configStore = useConfigStore();
const runtimeStore = useRuntimeStore();
const metadataStore = useMetadataStore();

const search = ref<string>((route.query.search as string) || "");

const showItem = ref<IMediaServerItem | null>(null);
const showItemInformationDialog = ref<boolean>(false);

const hasMore = computed<boolean>(() =>
  isEmpty(runtimeStore.mediaServerSearch.searchStatus)
    ? true
    : Object.values(runtimeStore.mediaServerSearch.searchStatus).some((x) => x?.canLoadMore ?? true),
);

function showItemInformation(item: IMediaServerItem) {
  showItem.value = item;
  showItemInformationDialog.value = true;
}

function openItem(item: IMediaServerItem) {
  window.open(item.url, "_blank", "noopener,noreferrer,nofollow");
}

function onScroll() {
  // 当滚动到页面底部时加载更多
  if (
    configStore.mediaServerEntity.autoSearchMoreWhenScroll &&
    window.innerHeight + window.scrollY >= document.body.offsetHeight - 50 &&
    !runtimeStore.mediaServerSearch.isSearching &&
    hasMore.value
  ) {
    void doSearch({ searchKey: search.value, loadMore: true });
  }
}

onMounted(() => {
  window.addEventListener("scroll", onScroll, { passive: true });

  if (configStore.mediaServerEntity.autoSearchWhenMount && runtimeStore.mediaServerSearch.searchResult.length === 0) {
    void doSearch({ searchKey: search.value });
  }
});

onUnmounted(() => {
  window.removeEventListener("scroll", onScroll);
});

// ===== 服务器范围多选 =====
const enabledServerIds = computed(() => metadataStore.getEnabledMediaServers.map((mediaServer) => mediaServer.id));

const allServersChecked = computed(
  () =>
    enabledServerIds.value.length > 0 &&
    enabledServerIds.value.every((id) => searchMediaServerIds.value.includes(id)),
);

const allServersIndeterminate = computed(() => {
  const hit = searchMediaServerIds.value.filter((id) => enabledServerIds.value.includes(id)).length;
  return hit > 0 && hit < enabledServerIds.value.length;
});

function toggleAllServers(checked: boolean) {
  searchMediaServerIds.value = checked ? [...enabledServerIds.value] : [];
}

function triggerSearch() {
  void doSearch({ searchKey: search.value });
}

function triggerLoadMore() {
  void doSearch({ searchKey: search.value, loadMore: true });
}

function firstVideoTitle(item: IMediaServerItem): string | undefined {
  return item.streams?.find((s) => s.type === "Video")?.title;
}
</script>

<template>
  <div class="media-server-entity">
    <a-alert :message="t('route.Overview.MediaServerEntity')" type="info" show-icon style="margin-bottom: 12px" />

    <a-card>
      <div class="search-row">
        <a-input
          v-model:value="search"
          allow-clear
          class="search-input"
          :placeholder="t('MediaServerEntity.searchPlaceholder')"
          @press-enter="triggerSearch"
        >
          <template #addonBefore>
            <a-popover placement="bottomLeft" trigger="click">
              <DatabaseOutlined class="server-filter-icon" />
              <template #content>
                <div class="server-filter-panel">
                  <a-checkbox
                    :checked="allServersChecked"
                    :indeterminate="allServersIndeterminate"
                    @change="(e: any) => toggleAllServers(e.target.checked)"
                  >
                    {{ t("common.checkbox.all") }}
                  </a-checkbox>
                  <a-divider class="filter-divider" />
                  <a-checkbox-group v-model:value="searchMediaServerIds" class="server-checkbox-group">
                    <div v-for="item in metadataStore.getMediaServers" :key="item.id" class="server-checkbox-item">
                      <a-checkbox :value="item.id" :disabled="item.enabled === false">
                        <span :class="{ 'disabled-name': item.enabled === false }">{{ item.name }}</span>
                      </a-checkbox>
                      <img :src="getMediaServerIcon(item.type)" :alt="item.type" class="server-type-icon" />
                    </div>
                  </a-checkbox-group>
                </div>
              </template>
            </a-popover>
          </template>
          <template #addonAfter>
            <a-button type="primary" :loading="runtimeStore.mediaServerSearch.isSearching" @click="triggerSearch">
              <template #icon><SearchOutlined /></template>
            </a-button>
          </template>
        </a-input>
      </div>

      <!-- 瀑布流形式展示媒体服务器搜索结果 -->
      <div v-if="runtimeStore.mediaServerSearch.searchResult.length > 0" class="masonry-grid">
        <div v-for="item in runtimeStore.mediaServerSearch.searchResult" :key="item.url" class="masonry-item">
          <div v-if="item.poster" class="poster-wrap">
            <img :src="item.poster" :title="item.name" :alt="item.name" class="poster-img" />

            <!-- 左上角：格式 / 大小 -->
            <div class="poster-tags poster-tags-left">
              <a-tag v-if="item.format" color="blue" class="poster-tag">
                <PlaySquareOutlined />
                {{ item.format?.toUpperCase() }}
                <template v-if="firstVideoTitle(item)"> / {{ firstVideoTitle(item) }}</template>
              </a-tag>
              <a-tag v-if="item.size" class="poster-tag">
                <HddOutlined />
                {{ formatSize(item.size ?? 0) }}
              </a-tag>
            </div>

            <!-- 右上角：观看 / 喜欢状态 -->
            <div v-if="item.user" class="poster-tags poster-tags-right">
              <CheckOutlined v-if="item.user?.IsPlayed" class="user-state played" />
              <HeartFilled v-if="item.user?.IsFavorite" class="user-state favorite" />
              <HeartOutlined v-else class="user-state favorite-outline" />
            </div>

            <!-- 悬停遮罩：详情 / 访问 -->
            <div class="poster-overlay">
              <a-button block class="overlay-btn" @click="() => showItemInformation(item)">
                <InfoCircleOutlined />
                {{ t("MediaServerEntity.detail") }}
              </a-button>
              <a-button block class="overlay-btn" @click="() => openItem(item)">
                <ExportOutlined />
                {{ t("common.visit") }}
              </a-button>
            </div>
          </div>

          <div class="item-caption">
            <a :href="item.url" :title="item.name" class="item-name" target="_blank">{{ item.name }}</a>
            <div v-if="metadataStore.mediaServers[item.server]" class="item-server">
              <img
                :src="getMediaServerIcon(metadataStore.mediaServers[item.server].type)"
                :alt="metadataStore.mediaServers[item.server].name"
                class="server-type-icon"
              />
              <span>{{ metadataStore.mediaServers[item.server].name }}</span>
            </div>
          </div>
        </div>
      </div>

      <a-empty v-else :description="t('MediaServerEntity.noItems')" class="empty-state" />

      <div class="load-more-row">
        <a-button
          :disabled="!hasMore"
          :loading="runtimeStore.mediaServerSearch.isSearching"
          @click="triggerLoadMore"
        >
          {{ t("MediaServerEntity.loadMore") }}
        </a-button>
      </div>
    </a-card>

    <ItemInformationDialog v-model="showItemInformationDialog" :item="showItem as IMediaServerItem" />
  </div>
</template>

<style scoped>
.media-server-entity {
  padding: 16px;
}
.search-row {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 12px;
}
.search-input {
  max-width: 500px;
  width: 100%;
}
.server-filter-icon {
  font-size: 16px;
  cursor: pointer;
}
.server-filter-panel {
  min-width: 200px;
  max-height: 320px;
  overflow-y: auto;
}
.filter-divider {
  margin: 6px 0;
}
.server-checkbox-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
}
.server-checkbox-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.disabled-name {
  color: rgba(0, 0, 0, 0.25);
}
.server-type-icon {
  width: 18px;
  height: 18px;
  object-fit: contain;
}

/* ===== 瀑布流（CSS columns，断点与旧版一致） ===== */
.masonry-grid {
  column-gap: 1rem;
}
@media (max-width: 599.98px) {
  .masonry-grid {
    column-count: 2;
  }
}
@media (min-width: 600px) and (max-width: 959.98px) {
  .masonry-grid {
    column-count: 4;
  }
}
@media (min-width: 960px) and (max-width: 1279.98px) {
  .masonry-grid {
    column-count: 5;
  }
}
@media (min-width: 1280px) {
  .masonry-grid {
    column-count: 7;
  }
}
.masonry-item {
  break-inside: avoid;
  margin-bottom: 1rem;
}
.poster-wrap {
  position: relative;
  border-radius: 8px;
  overflow: hidden;
}
.poster-img {
  display: block;
  width: 100%;
}
.poster-tags {
  position: absolute;
  top: 4px;
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-width: calc(100% - 32px);
}
.poster-tags-left {
  left: 4px;
  align-items: flex-start;
}
.poster-tags-right {
  right: 4px;
  align-items: flex-end;
}
.poster-tag {
  margin-inline-end: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.user-state {
  font-size: 16px;
  filter: drop-shadow(0 0 2px rgba(0, 0, 0, 0.6));
}
.user-state.played {
  color: #52c41a;
}
.user-state.favorite {
  color: #ff4d4f;
}
.user-state.favorite-outline {
  color: rgba(255, 255, 255, 0.9);
}
.poster-overlay {
  position: absolute;
  inset: 0;
  z-index: 3;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 8px;
  padding: 16px;
  background: rgba(0, 0, 0, 0.55);
  opacity: 0;
  transition: opacity 0.2s;
}
.poster-wrap:hover .poster-overlay {
  opacity: 1;
}
.overlay-btn {
  text-align: center;
}
.item-caption {
  text-align: center;
  margin-top: 4px;
}
.item-name {
  display: block;
  font-weight: 600;
  white-space: normal;
  word-break: break-all;
}
.item-server {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  margin-top: 4px;
  color: #666;
  font-size: 12px;
}
.empty-state {
  padding: 48px 0;
}
.load-more-row {
  display: flex;
  justify-content: center;
  margin-top: 16px;
}
</style>
