<script setup lang="ts">
/**
 * 高级筛选对话框：区间滑块。
 * 把 Vuetify v-range-slider 的 ticks（原始数值数组）转成 a-slider 的 marks。
 *
 * formatter：
 * - 传函数：tooltip 与上面那行读数都用它格式化（日期 / 体积）
 * - 传 null：明确不要 formatter（数字区间，读数就是原值）
 * - 不传：不挂 formatter 键，tooltip 走 a-slider 默认格式化，读数走原值
 *
 * **读数为什么由这一层自己画**：原先这里挂的是 `tooltip: { open: true }`（照搬 Vuetify 的
 * `thumb-label="always"`），那颗气泡是绝对定位的，会**压在上一行**——他 2026-10-11 指着的
 * 「1970-01-01 08:00」盖住「已完成」那一格、「0.00 B」盖住日期预设按钮就是这个。
 * 而且区间滑块有两个把手，两个气泡各说一半，合起来也读不出「从 — 到」。
 * 现在气泡只在悬停 / 拖动时出现（那才是需要精确值的时刻），静止时看这一行正常流的读数。
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

/** 一个边界的读数：有 formatter 就用它，它给出空串或没给 formatter 就退回原值 */
function showOne(value: number | undefined): string {
  if (typeof value !== "number") return "";
  const text = props.formatter ? props.formatter(value) : undefined;
  return text ? text : String(value);
}

const readout = computed(() => `${showOne(range.value?.[0])} – ${showOne(range.value?.[1])}`);

const tooltip = computed(() => (props.formatter === undefined ? {} : { formatter: props.formatter }));
</script>

<template>
  <div class="range-slider">
    <div class="range-slider-readout text-grey">{{ readout }}</div>
    <a-slider
      v-model:value="range"
      range
      :min="min"
      :max="max"
      :step="step"
      :marks="marks"
      :tooltip="tooltip"
    />
  </div>
</template>

<style lang="scss" scoped>
/**
 * 读数那一行不许伸手去碰滑块：它是正常流的一行，`pointer-events: none` 让指针穿过它落到轨道上，
 * 否则贴着上沿的那几像素会被这行文字吃掉（拖动时按不到把手两端）。
 */
.range-slider-readout {
  font-size: 12px;
  line-height: 18px;
  text-align: right;
  pointer-events: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
