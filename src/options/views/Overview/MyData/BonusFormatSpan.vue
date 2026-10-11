<script setup lang="ts">
import { computed } from "vue";
import { useConfigStore } from "@/options/stores/config.ts";
import { simplifyNumber } from "@/options/utils.ts";
import { bonusFullText, normalizeBonus } from "./utils/format.ts";

const { num, reveal = true } = defineProps<{
  num: number | string | undefined;
  /**
   * 要不要挂这一层「悬停看完整值」的浮层，默认要。
   * 唯一的调用点传 false：「我的数据 → 积分」那一格把 积分 / 做种积分 两行合成**一个**
   * 浮层（Index.vue 的 bonus 列），浮层里不许再套浮层（AGENTS §3.4 那条：已套在浮层里的
   * 元素不许再套 popover —— 指针移到内层时外层判定 mouseleave，会把触发元素一起销毁）。
   */
  reveal?: boolean;
}>();

const configStore = useConfigStore();

const normalizedValue = computed(() => normalizeBonus(num));
const fullText = computed(() => bonusFullText(num));

const displayText = computed(() =>
  normalizedValue.value.type === "number"
    ? configStore.myDataTableControl.simplifyBonusNumbers
      ? simplifyNumber(normalizedValue.value.value)
      : bonusFullText(normalizedValue.value.value)
    : normalizedValue.value.value,
);

function toggleNumberSimplification() {
  if (normalizedValue.value.type !== "number") return;

  configStore.myDataTableControl.simplifyBonusNumbers = !configStore.myDataTableControl.simplifyBonusNumbers;
}
</script>

<template>
  <!-- 揭示全文原先挂原生 title（浏览器画：底色/字号/行宽/延迟都不归页面管），改成 a-popover。
       数字本身双击切换「简化 / 完整」这条行为没动。 -->
  <a-popover v-if="reveal" trigger="hover" placement="topLeft" :mouse-enter-delay="0.4">
    <template #content>
      <div class="reveal-text">{{ fullText }}</div>
    </template>
    <span
      class="text-no-wrap"
      :style="{ cursor: normalizedValue.type === 'number' ? 'pointer' : 'default', userSelect: 'none' }"
      @dblclick="toggleNumberSimplification"
    >
      {{ displayText }}
    </span>
  </a-popover>
  <span
    v-else
    class="text-no-wrap"
    :style="{ cursor: normalizedValue.type === 'number' ? 'pointer' : 'default', userSelect: 'none' }"
    @dblclick="toggleNumberSimplification"
  >
    {{ displayText }}
  </span>
</template>

<style scoped lang="scss">
.reveal-text {
  max-width: 480px;
  white-space: normal;
  overflow-wrap: anywhere;
}
</style>
