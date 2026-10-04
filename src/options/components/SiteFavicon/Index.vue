<script setup lang="ts">
import { computed, onMounted, watch } from "vue";
import { NO_IMAGE, type TSiteID } from "@ptd/site";

import { faviconCache, getSiteFavicon } from "./utils.ts";

const {
  siteId,
  size = 32,
  flushOnPre = false,
  flushOnNoImage = false,
  flushOnClick = false,
} = defineProps<{
  siteId: TSiteID;
  size?: number;
  flushOnPre?: boolean;
  flushOnNoImage?: boolean;
  flushOnClick?: boolean;
}>();

/**
 * 图标值一律从 utils 的共享缓存派生，组件自己不再持有一份 shallowRef。
 * 这样 flushSiteFavicon() 改写/删除某个站点的缓存后，页面上所有已渲染的实例会跟着更新；
 * 原实现把结果存在组件本地，外部刷新永远传不进来。
 * 也正因为缓存是按 siteId 存的，不再需要「竞态令牌」防止结果串到别的站点上。
 */
const siteFavicon = computed<string>(() => faviconCache.value[siteId] ?? NO_IMAGE);

async function load(flush: boolean) {
  const favicon = await getSiteFavicon(siteId, flush);
  if (favicon === NO_IMAGE && flushOnNoImage) {
    await getSiteFavicon(siteId, true); // 强制刷新
  }
}

onMounted(() => void load(flushOnPre));

// ⚠️ 必须监听 siteId：表格排序/过滤后 rc-table 会复用行组件实例，
// 只在 onMounted 读一次的话，siteId 变了而图标不变。
watch(() => siteId, () => void load(flushOnPre));

function doFlush() {
  if (!flushOnClick) return;
  void load(true);
}

const binds = {
  click: flushOnClick ? doFlush : undefined,
};
</script>

<template>
  <img :height="size" :src="siteFavicon" :width="size" class="site-favicon" v-on="binds" alt="" />
</template>

<style scoped lang="scss">
.site-favicon {
  object-fit: cover;
  border-radius: 2px;
  vertical-align: middle;
}
</style>
