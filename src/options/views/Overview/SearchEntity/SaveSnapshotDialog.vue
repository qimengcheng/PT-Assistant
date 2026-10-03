<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";

import { useMetadataStore } from "@/options/stores/metadata.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { formatDate } from "@/options/utils.ts";

const { t } = useI18n();

const showDialog = defineModel<boolean>();

const metadataStore = useMetadataStore();
const runtimeStore = useRuntimeStore();

const snapshotName = computed(
  () =>
    "[" +
    metadataStore.getSearchSolutionName(runtimeStore.search.searchPlanKey) +
    "] " +
    runtimeStore.search.searchKey +
    " (" +
    formatDate(runtimeStore.search.startAt) +
    ")",
);

function saveSearchSnapshotData() {
  metadataStore.saveSearchSnapshotData(snapshotName.value);
  showDialog.value = false;
}
</script>

<template>
  <a-modal v-model:open="showDialog" :width="500">
    <template #title>
      {{ t("SearchEntity.index.action.saveSnapshot") }}
    </template>

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
