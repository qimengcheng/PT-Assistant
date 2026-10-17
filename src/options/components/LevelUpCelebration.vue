<script setup lang="ts">
/**
 * 站点等级升了级 → 全屏烟花 + 一张祝贺卡（用户 2026-10-13：「用户数据更新后发现用户升级之后
 * 要祝贺用户，要有好看的烟花动画」）。
 *
 * 只在 `entrypoints/options/App.vue` 那一层挂：烟花是**整屏**的效果，挂在某个页面组件里
 * 就会跟着路由切换被换掉 —— 而这一场可能正好落在用户切去别的页面的那一秒。
 *
 * 措辞与判据都不在这里：那些住 `src/shared/levelUp.ts`，系统通知那一条吃的是同一份，
 * 抄第二份就是「卡片说升了、通知说的不是」（同 v0.79.0 那张辅种进展卡的口径）。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { FireOutlined } from "@antdv-next/icons";

import { levelUpDetailLines, levelUpLead, levelUpTitle, type ILevelUpItem } from "@/shared/levelUp.ts";
import type { ILevelUpGreeting } from "@/shared/reseedPresence.ts";
import { playFireworks, type IFireworksHandle } from "@/options/utils/fireworks.ts";

const props = defineProps<{
  greeting: ILevelUpGreeting | null;
  /** 界面按 `config.lang` 传：文案两处共用一份判法，所以措辞跟着这份走而不是跟着组件自己的 locale */
  lang?: string;
}>();

const emit = defineEmits<{ (e: "close"): void }>();

const { t } = useI18n();

const canvasEl = ref<HTMLCanvasElement | null>(null);
const visible = ref(false);
/** 卡片入场那一下：先挂上再翻，transition 才有起始值（同帧给 true 会被浏览器合并成没动过） */
const entered = ref(false);

let fireworks: IFireworksHandle | null = null;

const items = computed<ILevelUpItem[]>(() => props.greeting?.items ?? []);
const title = computed(() => levelUpTitle(props.lang));
const lead = computed(() => levelUpLead(items.value, props.lang));
const details = computed(() => levelUpDetailLines(items.value, props.lang));

/**
 * 系统开了「减少动态效果」就只出那张卡、不放烟花。整屏闪烁的动画对前庭功能敏感的人
 * 不是「好看」而是难受，这条是 WCAG 2.3.3 那一档；关掉动画不该连带把「你升级了」这件事也吞掉。
 */
function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

function stopShow(): void {
  fireworks?.stop();
  fireworks = null;
}

function closeNow(): void {
  stopShow();
  visible.value = false;
  entered.value = false;
  emit("close");
}

/**
 * 烟花**循环放**、卡片**不自己消失**（用户 2026-10-17：「升级时的烟花要循环播放，弹窗也不要自己消失，
 * 用户手动关闭后才停止烟花」）。所以这里没有任何定时器：收场只有 `closeNow` 这一个入口，
 * 它先 `stop()` 把 rAF 与 resize 监听摘掉，再把卡片收掉。
 * 减动效那一档同样等手动关：那条只该决定「放不放烟花」，不该顺手把「卡会不会自己走」也改掉。
 */
function startShow(): void {
  stopShow();
  visible.value = true;
  void nextTick(() => {
    entered.value = true;
    if (prefersReducedMotion()) return;
    const canvas = canvasEl.value;
    if (!canvas) return;
    fireworks = playFireworks(canvas, { loop: true });
  });
}

/**
 * 只认 `at`：那是这一批的写入时刻，同 `session:reseedNotice` 那条理由一样 —— 连续两批内容
 * 可能一字不差（同站同等级名），只看内容会把第二场吞掉。
 */
watch(
  () => props.greeting?.at,
  (at) => {
    if (!at || items.value.length === 0) return;
    startShow();
  },
);

onBeforeUnmount(stopShow);
</script>

<template>
  <div v-if="visible" class="level-up-celebration" :class="{ 'is-in': entered }" role="status" aria-live="polite">
    <canvas ref="canvasEl" class="level-up-canvas" />
    <section class="level-up-card">
      <header class="level-up-head">
        <FireOutlined class="level-up-icon" />
        <span>{{ title }}</span>
      </header>
      <p class="level-up-lead">{{ lead }}</p>
      <ul v-if="details.length > 0" class="level-up-list">
        <li v-for="(line, i) in details" :key="i">{{ line }}</li>
      </ul>
      <a-button type="primary" class="level-up-close" @click="closeNow">{{ t("common.dialog.close") }}</a-button>
    </section>
  </div>
</template>

<style scoped>
.level-up-celebration {
  position: fixed;
  inset: 0;
  /* 盖过弹窗（antd modal 1000）与通知卡片（1010）：这一场是全屏效果，
     不该被一张正开着的弹窗裁掉半截 */
  z-index: 2200;
  /* 整屏只有那张卡可点，别的地方一律穿透 —— 烟花期间用户还能照常操作页面 */
  pointer-events: none;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 14vh;
}

.level-up-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.level-up-card {
  position: relative;
  pointer-events: auto;
  min-width: 280px;
  max-width: 480px;
  padding: 16px 18px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.95);
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.18);
  text-align: center;
  opacity: 0;
  transform: translateY(-8px);
  transition:
    opacity 0.28s ease,
    transform 0.28s ease;
}

.level-up-celebration.is-in .level-up-card {
  opacity: 1;
  transform: none;
}

.level-up-head {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 15px;
  font-weight: 600;
}

/* 图标不写死颜色就没法在整片白底上有分量；这一档在白卡上是 5.18:1（非文本图形下限 3:1）。
   按钮里那颗照旧不许写色 —— 那里继承的是实心蓝底上的白字前景。 */
.level-up-icon {
  color: #c2410c;
}

.level-up-lead {
  margin: 10px 0 0;
  overflow-wrap: anywhere;
}

.level-up-list {
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
  font-size: 13px;
  color: rgba(0, 0, 0, 0.72);
  overflow-wrap: anywhere;
}

.level-up-list li + li {
  margin-top: 2px;
}

.level-up-close {
  margin-top: 14px;
}

@media (prefers-reduced-motion: reduce) {
  .level-up-card {
    transition: none;
  }
}
</style>
