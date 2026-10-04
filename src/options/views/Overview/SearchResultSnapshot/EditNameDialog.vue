<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";

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
    :ok-text="t('common.save')"
    :cancel-text="t('common.dialog.cancel')"
    :after-open-change="(open: boolean) => open && props.editId && dialogEnter()"
    :after-close="() => (snapshotName = '')"
    @ok="saveSearchSnapshotData"
  >
    <a-input
      v-model:value="snapshotName"
      :placeholder="t('SearchResultSnapshot.EditNameDialog.snapshotName')"
      @press-enter="saveSearchSnapshotData"
    />
  </a-modal>
</template>
