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
  // 「搜索快照」那一页 v0.38.0 起并进搜索页（工具条那颗按钮开弹窗管理）。
  // 旧地址留着只跳转不渲染：书签和 `?snapshot=xxx` 这类深链不能断，query 原样带过去，
  // 落到 /search 后由那一页的 route.query 观察器就地装载这份快照。
  {
    path: "/search-result-snapshot",
    alias: "/search-snapshot",
    redirect: (to) => ({ path: "/search", query: to.query }),
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

/**
 * 「打开插件」这一趟落在哪一页：装机后第一次进首页（那里有「最近更新」和添加站点的入口），
 * 之后每次直接进搜索页 —— 天天用的人点开就是搜种子，首页对他只是一次多余的跳转。
 *
 * 只在**裸开**时改：进来那一刻 hash 是空的（点工具栏图标、从「扩展程序」详情打开，都是
 * `options.html` 不带 hash）。划词搜索、omnibox、点通知、书签深链都带着自己的 hash，
 * 那些一律不动。
 * 实测过一条关键区分（`.tmp-build/bench-hash/`，vue-router 4 + createWebHashHistory）：
 * 空 hash 进来、路由 ready 之后 URL 里已经写着 `#/` —— 所以「在首页按 F5」不算裸开，
 * 不会把人弹去搜索页。判据要是写成「hash 为空**或就是 `#/`**」，那条就错了。
 *
 * 写在 createRouter **之前**而不是路由守卫里，有两个理由：
 * - 守卫会在用户点侧栏「首页」时也触发，那就永远回不到首页了；
 * - `createWebHashHistory()` 在 createRouter 那一刻就读掉初始 hash，晚一步只能
 *   `router.replace()` 补，会先闪一下首页。
 *
 * 用 localStorage 而不是 config store：这一趟要在挂载**前**同步读完，而 persistWebExt
 * 那份是异步水合的（AGENTS §3.2 防线⑤拦的就是"等不及就去读 store"）。
 */
const HAS_OPENED_KEY = "ptd.options.hasOpenedBefore";

function pickLandingRoute(): void {
  // 拿不到 location / localStorage（非浏览器环境、隐私模式、配额满）就什么都不做：
  // 停在首页是原来就有的行为，比替用户猜一个去处安全。
  let hash: string;
  try {
    hash = window.location.hash;
    if (hash !== "" && hash !== "#") return;
    const isFirstOpen = window.localStorage.getItem(HAS_OPENED_KEY) !== "1";
    window.localStorage.setItem(HAS_OPENED_KEY, "1");
    if (!isFirstOpen) window.location.hash = "/search";
  } catch {
    return;
  }
}

pickLandingRoute();

export const routerInstance = createRouter({
  history: createWebHashHistory(),
  routes,
});
