<script setup lang="ts">
/**
 * 在站点网页上：这个插件注入到各站点页面的那部分 —— 划词搜索、下载按钮的排布与确认、
 * 拖拽推送，以及浏览器右键菜单。
 *
 * 这一节是从原先那节「界面与内容脚本」里拆出来的。它改的是**别人家的页面**，
 * 和「插件自己的界面长什么样」（语言、表格）不是一回事，混在一节里两边都说不清自己的名字；
 * 而按使用频率它又是最靠前的一档（每天都在站点页面上碰它），所以单独成节、排在「下载与推送」后面。
 *
 * ⚠️ 标签键仍是 `SetBase.UiWindow.*`，理由见 `AppearanceWindow.vue` 文件头那条。
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useConfigStore } from "@/options/stores/config.ts";

const { t } = useI18n();
const configStore = useConfigStore();

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
  <div class="site-page-window">
    <a-form layout="vertical" class="compact-form">
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
