<script setup lang="ts">
/**
 * 高级筛选对话框：区间滑块。
 * 把 Vuetify v-range-slider 的 ticks（原始数值数组）转成 a-slider 的 marks。
 *
 * formatter：
 * - 传函数：tooltip 用该函数格式化（日期/体积）
 * - 传 null：明确不要 formatter（数字区间，tooltip 只显示原值）
 * - 不传：不挂 formatter 键，走 a-slider 默认格式化
 */
import { computed } from "vue";

const range = defineModel<[number, number]>({ required: true });

const props = defineProps<{
  min: number;
  max: number;
  step: number;
  ticks?: number[];
  formatter?: ((value?: number) => string) | null;
}>();

const marks = computed<Record<number, null>>(() => {
  const out: Record<number, null> = {};
  for (const tick of props.ticks ?? []) out[tick] = null;
  return out;
});

const tooltip = computed(() =>
  props.formatter === undefined ? { open: true } : { open: true, formatter: props.formatter },
);
</script>

<template>
  <a-slider
    v-model:value="range"
    range
    :min="min"
    :max="max"
    :step="step"
    :marks="marks"
    :tooltip="tooltip"
  />
</template>
