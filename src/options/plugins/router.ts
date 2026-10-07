import { createRouter, createWebHashHistory, type RouteRecordRaw } from "vue-router";

/**
 * 路由表。平移自 PT-depiler `entries/options/plugins/router.ts`。
 *
 * 上游用嵌套 children 组织菜单，本项目 App.vue 自己渲染侧边栏（不消费嵌套路由），
 * 所以这里保持**扁平**结构，只保留 path / name / component。
 *
 * 两条约定：
 * 1. `alias` 保留上游的原始 path。content script 的 `doKeywordSearch`、
 *    SetDownloader 等处仍按上游路径跳转，加 alias 后新旧路径都能进。
 * 2. **只注册组件真实存在的路由**。上游有 30+ 条，这里按当前已平移的视图增量添加，
 *    组件没做出来的先不注册，否则 `import()` 会在运行时抛模块找不到。
 */
export const routes: RouteRecordRaw[] = [
  {
    path: "/",
    name: "Home",
    component: () => import("../views/HomeView.vue"),
  },
  {
    // 新手引导：从添加站点到把种子推进下载器，一条路走通。挂在首页后面进左侧菜单。
    path: "/guide",
    name: "GuideView",
    component: () => import("../views/GuideView.vue"),
  },
  {
    // 站点管理走与旧版一一对应的正式页（表格 + 站点图标 + 分组筛选 + 增删改 + 一键导入 + 重建映射表）。
    // 早期这里挂的是 SiteManageView.vue —— 一个只有纯文字列表的简易调试页，已移入 tobedeleted。
    path: "/sites",
    name: "SiteManage",
    component: () => import("../views/Settings/SetSite/Index.vue"),
  },

  // ===== Overview =====
  {
    path: "/my-data",
    name: "MyData",
    component: () => import("../views/Overview/MyData/Index.vue"),
  },
  {
    // MyData「统计图表」二级页，入口在 MyData/Index.vue 的 viewStatistic（hasRoute 守卫）
    path: "/user-data-statistic",
    name: "UserDataStatistic",
    component: () => import("../views/Overview/MyData/UserDataStatistic/Index.vue"),
  },
  {
    // MyData「时间线」二级页（konva 绘制），入口同上，走 viewTimeline 的 hasRoute 守卫
    path: "/user-data-timeline",
    name: "UserDataTimeline",
    component: () => import("../views/Overview/MyData/UserDataTimeline/Index.vue"),
  },
  {
    // 上游 path 是 /search-entity，保留 alias 兼容 content script 等处的跳转
    path: "/search",
    alias: "/search-entity",
    name: "SearchEntity",
    component: () => import("../views/Overview/SearchEntity/Index.vue"),
  },
  {
    path: "/search-result-snapshot",
    alias: "/search-snapshot",
    name: "SearchResultSnapshot",
    component: () => import("../views/Overview/SearchResultSnapshot/Index.vue"),
  },
  {
    path: "/download-history",
    name: "DownloadHistory",
    component: () => import("../views/Overview/DownloadHistory/Index.vue"),
  },
  {
    path: "/keep-upload-task",
    name: "KeepUploadTask",
    component: () => import("../views/Overview/KeepUploadTask/Index.vue"),
  },
  {
    path: "/my-client",
    name: "MyClient",
    component: () => import("../views/Overview/MyClient/Index.vue"),
  },
  {
    path: "/media-server-entity",
    name: "MediaServerEntity",
    component: () => import("../views/Overview/MediaServerEntity/Index.vue"),
  },

  // ===== Settings =====
  {
    path: "/set-base",
    name: "SetBase",
    component: () => import("../views/Settings/SetBase/Index.vue"),
  },
  {
    path: "/link-push",
    name: "ContextMenuLinkPush",
    component: () => import("../views/ContextMenuLinkPush.vue"),
  },
  {
    path: "/set-downloader",
    name: "SetDownloader",
    component: () => import("../views/Settings/SetDownloader/Index.vue"),
  },
  {
    path: "/set-backup",
    name: "SetBackup",
    component: () => import("../views/Settings/SetBackup/Index.vue"),
  },
  {
    path: "/set-search-solution",
    name: "SetSearchSolution",
    component: () => import("../views/Settings/SetSearchSolution/Index.vue"),
  },

  // ===== About =====
  {
    path: "/technology-stack",
    name: "TechnologyStack",
    component: () => import("../views/About/TechnologyStack.vue"),
  },
  {
    path: "/special-thank",
    name: "SpecialThank",
    component: () => import("../views/About/SpecialThank.vue"),
  },
  {
    path: "/logger",
    name: "Logger",
    component: () => import("../views/About/Logger.vue"),
  },

  // ===== 开发调试 =====
  {
    path: "/debug/site-definitions",
    name: "DebugSiteDefinitions",
    component: () => import("../views/SiteDefinitions.vue"),
  },
  {
    path: "/debugger",
    name: "Debugger",
    component: () => import("../views/Devtools/Debugger.vue"),
  },

  {
    path: "/:pathMatch(.*)*",
    name: "NotFound",
    redirect: "/",
  },
];

export const routerInstance = createRouter({
  history: createWebHashHistory(),
  routes,
});
