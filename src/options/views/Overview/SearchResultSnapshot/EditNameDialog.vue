<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { CloseOutlined } from "@antdv-next/icons";

import { useMetadataStore } from "@/options/stores/metadata.ts";
import { type TSearchSnapshotKey } from "@/shared/types.ts";

const { t } = useI18n();

const showDialog = defineModel<boolean>();

const props = defineProps<{
  editId: TSearchSnapshotKey;
}>();

const metadataStore = useMetadataStore();
const snapshotName = ref("");

function saveSearchSnapshotData() {
  metadataStore.editSearchSnapshotDataName(props.editId, snapshotName.value);
  showDialog.value = false;
}

function dialogEnter() {
  snapshotName.value = metadataStore.snapshots[props.editId]?.name ?? "";
}
</script>

<template>
  <a-modal
    v-model:open="showDialog"
    :title="t('SearchResultSnapshot.EditNameDialog.title')"
    :width="500"
    :footer="null"
    @after-open-change="(open: boolean) => open && props.editId && dialogEnter()"
    @after-close="() => (snapshotName = '')"
  >

    <a-input
      v-model:value="snapshotName"
      size="small"
      :placeholder="t('SearchResultSnapshot.EditNameDialog.snapshotName')"
      @press-enter="saveSearchSnapshotData"
    />

    <div class="dialog-actions">
      <a-button size="small" type="text" @click="showDialog = false">
        <template #icon>
          <CloseOutlined />
        </template>
        <span class="ml-1">{{ t("common.dialog.close") }}</span>
      </a-button>
      <a-button size="small" type="primary" @click="saveSearchSnapshotData">
        <span class="ml-1">{{ t("common.save") }}</span>
      </a-button>
    </div>
  </a-modal>
</template>

<style scoped lang="scss">
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
</style>
