<script setup lang="ts" generic="T">
import { useI18n } from "vue-i18n";
import { BorderOutlined, CheckSquareOutlined, MinusSquareOutlined } from "@zboson/icons";

const { t } = useI18n();

const selected = defineModel<T[]>({ required: true });
const { all } = defineProps<{
  all: T[];
}>();

function updateSelected(value: T[]) {
  selected.value = value;
}
</script>

<template>
  <!--
    这一排必须自己带缝。原先组件是**三颗按钮当三个根节点**（多根 fragment），于是：
    - 调用点包的那层 a-space 只把「整个组件」数成一个孩子，缝给不到按钮之间
      → 一键导入站点那排三颗零间距贴边（用户 2026-10-11 指的就是这个）；
    - 调用点传的 class 会落到**每一颗**按钮上（统计图表 / 时间线那两处写的 ml-2
      就是靠这个副作用凑出缝的，第一颗因此还多被推了 8px）。
    改成单根 + gap 之后，class 与事件都落在这一层，缝由组件自己负责。
  -->
  <div class="check-switch">
    <a-button type="primary" size="small" @click="() => updateSelected(all)">
      <template #icon><CheckSquareOutlined /></template>
      <span>{{ t("common.checkbox.all") }}</span>
    </a-button>
    <a-button type="primary" size="small" @click="() => updateSelected([])">
      <template #icon><BorderOutlined /></template>
      <span>{{ t("common.checkbox.none") }}</span>
    </a-button>
    <a-button type="primary" size="small" @click="() => updateSelected(all.filter((item) => !selected.includes(item)))">
      <template #icon><MinusSquareOutlined /></template>
      <span>{{ t("common.checkbox.invert") }}</span>
    </a-button>
  </div>
</template>

<style scoped lang="scss">
.check-switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
</style>
