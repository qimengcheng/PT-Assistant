<script setup lang="ts">
/**
 * 高级筛选对话框统一底栏：重置（左）/ 取消 / 生成（右）。
 */
import { useI18n } from "vue-i18n";

const { t } = useI18n();

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
</style>
