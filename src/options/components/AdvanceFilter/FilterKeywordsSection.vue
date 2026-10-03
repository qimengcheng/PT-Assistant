<script setup lang="ts">
/**
 * 高级筛选对话框：关键词「必含 / 排除」双输入框。
 * SearchEntity 与 DownloadHistory 两个 AdvanceFilterGenerateDialog 逐字相同的部分。
 */
import { useI18n } from "vue-i18n";

import type { ITextValue } from "@/options/directives/useAdvanceFilter.ts";

const { t } = useI18n();

const text = defineModel<ITextValue>({ required: true });
</script>

<template>
  <a-row :gutter="12">
    <a-col :xs="24" :md="12">
      <a-select
        v-model:value="text.required"
        mode="tags"
        size="small"
        :token-separators="[',']"
        style="width: 100%"
        :placeholder="t('common.AdvanceFilterGenerateDialog.required')"
      />
    </a-col>
    <a-col :xs="24" :md="12">
      <a-select
        v-model:value="text.exclude"
        mode="tags"
        size="small"
        :token-separators="[',']"
        style="width: 100%"
        :placeholder="t('common.AdvanceFilterGenerateDialog.exclude')"
      />
    </a-col>
  </a-row>
</template>
