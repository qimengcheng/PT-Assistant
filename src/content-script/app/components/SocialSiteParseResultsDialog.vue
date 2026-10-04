<script setup lang="ts">
import { type ISocialSitePageInformation } from "@ptd/social";
import { doKeywordSearch, type IPtdData } from "../utils.ts";
import { inject } from "vue";
import { useI18n } from "vue-i18n";
import SearchPlanDropdown from "./SearchPlanDropdown.vue";

const { t } = useI18n();

const showDialog = defineModel<boolean>();
const { parseResults, searchPlan = "default" } = defineProps<{
  parseResults: ISocialSitePageInformation[];
  searchPlan?: string;
}>();

const ptdData = inject<IPtdData>("ptd_data", {});

// 搜索方案下拉（customSearchPlans / searchPlans / shouldShowSearchPlanMenu 的计算
// 与菜单渲染）已整块搬进 SearchPlanDropdown.vue —— 这个弹窗里站点条目 / 外部 ID /
// 系列名 / 折叠标题 / 标题列表五处都是同一段 dropdown，只有关键词不同。
function buildSiteSearchKeyword(result: ISocialSitePageInformation) {
  return `${ptdData.socialSite!}|${result.id}`;
}

function shouldCollapseTitles(result: ISocialSitePageInformation) {
  return ptdData.socialSite === "tmdb" && result.pageCategory === "season_list";
}

function getCollapseTitle(result: ISocialSitePageInformation) {
  if (ptdData.socialSite === "tmdb" && result.pageCategory === "season_list") {
    return t("contentScript.SocialSiteParseResultsDialog.searchEntryTitle", {
      title: result.entryTitle || t("contentScript.SocialSiteParseResultsDialog.defaultSeasonTitle"),
    });
  }

  return t("contentScript.SocialSiteParseResultsDialog.searchTitle");
}

function getResultKey(result: ISocialSitePageInformation, index: number) {
  return `${result.id}|${result.pageCategory ?? "default"}|${result.titles[0] ?? index}`;
}

function shouldShowSiteId(result: ISocialSitePageInformation, index: number) {
  if (!(ptdData.socialSite === "tmdb" && result.pageCategory === "season_list")) {
    return true;
  }

  return index === 0;
}

function shouldShowExternalIds(result: ISocialSitePageInformation, index: number) {
  if (!(ptdData.socialSite === "tmdb" && result.pageCategory === "season_list")) {
    return true;
  }

  return index === 0;
}

function shouldShowSeriesTitle(result: ISocialSitePageInformation, index: number) {
  return ptdData.socialSite === "tmdb" && result.pageCategory === "season_list" && index === 0 && !!result.seriesTitle;
}
</script>

<template>
  <a-modal v-model:open="showDialog" :title="t('contentScript.SocialSiteParseResultsDialog.title')" :width="600" :footer="null">
    <!-- 解析不到任何东西时原来是一个纯空白的内容区（弹窗照常打开，里面什么都没有），
         给出明确空状态。Empty 已加进 content 侧的按需注册清单 antd-lite.ts。 -->
    <a-empty
      v-if="parseResults.length === 0"
      :description="t('contentScript.SocialSiteParseResultsDialog.empty')"
    />
    <div v-else class="result-list">
      <template v-for="(result, index) in parseResults" :key="getResultKey(result, index)">
        <!-- 站点条目 -->
        <div v-if="shouldShowSiteId(result, index)" class="result-row" @click="() => doKeywordSearch(buildSiteSearchKeyword(result), searchPlan)">
          <span class="result-title">{{ `${ptdData.socialSite}: ${result.id}` }}</span>
          <a-tag color="blue">{{ t("contentScript.SocialSiteParseResultsDialog.searchId") }}</a-tag>
          <SearchPlanDropdown
            :keyword="buildSiteSearchKeyword(result)"
            :item-id="`${result.id}|id`"
          />
        </div>

        <!-- 外部 ID -->
        <template v-if="result.external_ids && shouldShowExternalIds(result, index)">
          <div
            v-for="(externalId, externalType) in result.external_ids"
            :key="`${result.id}|${externalType}|${externalId}`"
            class="result-row"
            @click="() => doKeywordSearch(`${externalType}|${externalId}`, searchPlan)"
          >
            <span class="result-title">{{ `${externalType}: ${externalId}` }}</span>
            <a-tag color="green">{{ t("contentScript.SocialSiteParseResultsDialog.searchExternalId") }}</a-tag>
            <SearchPlanDropdown
              :keyword="`${externalType}|${externalId}`"
              :item-id="`${result.id}|${externalType}|${externalId}`"
            />
          </div>
        </template>

        <!-- 系列名 -->
        <div
          v-if="shouldShowSeriesTitle(result, index)"
          class="result-row"
          @click="() => doKeywordSearch(result.seriesTitle!, searchPlan)"
        >
          <span class="result-title">{{ result.seriesTitle }}</span>
          <a-tag color="default">{{ t("contentScript.SocialSiteParseResultsDialog.searchTitle") }}</a-tag>
          <SearchPlanDropdown :keyword="result.seriesTitle!" :item-id="`${result.id}|series`" />
        </div>

        <!-- 标题列表（tmdb 季列表时折叠） -->
        <a-collapse v-if="shouldCollapseTitles(result)" ghost>
          <a-collapse-panel :key="`collapse|${result.id}`" :header="`${getCollapseTitle(result)} (${result.titles.length})`">
            <div class="result-list">
              <div
                v-for="title in result.titles"
                :key="`${result.id}|${title}`"
                class="result-row"
                @click="() => doKeywordSearch(title, searchPlan)"
              >
                <span class="result-title">{{ title }}</span>
                <a-tag color="default">{{ t("contentScript.SocialSiteParseResultsDialog.searchTitle") }}</a-tag>
                <SearchPlanDropdown :keyword="title" :item-id="`${result.id}|${title}`" />
              </div>
            </div>
          </a-collapse-panel>
        </a-collapse>

        <template v-else>
          <div
            v-for="title in result.titles"
            :key="`${result.id}|${title}`"
            class="result-row"
            @click="() => doKeywordSearch(title, searchPlan)"
          >
            <span class="result-title">{{ title }}</span>
            <a-tag color="default">{{ t("contentScript.SocialSiteParseResultsDialog.searchTitle") }}</a-tag>
            <SearchPlanDropdown :keyword="title" :item-id="`${result.id}|${title}`" />
          </div>
        </template>

        <a-divider v-if="index != parseResults.length - 1" />
      </template>
    </div>
  </a-modal>
</template>

<style scoped lang="scss">
.result-list {
  display: flex;
  flex-direction: column;
}

.result-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  cursor: pointer;
  border-radius: 4px;

  &:hover {
    background: #f0f6ff;
  }
}

.result-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
