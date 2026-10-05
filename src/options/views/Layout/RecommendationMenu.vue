<script lang="ts" setup>
import { computed, ref, watch } from "vue";
import PQueue from "p-queue";
import { useI18n } from "vue-i18n";
import { FireOutlined, ReloadOutlined, StarFilled } from "@antdv-next/icons";
import { Empty } from "antdv-next";
import type { ISocialRecommendationItem, TSocialRecommendationCategory } from "@ptd/social";

import { sendMessage } from "@/messages.ts";

const MOVIE_PLACEHOLDER = "/icons/movie_placeholder.png";

const { disabled } = defineProps<{
  disabled?: boolean;
}>();

const emit = defineEmits<{
  search: [title: string];
}>();

const { t } = useI18n();

const isRecommendationMenuOpen = ref(false);
const isLoadingRecommendations = ref(false);
const recommendationError = ref("");
const recommendationItems = ref<ISocialRecommendationItem[]>([]);
let recommendationRequestId = 0;

const recommendationCategories: TSocialRecommendationCategory[] = ["movie", "tv", "variety", "anime"];
const recommendationCategoryLimit = 10;
const visibleRecommendationCategoryLimit = 5;
const recommendationItemEnrichmentConcurrency = 10;

const groupedRecommendationItems = computed(() =>
  recommendationCategories.map((category) => ({
    category,
    items: recommendationItems.value.filter((item) => item.category === category).slice(0, recommendationCategoryLimit),
  })),
);

async function loadRecommendations(flush = false) {
  if (isLoadingRecommendations.value) {
    return;
  }

  if (!flush && recommendationItems.value.length > 0 && !recommendationError.value) {
    const requestId = ++recommendationRequestId;
    if (hasIncompleteRecommendations()) {
      void enrichRecommendations(requestId);
    }
    return;
  }

  isLoadingRecommendations.value = true;
  recommendationError.value = "";
  const requestId = ++recommendationRequestId;

  try {
    const result = await sendMessage("getSocialRecommendations", { flush, enrichment: "none" });
    if (requestId !== recommendationRequestId) {
      return;
    }

    if (!result.hasFailedSources || recommendationItems.value.length === 0) {
      recommendationItems.value = result.items;
    }
    if (result.hasFailedSources && recommendationItems.value.length === 0) {
      recommendationError.value = t("layout.header.hotRecommendations.loadFailed");
    }
    void enrichRecommendations(requestId);
  } catch (error) {
    console.error("Failed to load social recommendations", error);
    if (recommendationItems.value.length === 0) {
      recommendationError.value = t("layout.header.hotRecommendations.loadFailed");
    }
  } finally {
    if (requestId === recommendationRequestId) {
      isLoadingRecommendations.value = false;
    }
  }
}

function hasIncompleteRecommendations() {
  return recommendationItems.value.some(
    (item) =>
      !item.summary || !item.releaseYear || !item.region || !item.genres?.length || !item.poster?.startsWith("data:"),
  );
}

function getRecommendationItemKey(item: ISocialRecommendationItem) {
  return `${item.category}:${item.site}:${item.id}`;
}

function getVisibleRecommendationItems() {
  const categoryCounts = new Map<ISocialRecommendationItem["category"], number>();
  const visibleItems: ISocialRecommendationItem[] = [];

  for (const item of recommendationItems.value) {
    const categoryCount = categoryCounts.get(item.category) ?? 0;
    categoryCounts.set(item.category, categoryCount + 1);

    if (categoryCount < visibleRecommendationCategoryLimit) {
      visibleItems.push(item);
    }
  }

  return visibleItems;
}

function updateRecommendationItem(enrichedItem: ISocialRecommendationItem) {
  const enrichedItemKey = getRecommendationItemKey(enrichedItem);
  const itemIndex = recommendationItems.value.findIndex((item) => getRecommendationItemKey(item) === enrichedItemKey);

  if (itemIndex === -1) {
    return;
  }

  recommendationItems.value = recommendationItems.value.map((item, index) =>
    index === itemIndex ? enrichedItem : item,
  );
}

async function enrichRecommendationItems(
  requestId: number,
  items: ISocialRecommendationItem[],
  enrichment: "visible" | "all",
) {
  if (!isRecommendationMenuOpen.value) {
    return;
  }

  const enrichmentQueue = new PQueue({ concurrency: recommendationItemEnrichmentConcurrency });
  await Promise.all(
    items.map((item) =>
      enrichmentQueue.add(async () => {
        try {
          const result = await sendMessage("getSocialRecommendationItem", { item, enrichment });
          if (requestId !== recommendationRequestId || !isRecommendationMenuOpen.value) {
            return;
          }
          updateRecommendationItem(result.item);
        } catch (error) {
          console.error("Failed to enrich social recommendation item", item, error);
        }
      }),
    ),
  );
}

