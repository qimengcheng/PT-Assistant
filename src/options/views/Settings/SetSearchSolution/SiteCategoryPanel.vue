<script setup lang="ts">
/**
 * 站点分类选择面板（antdv-next 平移）。
 * 列出站点定义的搜索分类：cross 分类多选（支持全选三态），普通分类单选（含「站点默认」）。
 * 生成结果通过 update:solution 事件抛给父级；另支持基于当前选择创建自定义方案。
 */
import { onMounted, ref, shallowRef } from "vue";
import { useI18n } from "vue-i18n";
import { ArrowRightOutlined, ClearOutlined, EditOutlined } from "@antdv-next/icons";
import type { ISearchCategories, TSiteID } from "@ptd/site";

import CustomSolutionDialog from "./CustomSolutionDialog.vue";
import type { ISearchSolution } from "@/shared/types/storages/metadata.ts";
import {
  generateSiteSearchSolution,
  getSiteMetaCategory,
  isDefaultCategory,
  radioDefault,
  type TSelectCategory,
} from "./utils.ts";

const { siteId } = defineProps<{
  siteId: TSiteID;
}>();

const emit = defineEmits(["update:solution"]);

const { t } = useI18n();
const showCustomSolutionDialog = ref(false);

const selectCategory = ref<TSelectCategory>({});
const siteMetaCategory = shallowRef<ISearchCategories[]>([]);
const activeKeys = ref<string[]>([]);

function resetSelectCategory() {
  for (const category of siteMetaCategory.value) {
    selectCategory.value[category.key] = category.cross ? [] : radioDefault;
  }
}

function checkBtnIndeterminate(category: ISearchCategories): boolean {
  const field = selectCategory.value[category.key];
  if (Array.isArray(field)) {
    return field.length > 0 && field.length !== category.options.length;
  }
  return false;
}

function isAllChecked(category: ISearchCategories): boolean {
  const field = selectCategory.value[category.key];
  return Array.isArray(field) && field.length === category.options.length && category.options.length > 0;
}

// 该分类是否为多选（cross）分类；用函数而非模板内可选链，避免 vue 模板对 false | object 联合类型推导报错
function isCrossCategory(category: ISearchCategories): boolean {
  return !!category.cross && !!category.cross.mode;
}

function clickAllBtn(category: ISearchCategories, checked: boolean) {
  selectCategory.value[category.key] = checked ? category.options.map((sp) => sp.value) : [];
}

function saveGeneratedSolution(searchSolution: ISearchSolution) {
  emit("update:solution", searchSolution);

  // 重置本 panel 的数据
  resetSelectCategory();
}

async function generateSolution() {
  const searchSolution = await generateSiteSearchSolution(siteId, selectCategory.value);
  saveGeneratedSolution(searchSolution);
}

onMounted(async () => {
  siteMetaCategory.value = await getSiteMetaCategory(siteId);
  resetSelectCategory();
});
</script>

<template>
  <div class="site-category-panel">
    <div class="category-select">
      <a-collapse v-if="siteMetaCategory.length > 0" v-model:active-key="activeKeys">
        <a-collapse-panel v-for="category in siteMetaCategory" :key="category.key">
          <template #header>
            <span>
              {{ category.name }}
              <span class="category-notes">{{ category.notes ?? "" }}</span>
              <a-tag :color="isDefaultCategory(selectCategory[category.key]) ? 'default' : 'blue'" class="category-key-tag">
                {{ category.key }}
              </a-tag>
            </span>
          </template>

          <!-- 如果该类别支持多选，则显示全选按钮 -->
          <div v-if="isCrossCategory(category)" class="select-all-row">
            <a-checkbox
              :checked="isAllChecked(category)"
              :indeterminate="checkBtnIndeterminate(category)"
              @change="(e: any) => clickAllBtn(category, e.target.checked)"
            >
              <b>{{ t("common.checkbox.all") }}</b>
              <span v-if="!checkBtnIndeterminate(category) && isAllChecked(category)" class="select-all-notice">
                &nbsp;{{ t("SetSearchSolution.spDialog.selectAllNotice") }}
              </span>
            </a-checkbox>
          </div>

          <!-- 多选类别选项 -->
          <a-checkbox-group
            v-if="isCrossCategory(category)"
            v-model:value="selectCategory[category.key]"
            class="option-grid"
          >
            <a-row>
              <a-col v-for="option in category.options" :key="String(option.value)" :xs="24" :sm="12" :md="8" :lg="6">
                <a-checkbox :value="option.value">{{ option.name }}</a-checkbox>
              </a-col>
            </a-row>
          </a-checkbox-group>

          <!-- 单选类别选项 -->
          <a-radio-group v-else v-model:value="selectCategory[category.key]" class="option-grid">
            <a-row>
              <!-- 增加一个代表默认的值，说明该类别什么都不选（尊重站点默认）。（不然的话，只能全部重置才能取消选择） -->
              <a-col :xs="24" :sm="12" :md="8" :lg="6">
                <a-radio :value="radioDefault">{{ t("SetSite.SiteCategoryPanel.siteDefault") }}</a-radio>
              </a-col>
              <a-col v-for="option in category.options" :key="String(option.value)" :xs="24" :sm="12" :md="8" :lg="6">
                <a-radio :value="option.value">{{ option.name }}</a-radio>
              </a-col>
            </a-row>
          </a-radio-group>
        </a-collapse-panel>
      </a-collapse>
      <div v-else class="no-def-notice">{{ t("SetSearchSolution.spDialog.noDefNotice") }}</div>
    </div>

    <div class="action-col">
      <a-tooltip :title="t('SetSearchSolution.spDialog.action.reset')">
        <a-button type="text" danger size="small" @click="resetSelectCategory">
          <template #icon><ClearOutlined /></template>
        </a-button>
      </a-tooltip>
      <a-tooltip :title="t('SetSearchSolution.spDialog.action.create')">
        <a-button type="text" size="small" @click="showCustomSolutionDialog = true">
          <template #icon><EditOutlined /></template>
        </a-button>
      </a-tooltip>
      <a-tooltip :title="t('SetSearchSolution.spDialog.action.add')">
        <a-button type="text" size="small" class="add-btn" @click="generateSolution">
          <template #icon><ArrowRightOutlined /></template>
        </a-button>
      </a-tooltip>
    </div>

    <CustomSolutionDialog
      v-model="showCustomSolutionDialog"
      :save-generated-solution="saveGeneratedSolution"
      :select-category="selectCategory"
      :site-id="siteId"
    />
  </div>
</template>

<style scoped>
.site-category-panel {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.category-select {
  flex: 1;
  min-width: 0;
}
.category-notes {
  margin-left: 4px;
  color: #999;
  font-size: 12px;
}
.category-key-tag {
  margin-left: 8px;
  transform: scale(0.9);
}
.select-all-row {
  margin-bottom: 4px;
}
.select-all-notice {
  color: #ff7875;
  font-weight: normal;
}
.option-grid {
  width: 100%;
}
.no-def-notice {
  padding: 12px;
  color: #999;
}
.action-col {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-top: 4px;
}
.add-btn {
  color: #1677ff;
}
</style>
