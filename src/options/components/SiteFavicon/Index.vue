<script setup lang="ts">
import { onMounted, shallowRef, watch } from "vue";
import { NO_IMAGE, type TSiteID } from "@ptd/site";

import { getSiteFavicon } from "./utils.ts";

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

const siteFavicon = shallowRef<string>(NO_IMAGE);

/** 用 siteId 作竞态令牌：并发加载时只有最后一次请求的结果会被采纳 */
let loadToken = 0;

async function load(flush: boolean) {
  const token = ++loadToken;
  try {
    let favicon = await getSiteFavicon(siteId, flush);
    if (favicon === NO_IMAGE && flushOnNoImage) {
      favicon = await getSiteFavicon(siteId, true); // 强制刷新
    }

    // 期间 siteId 已经变了（或又发起了新的加载）→ 丢弃这次结果，否则图标会串到别的站点上
    if (token === loadToken) {
      siteFavicon.value = favicon;
    }
  } catch (e) {
    console.error("[PTD] load site favicon failed", siteId, e);
    if (token === loadToken) {
      siteFavicon.value = NO_IMAGE;
    }
  }
}

onMounted(() => load(flushOnPre));

// ⚠️ 必须监听 siteId：表格排序/过滤后 rc-table 会复用行组件实例，
// 只在 onMounted 读一次的话，siteId 变了而图标不变。
watch(() => siteId, () => load(flushOnPre));

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
