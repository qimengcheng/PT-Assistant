<script setup lang="ts">
import { reactive, ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { ExportOutlined, MoreOutlined, SearchOutlined } from "@antdv-next/icons";

import { socialBuildUrlMap } from "@ptd/social";
import type { ITorrent } from "@ptd/site";
import type { ISocialInformation, TSupportSocialSite } from "@ptd/social/types.ts";

import { useConfigStore } from "@/options/stores/config.ts";
import { sendMessage } from "@/messages.ts";

const { item, showSocial = true } = defineProps<{
  item: Partial<ITorrent>;
  showSocial?: boolean;
}>();

const { t } = useI18n();
const router = useRouter();
const configStore = useConfigStore();

interface ISocialInformationData extends ISocialInformation {
  loading?: boolean;
  /** 请求失败标记：避免 loading 永不清除导致 popover 一直转圈 */
  error?: boolean;
}

const socialInformation = reactive<Record<TSupportSocialSite | string, ISocialInformationData>>({});

const tagsExpanded = ref(false);
/** 当前悬停的标签名：只有悬停的那个标签才显示关闭按钮（替代原先的 v-hover） */
const hoveringTag = ref<string | null>(null);

const visibleTags = computed(() => {
  const tags = item.tags;
  if (!tags || !tags.length) return [];
  const hiddenNames = configStore.searchEntifyControl.hiddenTagNames || [];
  return tags.filter((tag) => !hiddenNames.includes(tag.name));
});

const maxTagCount = computed(() => configStore.searchEntifyControl.maxTagCountBeforeGroup || 0);

const displayedTags = computed(() => {
  if (!maxTagCount.value || maxTagCount.value >= visibleTags.value.length || tagsExpanded.value) {
    return visibleTags.value;
  }
  return visibleTags.value.slice(0, maxTagCount.value);
});

const hasMoreTags = computed(
  () => maxTagCount.value > 0 && visibleTags.value.length > maxTagCount.value && !tagsExpanded.value,
);

const hiddenTagCount = computed(() => visibleTags.value.length - maxTagCount.value);

function tempHideTag(name: string) {
  if (!configStore.searchEntifyControl.hiddenTagNames.includes(name)) {
    configStore.searchEntifyControl.hiddenTagNames = [...configStore.searchEntifyControl.hiddenTagNames, name];
  }
}

function loadSocialInformation(site: TSupportSocialSite) {
  if (item[`ext_${site}`] && !socialInformation[site]) {
    socialInformation[site] = { loading: true } as ISocialInformationData;
    sendMessage("getSocialInformation", { site, sid: item[`ext_${site}`] as unknown as string })
      .then((info) => {
        socialInformation[site] = info;
      })
      .catch((e) => {
        // 必须兜底：失败时 { loading: true } 永不清除，popover 里会一直显示 Loading....
        console.error("[PTD] load social information failed", site, e);
        socialInformation[site] = { error: true } as ISocialInformationData;
      });
  }
}

function doAdvanceSearch(site: TSupportSocialSite, sid: string) {
  const toRoute = { name: "SearchEntity", query: { search: `${site}|${sid}`, flush: 1 } };

  if (configStore.searchEntifyControl.socialInformationSearchOnNewTab) {
    window.open(router.resolve(toRoute).href, "_blank");
  } else {
    router.push(toRoute);
  }
}

function canAdvanceSearch(site: TSupportSocialSite) {
  return site !== "tmdb";
}
</script>

<template>
  <div class="t_main">
    <div class="t_row">
      <!--
        下面几处刻意继续用 CSS 的 text-truncate / text-ellipsis，而不是 antd 的
        <a-typography-text :ellipsis>，原因有三条（别再当成待办改回去）：
        ① 悬停提示已经在了 —— 主标题 :title="item.title"、副标题 :title="item.subTitle"、
           社交卡标题 :title 都是原生 title。ellipsis 属性能提供的「截断 + 悬停全文」这里已齐全，
           换过去行为上零增益，只是写法不同。
        ② 本组件被 content 侧复用（content-script/app/components/AdvanceListModuleDialog.vue 导入它），
           加 <a-typography-text> 就必须往 src/content-script/antd-lite.ts 注册 Typography，
           而 Typography 子包约 19 KB（对照 FloatButton 实测 +47.8 KB 的先例），代价摊给每个 PT 站点。
        ③ 第 138 行那个 <h3> 在 <a-popover> 的 #content 里，再嵌一层 tooltip 会叠成双层浮层。
      -->
      <!-- 种子主标题信息 -->
      <span class="text-truncate flex-1-1-0">
        <a
          :href="item.url"
          :title="item.title"
          class="t_title text-decoration-none text-body-large text-truncate"
          rel="noopener noreferrer nofollow"
          target="_blank"
        >
          {{ item.title ?? item.url ?? item.link }}
        </a>
      </span>

      <!-- 种子的媒体信息 -->
      <div class="ml-2 flex-0-0">
        <template v-if="showSocial && configStore.searchEntifyControl.showSocialInformation">
          <template v-for="(meta, key) in socialBuildUrlMap" :key="key">
            <a-popover
              v-if="item[`ext_${key}`]"
              placement="bottom"
              trigger="hover"
              :open="undefined"
              @open-change="(open: boolean) => open && loadSocialInformation(key as TSupportSocialSite)"
            >
              <template #content>
                <div class="social-card" style="max-width: 150px">
                  <template v-if="socialInformation[key]?.loading === true">
                    <h3 class="font-weight-bold my-2">Loading....</h3>
                  </template>
                  <template v-else-if="socialInformation[key]?.id">
                    <a-image
                      :src="socialInformation[key]?.poster"
                      :width="150"
                      :fallback="'/icons/movie_placeholder.png'"
                      class="mb-1"
                    >
                      <template #placeholder>
                        <a-skeleton-button active style="width: 150px; height: 225px" />
                      </template>
                    </a-image>
                    <h3
                      v-if="socialInformation[key]?.title"
                      class="text-ellipsis font-weight-bold"
                      :title="socialInformation[key]?.title"
                    >
                      {{ socialInformation[key]?.title.split(" / ")[0] }}
                    </h3>
                    <p v-if="socialInformation[key]?.ratingScore" class="text-body-small">
                      {{ socialInformation[key].ratingScore }}
                      <span v-if="socialInformation[key]?.ratingCount">
                        from {{ socialInformation[key].ratingCount }} votes
                      </span>
                    </p>
                  </template>
                  <template v-else>
                    <h3 class="font-weight-bold my-2">No Information</h3>
                  </template>

                  <template v-if="canAdvanceSearch(key as TSupportSocialSite)">
                    <a-divider class="my-1" />
                    <a-button type="text" block @click="doAdvanceSearch(key as TSupportSocialSite, item[`ext_${key}`] as string)">
                      <template #icon><SearchOutlined /></template>
                      {{ t("common.search") }}
                    </a-button>
                  </template>

                  <a-divider class="my-1" />
                  <a-button
                    type="text"
                    block
                    :href="meta(item[`ext_${key}`]! as string)"
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    :title="`${key}: ${item[`ext_${key}`]}`"
                  >
                    <template #icon><ExportOutlined /></template>
                    {{ t("common.visit") }}
                  </a-button>
                  <a-divider class="my-1" />
                  <p class="text-body-small mt-1">( {{ key }}: {{ item[`ext_${key}`] }} )</p>
                </div>
              </template>

              <img
                class="social-avatar"
                :src="`/icons/social/${key}.png`"
                :alt="key"
                @click="loadSocialInformation(key as TSupportSocialSite)"
                @mouseenter="loadSocialInformation(key as TSupportSocialSite)"
              />
            </a-popover>
          </template>
        </template>
      </div>
    </div>
    <div
      class="t_row"
      v-if="configStore.searchEntifyControl.showTorrentTag || configStore.searchEntifyControl.showTorrentSubtitle"
    >
      <!-- 种子标签信息 -->
      <div class="flex-0-0">
        <template v-if="configStore.searchEntifyControl.showTorrentTag && item.tags && item.tags.length > 0">
          <a-tag
            v-for="tag in displayedTags"
            :key="tag.name"
            :color="tag.color"
            :closable="hoveringTag === tag.name"
            class="mr-1"
            @mouseenter="hoveringTag = tag.name"
            @mouseleave="hoveringTag = null"
            @close="tempHideTag(tag.name)"
          >
            {{ tag.name }}
          </a-tag>
          <a-tag v-if="hasMoreTags" class="mr-1" color="blue" @click="tagsExpanded = true">
            <template #icon><MoreOutlined /></template>
            {{ hiddenTagCount }}
          </a-tag>
        </template>
      </div>

      <!-- 种子副标题信息 -->
      <span
        v-if="configStore.searchEntifyControl.showTorrentSubtitle && item.subTitle"
        :title="item.subTitle"
        class="t_subTitle text-grey text-truncate flex-1-1-0"
      >
        {{ item.subTitle }}
      </span>
    </div>
  </div>
</template>

<style scoped lang="scss">
.t_main {
  padding: 0;
}

.t_row {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  gap: 0;
}

// flex item 默认 min-width: auto 会阻止 text-overflow: ellipsis 收缩截断,需显式归零
.t_main .text-truncate.flex-1-1-0 {
  min-width: 0;
}

.t_title {
  color: inherit;
  font-weight: 500;
}

.social-avatar {
  width: 20px;
  height: 20px;
  margin-left: 4px;
  vertical-align: middle;
  cursor: pointer;
}

.social-card {
  text-align: center;
}
</style>
