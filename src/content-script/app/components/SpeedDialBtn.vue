<script setup lang="ts">
import { computed, useAttrs, useTemplateRef, type Component, type TransitionProps } from "vue";
import { useElementHover } from "@vueuse/core";

import { useConfigStore } from "@/options/stores/config.ts";
import HoverTip from "@/options/components/HoverTip.vue";

const {
  title,
  icon,
  color = "#ffffff",
  transition = { name: "fade-transition", appear: true, mode: "out-in" },
} = defineProps<{
  title: string;
  /** 图标组件（从 @antdv-next/icons 具名导入后传入） */
  icon: Component;
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
    <!-- 堆叠模式（图标 + 文字）文字已经写着这一句，不再挂浮层；只剩圆图标那一档才需要。
         原先是无条件挂原生 title，而它落在 shadowRoot 之外的系统层上：字号、行宽、
         出现延迟都不归页面管（用户 2026-10-15「所有的悬浮提示都不要用原生的 title」）。 -->
    <HoverTip :text="stacked ? undefined : title">
      <a-button
        ref="btn"
        v-bind="attrs"
        :class="{ 'ptd-fade-enter': shouldFadeEnter }"
        :style="stacked ? { background: isHovered ? color : 'transparent', borderColor: color } : undefined"
        shape="circle"
        size="large"
      >
        <template #icon>
          <component :is="icon" />
        </template>
        <span v-if="stacked" :style="{ color: color }">{{ title }}</span>
      </a-button>
    </HoverTip>
  </Transition>
</template>

<style scoped lang="scss">
.ptd-fade-enter {
  opacity: 0.55;
  transition: opacity 0.2s;
}
</style>
