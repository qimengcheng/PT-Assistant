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
</script>

<template>
  <div class="ui-window">
    <a-form layout="vertical" class="compact-form">
      <a-row :gutter="24">
        <a-col :span="8">
          <a-form-item label="界面语言">
            <a-select v-model:value="configStore.lang" :options="langOptions" />
          </a-form-item>
        </a-col>
        <a-col :span="8">
          <a-form-item label="显示模式">
            <a-select v-model:value="configStore.theme" :options="themeOptions" />
          </a-form-item>
        </a-col>
      </a-row>

      <div class="group">
        <div class="group-title">表格</div>
        <a-form-item>
          <a-switch v-model:checked="configStore.saveTableBehavior" />
          <span class="label">记住表格的显示列配置</span>
        </a-form-item>
        <a-form-item>
          <a-switch v-model:checked="configStore.enableTableMultiSort" />
          <span class="label">允许多列排序</span>
        </a-form-item>
        <a-form-item>
          <a-switch v-model:checked="configStore.showReleaseNoteOnVersionChange" />
          <span class="label">版本更新后显示更新说明</span>
        </a-form-item>
      </div>

      <div class="group">
        <div class="group-title">导航栏</div>
        <a-form-item>
          <a-switch v-model:checked="configStore.autoToggleNavBarOnDisplayChange" />
          <span class="label">小屏设备下自动折叠导航栏</span>
        </a-form-item>
      </div>

      <div class="group">
        <div class="group-title">站点页面助手（content script）</div>
        <a-form-item>
          <a-switch v-model:checked="configStore.contentScript.enabled" />
          <span class="label">启用站点页面助手</span>
        </a-form-item>
        <a-form-item v-if="configStore.contentScript.enabled">
          <a-switch v-model:checked="configStore.contentScript.allowExceptionSites" />
          <span class="label">允许配置不显示助手的站点</span>
        </a-form-item>
        <a-form-item v-if="configStore.contentScript.enabled">
          <a-switch v-model:checked="configStore.contentScript.enabledAtSocialSite" />
          <span class="label">在社交站点（豆瓣/Bangumi 等）启用助手</span>
        </a-form-item>
        <a-form-item v-if="configStore.contentScript.enabled">
          <a-switch v-model:checked="configStore.contentScript.applyTheme" />
          <span class="label">跟随扩展主题样式</span>
        </a-form-item>
        <a-form-item v-if="configStore.contentScript.enabled">
          <a-switch v-model:checked="configStore.contentScript.defaultOpenSpeedDial" />
          <span class="label">默认展开快捷按钮（SpeedDial）</span>
        </a-form-item>
        <a-form-item v-if="configStore.contentScript.enabled">
          <a-switch v-model:checked="configStore.contentScript.stackedButtons" />
          <span class="label">使用堆叠按钮</span>
        </a-form-item>
        <a-form-item v-if="configStore.contentScript.enabled">
          <a-switch v-model:checked="configStore.contentScript.fadeEnterStyle" />
          <span class="label">默认半透明，鼠标移入时不透明</span>
        </a-form-item>
        <a-form-item v-if="configStore.contentScript.enabled">
          <a-switch v-model:checked="configStore.contentScript.doubleConfirmAction" />
          <span class="label">批量操作前二次确认</span>
        </a-form-item>
        <a-form-item v-if="configStore.contentScript.enabled">
          <a-switch v-model:checked="configStore.contentScript.dragLinkOnSpeedDial" />
          <span class="label">允许拖拽链接到快捷按钮</span>
        </a-form-item>
        <a-form-item v-if="configStore.contentScript.enabled" label="社交站点搜索方式">
          <a-select v-model:value="configStore.contentScript.socialSiteSearchBy" :options="socialSiteSearchByOptions" />
        </a-form-item>
      </div>

      <div class="group">
        <div class="group-title">右键菜单</div>
        <a-form-item>
          <a-switch v-model:checked="configStore.contextMenus.enabled" />
          <span class="label">启用浏览器右键菜单扩展项</span>
        </a-form-item>
      </div>
    </a-form>
  </div>
</template>

<style scoped>
.compact-form :deep(.ant-form-item) {
  margin-bottom: 10px;
}

.group {
  margin-bottom: 16px;
  padding: 12px 16px;
  border: 1px solid #f0f0f0;
  border-radius: 6px;
}

.group-title {
  font-weight: 600;
  margin-bottom: 10px;
}

.label {
  margin-left: 10px;
}
</style>
