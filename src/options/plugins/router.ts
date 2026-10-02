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
 *    组件还没做出来的（如 UserDataTimeline / SetSite / MyClient）先不注册，
 *    否则 `import()` 会在运行时抛模块找不到。
 */
export const routes: RouteRecordRaw[] = [
  {
    path: "/",
    name: "Home",
    component: () => import("../views/HomeView.vue"),
  },
  {
    path: "/sites",
    name: "SiteManage",
    component: () => import("../views/SiteManageView.vue"),
  },

  // ===== Overview =====
  {
    path: "/my-data",
    name: "MyData",
    component: () => import("../views/Overview/MyData/Index.vue"),
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
    path: "/set-media-server",
    name: "SetMediaServer",
    component: () => import("../views/Settings/SetMediaServer/Index.vue"),
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

  // ===== 开发调试 =====
  {
    path: "/debug/site-definitions",
    name: "DebugSiteDefinitions",
    component: () => import("../views/SiteDefinitions.vue"),
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
