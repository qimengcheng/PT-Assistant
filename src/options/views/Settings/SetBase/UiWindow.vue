<script setup lang="ts">
/**
 * 界面设置：语言、主题、表格行为、导航栏、content script 行为开关。
 */
import { computed } from "vue";
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

// computed：label 里有 t()，setup 里一次性求值的话切语言不会重算
const socialSiteSearchByOptions = computed(() => [
  { value: "id", label: t("SetBase.UiWindow.socialSiteSearchById") },
  { value: "title", label: t("SetBase.UiWindow.socialSiteSearchByTitle") },
  { value: "imdb", label: t("SetBase.UiWindow.socialSiteSearchByImdb") },
  { value: "chosen", label: t("SetBase.UiWindow.socialSiteSearchByChosen") },
]);

const contentScriptToggles = computed(
  () =>
    [
      { key: "allowExceptionSites", label: t("SetBase.UiWindow.allowExceptionSites") },
      { key: "enabledAtSocialSite", label: t("SetBase.UiWindow.enabledAtSocialSite") },
      { key: "applyTheme", label: t("SetBase.UiWindow.applyTheme") },
      { key: "defaultOpenSpeedDial", label: t("SetBase.UiWindow.defaultOpenSpeedDial") },
      { key: "stackedButtons", label: t("SetBase.UiWindow.stackedButtons") },
      { key: "fadeEnterStyle", label: t("SetBase.UiWindow.fadeEnterStyle") },
      { key: "doubleConfirmAction", label: t("SetBase.UiWindow.doubleConfirmAction") },
      { key: "dragLinkOnSpeedDial", label: t("SetBase.UiWindow.dragLinkOnSpeedDial") },
    ] as const,
);
</script>

<template>
  <div class="ui-window">
    <a-form layout="vertical" class="compact-form">
      <a-row :gutter="24">
        <a-col :span="12">
          <a-form-item :label="t('SetBase.UiWindow.interfaceLanguage')">
            <a-select v-model:value="configStore.lang" :options="langOptions" />
          </a-form-item>
        </a-col>
      </a-row>

      <div class="group">
        <div class="group-title">{{ t("SetBase.UiWindow.groupTableAndVersion") }}</div>
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

      <div class="group">
        <div class="group-title">{{ t("SetBase.UiWindow.groupDeveloper") }}</div>
        <div class="switch-grid">
          <div class="switch-item">
            <a-switch v-model:checked="configStore.developerMode" size="small" />
            <span class="label">{{ t("SetBase.UiWindow.developerMode") }}</span>
          </div>
        </div>
      </div>

      <div class="group">
        <div class="group-title">{{ t("SetBase.UiWindow.groupContentScript") }}</div>
        <div class="switch-item" style="margin-bottom: 10px">
          <a-switch v-model:checked="configStore.contentScript.enabled" size="small" />
          <span class="label">{{ t("SetBase.UiWindow.enableContentScript") }}</span>
        </div>
        <div v-if="configStore.contentScript.enabled" class="switch-grid">
          <div v-for="toggle in contentScriptToggles" :key="toggle.key" class="switch-item">
            <a-switch v-model:checked="configStore.contentScript[toggle.key]" size="small" />
            <span class="label">{{ toggle.label }}</span>
          </div>
          <div class="switch-item">
            <span class="label" style="min-width: 110px">{{ t("SetBase.UiWindow.socialSiteSearchBy") }}</span>
            <a-select
              v-model:value="configStore.contentScript.socialSiteSearchBy"
              :options="socialSiteSearchByOptions"
              size="small"
              style="width: 180px"
            />
          </div>
        </div>
      </div>

      <div class="group">
        <div class="group-title">{{ t("SetBase.UiWindow.groupContextMenu") }}</div>
        <div class="switch-item">
          <a-switch v-model:checked="configStore.contextMenus.enabled" size="small" />
          <span class="label">{{ t("SetBase.UiWindow.enableContextMenu") }}</span>
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