async function enrichRecommendations(requestId: number) {
  await enrichRecommendationItems(requestId, getVisibleRecommendationItems(), "visible");
  if (requestId !== recommendationRequestId || !isRecommendationMenuOpen.value) {
    return;
  }
  await enrichRecommendationItems(requestId, [...recommendationItems.value], "all");
}

function searchRecommendation(item: ISocialRecommendationItem) {
  isRecommendationMenuOpen.value = false;
  emit("search", item.title);
}

/**
 * 地区 → a-tag 的语义色。国内/海外用 blue / cyan 区分（⚠️ 与实现不符：实际返回的是 orange / blue，全文件没有 cyan），比原来两套手写色值
 * （#8a3b12 on #fff0d5 / #0f5c68 on #dff6f8）更贴近组件库的色板，
 * 也不会在暗色主题下和文字对比度失配 —— 原来那套是纯手写 hex，不随主题走。
 */
function getRecommendationRegionColor(region?: string) {
  return region && /(中国|华语|香港|台湾|澳门)/.test(region) ? "orange" : "blue";
}

function getRecommendationPosterSrc(item: ISocialRecommendationItem) {
  if (!item.poster || /doubanio\.com/.test(item.poster)) {
    return MOVIE_PLACEHOLDER;
  }

  return item.poster;
}

/**
 * 旧实现用 v-img 的 #error 插槽兜底。这里换成原生 img + onerror：
 * 远程海报加载失败（含防盗链 403）时退回本地占位图，且只退回一次，避免占位图自身失败导致死循环。
 */
function onPosterError(event: Event) {
  const img = event.target as HTMLImageElement | null;
  if (!img || img.dataset.fallback === "1") {
    return;
  }
  img.dataset.fallback = "1";
  img.src = MOVIE_PLACEHOLDER;
}

watch(isRecommendationMenuOpen, (isOpen) => {
  if (isOpen) {
    loadRecommendations();
  }
});
</script>

<template>
  <a-popover v-model:open="isRecommendationMenuOpen" trigger="click" placement="bottom">
    <a-button type="text" :disabled="disabled" :title="t('layout.header.hotRecommendations.title')">
      <template #icon>
        <FireOutlined />
      </template>
    </a-button>

    <template #content>
      <div class="hot-recommendation-panel">
        <div class="hot-recommendation-header">
          <FireOutlined class="hot-recommendation-header-icon" />
          <span class="hot-recommendation-header-title">{{ t("layout.header.hotRecommendations.title") }}</span>
          <a-button
            type="text"
            size="small"
            :loading="isLoadingRecommendations"
            :title="t('layout.header.hotRecommendations.refresh')"
            @click="() => loadRecommendations(true)"
          >
            <template #icon>
              <ReloadOutlined />
            </template>
          </a-button>
        </div>

        <a-divider style="margin: 0" />

        <div v-if="isLoadingRecommendations && recommendationItems.length === 0" class="hot-recommendation-state">
          <a-spin size="small" />
          <span>{{ t("layout.header.hotRecommendations.loading") }}</span>
        </div>

        <div v-else-if="recommendationError && recommendationItems.length === 0" class="hot-recommendation-state">
          <span class="hot-recommendation-error">{{ recommendationError }}</span>
        </div>

        <div v-else-if="recommendationItems.length === 0" class="hot-recommendation-state">
          {{ t("layout.header.hotRecommendations.empty") }}
        </div>

        <div v-else class="hot-recommendation-body">
          <a-row :gutter="[8, 8]">
            <a-col v-for="group in groupedRecommendationItems" :key="group.category" :xs="24" :sm="12" :lg="6">
              <div class="hot-recommendation-category">
                {{ t(`layout.header.hotRecommendations.category.${group.category}`) }}
              </div>

              <div class="hot-recommendation-list">
                <a-empty
                  v-if="group.items.length === 0"
                  class="hot-recommendation-empty"
                  :image="Empty.PRESENTED_IMAGE_SIMPLE"
                  :description="t('layout.header.hotRecommendations.empty')"
                />

                <div
                  v-for="item in group.items"
                  :key="`${item.category}:${item.site}:${item.id}`"
                  class="hot-recommendation-item"
                  @click="() => searchRecommendation(item)"
                >
                  <img
                    class="hot-recommendation-poster"
                    :src="getRecommendationPosterSrc(item)"
                    referrerpolicy="no-referrer"
                    alt=""
                    @error="onPosterError"
                  />

                  <div class="hot-recommendation-main">
                    <div class="hot-recommendation-title-row">
                      <span class="hot-recommendation-title">{{ item.title }}</span>
                      <span class="hot-recommendation-rating">
                        <StarFilled class="hot-recommendation-rating-icon" />
                        {{
                          item.ratingScore ? item.ratingScore.toFixed(1) : t("layout.header.hotRecommendations.noRating")
                        }}
                      </span>
                    </div>

                    <div class="hot-recommendation-meta">
                      <a-tag v-if="item.releaseYear" color="purple">
                        {{ item.releaseYear }}
                      </a-tag>
                      <a-tag v-if="item.region" :color="getRecommendationRegionColor(item.region)">
                        {{ item.region }}
                      </a-tag>
                      <a-tag v-for="genre in item.genres?.slice(0, 3)" :key="genre" color="green">
                        {{ genre }}
                      </a-tag>
                    </div>

                    <div class="hot-recommendation-summary">
                      {{ item.summary || t("layout.header.hotRecommendations.noSummary") }}
                    </div>
                  </div>
                </div>
              </div>
            </a-col>
          </a-row>
        </div>
      </div>
    </template>
  </a-popover>
