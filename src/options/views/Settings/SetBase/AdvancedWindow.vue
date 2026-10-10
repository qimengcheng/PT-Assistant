<script setup lang="ts">
/**
 * 高级与诊断：平时不用碰的那两档 —— 开发者选项（放开「站点定义」「调试」这些内部页面的入口）
 * 和本机 ptd CLI 的通信桥。
 *
 * 为什么把它们并成一节：这两档各自只有 1 个 / 3 个控件，原先各占一节排在目录里，
 * 把「一次配好」那一片拉得跟「天天用」一样长；而它们的共同点恰恰是「都不常改、改错了影响大」，
 * 放一起、压到最后，反而比摊开在第一节和第七节更好找 —— 想找的人知道往下翻，不想找的人不会误碰。
 *
 * ⚠️ 「开发者选项」那颗开关的标签键仍是 `SetBase.UiWindow.developerMode`（同 `AppearanceWindow.vue`
 * 文件头那条口径：重排只动版面，不给语言包添新的搬运风险）。
 */
import { useI18n } from "vue-i18n";
import { useConfigStore } from "@/options/stores/config.ts";

import NativeBridgeWindow from "./NativeBridgeWindow.vue";

const { t } = useI18n();
const configStore = useConfigStore();
</script>

<template>
  <div class="advanced-window">
    <a-form layout="vertical" class="compact-form">
      <div class="group">
        <div class="group-title">{{ t("SetBase.UiWindow.groupDeveloper") }}</div>
        <div class="switch-grid">
          <div class="switch-item">
            <a-switch v-model:checked="configStore.developerMode" size="small" />
            <span class="label">{{ t("SetBase.UiWindow.developerMode") }}</span>
          </div>
        </div>
      </div>
    </a-form>

    <NativeBridgeWindow />
  </div>
</template>
