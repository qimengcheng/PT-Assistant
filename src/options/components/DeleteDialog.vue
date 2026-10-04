<script setup lang="ts" generic="Id extends string | number">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { message } from "antdv-next";

const showDialog = defineModel<boolean>();
const { toDeleteIds, confirmDelete: confirmDeleteFn } = defineProps<{
  toDeleteIds: Id[];
  confirmDelete: (toDeleteId: Id) => Promise<void> | void;
}>();
const emits = defineEmits<{
  (e: "allDelete"): void;
}>();

const { t } = useI18n();

const isDeleting = ref(false);

async function confirmDelete() {
  isDeleting.value = true;
  try {
    const results = await Promise.allSettled(toDeleteIds.map((toDeleteId) => confirmDeleteFn(toDeleteId)));

    // ⚠️ allSettled 会把失败吞掉：原来无论成败都关窗 + emits("allDelete")，
    // 父组件收到通知后刷新列表，用户看到「删除成功」但实际可能一个都没删掉。
    // 这里统计失败项并明确告知，弹窗保持打开让用户决定是否重试。
    const failed = results.filter((r) => r.status === "rejected");
    if (failed.length > 0) {
      console.error(
        "[PTD] delete partially failed",
        failed.map((r) => (r as PromiseRejectedResult).reason),
      );
      message.error(t("common.dialog.deleteFailed", [failed.length]));
      return;
    }

    showDialog.value = false;
    emits("allDelete");
  } finally {
    isDeleting.value = false;
  }
}

async function dialogEnter() {
  isDeleting.value = false;
}
</script>

<template>
  <!-- footer prop 传 null 会连 #footer slot 一起吞掉（antdv-next: footer: d !== null && ...），底部按钮全消失，故不设 footer -->
  <a-modal
    v-model:open="showDialog"
    :title="t('common.dialog.title.confirmAction')"
    wrap-class-name="modal-title--danger"
    :width="340"
    :mask="{ closable: !isDeleting }"
    :closable="!isDeleting"
    :keyboard="!isDeleting"
    :after-open-change="(open: boolean) => open && dialogEnter()"
  >

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
