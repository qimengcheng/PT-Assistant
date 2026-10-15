<script setup lang="ts">
/**
 * 悬浮提示的统一外壳。
 *
 * 为什么要有这一颗：界面上原先有几十处 `:title="…"`，而 `title` 不是 antd 的 prop，
 * 它被 `inheritAttrs` 原样塞进 DOM，出的是**浏览器自己画的那层提示** —— 底色、字号、
 * 行宽、出现延迟全都由系统定，页面一点控制不了，深色主题下还会跟界面脱节。
 * 用户 2026-10-07 定过一次「揭示走 popover」，2026-10-15 把口径扩成
 * 「**所有**悬浮提示都不许用原生 title」。所以这一族统一走 `a-popover`，
 * 样式与延迟只在这里写一份。判据在 `scripts/check-native-title.mjs`。
 *
 * 两条实测来的边界（AGENTS §3.4 那一条的原文，这里照做）：
 * - `v-if` 挂在 `a-popover` 本体上，不挂在插槽里的子节点上 —— 子节点不在时插槽是空的，
 *   Popover 会给自己补一个空 `<span>` 当触发元素，那层空 span 会顶掉 flex item 本体。
 *   所以「没有提示文案」这一档由本组件的 `v-else` 直接原样渲染子节点，不产生任何包装元素。
 * - 子节点在位时 Popover **不生成包装元素**（`@v-c/trigger` 取 `slots.default()[0]` 再
 *   mergeProps），所以调用点上原来那些 class / `text-truncate` / flex 布局都不受影响。
 */
import { Comment, computed, useSlots } from "vue";

interface IProps {
  /** 提示正文。空串 / undefined / null 时不挂浮层，原样渲染子节点 */
  text?: string | null;
  /** 浮层方位，默认上方 */
  placement?: "top" | "bottom" | "left" | "right" | "topLeft" | "topRight" | "bottomLeft" | "bottomRight";
  /** 悬停多久后出浮层：整行/长文案 0.4，小命中区（图标）0.2 */
  delay?: number;
  /**
   * 把浮层挂进某个祖先容器，而不是 `document.body`。
   *
   * 只为一件事：提示本身躺在**另一层悬停浮层里**（例如「我的数据 → 等级要求」那一块挂在
   * `a-tooltip` 的面板中）。那种情况下内层浮层默认 portal 到 body，指针从外层面板移进内层
   * 浮层时，外层判定 mouseleave 会把自己连同内层的触发元素一起销毁 —— 内层跟着消失、外层整块
   * 关掉。给内层指定 `insideClass`，让浮层落进外层面板内部，指针始终算待在外层里。
   */
  insideClass?: string;
}

const props = withDefaults(defineProps<IProps>(), {
  text: undefined,
  placement: "top",
  delay: 0.2,
  insideClass: undefined,
});

const hasText = computed(() => props.text !== undefined && props.text !== null && props.text !== "");

/**
 * 要不要挂这层浮层：有文案，**且**默认插槽里真的有触发元素。
 *
 * 写成渲染期调用的函数而不是 computed —— 插槽内容的变化不是本组件的响应式依赖，
 * computed 会把第一次的结果一直缓存下去，调用点那颗 `v-if` 后来翻转时判据就僵住了。
 * 正解是把 `v-if` 挂在本组件上（AGENTS §3.4 那条），但万一挂到了子节点上，插槽就是空的，
 * 而空插槽会让 Popover 给自己补一个空 `<span>` 当触发元素 —— 那一格平白多出一个子项。
 */
const slots = useSlots();
function showTip(): boolean {
  if (!hasText.value) return false;
  return (slots.default?.() ?? []).some((node) => node.type !== Comment);
}

/**
 * `getPopupContainer` 由 antd 传入触发元素，所以不需要 ref 就能拿到它所在的容器。
 *
 * ⚠️ 只在点名 `insideClass` 时才把这个 prop 交出去：content script 那侧的 App.vue 用
 * ConfigProvider 全局配了 `getPopupContainer`（把浮层挂进 shadowRoot 里，否则取不到扩展的
 * 样式）。这里无条件给一个函数会**盖掉**那份全局配置，浮层落到页面 body 上就没样式了。
 */
function resolveContainer(triggerNode: HTMLElement): HTMLElement {
  if (props.insideClass) {
    const host = triggerNode?.closest?.(`.${props.insideClass}`);
    if (host instanceof HTMLElement) return host;
  }
  return document.body;
}
</script>

<template>
  <a-popover
    v-if="showTip()"
    trigger="hover"
    :placement="placement"
    :mouse-enter-delay="delay"
    :get-popup-container="insideClass ? resolveContainer : undefined"
  >
    <template #content>
      <div class="hover-tip-text">{{ text }}</div>
    </template>
    <slot />
  </a-popover>
  <slot v-else />
</template>

<style scoped lang="scss">
/* 与 TorrentTitleTd / SentToDownloaderDialog 那两处 `.reveal-text` 同一档：
   上限 480px、允许换行、无空格长串（种子标题、路径）也要断得开。 */
.hover-tip-text {
  max-width: 480px;
  white-space: normal;
  overflow-wrap: anywhere;
}
</style>
