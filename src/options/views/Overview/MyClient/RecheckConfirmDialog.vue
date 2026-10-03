<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { CheckCircleOutlined, CloseCircleOutlined, ReloadOutlined } from "@antdv-next/icons";

const showDialog = defineModel<boolean>();
const { torrentCount, confirmFn } = defineProps<{
  torrentCount: number;
  confirmFn: () => Promise<void> | void;
}>();

const { t } = useI18n();

const isRechecking = ref(false);

async function confirmRecheck() {
  isRechecking.value = true;
  try {
    await confirmFn();
  } finally {
    isRechecking.value = false;
    showDialog.value = false;
  }
}

function dialogEnter() {
  isRechecking.value = false;
}
</script>

<template>
  <!--
    原实现就是「常驻对话框 + 确定按钮」的确认框（不是原生 confirm()），
    因此这里保持同构：a-modal + 自定义 footer，
    而不是换成 Modal.confirm() —— 后者会把本组件 props 里的 torrentCount / confirmFn
    拆成调用方闭包，父组件 showRecheckDialog / toRecheckTorrents 的状态就无处安放了。
    :persistent="isRechecking" → mask-closable / keyboard / closable 三者同时受控。
  -->
  <a-modal
    v-model:open="showDialog"
    :title="t('MyClient.recheckDialog.title')"
    :width="420"
    :mask-closable="!isRechecking"
    :closable="!isRechecking"
    :keyboard="!isRechecking"
    @after-open-change="(open: boolean) => open && dialogEnter()"
  >

    <div class="text-body-large">{{ t("MyClient.recheckDialog.text", { count: torrentCount }) }}</div>

    <template #footer>
      <div class="dialog-footer">
        <div style="flex: 1" />
        <a-button color="blue" variant="text" icon-placement="start" :disabled="isRechecking" @click="showDialog = false">
          <template #icon>
            <CloseCircleOutlined />
          </template>
          <span class="ml-1">{{ t("common.dialog.cancel") }}</span>
        </a-button>
        <a-button color="cyan" variant="text" icon-placement="start" :loading="isRechecking" @click="confirmRecheck">
          <template #icon>
            <ReloadOutlined />
          </template>
          <span class="ml-1">{{ t("common.dialog.ok") }}</span>
        </a-button>
      </div>
    </template>
  </a-modal>
</template>

<style scoped lang="scss">
/* 原 v-card-title class="bg-cyan-lighten-2" */
.dialog-footer {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
