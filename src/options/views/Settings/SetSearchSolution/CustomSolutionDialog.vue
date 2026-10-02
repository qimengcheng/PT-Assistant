<script setup lang="ts">
/**
 * 自定义搜索方案对话框（antdv-next 平移）。
 * 基于当前站点分类选择生成一份方案，并允许直接编辑其 requestConfig JSON 后回传父组件。
 */
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { nanoid } from "nanoid";
import { isJSON } from "es-toolkit";
import type { TSiteID } from "@ptd/site";

import type { ISearchSolution } from "@/shared/types/storages/metadata.ts";

import SiteName from "@/options/components/SiteName.vue";

import {
  generateSiteSearchSolution,
  getCategoryName,
  getCategoryOptionName,
  getSiteMetaCategory,
  type TSelectCategory,
} from "./utils.ts";

const showDialog = defineModel<boolean>();

const { siteId, selectCategory, saveGeneratedSolution } = defineProps<{
  siteId: TSiteID;
  selectCategory: TSelectCategory;
  saveGeneratedSolution: (searchSolution: ISearchSolution) => void;
}>();

const { t } = useI18n();

const formRef = ref();
const formValid = ref<boolean>(false);
const searchSolution = ref<ISearchSolution>({} as ISearchSolution);
const searchSolutionEntryRequestConfig = ref<string>("");

const rules = computed(() => ({
  name: [{ required: true, message: t("SetSearchSolution.CustomSolutionDialog.solutionName"), trigger: "blur" }],
  requestConfig: [
    { required: true, message: t("SetSearchSolution.CustomSolutionDialog.requestConfig"), trigger: "blur" },
    {
      trigger: "blur",
      validator: (_rule: unknown, value: string) =>
        isJSON(value) ? Promise.resolve() : Promise.reject(t("SetSearchSolution.CustomSolutionDialog.requestConfigJsonError")),
    },
  ],
}));

async function onEnter() {
  // 首先按照默认值生成一次基本情况
  searchSolution.value = await generateSiteSearchSolution(siteId, selectCategory);

  if (searchSolution.value.id === "default") {
    searchSolution.value.id = nanoid(); // 如果是默认id，则生成一个新的id
    searchSolution.value.name = ""; // 清空name
  } else {
    // 为这个 searchSolution 生成默认 name
    const siteMetaCategory = await getSiteMetaCategory(siteId);

    searchSolution.value.name = Object.entries(searchSolution.value.selectedCategories!)
      .map(([category, value]) => {
        return (
          getCategoryName(siteMetaCategory, category) + ": " + getCategoryOptionName(siteMetaCategory, category, value)
        );
      })
      .join(";");

    // 脱钩 selectedCategories，因为 name 已经包含了这些信息
    delete searchSolution.value.selectedCategories;
  }

  // 生成 requestConfig 的 JSON 字符串
  searchSolutionEntryRequestConfig.value = JSON.stringify(
    searchSolution.value.searchEntries?.[searchSolution.value.id]?.requestConfig ?? { params: {}, data: {} },
    null,
    2,
  );
  formValid.value = false;
}

watch(showDialog, (visible) => {
  if (visible) void onEnter();
});

async function doSubmit() {
  try {
    await formRef.value?.validateFields();
  } catch {
    return;
  }

  // 解析 requestConfig
  try {
    const requestConfig = JSON.parse(searchSolutionEntryRequestConfig.value);
    if (searchSolution.value.searchEntries && searchSolution.value.id) {
      searchSolution.value.searchEntries[searchSolution.value.id] ??= {}; // 防止 default 情况下无法赋值
      searchSolution.value.searchEntries[searchSolution.value.id].requestConfig = requestConfig;
    }
  } catch (e) {
    console.error("请求配置 JSON 解析失败", e);
    return;
  }

  // 回调父组件
  saveGeneratedSolution(searchSolution.value);

  // 关闭对话框
  showDialog.value = false;
}
</script>

<template>
  <a-modal
    :open="showDialog"
    :width="800"
    :ok-text="t('common.dialog.ok')"
    :cancel-text="t('common.dialog.cancel')"
    :ok-button-props="{ disabled: !formValid }"
    @update:open="(v: boolean) => (showDialog = v)"
    @ok="doSubmit"
  >
    <template #title>
      <span>{{ t("SetSearchSolution.CustomSolutionDialog.title") }} [ <SiteName :site-id="siteId" tag="span" /> ]</span>
    </template>

    <a-form
      ref="formRef"
      :model="{ name: searchSolution.name, requestConfig: searchSolutionEntryRequestConfig }"
      :rules="rules"
      layout="vertical"
      @validate="({ errorFields }: { errorFields?: any[] }) => (formValid = !errorFields?.length)"
    >
      <a-form-item :label="t('SetSearchSolution.CustomSolutionDialog.solutionName')" name="name">
        <a-input v-model:value="searchSolution.name" />
      </a-form-item>
      <a-form-item
        :label="t('SetSearchSolution.CustomSolutionDialog.requestConfig')"
        name="requestConfig"
        :extra="t('SetSearchSolution.CustomSolutionDialog.requestConfigHint')"
      >
        <a-textarea v-model:value="searchSolutionEntryRequestConfig" :rows="12" class="json-textarea" />
      </a-form-item>
    </a-form>
  </a-modal>
</template>

<style scoped>
.json-textarea {
  font-family: ui-monospace, Menlo, Consolas, monospace;
}
</style>
