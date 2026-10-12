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
 *
 * v0.92.2 起这一节多了「在浏览器控制台输出运行日志」：它不是界面开关，是**诊断开关** ——
 * 关掉时控制台安静（默认），打开时才看得到 log/info/debug/warn 四档。和「开发者选项」并在一节，
 * 是因为两者都是「平时不用碰、排查问题才打开」那一类。
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
          <!-- 控制台日志总闸：判据在 src/shared/consoleLog.ts（报错不在闸内，那一档始终输出） -->
          <div class="switch-item">
            <a-switch v-model:checked="configStore.consoleLog" size="small" />
            <span class="label">{{ t("SetBase.UiWindow.consoleLog") }}</span>
          </div>
        </div>
      </div>
    </a-form>

    <NativeBridgeWindow />
  </div>
</template>
