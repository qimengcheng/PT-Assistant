<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { EResultParseStatus } from "@ptd/site";

const { status } = defineProps<{
  status: EResultParseStatus;
}>();

const { t } = useI18n();

/**
 * 状态 → a-tag 的颜色/文案映射。
 * 原来这里是 10 个 v-if 分支 + Vuetify 兼容层里的 text-red / text-green 等彩色文字类，
 * 换成 a-tag 后状态标签的视觉与其他页面的标签统一，也不再依赖兼容层。
 */
const meta = computed<{ text: string; color?: string; title?: string }>(() => {
  switch (status) {
    case EResultParseStatus.unknownError:
      return { text: t("resultParseStatus.unknownError"), color: "error" };
    case EResultParseStatus.waiting:
      return { text: t("resultParseStatus.waiting"), color: "processing" };
    case EResultParseStatus.working:
      return { text: t("resultParseStatus.working"), color: "processing" };
    case EResultParseStatus.success:
      return { text: t("resultParseStatus.success"), color: "success" };
    case EResultParseStatus.parseError:
      return { text: t("resultParseStatus.parseError"), color: "error" };
    case EResultParseStatus.passParse:
      return { text: t("resultParseStatus.passParse"), color: "warning" };
    case EResultParseStatus.CFBlocked:
      return { text: t("resultParseStatus.CFBlocked"), title: t("resultParseStatus.CFBlockedNotes") };
    case EResultParseStatus.needLogin:
      return { text: t("resultParseStatus.needLogin"), color: "error" };
    case EResultParseStatus.noUserInput:
      return { text: t("resultParseStatus.noUserInput"), color: "error" };
    case EResultParseStatus.noResults:
      return { text: t("resultParseStatus.noResults"), color: "warning" };
    default:
      return { text: t("resultParseStatus.unknown") };
  }
});
</script>

<template>
  <a-tag :color="meta.color" :title="meta.title" :bordered="false" style="margin-inline-end: 0">
    {{ meta.text }}
  </a-tag>
</template>

<style scoped lang="scss"></style>
