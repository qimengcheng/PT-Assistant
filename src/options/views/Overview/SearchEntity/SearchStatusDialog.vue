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

/**
 * 标题第二行原本是内部方案键 `<site:xxx>`：一是按 §3.5「内部 id 不进 UI」不该出现，
 * 二是两行富文本标题只能走 #title 插槽，会和右上角关闭按钮相撞。改成单行 title 属性。
 */
const dialogTitle = computed(() =>
  t("SearchEntity.SearchStatusDialog.title", [
    metadataStore.getSearchSolutionName(runtimeStore.search.searchPlanKey),
  ]),
);

function getSearchSolution(planKey: string, entryName: string) {
  return metadataStore.solutions[planKey]?.solutions.find((x) => x.id === entryName)!;
}

const statusFilterRef = ref<EResultParseStatus[]>([]);

const statusColorMap: Record<EResultParseStatus, string> = {
  [EResultParseStatus.success]: "green",
  [EResultParseStatus.waiting]: "indigo",
  [EResultParseStatus.working]: "indigo",
  [EResultParseStatus.parseError]: "red",
  [EResultParseStatus.passParse]: "gold",
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
  <!-- 这是一只看状态的窗口：每一行的动作（重新搜索 / 上移队列）都在行内，
       默认页脚那颗「确定」没有任何事可做（没人接 @ok），点了只是没反应 —— 撤掉整个页脚，
       关掉走右上角的 ✕ 或 ESC。与 ClientStatusDialog、TorrentDetailDialog 那几只同类窗口同写法。 -->
  <a-modal v-model:open="showDialog" :title="dialogTitle" :width="800" :footer="null">

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
        <span class="text-label-large text-end status-msg">
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

/* 状态消息列必须能自己变窄：`chrome-extension://…/chunks/xxx.js` 这类无空格整串的
   min-content 宽度接近 500px，而它左边那列是 .flex-1-1-0（含 min-width:0），
   于是错误行里左边会被挤到 1 个字符宽、`<default>` 竖成一列。
   这里给消息列同样的 flex:1 1 0 + min-width:0，并允许在列内折断长串。 */
.status-msg {
  flex: 1 1 0;
  min-width: 0;
  overflow-wrap: anywhere;
}
</style>
