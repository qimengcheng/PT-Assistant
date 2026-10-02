<script setup lang="ts">
/**
 * 基础设置页容器：a-tabs 组织各设置窗口。
 * 各窗口直接 v-model 绑定 configStore 字段；config store 开启了 persistWebExt
 * 自动持久化（每次变更自动 $save），无需手动保存按钮。
 */
import { ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

import UiWindow from "./UiWindow.vue";
import UserInfoWindow from "./UserInfoWindow.vue";
import SearchEntityWindow from "./SearchEntityWindow.vue";
import DownloadWindow from "./DownloadWindow.vue";
import BackupWindow from "./BackupWindow.vue";
import SocialInformationWindow from "./SocialInformationWindow.vue";

const tabs = [
  { key: "ui", label: "界面与内容脚本", component: UiWindow },
  { key: "user-info", label: "用户信息", component: UserInfoWindow },
  { key: "search-entity", label: "搜索", component: SearchEntityWindow },
  { key: "download", label: "下载", component: DownloadWindow },
  { key: "backup", label: "备份", component: BackupWindow },
  { key: "social-information", label: "社交信息", component: SocialInformationWindow },
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
      <h2>基础设置</h2>
      <span class="hint">变更即时保存，无需手动确认</span>
    </div>

    <a-tabs v-model:activeKey="activeKey" type="card">
      <a-tab-pane v-for="tab in tabs" :key="tab.key" :tab="tab.label">
        <component :is="tab.component" />
      </a-tab-pane>
    </a-tabs>
  </div>
</template>

<style scoped>
.page-header {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 12px;
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
