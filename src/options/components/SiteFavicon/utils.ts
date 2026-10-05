import { ref } from "vue";
import { NO_IMAGE, type TSiteID } from "@ptd/site";

import { sendMessage } from "@/messages.ts";
import { ptdIndexDb } from "@/shared/indexdb.ts";

/**
 * options 侧 favicon 的唯一取数入口。四级，从便宜到贵：
 *
 *   1. 随包图标（同步，零异步、零消息、零存储读）
 *      构建期把 `public/icons/site/` 的文件清单注入成编译期常量 `__RESOURCE_SITE_ICONS__`
 *      （wxt.config.ts）。340 个站点定义里 242 个能按 `<siteId>.<png|ico|svg>` 命中。
 *      与 `@ptd/site` 的 `getFavicon()` 本地分支做过逐站点对照模拟：结果不一致 0 处，
 *      另有 35 个用 `favicon: "./别的名字"` 声明的站点这里命中不了、自动落到第 3 级，
 *      属于「少优化、不出错」。
 *   2. 本标签页内存缓存（同一页面里 19 处调用点共享，见下方 faviconCache）
 *   3. 扩展 IndexedDB 的 `favicon` 表（offscreen 抓过一次就在，跨浏览器重启有效）
 *      —— options 与 offscreen 同属扩展 origin，**直接读库即可**，不必再 sendMessage。
 *      offscreen 存在的理由是它要有 DOM 才能解析网站 HTML 抓图标，读缓存不需要 DOM。
 *   4. 真 miss 才 sendMessage("getSiteFavicon")，由 offscreen 抓取并落库。
 *
 * 改造前只有第 2、4 级，所以每次打开 options 页、每个站点都要付一次跨上下文往返
 * （第 3 级命中时还要把整张 base64 图从 offscreen 搬回来）。
 */

/** 随包图标清单（编译期常量），Set 化后做 O(1) 判定 */
const bundledIconFiles = new Set<string>(__RESOURCE_SITE_ICONS__);

/** 与 getFavicon() 内的探测顺序保持一致 */
const BUNDLED_ICON_EXTS = ["png", "ico", "svg"] as const;

/**
 * 该站点是否有随扩展分发的图标。
 * 有的话「强制刷新」是空操作 —— getFavicon() 的本地分支优先于一切网络抓取，
 * 站点定义里的 favicon 字段和 IndexedDB 缓存都不参与（见 packages/site/utils/favicon.ts 头注释）。
 * 调用点用它把刷新按钮置灰，避免做一个永远按得动、按了没反应的按钮。
 */
export function hasBundledIcon(siteId: TSiteID): boolean {
  return resolveBundledIcon(siteId) !== null;
}

function resolveBundledIcon(siteId: TSiteID): string | null {
  for (const ext of BUNDLED_ICON_EXTS) {
    const file = `${siteId}.${ext}`;
    if (bundledIconFiles.has(file)) {
      return `/icons/site/${file}`;
    }
  }
  return null;
}

/**
 * 已解析结果。导出给组件做 computed 派生 —— 必须是响应式的，
 * 这样 flushSiteFavicon() 改写或删除某个键之后，所有已渲染的 <SiteFavicon> 实例会自己更新，
 * 不需要每个调用点持有组件 ref 去逐个通知。
 */
export const faviconCache = ref<Record<TSiteID, string>>({});

/** 同一站点的并发请求收敛成一条消息（表格一次渲染 20 行、多处共用站点时很常见） */
const inflight = new Map<TSiteID, Promise<string>>();

async function readFaviconFromIdb(siteId: TSiteID): Promise<string | null> {
  try {
    // store 一定存在：openDB 的 upgrade 是 @/shared/indexdb.ts 里唯一的一份定义
    return ((await (await ptdIndexDb()).get("favicon", siteId)) as string | undefined) ?? null;
  } catch (e) {
    // 读缓存失败不该影响主流程，降级去问 offscreen
    console.error(`[PTD] 读 favicon 缓存失败: ${siteId}`, e);
    return null;
  }
}

export async function getSiteFavicon(siteId: TSiteID, flush: boolean = false): Promise<string> {
  if (!flush) {
    const inMemory = faviconCache.value[siteId];
    if (inMemory) return inMemory;
  }

  // 1. 随包图标：flush 也改变不了它（本地硬配置优先），所以两种情况都直接返回
  const bundled = resolveBundledIcon(siteId);
  if (bundled) {
    faviconCache.value[siteId] = bundled;
    return bundled;
  }

  // 2. 扩展 IndexedDB
  if (!flush) {
    const fromIdb = await readFaviconFromIdb(siteId);
    if (fromIdb) {
      faviconCache.value[siteId] = fromIdb;
      return fromIdb;
    }
  }

  // 3. 交给 offscreen 抓取（它负责写回 IndexedDB）
  const pending = inflight.get(siteId);
  if (pending) return pending;

  const task = sendMessage("getSiteFavicon", { site: siteId, flush })
    .then((value) => {
      const favicon = value ?? NO_IMAGE;
      faviconCache.value[siteId] = favicon;
      return favicon;
    })
    .catch((e) => {
      console.error(`[PTD] getSiteFavicon(${siteId}) 失败`, e);
      faviconCache.value[siteId] = NO_IMAGE;
      return NO_IMAGE;
    })
    .finally(() => {
      inflight.delete(siteId);
    });

  inflight.set(siteId, task);
  return task;
}

/**
 * 强制重新抓取若干站点图标，并让界面上所有已渲染的实例跟着更新。
 *
 * 这里必须同时做三件事，缺一条就是静默失效：
 *   ① 删 IndexedDB 条目 —— 否则 offscreen 侧 `if (flush || !cached)` 之外还有别的调用方会读到旧值；
 *   ② 删内存条目 —— 否则本页面立刻短路回旧值，用户点了没反应；
 *   ③ 重新取一次并写回内存 —— 组件是 computed 派生的，光删只会变占位图，得把新值填回去。
 *
 * 站点管理页的「刷新图标」按钮原先直接 sendMessage("getSiteFavicon", {flush:true})，
 * 三条一条都没做，所以点完只弹一条「刷新完成」，图标一个都不变。
 */
export async function flushSiteFavicon(siteIds: TSiteID[]): Promise<void> {
  if (siteIds.length === 0) return;

  const db = await ptdIndexDb();
  for (const siteId of siteIds) {
    delete faviconCache.value[siteId];
    await db.delete("favicon", siteId).catch((e) => {
      // 条目本来不存在时 IndexedDB 也会抛，不该因此中断整批刷新
      console.error(`[PTD] 清除 favicon 缓存失败: ${siteId}`, e);
    });
  }

  await Promise.all(siteIds.map((siteId) => getSiteFavicon(siteId, true)));
}

/** 清空整张 favicon 缓存（调试页用） */
export async function clearFaviconCaches(): Promise<void> {
  faviconCache.value = {};
  const db = await ptdIndexDb();
  await db.clear("favicon");
}
