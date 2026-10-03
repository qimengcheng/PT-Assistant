<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { ApiOutlined, CheckCircleOutlined, CloseCircleOutlined } from "@antdv-next/icons";

const { checkFn, resetTimeout } = defineProps<{
  checkFn: () => Promise<boolean>;
  resetTimeout?: number;
}>();
const emits = defineEmits<{
  (e: "after:checkConnect"): void;
}>();

const { t } = useI18n();

enum connectStatus {
  default = "default",
  success = "success",
  error = "error",
}

const connectBtnMap: Record<connectStatus, { icon: any; color: string }> = {
  [connectStatus.default]: { icon: ApiOutlined, color: "default" },
  [connectStatus.success]: { icon: CheckCircleOutlined, color: "success" },
  [connectStatus.error]: { icon: CloseCircleOutlined, color: "danger" },
};

const isTestingConnectRef = ref<boolean>(false);
const connectStatusRef = ref<connectStatus>(connectStatus.default);

async function checkConnect() {
  isTestingConnectRef.value = true;
  try {
    connectStatusRef.value = (await checkFn()) ? connectStatus.success : connectStatus.error;
  } catch (e) {
    connectStatusRef.value = connectStatus.error;
    if (resetTimeout) {
      setTimeout(() => (connectStatusRef.value = connectStatus.default), resetTimeout);
    }
  } finally {
    isTestingConnectRef.value = false;
    emits("after:checkConnect");
  }
}
</script>

<template>
  <a-button
    block
    type="text"
    :disabled="isTestingConnectRef"
    :loading="isTestingConnectRef"
    @click="checkConnect"
  >
    <template #icon>
      <component :is="connectBtnMap[connectStatusRef].icon" />
    </template>
    <span :style="connectBtnMap[connectStatusRef].color === 'success' ? 'color:#389e0d' : ''">
      {{ t("connectCheck." + connectStatusRef) }}
    </span>
  </a-button>
</template>

<style scoped lang="scss"></style>
