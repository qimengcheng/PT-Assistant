<script setup lang="ts">
/**
 * 外观与表格：**插件自己这套界面**的设置 —— 语言，以及各页表格要不要记住你上次挑的排序和每页条数。
 *
 * 原先这一档和「注入到站点页面的助手」挤在同一节（那节叫「界面与内容脚本」），可这两组东西
 * 从来没有一次一起改过：这里是一条下拉 + 两颗开关，那边是十颗开关。拆开后各自有名字，
 * 助手那半搬去 `SitePageWindow.vue`，「开发者选项」那半搬去 `AdvancedWindow.vue`。
 *
 * ⚠️ 设置项的标签键仍写作 `SetBase.UiWindow.*`（不是本文件的名字）：这批文案中英各一条、
 * 共 30 多个键，重排只动版面；把键一起搬家就要在两份语言包各改一遍，改漏一个键的表现是
 * 界面上直接渲染出键路径（AGENTS §3.4 防线③那种），比名字对不上贵得多。
 */
import { useI18n } from "vue-i18n";
import { useConfigStore } from "@/options/stores/config.ts";
import { definedLangMetaData } from "@/options/plugins/i18n.ts";

const { t } = useI18n();
const configStore = useConfigStore();

const langOptions = definedLangMetaData.map((meta) => ({ value: meta.value, label: meta.title }));

// 「显示模式（浅色/深色/跟随系统）」选项已移除：全局写死 color-scheme: only light
// （entrypoints/options/style.css），App.vue 也未接 dark algorithm，切换没有任何效果。
// 等真正实现深色主题后再加回（configStore.theme 字段保留，不动存量数据）。
// 「小屏设备下自动折叠导航栏」同理：侧栏目前没有任何折叠实现，开关先移除
// （configStore.autoToggleNavBarOnDisplayChange 字段保留）。
</script>

<template>
  <div class="appearance-window">
    <a-form layout="vertical" class="compact-form">
      <a-row :gutter="24">
        <a-col :span="12">
          <a-form-item :label="t('SetBase.UiWindow.interfaceLanguage')">
            <a-select v-model:value="configStore.lang" :options="langOptions" />
          </a-form-item>
        </a-col>
      </a-row>

      <div class="group">
        <div class="group-title">{{ t("SetBase.UiWindow.groupTable") }}</div>
        <div class="switch-grid">
          <div class="switch-item">
            <a-switch v-model:checked="configStore.saveTableBehavior" size="small" />
            <span class="label">{{ t("SetBase.UiWindow.saveTableBehavior") }}</span>
          </div>
          <div class="switch-item">
            <a-switch v-model:checked="configStore.enableTableMultiSort" size="small" />
            <span class="label">{{ t("SetBase.UiWindow.enableTableMultiSort") }}</span>
          </div>
        </div>
      </div>
    </a-form>
  </div>
</template>

<style scoped>
.compact-form :deep(.ant-form-item) {
  margin-bottom: 10px;
}
</style>
