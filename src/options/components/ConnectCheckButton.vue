<script setup lang="ts">
import { onUnmounted, ref, type Component } from "vue";
import { useI18n } from "vue-i18n";
import { ApiOutlined, CheckCircleOutlined, CloseCircleOutlined } from "@zboson/icons";

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

const connectBtnMap: Record<connectStatus, { icon: Component; color: string }> = {
  [connectStatus.default]: { icon: ApiOutlined, color: "default" },
  [connectStatus.success]: { icon: CheckCircleOutlined, color: "success" },
  [connectStatus.error]: { icon: CloseCircleOutlined, color: "danger" },
};

const isTestingConnectRef = ref<boolean>(false);
const connectStatusRef = ref<connectStatus>(connectStatus.default);

/**
 * 失败后自动复位的定时器句柄。
 *
 * ⚠️ 原先不保存句柄：组件卸载（切路由、关弹窗）后这个 setTimeout 照样醒来，
 * 去写一个已经卸载掉的组件的 ref（泄漏一条 Vue warn）。连点两次还会排出两个
 * 定时器，第二个在第一个之后才复位 —— 用户看到状态「刚变回默认又跳回错误」。
 */
let resetTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleReset() {
  if (!resetTimeout) return;
  if (resetTimer) clearTimeout(resetTimer); // 连点时只保留最后一个
  resetTimer = setTimeout(() => {
    resetTimer = undefined;
    connectStatusRef.value = connectStatus.default;
  }, resetTimeout);
}

onUnmounted(() => {
  if (resetTimer) clearTimeout(resetTimer);
  resetTimer = undefined;
});

async function checkConnect() {
  isTestingConnectRef.value = true;
  try {
    connectStatusRef.value = (await checkFn()) ? connectStatus.success : connectStatus.error;
  } catch (e) {
    connectStatusRef.value = connectStatus.error;
    scheduleReset();
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
