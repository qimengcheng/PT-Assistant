<script setup lang="ts">
/**
 * 界面设置：语言、主题、表格行为、导航栏、content script 行为开关。
 */
import { useConfigStore } from "@/options/stores/config.ts";
import { definedLangMetaData } from "@/options/plugins/i18n.ts";

const configStore = useConfigStore();

const langOptions = definedLangMetaData.map((meta) => ({ value: meta.value, label: meta.title }));

const themeOptions = [
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
  { value: "auto", label: "跟随系统" },
];

const socialSiteSearchByOptions = [
  { value: "id", label: "使用 ID 搜索" },
  { value: "title", label: "使用主标题搜索" },
  { value: "imdb", label: "使用 IMDb 编号搜索" },
  { value: "chosen", label: "使用用户选择的方式" },
];

const contentScriptToggles = [
  { key: "allowExceptionSites", label: "允许配置不显示助手的站点" },
  { key: "enabledAtSocialSite", label: "在社交站点启用助手" },
  { key: "applyTheme", label: "跟随扩展主题样式" },
  { key: "defaultOpenSpeedDial", label: "默认展开快捷按钮（SpeedDial）" },
  { key: "stackedButtons", label: "使用堆叠按钮" },
  { key: "fadeEnterStyle", label: "默认半透明，移入不透明" },
  { key: "doubleConfirmAction", label: "批量操作前二次确认" },
  { key: "dragLinkOnSpeedDial", label: "允许拖拽链接到快捷按钮" },
] as const;
</script>

<template>
  <div class="ui-window">
    <a-form layout="vertical" class="compact-form">
      <a-row :gutter="24">
        <a-col :span="12">
          <a-form-item label="界面语言">
            <a-select v-model:value="configStore.lang" :options="langOptions" />
          </a-form-item>
        </a-col>
        <a-col :span="12">
          <a-form-item label="显示模式">
            <a-select v-model:value="configStore.theme" :options="themeOptions" />
          </a-form-item>
        </a-col>
      </a-row>

      <div class="group">
        <div class="group-title">表格与版本</div>
        <div class="switch-grid">
          <div class="switch-item">
            <a-switch v-model:checked="configStore.saveTableBehavior" size="small" />
            <span class="label">记住表格的显示列配置</span>
          </div>
          <div class="switch-item">
            <a-switch v-model:checked="configStore.enableTableMultiSort" size="small" />
            <span class="label">允许多列排序</span>
          </div>
          <div class="switch-item">
            <a-switch v-model:checked="configStore.showReleaseNoteOnVersionChange" size="small" />
            <span class="label">版本更新后显示更新说明</span>
          </div>
          <div class="switch-item">
            <a-switch v-model:checked="configStore.autoToggleNavBarOnDisplayChange" size="small" />
            <span class="label">小屏设备下自动折叠导航栏</span>
          </div>
        </div>
      </div>

      <div class="group">
        <div class="group-title">站点页面助手（content script）</div>
        <div class="switch-item" style="margin-bottom: 10px">
          <a-switch v-model:checked="configStore.contentScript.enabled" size="small" />
          <span class="label">启用站点页面助手</span>
        </div>
        <div v-if="configStore.contentScript.enabled" class="switch-grid">
          <div v-for="toggle in contentScriptToggles" :key="toggle.key" class="switch-item">
            <a-switch v-model:checked="configStore.contentScript[toggle.key]" size="small" />
            <span class="label">{{ toggle.label }}</span>
          </div>
          <div class="switch-item">
            <span class="label" style="min-width: 110px">社交站点搜索方式</span>
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
        <div class="group-title">右键菜单</div>
        <div class="switch-item">
          <a-switch v-model:checked="configStore.contextMenus.enabled" size="small" />
          <span class="label">启用浏览器右键菜单扩展项</span>
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
