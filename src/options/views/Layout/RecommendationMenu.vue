<script lang="ts" setup>
import { computed, ref, watch } from "vue";
import PQueue from "p-queue";
import { useI18n } from "vue-i18n";
import { FireOutlined, ReloadOutlined, StarFilled } from "@antdv-next/icons";
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

function getRecommendationRegionClass(region?: string) {
  return region && /(中国|华语|香港|台湾|澳门)/.test(region)
    ? "hot-recommendation-chip-region-domestic"
    : "hot-recommendation-chip-region-foreign";
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
  <a-popover v-model:open="isRecommendationMenuOpen" trigger="click" placement="bottomRight">
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
                <div v-if="group.items.length === 0" class="hot-recommendation-empty">
                  {{ t("layout.header.hotRecommendations.empty") }}
                </div>

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
                      <span v-if="item.releaseYear" class="hot-recommendation-chip hot-recommendation-chip-year">
                        {{ item.releaseYear }}
                      </span>
                      <span
                        v-if="item.region"
                        :class="['hot-recommendation-chip', getRecommendationRegionClass(item.region)]"
                      >
                        {{ item.region }}
                      </span>
                      <span
                        v-for="genre in item.genres?.slice(0, 3)"
                        :key="genre"
                        class="hot-recommendation-chip hot-recommendation-chip-genre"
                      >
                        {{ genre }}
                      </span>
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
.hot-recommendation-panel {
  min-width: 1120px;
  max-width: 1280px;
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

.hot-recommendation-empty {
  min-height: 78px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(0, 0, 0, 0.45);
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

.hot-recommendation-chip {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  height: 18px;
  padding: 0 6px;
  border-radius: 4px;
  font-size: 0.68rem;
  line-height: 18px;
}

.hot-recommendation-chip-year {
  color: #6750a4;
  background: #eee8ff;
}

.hot-recommendation-chip-region-domestic {
  color: #8a3b12;
  background: #fff0d5;
}

.hot-recommendation-chip-region-foreign {
  color: #0f5c68;
  background: #dff6f8;
}

.hot-recommendation-chip-genre {
  color: #2f5d37;
  background: #e6f4ea;
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
