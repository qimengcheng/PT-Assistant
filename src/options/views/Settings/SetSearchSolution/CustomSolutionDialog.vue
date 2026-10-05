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

import { useMetadataStore } from "@/options/stores/metadata.ts";

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
const metadataStore = useMetadataStore();

/**
 * 站点名要拼进标题：原先用 <SiteName> 组件塞在 #title 插槽里，
 * 而 antdv-next 的 modal header 无 padding、关闭按钮绝对定位在右上角，插槽内容会压到 X 上。
 */
const siteName = ref<string>("");
watch(
  () => siteId,
  async (id) => {
    if (!id) {
      siteName.value = "";
      return;
    }
    try {
      siteName.value = await metadataStore.getSiteName(id);
    } catch (e) {
      console.error("[PTD] load site name failed", id, e);
      siteName.value = "";
    }
  },
  { immediate: true },
);

const dialogTitle = computed(() => {
  const base = t("SetSearchSolution.CustomSolutionDialog.title");
  return siteName.value ? `${base} [ ${siteName.value} ]` : base;
});


const formRef = ref();
const searchSolution = ref<ISearchSolution>({} as ISearchSolution);
const searchSolutionEntryRequestConfig = ref<string>("");

/**
 * a-form 的 model。用 computed 包一层而不是在模板里写对象字面量：
 * 字面量每次渲染都新建一个对象，Form 若在初始化时缓存了 model 引用，之后拿到的是过期对象。
 * 同项目其它表单（SetBackup/Editor.vue、SetDownloader/Editor.vue）也都传稳定的对象。
 */
const formModel = computed(() => ({
  name: searchSolution.value.name,
  requestConfig: searchSolutionEntryRequestConfig.value,
}));

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
    :title="dialogTitle"
    :width="800"
    :ok-text="t('common.dialog.ok')"
    :cancel-text="t('common.dialog.cancel')"
    @update:open="(v: boolean) => (showDialog = v)"
    @ok="doSubmit"
  >

    <a-form
      ref="formRef"
      :model="formModel"
      :rules="rules"
      layout="vertical"
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
