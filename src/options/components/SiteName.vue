<script setup lang="ts">
import { computed, ref, useAttrs, watch } from "vue";
import { type TSiteID } from "@ptd/site";

import { useMetadataStore } from "@/options/stores/metadata.ts";

const metadataStore = useMetadataStore();

const props = defineProps<{
  siteId: TSiteID;
  tag?: string;
  class?: string[] | string;
}>();

const attrs = useAttrs();

const siteName = ref<string>("");

const tagIs = props.tag ?? "a";
const href = ref<string>("#");

/**
 * 用 computed 而不是 reactive({...attrs})：
 * 原来把 attrs 快照进 reactive，父组件后续传的 title/class 等都不会更新
 * （表格排序/过滤复用行实例时尤其明显）。
 */
const renderProp = computed<Record<string, any>>(() => ({
  ...attrs,
  ...(tagIs === "a"
    ? {
        href: href.value,
        target: "_blank",
        rel: "noopener noreferrer nofollow",
      }
    : {}),
  class: props.class ?? ["text-body-small", "text-decoration-none", "text-grey", "text-no-wrap"],
}));

// ⚠️ href 必须跟着 siteId 走：原来只在 setup 里取一次 URL，
// 行组件被复用后链接会指向另一个站点。异步调用也要 catch，否则 offscreen 未就绪时会留 unhandledRejection。
if (tagIs === "a") {
  const loadHref = async (siteId: TSiteID) => {
    try {
      href.value = await metadataStore.getSiteUrl(siteId);
    } catch (e) {
      console.error("[PTD] load site url failed", siteId, e);
      href.value = "#";
    }
  };
  void loadHref(props.siteId);
  watch(() => props.siteId, (id) => void loadHref(id));
}

function updateSiteName(siteId: TSiteID) {
  // 首先赋值为 siteId，防止空白
  siteName.value = siteId;

  // 优先从缓存中读取
  if (metadataStore.siteNameMap?.[siteId]) {
    siteName.value = metadataStore.siteNameMap[siteId];
  } else {
    // 如果缓存中没有/或者没有生成缓存，则按之前的逻辑读取
    metadataStore
      .getSiteName(siteId)
      .then((name) => {
        siteName.value = name;
      })
      .catch((e) => console.error("[PTD] load site name failed", siteId, e));
  }
}

watch(
  () => props.siteId,
  (newSiteId) => {
    updateSiteName(newSiteId);
  },
  { immediate: true },
);
</script>

<template>
  <slot :name="siteName">
    <component :is="tagIs" v-bind="renderProp">{{ siteName }}</component>
  </slot>
</template>

<style scoped lang="scss"></style>
