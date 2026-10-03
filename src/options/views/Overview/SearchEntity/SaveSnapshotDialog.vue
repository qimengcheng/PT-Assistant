<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import { useMetadataStore } from "@/options/stores/metadata.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { formatDate } from "@/options/utils.ts";

const { t } = useI18n();

const showDialog = defineModel<boolean>();

const metadataStore = useMetadataStore();
const runtimeStore = useRuntimeStore();

// 默认名（只读，仅用于每次打开弹窗时给可编辑的 snapshotName 赋初值）
const defaultSnapshotName = computed(
  () =>
    "[" +
    metadataStore.getSearchSolutionName(runtimeStore.search.searchPlanKey) +
    "] " +
    runtimeStore.search.searchKey +
    " (" +
    formatDate(runtimeStore.search.startAt) +
    ")",
);

// ⚠️ 这里必须是可写的 ref：原先直接把只读 computed 绑给 v-model，
// 用户一输入就触发 "Write operation failed: computed value is readonly"，名字永远改不了。
const snapshotName = ref<string>("");
watch(showDialog, (open) => {
  if (open) {
    snapshotName.value = defaultSnapshotName.value;
  }
});

function saveSearchSnapshotData() {
  metadataStore.saveSearchSnapshotData(snapshotName.value);
  showDialog.value = false;
}
</script>

<template>
  <a-modal v-model:open="showDialog" :title="t('SearchEntity.index.action.saveSnapshot')" :width="500">

    <a-input
      v-model:value="snapshotName"
      size="small"
      :placeholder="t('SearchEntity.SaveSnapshotDialog.snapshotName')"
    />

    <template #footer>
      <a-button @click="showDialog = false">{{ t("common.dialog.cancel") }}</a-button>
      <a-button type="primary" @click="saveSearchSnapshotData">{{ t("common.save") }}</a-button>
    </template>
  </a-modal>
</template>

<style scoped lang="scss"></style>
