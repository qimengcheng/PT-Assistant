<script setup lang="ts">
import { computed, type Component } from "vue";
import { useBreakpoint } from "antdv-next";

const screens = useBreakpoint();

const { disabled = false, ...props } = defineProps<{
  /**
   * 图标组件本身（从 @antdv-next/icons 具名导入后传入），
   * 不要传字符串 —— 字符串形式需要整包导入图标库，产物会多出上千个模块。
   */
  icon: Component;
  text: string;
  disabled?: boolean;
}>();

/** 窄屏只显示图标，宽屏显示「图标 + 文字」 */
const compact = computed(() => !screens.value?.md);
</script>

<template>
  <a-button
    v-bind="$attrs"
    :disabled="disabled"
    :title="props.text"
    :type="compact ? 'text' : 'default'"
    :aria-label="compact ? props.text : undefined"
  >
    <template #icon>
      <component :is="props.icon" />
    </template>
    <span v-if="!compact" class="nav-button-text">{{ props.text }}</span>
  </a-button>
</template>

<style scoped lang="scss">
.nav-button-text {
  font-weight: 500;
  white-space: nowrap;
}
</style>