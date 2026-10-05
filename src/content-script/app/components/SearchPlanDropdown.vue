<script setup lang="ts">
/**
 * 「用哪个搜索方案搜这一条」的下拉。
 *
 * 从 SocialSiteParseResultsDialog 里抽出来的：那个弹窗里站点条目 / 外部 ID / 系列名 /
 * 折叠标题 / 标题列表五处都是同一段 dropdown + a-menu，只有关键词和 key 前缀不同，
 * 抄了五遍。改一次交互要动五个地方，抽出来之后只动这一处。
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { DownOutlined } from "@antdv-next/icons";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import { doKeywordSearch } from "../utils.ts";

const { keyword, itemId } = defineProps<{
  /** 点某个方案时，实际拿去搜索的关键词 */
  keyword: string;
  /** 只用于让同一弹窗里多个下拉的 menu key 互不重复 */
  itemId: string;
}>();

const { t } = useI18n();
const metadataStore = useMetadataStore();

const customSearchPlans = computed(() => {
  if (!metadataStore.$ready) {
    return [];
  }

  return metadataStore.getSearchSolutions
    .filter((solution) => !!solution.enabled)
    .sort((a, b) => b.sort - a.sort)
    .map((solution) => ({
      id: solution.id,
      name: solution.name ?? solution.id,
    }));
});

const searchPlans = computed(() => {
  const plans = [{ id: "default", name: t("layout.header.searchPlan.default") }];

  if (metadataStore.defaultSolutionId !== "default") {
    plans.push({ id: "all", name: t("layout.header.searchPlan.all") });
  }

  plans.push(...customSearchPlans.value);

  return plans;
});

// 用户没配过自定义搜索方案时，整个下拉没有意义，直接不渲染
const shouldShowSearchPlanMenu = computed(() => customSearchPlans.value.length > 0);

function search(planId: string) {
  doKeywordSearch(keyword, planId);
}
</script>

<template>
  <a-dropdown v-if="shouldShowSearchPlanMenu" trigger="hover" placement="bottomRight">
    <DownOutlined style="cursor: pointer; color: #8c8c8c" @click.stop />
    <template #popupRender>
      <a-menu>
        <!-- 不能加 .stop：@v-c/menu 回调 onClick 时传的是 info 对象不是原生事件，
             stopPropagation() 会当场抛 TypeError，菜单项就永远点不动。
             浮层在 shadowRoot 的 contentOverlay 里，不需要挡冒泡。 -->
        <a-menu-item v-for="plan in searchPlans" :key="`${itemId}|${plan.id}`" @click="search(plan.id)">
          {{ plan.name }}
        </a-menu-item>
      </a-menu>
    </template>
  </a-dropdown>
</template>
