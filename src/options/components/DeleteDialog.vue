<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";

type TDeleteId = any;

const showDialog = defineModel<boolean>();
const { toDeleteIds, confirmDelete: confirmDeleteFn } = defineProps<{
  toDeleteIds: TDeleteId[];
  confirmDelete: (toDeleteId: TDeleteId) => Promise<void> | void;
}>();
const emits = defineEmits<{
  (e: "allDelete"): void;
}>();

const { t } = useI18n();

const isDeleting = ref(false);

async function confirmDelete() {
  isDeleting.value = true;
  await Promise.allSettled(toDeleteIds.map((toDeleteId) => confirmDeleteFn(toDeleteId)));
  isDeleting.value = false;
  showDialog.value = false;
  emits("allDelete");
}

async function dialogEnter() {
  isDeleting.value = false;
}
</script>

<template>
  <!-- footer prop 传 null 会连 #footer slot 一起吞掉（antdv-next: footer: d !== null && ...），底部按钮全消失，故不设 footer -->
  <a-modal
    v-model:open="showDialog"
    :width="340"
    :mask-closable="!isDeleting"
    :closable="!isDeleting"
    :keyboard="!isDeleting"
    @after-open-change="(open: boolean) => open && dialogEnter()"
  >
    <template #title>
      <span style="color: #cf1322">{{ t("common.dialog.title.confirmAction") }}</span>
    </template>

    <div class="text-body-large">
      {{ t("common.dialog.deleteText", [toDeleteIds!.length]) }}
      <slot name="append-text" />
    </div>

    <template #footer>
      <a-button type="text" @click="showDialog = false">
        <span class="ml-1">{{ t("common.dialog.cancel") }}</span>
      </a-button>
      <a-button danger :loading="isDeleting" type="text" @click="confirmDelete">
        <span class="ml-1">{{ t("common.dialog.ok") }}</span>
      </a-button>
    </template>
  </a-modal>
</template>

<style scoped lang="scss"></style>
