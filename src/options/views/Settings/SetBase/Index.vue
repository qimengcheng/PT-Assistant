<script setup lang="ts">
/**
 * 基础设置页容器：a-tabs 组织各设置窗口。
 * 各窗口直接 v-model 绑定 configStore 字段；config store 开启了 persistWebExt
 * 自动持久化（每次变更自动 $save），无需手动保存按钮。
 */
import { computed, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { MutationType } from "pinia";
import { useDebounceFn } from "@vueuse/core";
import { App } from "antdv-next";

import { useConfigStore } from "@/options/stores/config.ts";

import UiWindow from "./UiWindow.vue";
import UserInfoWindow from "./UserInfoWindow.vue";
import SearchEntityWindow from "./SearchEntityWindow.vue";
import DownloadWindow from "./DownloadWindow.vue";
import BackupWindow from "./BackupWindow.vue";
import SocialInformationWindow from "./SocialInformationWindow.vue";
import NativeBridgeWindow from "./NativeBridgeWindow.vue";

const { t } = useI18n();

// computed：label 里有 t()，setup 里一次性求值的话切语言不会重算
const tabs = computed(
  () =>
    [
      { key: "ui", label: t("SetBase.Index.tabUi"), component: UiWindow },
      { key: "user-info", label: t("SetBase.Index.tabUserInfo"), component: UserInfoWindow },
      { key: "search-entity", label: t("SetBase.Index.tabSearch"), component: SearchEntityWindow },
      { key: "download", label: t("SetBase.Index.tabDownload"), component: DownloadWindow },
      { key: "backup", label: t("SetBase.Index.tabBackup"), component: BackupWindow },
      {
        key: "social-information",
        label: t("SetBase.Index.tabSocialInformation"),
        component: SocialInformationWindow,
      },
      { key: "native-bridge", label: t("SetBase.Index.tabNativeBridge"), component: NativeBridgeWindow },
    ] as const,
);

const route = useRoute();
const router = useRouter();

const activeKey = ref<string>(route.query.tab === "backup" ? "backup" : (route.query.tab as string) || "ui");

// tab 状态同步到地址栏，方便从别处（如备份页）跳转定位
watch(activeKey, (key) => {
  router.replace({ query: { ...route.query, tab: key === "ui" ? undefined : key } });
});

// ===== 「改完就报已保存」：顶栏那句静态提示的替代品 =====
const configStore = useConfigStore();
// 走 App.useApp() 而不是静态 import { message }：静态那份挂在根上，吃不到
// entrypoints/options/App.vue 那层 a-config-provider 的 token（字号 13 等）。
// <a-app> 确实包着 router-view，正例见 views/Devtools/Debugger.vue:33。
const { message } = App.useApp();

/**
 * 三条边界都是实测来的，少一条就会凭空弹 toast：
 * 1) 订阅要等 $onReady —— 水合那次 store.$patch 本身是一次 mutation（虽然它走 patchObject，
 *    见下条），但 afterRestore 里的废弃项清理是直接改 state，不等就会在打开页面时报一次「已保存」。
 * 2) 只认 MutationType.direct —— 本页 7 个窗口全是裸 v-model（实测：三层嵌套字段赋值报 direct）；
 *    而水合与跨上下文同步（chrome.storage.onChanged → $patch）报的是 patch object，
 *    不按这个过滤，别的窗口改一下配置这边就会跟着弹。
 * 3) 必须合并 —— 文本框逐字符写 store，不合并就是每敲一个字一条 toast。
 *    延后报不会说谎：插件是每次 mutation 立刻 $save，没有 debounce。
 */
const announceSaved = useDebounceFn(() => message.success(t("SetBase.Index.savedToast")), 600);
let stopConfigWatch: (() => void) | undefined;
let isUnmounted = false;

configStore.$onReady(() => {
  if (isUnmounted) return;
  stopConfigWatch = configStore.$subscribe(
    (mutation) => {
      if (mutation.type !== MutationType.direct) return;
      announceSaved();
    },
    { detached: true },
  );
});

onUnmounted(() => {
  isUnmounted = true;
  stopConfigWatch?.();
});
</script>

<template>
  <div class="set-base page-fill">
    <div class="set-base-body page-fill-grow">
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
   整页收进一块白表面、分组用分隔线区分、开关两列排布。
   以前是「灰底上摊着几张白卡」，卡片只有 960 宽，右边和下面整片都是灰 —— 现在换成
   与列表页 .page-panel 同档的一整块白面板（同 border / 同 10px 圆角）。 */
.set-base .set-base-body {
  padding: 8px 16px 16px;
  background: #fff;
  border: 1px solid var(--pt-color-border-light);
  border-radius: 10px;
}

/* 面板铺满内容区（高度靠根上的 .page-fill + 本块的 .page-fill-grow 撑到视口底，
   宽度上控件仍限 960：不然开关那两列会被拉到两千多 px 宽，一行里只剩左边一个 switch）。 */
.set-base .ant-tabs {
  max-width: 960px;
}

.set-base .group {
  margin-bottom: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--pt-color-border-light);
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
