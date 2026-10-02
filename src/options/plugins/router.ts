import { createRouter, createWebHashHistory, type RouteRecordRaw } from "vue-router";

// 最小路由集：首页 / 站点管理 / 多站点搜索 / 调试入口。
// 后续轮次（下载器、备份、设置）在此追加懒加载路由即可。
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
  {
    path: "/search",
    name: "SearchEntity",
    component: () => import("../views/Overview/SearchEntity/Index.vue"),
  },
  {
    path: "/debug/site-definitions",
    name: "DebugSiteDefinitions",
    component: () => import("../views/SiteDefinitions.vue"),
  },
];

export const routerInstance = createRouter({
  history: createWebHashHistory(),
  routes,
});
