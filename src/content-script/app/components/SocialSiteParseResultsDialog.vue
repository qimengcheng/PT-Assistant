<script setup lang="ts">
import { type ISocialSitePageInformation } from "@ptd/social";
import { doKeywordSearch, type IPtdData } from "../utils.ts";
import { computed, inject } from "vue";
import { useI18n } from "vue-i18n";
import { DownOutlined } from "@antdv-next/icons";
import { useMetadataStore } from "@/options/stores/metadata.ts";

const { t } = useI18n();
const metadataStore = useMetadataStore();

const showDialog = defineModel<boolean>();
const { parseResults, searchPlan = "default" } = defineProps<{
  parseResults: ISocialSitePageInformation[];
  searchPlan?: string;
}>();

const ptdData = inject<IPtdData>("ptd_data", {});

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

const shouldShowSearchPlanMenu = computed(() => customSearchPlans.value.length > 0);

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
    <div class="result-list">
      <template v-for="(result, index) in parseResults" :key="getResultKey(result, index)">
        <!-- 站点条目 -->
        <div v-if="shouldShowSiteId(result, index)" class="result-row" @click="() => doKeywordSearch(buildSiteSearchKeyword(result), searchPlan)">
          <span class="result-title">{{ `${ptdData.socialSite}: ${result.id}` }}</span>
          <a-tag color="blue">{{ t("contentScript.SocialSiteParseResultsDialog.searchId") }}</a-tag>
          <a-dropdown v-if="shouldShowSearchPlanMenu" trigger="hover" placement="bottomRight">
            <DownOutlined style="cursor: pointer; color: #8c8c8c" @click.stop />
            <template #popupRender>
              <a-menu>
                <a-menu-item
                  v-for="plan in searchPlans"
                  :key="`${result.id}|id|${plan.id}`"
                  @click.stop="doKeywordSearch(buildSiteSearchKeyword(result), plan.id)"
                >
                  {{ plan.name }}
                </a-menu-item>
              </a-menu>
            </template>
          </a-dropdown>
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
            <a-dropdown v-if="shouldShowSearchPlanMenu" trigger="hover" placement="bottomRight">
              <DownOutlined style="cursor: pointer; color: #8c8c8c" @click.stop />
              <template #popupRender>
                <a-menu>
                  <a-menu-item
                    v-for="plan in searchPlans"
                    :key="`${result.id}|${externalType}|${plan.id}`"
                    @click.stop="doKeywordSearch(`${externalType}|${externalId}`, plan.id)"
                  >
                    {{ plan.name }}
                  </a-menu-item>
                </a-menu>
              </template>
            </a-dropdown>
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
          <a-dropdown v-if="shouldShowSearchPlanMenu" trigger="hover" placement="bottomRight">
            <DownOutlined style="cursor: pointer; color: #8c8c8c" @click.stop />
            <template #popupRender>
              <a-menu>
                <a-menu-item
                  v-for="plan in searchPlans"
                  :key="`${result.id}|series|${plan.id}`"
                  @click.stop="doKeywordSearch(result.seriesTitle!, plan.id)"
                >
                  {{ plan.name }}
                </a-menu-item>
              </a-menu>
            </template>
          </a-dropdown>
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
                <a-dropdown v-if="shouldShowSearchPlanMenu" trigger="hover" placement="bottomRight">
                  <DownOutlined style="cursor: pointer; color: #8c8c8c" @click.stop />
                  <template #popupRender>
                    <a-menu>
                      <a-menu-item
                        v-for="plan in searchPlans"
                        :key="`${result.id}|${title}|${plan.id}`"
                        @click.stop="doKeywordSearch(title, plan.id)"
                      >
                        {{ plan.name }}
                      </a-menu-item>
                    </a-menu>
                  </template>
                </a-dropdown>
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
            <a-dropdown v-if="shouldShowSearchPlanMenu" trigger="hover" placement="bottomRight">
              <DownOutlined style="cursor: pointer; color: #8c8c8c" @click.stop />
              <template #popupRender>
                <a-menu>
                  <a-menu-item
                    v-for="plan in searchPlans"
                    :key="`${result.id}|${title}|${plan.id}`"
                    @click.stop="doKeywordSearch(title, plan.id)"
                  >
                    {{ plan.name }}
                  </a-menu-item>
                </a-menu>
              </template>
            </a-dropdown>
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
