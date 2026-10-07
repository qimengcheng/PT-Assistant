<script setup lang="ts">
/**
 * 媒体库浏览页（antdv-next 平移）。
 * 跨媒体服务器搜索影片，<a-masonry> 瀑布流展示（不是手写 CSS columns 了，见下方 :335 的交棒说明），
 * 悬停卡片查看详情/访问原页；
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
  SettingOutlined,
} from "@antdv-next/icons";
import { getMediaServerIcon, type IMediaServerItem } from "@ptd/mediaServer";

import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import { useConfigStore } from "@/options/stores/config.ts";

import ItemInformationDialog from "./ItemInformationDialog.vue";
import ServerManager from "./ServerManager.vue";

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

/**
 * metadata store 靠 chrome.storage 异步水合，水合完成前 `getEnabledMediaServers` 是空数组 ——
 * 那**不等于**「用户没有服务器」。所以「没有可搜目标」只在确认水合之后才成立，
 * 否则冷启动首帧会把搜索框和加载更多闪一下禁用，还会把空态文案指向错的地方
 * （AGENTS §3.4 防线⑤ 那一族：派生是对的做法，但派生的起点也得是真的）。
 */
const metadataHydrated = ref<boolean>(false);

/**
 * 服务器管理面板。「媒体服务器」那一整页 v0.37.0 起并进这里，由工具条那颗按钮展开。
 * 一台服务器都没有时自动展开：那种状态下浏览区必然是空的，功能入口不该还要人猜。
 */
const showServerManager = ref<boolean>(false);

void metadataStore.$onReady(() => {
  metadataHydrated.value = true;
  showServerManager.value = metadataStore.getMediaServers.length === 0;
});

const managerToggleLabel = computed(() =>
  showServerManager.value ? t("MediaServerEntity.collapseManage") : t("MediaServerEntity.manageServers"),
);

/**
 * 「参与搜索的服务器范围」为空时，搜索和加载更多都是**静默空转**：
 * `doSearch` 是 `for (const id of searchMediaServerIds)`，一条都没有就一次请求都不发，
 * 不报错、不出 spinner、也不弹 snakebar —— 界面表现就是「点了没反应」。
 * 空下来的来路有三条，用户分不清是哪一条，所以这里不区分、统一把按钮禁掉并说清去哪补：
 *   ① 压根没在「媒体服务器」页添加；
 *   ② 添加了但「启用?」是关的（getter 只收 enabled 的）；
 *   ③ 在搜索框前那个数据库弹层里把勾全取消了（那是用户主动选择，会盖过派生值）。
 */
const noSearchTarget = computed<boolean>(
  () => metadataHydrated.value && searchMediaServerIds.value.length === 0,
);

function showItemInformation(item: IMediaServerItem) {
  showItem.value = item;
  showItemInformationDialog.value = true;
}

function openItem(item: IMediaServerItem) {
  window.open(item.url, "_blank", "noopener,noreferrer,nofollow");
}

/**
 * 「滚动到底自动加载更多」锚点。
 *
 * ⚠️ 不能监听 window scroll：选项页外壳是 .shell{height:100vh} + .content{overflow-y:auto}
 * （entrypoints/options/style.css），window/document.body 本身从不滚动，旧实现里
 * window.scrollY 恒为 0、scroll 事件永不触发，autoSearchMoreWhenScroll 设置形同虚设。
 * IntersectionObserver 以浏览器视口为准、同时受滚动容器裁切影响，锚点进入
 * .content 视口底边即触发，无需关心具体哪个祖先在滚动。
 */
const loadMoreSentinel = ref<HTMLElement | null>(null);
let loadMoreObserver: IntersectionObserver | null = null;

/** 是否发起过至少一次搜索：用于区分「未搜索 / 搜索无结果」两种空态 */
const hasSearchedOnce = ref<boolean>(false);

function runSearch(options: { searchKey: string; loadMore?: boolean }) {
  hasSearchedOnce.value = true;
  return doSearch(options);
}

onMounted(async () => {
  loadMoreObserver = new IntersectionObserver(
    (entries) => {
      if (
        entries[0]?.isIntersecting &&
        configStore.mediaServerEntity.autoSearchMoreWhenScroll &&
        !runtimeStore.mediaServerSearch.isSearching &&
        hasMore.value
      ) {
        void runSearch({ searchKey: search.value, loadMore: true });
      }
    },
    { rootMargin: "160px" },
  );
  if (loadMoreSentinel.value) {
    loadMoreObserver.observe(loadMoreSentinel.value);
  }

  // autoSearchWhenMount 是用户存下来的偏好，而 config store 靠 chrome.storage 异步水合：
  // 不等它就判断，读到的是初始值，表现为「设置了首屏自动搜索但冷启动不搜」，且完全不报错。
  // 观察器的接线在上面已经做完、不依赖水合，所以等待放在这里而不是钩子开头。
  await configStore.$onReady();

  if (configStore.mediaServerEntity.autoSearchWhenMount && runtimeStore.mediaServerSearch.searchResult.length === 0) {
    void runSearch({ searchKey: search.value });
  }
});

