<script setup lang="ts">
/**
 * 搜索方案编辑对话框（antdv-next 平移，旧版为全屏 dialog）。
 * 左侧按站点折叠选择搜索分类生成条目，右侧维护已选条目；保存为一条 ISearchSolutionMetadata。
 */
import { computed, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { nanoid } from "nanoid";
import { cloneDeep, isEqual } from "es-toolkit";
import { find, isEmpty } from "es-toolkit/compat";
import { refDebounced } from "@vueuse/core";
import { SearchOutlined } from "@antdv-next/icons";

import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import type { ISearchSolution, ISearchSolutionMetadata, TSolutionKey } from "@/shared/types.ts";

import SolutionLabel from "./SolutionLabel.vue";
import SiteCategoryPanel from "./SiteCategoryPanel.vue";
import SiteFavicon from "@/options/components/SiteFavicon/Index.vue";
import SiteName from "@/options/components/SiteName.vue";

const showDialog = defineModel<boolean>();
const { solutionId } = defineProps<{
  solutionId: TSolutionKey;
}>();

const { t } = useI18n();

const initSolution = () =>
  ({
    id: nanoid(),
    name: "",
    sort: 1,
    enabled: true,
    isDefault: false,
    createdAt: Date.now(),
    solutions: [],
  }) as ISearchSolutionMetadata;

const metadataStore = useMetadataStore();
const runtimeStore = useRuntimeStore();

const solution = ref<ISearchSolutionMetadata>(initSolution());
const formRef = ref();

const siteWaitFilter = ref("");
const siteFilter = refDebounced(siteWaitFilter, 500); // 延迟搜索过滤词的生成

const activeSiteKeys = ref<string[]>([]);

const addedSiteInfo = shallowRef<Array<{ siteId: string; isDead: boolean; siteName: string; siteUrl: string }>>([]);

const filteredSite = computed(() => {
  const filter = (siteFilter.value ?? "").toLowerCase();

  return addedSiteInfo.value
    .filter((item) => {
      const siteKey = [item.siteId, item.siteName, item.siteUrl]
        .filter(Boolean)
        .map((x: string) => x.toLowerCase())
        .join("|");
      return siteKey.includes(filter);
    })
    .map((item) => item.siteId);
});

const formRules = computed(() => ({
  name: [{ required: true, message: t("common.name"), trigger: "blur" }],
}));

function addSolution(add: ISearchSolution) {
  // 基于 siteId 和 selectedCategories / name 判断是否已存在，如果存在则不添加
  if (
    find(solution.value.solutions, (item) => {
      return (
        item.siteId === add.siteId &&
        ((!isEmpty(item.selectedCategories) && isEqual(item.selectedCategories, add.selectedCategories)) ||
          (typeof item.name !== "undefined" && item.name === add.name))
      );
    })
  ) {
    runtimeStore.showSnakebar(t("SetSearchSolution.edit.cantAddByDuplicateNote"), { color: "error" });
    return;
  }

  solution.value.solutions.push(add);
}

function removeSolution(remove: ISearchSolution) {
  solution.value.solutions = solution.value.solutions.filter(
    (x) => !(x.id == remove.id && x.siteId == remove.siteId),
  );
}

async function saveSolutionState() {
  try {
    await formRef.value?.validateFields();
  } catch {
    return;
  }
  metadataStore.addSearchSolution(solution.value);
  showDialog.value = false;
}

watch(showDialog, (visible) => {
  if (!visible) return;

  // 生成站点列表
  Promise.all(
    metadataStore.getAddedSiteIds
      .slice()
      .sort((a, b) => Number(metadataStore.sites[b].allowSearch) - Number(metadataStore.sites[a].allowSearch))
      .map(async (id) => ({
        siteId: id,
        isDead: (await metadataStore.getSiteMergedMetadata(id, "isDead")) ?? false,
        siteName: await metadataStore.getSiteName(id),
        siteUrl: await metadataStore.getSiteUrl(id),
      })),
  ).then((siteInfos) => {
    addedSiteInfo.value = siteInfos.filter((site) => !site.isDead);
  });

  const storedSolution = metadataStore.solutions[solutionId] ?? initSolution();
  solution.value = cloneDeep(storedSolution);
});

function dialogLeave() {
  solution.value = initSolution();
  siteWaitFilter.value = "";
  activeSiteKeys.value = [];
}
</script>

<template>
  <a-modal
    :open="showDialog"
    :title="t('SetSearchSolution.edit.title')"
    :width="'100%'"
    wrap-class-name="set-search-solution-edit-modal"
    :ok-text="t('common.dialog.ok')"
    :cancel-text="t('common.dialog.cancel')"
    :ok-button-props="{ disabled: solution.solutions.length === 0 }"
    destroy-on-hidden
    @update:open="(v: boolean) => {
      if (!v) {
        showDialog = false;
        dialogLeave();
      }
    }"
    @ok="saveSolutionState"
  >
    <a-form
      ref="formRef"
      :model="solution"
      :rules="formRules"
    >
      <a-row :gutter="16">
        <a-col :flex="'auto'">
          <a-form-item :label="t('common.name')" name="name">
            <a-input v-model:value="solution.name" autofocus />
          </a-form-item>
        </a-col>
        <a-col :flex="'220px'">
          <a-form-item :label="t('SetSearchSolution.solutionId')">
            <a-input v-model:value="solution.id" disabled />
          </a-form-item>
        </a-col>
        <a-col :flex="'140px'">
          <a-form-item :label="t('common.sortIndex')">
            <a-input-number v-model:value="solution.sort" :min="0" :max="100" style="width: 100%" />
          </a-form-item>
        </a-col>
      </a-row>

      <a-row :gutter="16">
        <a-col :xs="24" :md="15">
          <a-input v-model:value="siteWaitFilter" allow-clear :placeholder="t('SetSearchSolution.edit.filterPlaceholder')">
            <template #prefix><SearchOutlined /></template>
          </a-input>

          <div class="site-list">
            <a-collapse v-model:active-key="activeSiteKeys">
              <!-- CollapsePanel 没有 `disabled` prop（写上去只是塞进根 div，面板照样能折叠），
                   真正的开关是 `collapsible: 'disabled'`。见 scripts/check-dead-props.mjs -->
              <a-collapse-panel
                v-for="site in filteredSite"
                :key="site"
                :collapsible="!!metadataStore.sites[site].isOffline ? 'disabled' : undefined"
              >
                <template #header>
                  <span class="site-panel-header">
                    <SiteFavicon :site-id="site" :size="18" />
                    <a-tag color="green"><SiteName :site-id="site" tag="span" /></a-tag>
                  </span>
                </template>
                <SiteCategoryPanel :site-id="site" @update:solution="addSolution" />
              </a-collapse-panel>
            </a-collapse>
          </div>
        </a-col>

        <a-col :xs="24" :md="9">
          <a-alert type="success" :title="t('SetSearchSolution.edit.addCount', [solution.solutions.length])" style="margin-bottom: 8px" />
          <div class="selected-list">
            <SolutionLabel :group-props="{ column: true }" :solutions="solution.solutions" closable @remove:solution="removeSolution" />
          </div>
        </a-col>
      </a-row>
    </a-form>
  </a-modal>
</template>

<style>
/* 全屏化：旧版为 fullscreen dialog，这里通过 wrap class 覆盖 antd modal 定位 */
.set-search-solution-edit-modal {
  padding-bottom: 0;
}
.set-search-solution-edit-modal .ant-modal {
  max-width: 100vw;
  margin: 0;
  padding-bottom: 0;
}
.set-search-solution-edit-modal .ant-modal-content {
  height: 100vh;
  padding-bottom: 56px;
  display: flex;
  flex-direction: column;
}
.set-search-solution-edit-modal .ant-modal-body {
  flex: 1;
  overflow-y: auto;
}
</style>

<style scoped>
.site-list {
  margin-top: 8px;
  max-height: calc(100vh - 340px);
  overflow-y: auto;
}
.site-panel-header {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.selected-list {
  max-height: calc(100vh - 330px);
  overflow-y: auto;
  padding: 4px;
}
</style>
