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
  <!-- 这条曾经写 `bordered` prop，已删。删的理由不是「死属性」—— 那个说法是错的：
     antdv-next 1.5.6 的 Tag 确实声明了 bordered?: boolean（dist/tag/index.d.ts:37，
     无 @deprecated），hooks/useColor.js:16 真读它，语义是**降级**：
     bordered === false 时强制把 variant 压成 filled（默认值就是 true）。
     也就是说它能「取消描边」，但永远造不出描边 —— 要描边请写 variant="outlined" -->
  <a-tag :color="meta.color" :title="meta.title" style="margin-inline-end: 0">
    {{ meta.text }}
  </a-tag>
</template>

<style scoped lang="scss"></style>
