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
import UpdateWindow from "./UpdateWindow.vue";

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
      { key: "update", label: t("SetBase.Index.tabUpdate"), component: UpdateWindow },
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
      <div class="set-base-inner">
        <a-tabs v-model:activeKey="activeKey" type="card" size="small">
          <a-tab-pane v-for="tab in tabs" :key="tab.key" :tab="tab.label">
            <component :is="tab.component" />
          </a-tab-pane>
        </a-tabs>
      </div>
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

/* 面板铺满内容区（高度靠根上的 .page-fill + 本块的 .page-fill-grow 撑到视口底）。
   这里**原来还有一条 `.ant-tabs { max-width: 960px }`**（v0.7.0 antdv 迁移期留下的），
   它把下面那条 1280 居中竖栏从里面夹回 960、并且贴住竖栏左沿 —— 于是整块内容看着偏左
   160 CSS px（=(1280−960)/2）。2026-10-08 他第二次报「还是没在正中间」时量出来的：
   输入框左右竖边在 490.4 / 1449.6 CSS px，宽度 959.2 = 那条 960 上限；
   而竖栏自己 489.6..1769.6 是居中的（左右各 244.6）—— 也就是「容器对了、被旧上限夹住」。
   宽度口径从此只有下面 `.set-base-inner` 一处。 */

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

/* 开关网格：一格至少 300、等宽铺满 —— 1280 竖栏里正好三列（内容宽 1248 = 1280 − 16×2 内衬）。
   原来写死 `1fr 1fr` 两列，每格 612，而这一屏最长的开关档实测只有 270（zh）/ 364（en）
   → 每格白丢 250~340，两列之间和行尾各挂着一条三四百像素的空档，就是用户 2026-10-08 圈
   出来的那两块。数字来自台架 .tmp-build/bench-setbase（真 style 块 + 真 a-switch + 真语言包
   文案，逐条量 label 的 scrollWidth）。
   ⚠️ 用 auto-fill 而不是 auto-fit：auto-fit 会把没占满的空列塌掉、把剩下的格拉宽，
   于是「表格与版本」这种两条一组的网格又被拉回 612 一档 —— 等于白改。 */
.set-base .switch-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  column-gap: 24px;
  row-gap: 10px;
}

.set-base .switch-item {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

/* 标签允许换行：en 有三条超过 400 一档（autoExtendCookies 464、methodExtension 401、
   initDownloaderTorrentOnEnter 370），原来 nowrap + ellipsis 会把设置名截断 ——
   截断一个设置名比让它占两行严重（AGENTS §3.5：用户看不全的文案等于坏文案）。 */
.set-base .switch-item .label {
  margin-left: 0;
  font-size: 13px;
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

/* 八个 tab 的内容收成一条居中的竖栏：面板很宽时表单原先全贴在最左边，右边一大片是空的
   （用户口径「放到页面中间吧」）。1280 是量出来的：他那张「用户信息」截图里第一行三格
   控件从 x=306 排到 x=1505（输入框竖边 27px → 这张图 DPR=1，即 1199 CSS px），
   留一点余量，收这一档不会把任何一行挤成换行。
   外层 .set-base-body 仍是滚动容器，这里只加一个普通块级子元素，不动 flex/contain 那条链。 */
.set-base-inner {
  max-width: 1280px;
  margin: 0 auto;
}

/* 备份 / 原生通信桥 / 检查更新这三页自己把内容收在 720（长句子和提示条按这个宽度读着合适，
   不是可以拉满的东西）。拉满那条改掉之后它们会贴住 1280 竖栏的左沿、右边空 560 —— 同一句
   「没在正中间」会以另一档尺寸复发，所以在这三个根节点上补 auto 边距。
   按类名列出来而不是写 `.ant-tabs-tabpane > div`：后者要赌 antd 的 tabpane 下面不再包一层，
   而这条规则错了不报错，只会静默变回左对齐。 */
.set-base .backup-window,
.set-base .native-bridge-window,
.set-base .update-window {
  margin-inline: auto;
}
</style>
