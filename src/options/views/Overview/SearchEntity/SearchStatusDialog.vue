<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { EResultParseStatus } from "@ptd/site";
import { ArrowUpOutlined, SyncOutlined } from "@antdv-next/icons";

import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import type { ISearchPlanStatus, TSearchSolutionKey } from "@/shared/types.ts";

import SiteFavicon from "@/options/components/SiteFavicon/Index.vue";
import SiteName from "@/options/components/SiteName.vue";
import SolutionDetail from "@/options/components/SolutionDetail.vue";
import ResultParseStatus from "@/options/components/ResultParseStatus.vue";

import { doSearchEntity, raiseSearchPriority } from "./utils/search.ts";

const showDialog = defineModel<boolean>();

const { t } = useI18n();
const runtimeStore = useRuntimeStore();
const metadataStore = useMetadataStore();

function getSearchSolution(planKey: string, entryName: string) {
  return metadataStore.solutions[planKey]?.solutions.find((x) => x.id === entryName)!;
}

const statusFilterRef = ref<EResultParseStatus[]>([]);

const statusColorMap: Record<EResultParseStatus, string> = {
  [EResultParseStatus.success]: "green",
  [EResultParseStatus.waiting]: "indigo",
  [EResultParseStatus.working]: "indigo",
  [EResultParseStatus.parseError]: "red",
  [EResultParseStatus.passParse]: "yellow-darken-2",
  [EResultParseStatus.CFBlocked]: "orange",
  [EResultParseStatus.needLogin]: "red",
  [EResultParseStatus.noUserInput]: "red",
  [EResultParseStatus.noResults]: "red",
  [EResultParseStatus.unknownError]: "red",
};

const statusChips = computed(() => {
  const countMap = new Map<EResultParseStatus, number>();
  for (const plan of Object.values(runtimeStore.search.searchPlan ?? {})) {
    countMap.set(plan.status, (countMap.get(plan.status) ?? 0) + 1);
  }
  return [...countMap.entries()].map(([status, count]) => ({ status, count, color: statusColorMap[status] }));
});

const filteredSearchPlan = computed(() => {
  const entries = Object.entries(runtimeStore.search.searchPlan ?? {}) as [TSearchSolutionKey, ISearchPlanStatus][];
  if (statusFilterRef.value.length === 0) return entries;
  return entries.filter(([, plan]) => statusFilterRef.value.includes(plan.status));
});
</script>

<template>
  <a-modal v-model:open="showDialog" :width="800">
    <template #title>
      <div>
        {{
          t("SearchEntity.SearchStatusDialog.title", [
            metadataStore.getSearchSolutionName(runtimeStore.search.searchPlanKey),
          ])
        }}
        <br />
        <p class="text-body-small"><{{ runtimeStore.search.searchPlanKey }}></p>
      </div>
    </template>

    <div>
      <!-- v-chip-group(filter + multiple) → a-checkbox-group 多选 -->
      <a-checkbox-group v-model:value="statusFilterRef" class="status-filter d-flex flex-wrap">
        <a-checkbox v-for="{ status, count } in statusChips" :key="status" :value="status">
          <ResultParseStatus :status="status" />
          <a-badge :count="count" :offset="[4, 0]" color="#d9d9d9" />
        </a-checkbox>
      </a-checkbox-group>

      <a-divider v-if="statusChips.length > 0" class="mb-2" />

      <div
        v-for="[solutionKey, searchPlan] in filteredSearchPlan"
        :key="solutionKey"
        class="d-flex align-center py-1"
      >
        <SiteFavicon :site-id="searchPlan.siteId" class="mr-2" />
        <div class="flex-1-1-0">
          <div class="d-inline-flex">
            <SiteName
              :class="['text-decoration-none', 'font-weight-bold', 'text-black']"
              :site-id="searchPlan.siteId"
            />
            ->
            <span v-if="searchPlan.searchEntry.name">
              {{ searchPlan.searchEntry.name }}
            </span>
            <span
              v-else-if="
                runtimeStore.search.searchPlanKey === 'all' || runtimeStore.search.searchPlanKey.startsWith('site:')
              "
            >
              {{ searchPlan.searchEntry.name ?? searchPlan.searchEntryName }}
            </span>
            <span v-else>
              <SolutionDetail
                :solution="getSearchSolution(runtimeStore.search.searchPlanKey, searchPlan.searchEntryName)"
              />
            </span>
          </div>
          <br />
          <span class="text-label-large text-grey"> <{{ searchPlan.searchEntryName }}> </span>
        </div>
        <span class="text-label-large text-end">
          <ResultParseStatus :status="searchPlan.status" />
          <template v-if="searchPlan.status === EResultParseStatus.success">
            <br />
            <span class="text-end">
              {{
                t("SearchEntity.SearchStatusDialog.successMsg", [
                  searchPlan.count,
                  (searchPlan.costTime ?? 0) / 1000,
                ])
              }}
            </span>
          </template>
          <template v-else-if="searchPlan.statusMsg">
            <br />
            <span class="text-end">
              {{
                searchPlan.statusMsg.startsWith("i18n.")
                  ? t("SearchEntity.SearchStatusDialog.statusMsg" + searchPlan.statusMsg.replace("i18n.", "."))
                  : searchPlan.statusMsg
              }}
            </span>
          </template>
        </span>
        <a-divider orientation="vertical" class="mx-2" />
        <a-space-compact size="small">
          <!-- 上移队列 -->
          <a-button
            v-if="searchPlan.status === EResultParseStatus.waiting"
            type="text"
            :title="t('SearchEntity.SearchStatusDialog.moveUp')"
            @click="() => raiseSearchPriority(solutionKey)"
          >
            <template #icon><ArrowUpOutlined /></template>
          </a-button>
          <!-- 重新搜索 -->
          <a-button
            v-else
            type="text"
            danger
            :loading="searchPlan.status === EResultParseStatus.working"
            :title="t('SearchEntity.SearchStatusDialog.searchAgain')"
            @click="
              () => doSearchEntity(searchPlan.siteId, searchPlan.searchEntryName, searchPlan.searchEntry, true)
            "
          >
            <template #icon><SyncOutlined /></template>
          </a-button>
        </a-space-compact>
      </div>
    </div>
  </a-modal>
</template>

<style scoped lang="scss">
.status-filter {
  gap: 4px 8px;
}
</style>