</template>

<style scoped lang="scss">
// 宽度必须跟着视口走：面板比「按钮右侧剩余空间」宽时，antd 的 autoAdjustOverflow
// 会把 placement 翻边并把末列推到视口外裁掉（固定 1120/1280 就是这么坏的）。
.hot-recommendation-panel {
  width: min(1120px, calc(100vw - 24px));
}

.hot-recommendation-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
}

.hot-recommendation-header-title {
  flex: 1;
  font-weight: 500;
}

.hot-recommendation-header-icon {
  color: #fa541c;
}

.hot-recommendation-state {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px;
  color: rgba(0, 0, 0, 0.45);
}

.hot-recommendation-error {
  color: #ff4d4f;
}

.hot-recommendation-body {
  padding: 12px;
}

.hot-recommendation-category {
  margin-bottom: 8px;
  font-size: 0.875rem;
  font-weight: 500;
}

.hot-recommendation-list {
  max-height: 480px;
  overflow-y: auto;
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 6px;
}

// a-empty 默认大图会撑破 :lg="6" 的小栅格，模板里用的是 PRESENTED_IMAGE_SIMPLE。
// min-height 保留原来手写的占位高度，使有无内容的分类列行高一致。
.hot-recommendation-empty {
  min-height: 78px;
  margin: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  font-size: 0.875rem;
}

.hot-recommendation-item {
  display: flex;
  gap: 8px;
  min-height: 96px;
  padding: 8px;
  cursor: pointer;

  &:hover {
    background: rgba(0, 0, 0, 0.04);
  }
}

.hot-recommendation-poster {
  flex: none;
  width: 46px;
  height: 62px;
  object-fit: cover;
  border-radius: 4px;
}

.hot-recommendation-main {
  min-width: 0;
  flex: 1;
}

.hot-recommendation-title-row {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 8px;
}

.hot-recommendation-title {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hot-recommendation-rating {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 4px;
  color: rgba(0, 0, 0, 0.64);
  font-size: 0.75rem;
}

.hot-recommendation-rating-icon {
  color: #d4a017;
  font-size: 0.75rem;
}

.hot-recommendation-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 3px;
  margin-bottom: 3px;
  min-height: 20px;
}

// 原来这里是 31 行手写 chip 样式（.hot-recommendation-chip 及其 4 个变体，
// 全部是纯 hex 色值、不随主题变化）。改用 a-tag 后整块删除。
// a-tag 没有 size prop（真实 props：color/closable/closeIcon/icon/href/target/
// disabled/bordered/variant/rootClass/prefixCls/classes/styles），
// 尺寸只能靠下面的 CSS 压回去 —— scripts/check-dead-props.mjs 也会拦 size="small"。
.hot-recommendation-meta :deep(.ant-tag) {
  height: 18px;
  padding: 0 6px;
  font-size: 0.68rem;
  line-height: 16px;
  border-radius: 4px;
}

.hot-recommendation-summary {
  display: -webkit-box;
  overflow: hidden;
  white-space: normal;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  color: rgba(0, 0, 0, 0.58);
  font-size: 0.72rem;
  line-height: 1.25;
}
</style>
