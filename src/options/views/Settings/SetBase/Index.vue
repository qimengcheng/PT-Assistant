<script setup lang="ts">
/**
 * 基础设置页容器：a-tabs 组织各设置窗口。
 * 各窗口直接 v-model 绑定 configStore 字段；config store 开启了 persistWebExt
 * 自动持久化（每次变更自动 $save），无需手动保存按钮。
 */
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";

import UiWindow from "./UiWindow.vue";
import UserInfoWindow from "./UserInfoWindow.vue";
import SearchEntityWindow from "./SearchEntityWindow.vue";
import DownloadWindow from "./DownloadWindow.vue";
import BackupWindow from "./BackupWindow.vue";
import SocialInformationWindow from "./SocialInformationWindow.vue";
import NativeBridgeWindow from "./NativeBridgeWindow.vue";

const { t } = useI18n();

const tabs = [
  { key: "ui", label: t("SetBase.Index.tabUi"), component: UiWindow },
  { key: "user-info", label: t("SetBase.Index.tabUserInfo"), component: UserInfoWindow },
  { key: "search-entity", label: t("SetBase.Index.tabSearch"), component: SearchEntityWindow },
  { key: "download", label: t("SetBase.Index.tabDownload"), component: DownloadWindow },
  { key: "backup", label: t("SetBase.Index.tabBackup"), component: BackupWindow },
  { key: "social-information", label: t("SetBase.Index.tabSocialInformation"), component: SocialInformationWindow },
  { key: "native-bridge", label: t("SetBase.Index.tabNativeBridge"), component: NativeBridgeWindow },
] as const;

const route = useRoute();
const router = useRouter();

const activeKey = ref<string>(route.query.tab === "backup" ? "backup" : (route.query.tab as string) || "ui");

// tab 状态同步到地址栏，方便从别处（如备份页）跳转定位
watch(activeKey, (key) => {
  router.replace({ query: { ...route.query, tab: key === "ui" ? undefined : key } });
});
</script>

<template>
  <div class="set-base">
    <div class="page-header">
      <h2>{{ t("SetBase.Index.pageTitle") }}</h2>
      <span class="hint">{{ t("SetBase.Index.saveHint") }}</span>
    </div>

    <div class="set-base-body">
      <a-tabs v-model:activeKey="activeKey" type="card" size="small">
        <a-tab-pane v-for="tab in tabs" :key="tab.key" :tab="tab.label">
          <component :is="tab.component" />
        </a-tab-pane>
      </a-tabs>
    </div>
  </div>
</template>

<style>
/* SetBase 通用布局（非 scoped，供各子窗口复用）：
   内容限宽、分组卡片化（灰底白卡）、开关两列排布 */
.set-base .set-base-body {
  max-width: 960px;
}

.set-base .group {
  margin-bottom: 14px;
  padding: 14px 18px;
  background: #fff;
  border: 1px solid #f0f0f0;
  border-radius: 8px;
}

.set-base .group-title {
  font-weight: 600;
  font-size: 13px;
  margin-bottom: 12px;
  color: rgba(0, 0, 0, 0.88);
}

/* 开关两列网格：每项 switch + label 水平排列 */
.set-base .switch-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  column-gap: 24px;
  row-gap: 10px;
}

.set-base .switch-item {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.set-base .switch-item .label {
  margin-left: 0;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.set-base .compact-form :deep(.ant-form-item) {
  margin-bottom: 12px;
}

.set-base .compact-form :deep(.ant-form-item-label) {
  padding-bottom: 2px;
}

.set-base .compact-form :deep(.ant-select) {
  width: 260px;
}
</style>

<style scoped>
.page-header {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 10px;
}

.page-header h2 {
  margin: 0;
  font-size: 16px;
}

.hint {
  color: #999;
  font-size: 12px;
}
</style>
