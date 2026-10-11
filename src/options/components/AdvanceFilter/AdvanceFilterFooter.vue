<script setup lang="ts">
/**
 * 高级筛选对话框统一底栏：重置（左）/ 命中条数 + 取消 / 生成（右）。
 *
 * `matched` / `total` 是可选的实时预览：只有传了才显示那一行。判据由调用方从
 * `useTableCustomFilter` 的 `countMatchingFn` 拿（与表格同一个 matcher），
 * 这个零件自己不算任何东西 —— 下载历史那版还没接，所以它不显示。
 */
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const props = defineProps<{ matched?: number; total?: number }>();

defineEmits<{
  reset: [];
  cancel: [];
  generate: [];
}>();
</script>

<template>
  <div class="advance-filter-footer">
    <a-button type="text" size="small" @click="$emit('reset')">
      {{ t("common.AdvanceFilterGenerateDialog.reset") }}
    </a-button>
    <div class="footer-spacer" />
    <span v-if="props.matched !== undefined && props.total !== undefined" class="footer-count">
      {{ t("common.AdvanceFilterGenerateDialog.matchedCount", { matched: props.matched, total: props.total }) }}
    </span>
    <a-button type="text" size="small" danger @click="$emit('cancel')">
      {{ t("common.dialog.cancel") }}
    </a-button>
    <a-button type="primary" size="small" @click="$emit('generate')">
      {{ t("common.AdvanceFilterGenerateDialog.generate") }}
    </a-button>
  </div>
</template>

<style scoped lang="scss">
.advance-filter-footer {
  display: flex;
  align-items: center;
  gap: 8px;
}

.footer-spacer {
  flex: 1 1 0;
}

/** 数字右对齐到按钮那一列，读的时候眼睛不用找；不给颜色，跟正文同色才够对比度 */
.footer-count {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
</style>
