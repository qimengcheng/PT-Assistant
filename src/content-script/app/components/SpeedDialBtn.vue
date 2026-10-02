<script setup lang="ts">
import { computed, useAttrs, useTemplateRef, Transition, type TransitionProps } from "vue";
import { useElementHover } from "@vueuse/core";

import { useConfigStore } from "@/options/stores/config.ts";

const {
  title,
  icon,
  color = "#ffffff",
  transition = { name: "fade-transition", appear: true, mode: "out-in" },
} = defineProps<{
  title: string;
  /** 图标组件（从 @antdv-next/icons 具名导入后传入） */
  icon: any;
  color?: string;
  transition?: TransitionProps;
}>();

const configStore = useConfigStore();
const attrs = useAttrs();

const myHoverableElement = useTemplateRef<HTMLElement>("btn");
const isHovered = useElementHover(myHoverableElement);

/** 堆叠模式：显示「图标 + 文字」，且悬浮时加深底色 */
const stacked = computed(() => configStore.contentScript.stackedButtons);

const shouldFadeEnter = computed<boolean>(
  () => !stacked.value && configStore.contentScript.fadeEnterStyle,
);
</script>

<template>
  <Transition v-bind="transition">
    <a-button
      ref="btn"
      v-bind="attrs"
      :class="{ 'ptd-fade-enter': shouldFadeEnter }"
      :style="stacked ? { background: isHovered ? color : 'transparent', borderColor: color } : undefined"
      :title="title"
      shape="circle"
      size="large"
    >
      <template #icon>
        <component :is="icon" />
      </template>
      <span v-if="stacked" :style="{ color: color }">{{ title }}</span>
    </a-button>
  </Transition>
</template>

<style scoped lang="scss">
.ptd-fade-enter {
  opacity: 0.55;
  transition: opacity 0.2s;
}
</style>
