<script setup lang="ts">
import { shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { isEmpty } from "es-toolkit/compat";
import type { ISearchCategories } from "@ptd/site";

import type { ISearchSolution } from "@/shared/types.ts";

import {
  getCategoryName,
  getCategoryOptionName,
  getSiteMetaCategory,
} from "@/options/views/Settings/SetSearchSolution/utils.ts";

const props = defineProps<{
  solution: ISearchSolution;
}>();

const siteMetaCategory = shallowRef<ISearchCategories[]>([]);
const { t } = useI18n();

/**
 * 取站点分类元数据。
 *
 * ⚠️ 原来只在 onMounted 里取一次：① 那个 async 回调没有 catch，取站点定义失败
 * （扩展刚更新、旧 chunk 404）就是一个 unhandled rejection；② prop 变化时不重取 ——
 * 这个组件用在列表里，行复用后还显示着上一个站点的分类名。
 * 改成跟随 siteId 的 watch，且带 try/catch（取不到就退回空数组，
 * 分类名由 getCategoryName 兜成中性占位 `—`，不至于把组件打挂）。
 */
watch(
  () => props.solution?.siteId,
  async (siteId) => {
    if (!siteId) {
      siteMetaCategory.value = [];
      return;
    }
    try {
      siteMetaCategory.value = await getSiteMetaCategory(siteId);
    } catch (e) {
      console.error("[SolutionDetail] get site category failed", siteId, e);
      siteMetaCategory.value = [];
    }
  },
  { immediate: true },
);
</script>

<template>
  <div v-if="solution" class="text-wrap">
    <template v-if="solution.name">{{ solution.name }}</template>
    <template v-else-if="isEmpty(solution.selectedCategories)">{{ t('common.default') }}</template>
    <template v-else>
      <!-- 句子级说明走 a-tooltip 而不是原生 title：原生那层的底色/字号/行宽都由系统画，
           页面控制不了（全站口径见 AGENTS.md §3.4）。 -->
      <a-tooltip
        v-for="(value, category) in solution.selectedCategories"
        :key="category"
        :title="
          getCategoryName(siteMetaCategory, category) + ': ' + getCategoryOptionName(siteMetaCategory, category, value)
        "
      >
        <span>
          <b>{{ getCategoryName(siteMetaCategory, category) }}</b> :
          {{ getCategoryOptionName(siteMetaCategory, category, value) }};&nbsp;
        </span>
      </a-tooltip>
    </template>
  </div>
  <template v-else>{{ t("common.unknown") }}</template>
</template>

<style scoped lang="scss"></style>