onUnmounted(() => {
  loadMoreObserver?.disconnect();
  loadMoreObserver = null;
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
  void runSearch({ searchKey: search.value });
}

function triggerLoadMore() {
  void runSearch({ searchKey: search.value, loadMore: true });
}

function firstVideoTitle(item: IMediaServerItem): string | undefined {
  return item.streams?.find((s) => s.type === "Video")?.title;
}
</script>

<template>
  <div class="media-server-entity page-fill">
    <a-alert :title="t('route.Overview.MediaServerEntity')" type="info" show-icon style="margin-bottom: 12px" />

    <a-card class="page-fill-grow">
      <div class="search-row">
        <a-button class="manager-toggle" @click="showServerManager = !showServerManager">
          <template #icon><SettingOutlined /></template>
          {{ managerToggleLabel }}
        </a-button>

        <a-input-search
          v-model:value="search"
          allow-clear
          class="search-input"
          :disabled="noSearchTarget"
          :enter-button="t('common.search')"
          :loading="runtimeStore.mediaServerSearch.isSearching"
          :placeholder="t('MediaServerEntity.searchPlaceholder')"
          enterkeyhint="search"
          @search="triggerSearch"
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
        </a-input-search>
      </div>

      <ServerManager v-show="showServerManager" class="manager-block" />

      <!-- 搜索中：结果区给加载反馈；未搜索 / 空结果给不同空态文案 -->
      <a-spin :spinning="runtimeStore.mediaServerSearch.isSearching">
        <!-- 瀑布流形式展示媒体服务器搜索结果 -->
        <a-masonry
          v-if="runtimeStore.mediaServerSearch.searchResult.length > 0"
          class="masonry-grid"
          :items="runtimeStore.mediaServerSearch.searchResult"
          :columns="{ xs: 2, sm: 4, md: 5, lg: 5, xl: 7, xxl: 7 }"
          :gutter="16"
        >
          <!-- 必须用 #itemRender 插槽而不是 :itemRender 函数 prop：
               函数 prop 收到的参数只有 item 本身、没有 index（SSR 实测会渲染成
               "undefined:甲"），插槽拿到的才是 {...item, index}。
               不起解构别名 —— 插槽参数本身就是原对象，多一个 index 字段而已，
               直接当 IMediaServerItem 传给 firstVideoTitle / openItem 即可。
               另外 Masonry 没有 item-key prop（真实 props 只有
               classes/styles/gutter/items/itemRender/columns/fresh/rootClass/prefixCls），
               key 由 items 里的对象身份决定，不需要也不能传。 -->
          <template #itemRender="item">
            <div class="masonry-item">
              <div v-if="item.poster" class="poster-wrap">
                <img :src="item.poster" :title="item.name" :alt="item.name" class="poster-img" />

                <!-- 左上角：格式 / 大小 -->
                <div class="poster-tags poster-tags-left">
                  <a-tag v-if="item.format" color="blue" class="poster-tag">
                    <template #icon><PlaySquareOutlined /></template>
                    <span>{{ item.format?.toUpperCase() }}<template v-if="firstVideoTitle(item)"> / {{ firstVideoTitle(item) }}</template></span>
                  </a-tag>
                  <a-tag v-if="item.size" class="poster-tag">
                    <template #icon><HddOutlined /></template>
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
          </template>
        </a-masonry>

        <a-empty
          v-else
          :description="
            noSearchTarget
              ? t('MediaServerEntity.noServer')
              : hasSearchedOnce
                ? t('MediaServerEntity.noItems')
                : t('MediaServerEntity.noItemsBeforeSearch')
          "
          class="empty-state"
        />
      </a-spin>

      <!-- 滚动自动加载的观察锚点 -->
      <div ref="loadMoreSentinel" class="load-more-sentinel" aria-hidden="true" />

      <div class="load-more-row">
        <a-button
          :disabled="!hasMore || noSearchTarget"
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
  /* 不再加 padding：外壳 .content 自带 padding（style.css，改那里就行），
     这里再叠一层会比其他页多一圈空白。数值不写进注释，免得改一次就过期一次。 */
}
.load-more-sentinel {
  height: 1px;
}
.search-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 12px;
}

/* 管理面板展开时与结果区之间留一条分隔：它是"页中页"，不收口会和瀑布流糊在一起 */
.manager-block {
  margin-bottom: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--pt-color-border-light);
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

/* 瀑布流的列数与间距交给 a-masonry（columns 断点 + gutter）。
   原来这里是 24 行 CSS columns + 5 档媒体查询，断点行为不好对齐：
   CSS columns 的列数是硬切，而 a-masonry 走组件库统一的 Breakpoint 栅格。 */
.masonry-grid {
  width: 100%;
}

/* 条目间距由 a-masonry 的 gutter 负责，这里不能再加 margin-bottom，
   否则会与 gutter 叠加造成列间距明显大于行间距。 */
.masonry-item {
  break-inside: avoid;
}
.masonry-item {
  break-inside: avoid;
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
