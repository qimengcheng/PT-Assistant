/**
 * 右键菜单：划词搜索 / 豆瓣·IMDb 链接搜索 / 下载链接推送到下载器。
 * 平移自 PT-depiler background/utils/contextMenus.ts，适配点：
 * - extStorage → extStore（@webext-core/storage）
 * - openOptionsPage → 复用 ./base.ts 的同名导出（本文件原先自己抄了一份，
 *   而且抄漏了它 :24-27 的 runtime.openOptionsPage 兜底 —— tabs.create 被拒时会静默无反应）
 * - chrome.i18n.getMessage → 中文字符串（新项目未铺 _locales）
 * - 搜索路由 /search-entity → /search；图标路径 icons/logo/128.png → icon/128.png
 *
 * 相对旧实现修掉的两个缺陷（详见 commit message）：
 * 1. 点击派发不再依赖内存闭包 Map。旧版把 onclick 存进 contextMenusClickEventBus，
 *    MV3 的 service worker 约 30 秒空闲即被回收，Map 随之清空，而 Chrome 侧的菜单项
 *    仍然存在 —— 于是唤醒后点任何带回调的菜单项都会在第 28 行的 has() 判断处静默 return，
 *    要等下一次「切标签页触发全量重建」才复活。现改为把点击语义编码进 menuItemId，
 *    由顶层 onClicked 监听器解析派发，闭包不参与，因此天然扛得住 SW 回收。
 * 2. 不再每次切换标签页都 removeAll + 逐条 create。旧版每次 onActivated 都读两份
 *    全量存储 blob（config + metadata）、清掉全部菜单、再按「搜索方案数 + 站点数 +
 *    下载器数×建议目录数」逐条重建。现在：配置/元数据读一次并缓存（仅随 storage 变更失效），
 *    为当前标签页算出一个「菜单指纹」，指纹没变就直接返回，且重建过程串行化，
 *    避免快速切标签时 removeAll 与 create 交错。
 */
import { nanoid } from "nanoid";
import { format as dateFormat } from "date-fns";

import { type CAddTorrentOptions } from "@ptd/downloader/types.ts";
import { getHostFromUrl } from "@ptd/site/utils/html.ts"; // 不能用 @ptd/site 主入口，会把 sizzle eager 链拉进 SW
import { type ITorrent } from "@ptd/site/types/torrent.ts";

import { extStore } from "@/storage.ts";
import { onMessage, sendMessage } from "@/messages.ts";
import { type IDownloaderMetadata } from "@/shared/types/storages/metadata.ts";
import { openOptionsPage } from "./base.ts";

const contextMenusId = "PT-Assistant-Context-Menus";

/**
 * 菜单项 id 语法（`**` 分隔，最后一段永远不含裸 `**`，目录做了 encodeURIComponent）：
 *   <ROOT>**s**<scope>                    搜索子菜单根（scope = page | douban | imdb）
 *   <ROOT>**s**<scope>**d                 用默认搜索方案
 *   <ROOT>**s**<scope>**k**<solutionId>   用指定搜索方案
 *   <ROOT>**s**<scope>**w**<siteId>       在指定站点搜索
 *   <ROOT>**s**<scope>**t                 在当前站点搜索（站点由点击时的 pageUrl 解析）
 *   <ROOT>**p                             推送到下载器子菜单根
 *   <ROOT>**p**adv                        高级推送落地页
 *   <ROOT>**p**d**<downloaderId>          推送到该下载器（默认目录）
 *   <ROOT>**p**d**<downloaderId>**<encFolder>  推送到该下载器 + 指定建议目录模板
 */
const SEG = "**";
const idOf = (...parts: string[]) => [contextMenusId, ...parts].join(SEG);

/** 从 menuItemId 还原语义；非本插件的菜单项返回 null */
function parseMenuId(menuItemId: string | number): Record<string, string> | null {
  if (typeof menuItemId !== "string" || !menuItemId.startsWith(contextMenusId + SEG)) return null;

  const segs = menuItemId.slice(contextMenusId.length + SEG.length).split(SEG);
  const [head, scopeOrKind] = segs;

  if (head === "s") {
    const scope = scopeOrKind ?? "page";
    const rest = segs.slice(2);
    const tail = rest[0] ?? "";
    if (tail === "d") return { kind: "search", scope, target: "default" };
    if (tail === "t") return { kind: "search", scope, target: "this" };
    if (tail === "k") return rest[1] ? { kind: "search", scope, target: "solution", id: rest[1] } : { kind: "searchRoot", scope };
    if (tail === "w") return rest[1] ? { kind: "search", scope, target: "site", id: rest[1] } : { kind: "searchRoot", scope };
    return { kind: "searchRoot", scope };
  }

  if (head === "p") {
    if (segs.length === 1) return { kind: "pushRoot" };
    if (scopeOrKind === "adv") return { kind: "push", target: "advanced" };
    if (scopeOrKind === "d") {
      const downloaderId = segs[2];
      if (!downloaderId) return null;
      // 目录模板恒为最后一段，用 slice 重组以容忍 id 之外的内容
      const encodedFolder = segs.slice(3).join(SEG);
      return {
        kind: "push",
        target: "download",
        id: downloaderId,
        folder: encodedFolder ? decodeURIComponent(encodedFolder) : "",
      };
    }
  }

  return null;
}

/**
 * 菜单构建所需的两份存储 blob 只读一次并缓存在内存里，仅在 config / metadata 真正变化时失效。
 * 旧实现是在每次标签页激活时都重新读两份全量 blob。
 */
interface IMenuPlan {
  config: any;
  metadata: any;
}

let planCache: IMenuPlan | null = null;

async function loadPlan(): Promise<IMenuPlan> {
  if (!planCache) {
    const [config, metadata] = await Promise.all([extStore.getItem("config"), extStore.getItem("metadata")]);
    planCache = { config: config ?? {}, metadata: metadata ?? {} };
  }
  return planCache;
}

function invalidatePlan() {
  planCache = null;
}

/** chrome.contextMenus.create 不接受 onclick 回调，故所有项都只按 id 语义创建 */
function addContextMenu(data: chrome.contextMenus.CreateProperties) {
  if (!data.id) {
    data.id = nanoid();
  }
  // 外部经消息传入的 onclick 无法跨上下文序列化，这里显式丢弃以免误解
  delete (data as any).onclick;
  chrome.contextMenus?.create(data);
  return data.id;
}

function removeContextMenu(id: string) {
  chrome.contextMenus?.remove(id).catch();
}

function clearContextMenus() {
  chrome.contextMenus?.removeAll().catch();
}

onMessage("addContextMenu", async ({ data }) => addContextMenu(data));
onMessage("removeContextMenu", async ({ data }) => removeContextMenu(data));
onMessage("clearContextMenus", async () => clearContextMenus());

/** 打开 options 页指定路由（带 query，经 urlencode 后拼到 hash 路由上）—— 复用 base.ts 的实现 */

async function downloadLinkPush(
  link: string,
  downloader: IDownloaderMetadata,
  folder?: string,
  title?: string,
  url?: string,
) {
  const torrent: Partial<ITorrent> = {
    link,
    title,
    url,
  };

  // 尝试从链接中解出站点信息
  if (link.match(/https?:\/\/([^/]+)/)) {
    const host = getHostFromUrl(link);
    try {
      const metadataStore = await extStore.getItem("metadata");
      if (metadataStore?.siteHostMap?.[host]) {
        torrent.site = metadataStore.siteHostMap[host];
      }
    } catch (error) {
      console.warn("[PTD] Failed to get metadata store for site detection:", error);
    }
  }

  const notify = (msg: string) => {
    chrome.notifications?.create({
      type: "basic",
      iconUrl: chrome.runtime.getURL("icon/128.png"),
      title: "PT Assistant",
      message: msg,
    });
  };

  sendMessage("downloadTorrent", {
    torrent,
    downloaderId: downloader.id,
    addTorrentOptions: {
      addAtPaused: !(downloader?.feature?.DefaultAutoStart ?? true),
      savePath: folder!,
    } as CAddTorrentOptions,
  })
    .then((result: any) => {
      notify(
        result?.downloadStatus === "failed"
          ? `推送「${downloader.name}」失败`
          : `已推送到「${downloader.name}」`,
      );
    })
    .catch(() => {
      notify(`推送「${downloader.name}」失败`);
    });
}

interface ICreateSearchMenuOption {
  thisTabSiteId?: string;
  // chrome 类型将 contexts 定义为元组，与「默认值 + 动态展开覆盖」的模式天然冲突，此处放宽
  extraCreateMenuProperties?: any;
}

async function createSearchMenu(scope: TSearchScope, baseMenuId: string, options: ICreateSearchMenuOption = {}) {
  const { metadata: metadataStore } = await loadPlan();

  const { thisTabSiteId = null, extraCreateMenuProperties = {} } = options;

  // 基本关键词搜索
  addContextMenu({
    id: `${baseMenuId}${SEG}d`,
    parentId: baseMenuId,
    title: "使用默认搜索方案搜索",
    contexts: ["selection"],
    ...extraCreateMenuProperties,
  });

  // 特定搜索方案搜索
  const solutions = Object.values(
    (metadataStore.solutions ?? {}) as Record<string, { enabled: boolean; sort: number; id: string; name: string }>,
  )
    .filter((x: any) => !!x.enabled)
    .sort((a: any, b: any) => b.sort - a.sort);
  if (solutions.length > 0) {
    const solutionSearchSubMenuId = addContextMenu({
      id: `${baseMenuId}${SEG}k`,
      parentId: baseMenuId,
      title: "使用指定搜索方案搜索",
      contexts: ["selection"],
      ...extraCreateMenuProperties,
    });

    for (const solution of solutions) {
      addContextMenu({
        id: `${solutionSearchSubMenuId}${SEG}${(solution as any).id}`,
        parentId: solutionSearchSubMenuId,
        title: (solution as any).name,
        contexts: ["selection"],
        ...extraCreateMenuProperties,
      });
    }
  }

  // 特定站点搜索
  const sites = Object.entries(metadataStore.sites ?? {})
    .map(([siteId, site]: [string, any]) => ({
      id: siteId,
      ...site,
    }))
    .filter((x: any) => !x.isOffline && !!x.allowSearch)
    .sort((a: any, b: any) => (b.sortIndex ?? 0) - (a.sortIndex ?? 0));

  if (sites.length > 0) {
    const siteSearchSubMenuId = addContextMenu({
      id: `${baseMenuId}${SEG}w`,
      parentId: baseMenuId,
      title: "在指定站点搜索",
      contexts: ["selection"],
      ...extraCreateMenuProperties,
    });

    for (const site of sites) {
      if (site.id === thisTabSiteId) {
        continue;
      }

      const siteTitle = metadataStore.siteNameMap?.[site.id] || site.id;

      addContextMenu({
        id: `${siteSearchSubMenuId}${SEG}${site.id}`,
        parentId: siteSearchSubMenuId,
        title: siteTitle,
        contexts: ["selection"],
        ...extraCreateMenuProperties,
      });
    }
  }

  if (thisTabSiteId) {
    addContextMenu({
      id: `${baseMenuId}${SEG}t`,
      parentId: baseMenuId,
      title: "在当前站点搜索",
      contexts: ["selection"],
      ...extraCreateMenuProperties,
    });
  }
}

async function populateContextMenus(tab: chrome.tabs.Tab) {
  const { config: configStore, metadata: metadataStore } = await loadPlan();

  const tabHost = getHostFromUrl(tab.url || "https://example.com");
  const thisTabSiteId = metadataStore?.siteHostMap?.[tabHost];
  const thisTabSiteName = metadataStore?.siteNameMap?.[thisTabSiteId];

  // 注：原先这里先 clearContextMenus()，改为在 commit 阶段按指纹决定是否重建

  // 配置中禁用右键菜单则不初始化
  if (configStore?.contextMenus?.enabled === false) {
    console.debug("[PTD] Context menus are disabled, skipping initialization.");
    return;
  }

  // 关键词搜索菜单（所有页面可用）
  if (configStore.contextMenus?.allowSelectionTextSearch ?? true) {
    const baseSearchMenusId = addContextMenu({
      id: idOf("s", "page"),
      title: "PT Assistant：搜索",
      contexts: ["selection"],
    });
    await createSearchMenu("page", baseSearchMenusId);
  }

  // 社交链接搜索菜单（所有页面可用）
  if (configStore.contextMenus?.allowSocialLinkSearch ?? true) {
    // 豆瓣链接
    const doubanMenuId = addContextMenu({
      id: idOf("s", "douban"),
      title: "搜索豆瓣条目",
      contexts: ["link"],
      targetUrlPatterns: ["*://movie.douban.com/subject/*"],
    });
    await createSearchMenu("douban", doubanMenuId, {
      extraCreateMenuProperties: {
        contexts: ["link"],
        targetUrlPatterns: ["*://movie.douban.com/subject/*"],
      },
    });

    // IMDb 链接
    const imdbMenuId = addContextMenu({
      id: idOf("s", "imdb"),
      title: "搜索 IMDb 条目",
      contexts: ["link"],
      targetUrlPatterns: ["*://www.imdb.com/title/tt*"],
    });

    await createSearchMenu("imdb", imdbMenuId, {
      extraCreateMenuProperties: {
        contexts: ["link"],
        targetUrlPatterns: ["*://www.imdb.com/title/tt*"],
      },
    });
  }

  // 下载链接推送菜单（所有页面可用）
  if (configStore.contextMenus?.allowLinkDownloadPush ?? true) {
    const downloaders = Object.values(metadataStore.downloaders ?? {})
      .filter((x: any) => !!x.enabled)
      .sort((a: any, b: any) => (b.sortIndex ?? 100) - (a.sortIndex ?? 100));

    if (downloaders.length > 0) {
      const baseLinkDownloadPushMenuId = addContextMenu({
        id: idOf("p"),
        title: "PT Assistant：推送到下载器",
        contexts: ["link"],
      });

      // 高级推送：跳转 options 页
      addContextMenu({
        id: idOf("p", "adv"),
        parentId: baseLinkDownloadPushMenuId,
        title: "高级推送（可配置目录/标签）",
        contexts: ["link"],
      });

      // contextMenus 环境下无法获取的动态参数，过滤掉相关目录模板
      const EXCLUDE_FOLDER_KEYWORDS = [
        "<...>", // SW 环境无法 window.prompt 输入目录
        "$search:", // 不存在搜索相关参数
        "$torrent.title$",
        "$torrent.subTitle$",
        "$torrent.category$",
      ];

      for (const downloader of downloaders as IDownloaderMetadata[]) {
        const downloaderPushSubMenuId = addContextMenu({
          id: idOf("p", "d", downloader.id),
          parentId: baseLinkDownloadPushMenuId,
          title: `推送到 ${downloader.name}（${downloader.address}）`,
          contexts: ["link"],
        });

        let suggestFolders = (downloader.suggestFolders ?? []).filter((f) =>
          !EXCLUDE_FOLDER_KEYWORDS.some((keywords) => f.includes(keywords)),
        );

        if (!thisTabSiteId) {
          suggestFolders = suggestFolders.filter((f) => !f.includes("$torrent.site$"));
        }
        if (!thisTabSiteName) {
          suggestFolders = suggestFolders.filter((f) => !f.includes("$torrent.siteName$"));
        }

        if (suggestFolders.length > 0) {
          suggestFolders = ["", ...suggestFolders]; // 空字符串 = 默认目录

          for (const rawFolder of suggestFolders) {
            // 标题按「当前激活标签页」渲染供用户预览；id 里存原始模板，
            // 真正推送时再按「被右键的那个页面」解析（避免菜单缓存导致的目录/日期串味）。
            const renderedFolder = renderFolderTemplate(rawFolder, {
              siteId: thisTabSiteId,
              siteName: thisTabSiteName,
            });

            addContextMenu({
              id: idOf("p", "d", downloader.id, encodeURIComponent(rawFolder)),
              parentId: downloaderPushSubMenuId,
              title: renderedFolder ? `-> ${renderedFolder}` : "-> 默认目录",
              contexts: ["link"],
            });
          }
        }
      }
    }
  }
}

/** 目录模板渲染：站点相关占位按传入上下文替换，日期始终按当前时间替换 */
function renderFolderTemplate(
  raw: string,
  ctx: { siteId?: string; siteName?: string },
): string {
  if (!raw) return "";
  const now = new Date();
  return raw
    .replace(/\$torrent\.site\$/g, ctx.siteId ?? "")
    .replace(/\$torrent\.siteName\$/g, ctx.siteName ?? "")
    .replace(/\$date:YYYY\$/g, dateFormat(now, "yyyy"))
    .replace(/\$date:MM\$/g, dateFormat(now, "MM"))
    .replace(/\$date:DD\$/g, dateFormat(now, "dd"));
}

type TSearchScope = "page" | "douban" | "imdb";

/** 搜索词：page 用选中文本；douban/imdb 优先从被右键的链接里解出条目号（旧实现的 selectionTextFilterFn） */
function searchTextForScope(scope: TSearchScope, info: chrome.contextMenus.OnClickData): string {
  const fallback = info?.selectionText ?? "";
  const link = info?.linkUrl;
  if (!link) return fallback;

  if (scope === "douban") {
    const matched = link.match(/subject\/(\d+)/);
    return matched ? `douban|${matched[1]}` : fallback;
  }
  if (scope === "imdb") {
    const matched = link.match(/(tt\d+)/);
    return matched ? `imdb|${matched[1]}` : fallback;
  }
  return fallback;
}

function siteIdFromUrl(metadata: any, url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return metadata?.siteHostMap?.[getHostFromUrl(url)];
  } catch {
    return undefined;
  }
}

/** 由 url 解出当前标签页的站点上下文 */
function resolveTabContext(metadata: any, url?: string) {
  const siteId = siteIdFromUrl(metadata, url);
  return { siteId, siteName: siteId ? metadata?.siteNameMap?.[siteId] : undefined };
}

/**
 * 点击派发：语义全部来自 menuItemId，不依赖任何内存闭包，
 * 因此 service worker 被回收再唤醒后菜单依旧可用（旧实现此时会静默失效）。
 */
chrome.contextMenus?.onClicked.addListener(async (info, tab) => {
  const parsed = parseMenuId(info.menuItemId);
  if (!parsed) return;

  if (parsed.kind === "search") {
    const { metadata } = await loadPlan();
    const search = searchTextForScope(parsed.scope as TSearchScope, info);
    let plan: string | undefined;

    if (parsed.target === "solution" && parsed.id) {
      plan = parsed.id;
    } else if (parsed.target === "site" && parsed.id) {
      plan = `site:${parsed.id}`;
    } else if (parsed.target === "this") {
      // 按「被右键的那个页面」解析，比旧实现按「最后激活的标签页」烘进菜单更准
      const siteId = siteIdFromUrl(metadata, info.pageUrl ?? tab?.url);
      if (siteId) plan = `site:${siteId}`;
    }

    openOptionsPage({ path: "/search", query: { search, ...(plan ? { plan } : {}), flush: 1 } });
    return;
  }

  if (parsed.kind === "push") {
    if (parsed.target === "advanced") {
      openOptionsPage({ path: "/link-push", query: { link: info.linkUrl! } });
      return;
    }
    if (parsed.target === "download" && parsed.id) {
      const { metadata } = await loadPlan();
      const downloader = (metadata?.downloaders?.[parsed.id] as IDownloaderMetadata | undefined) ?? undefined;
      if (!downloader) return;

      const ctx = resolveTabContext(metadata, info.pageUrl ?? tab?.url);
      const folder = renderFolderTemplate(parsed.folder ?? "", ctx);

      downloadLinkPush(info.linkUrl!, downloader, folder || undefined, tab?.title, tab?.url ?? info.pageUrl);
    }
  }
});

/**
 * 菜单指纹：覆盖所有「会体现在菜单上的」输入。指纹没变就一次 IPC 都不发。
 * 旧实现没有这层判断——每次切标签页都无条件 removeAll + 全量 create。
 */
function menuSignature(config: any, metadata: any, ctx: { siteId?: string; siteName?: string }): string {
  const enabledSolutionIds = Object.values((metadata?.solutions ?? {}) as Record<string, any>)
    .filter((x) => !!x.enabled)
    .map((x) => `${x.id}=${x.name}`)
    .sort();

  const searchableSiteIds = Object.entries((metadata?.sites ?? {}) as Record<string, any>)
    .filter(([, s]) => !s.isOffline && !!s.allowSearch)
    // 站点名会直接出现在子菜单标题里，必须进指纹，否则改名后菜单不刷新
    .map(([id, s]) => `${id}=${metadata?.siteNameMap?.[id] ?? s?.merge?.name ?? id}`)
    .sort();

  const pushDownloaders = Object.values((metadata?.downloaders ?? {}) as Record<string, any>)
    .filter((x) => !!x.enabled)
    .map((x) => `${x.id}=${x.name}@${x.address}|${(x.suggestFolders ?? []).join(";")}`)
    .sort();

  return JSON.stringify({
    flags: config?.contextMenus ?? {},
    enabledSolutionIds,
    searchableSiteIds,
    pushDownloaders,
    siteId: ctx.siteId ?? "",
    siteName: ctx.siteName ?? "",
    // 目录标题里的日期会随构建时间变化，跨天后需要重建；按「天」粒度的键避免每小时抖动
    dateKey: dateFormat(new Date(), "yyyy-MM-dd"),
  });
}

let lastSignature: string | null = null;

/** 串行化重建：快速连切标签页时，removeAll 与 create 不会交错踩踏 */
let buildChain: Promise<void> = Promise.resolve();

async function rebuildMenus(tab: chrome.tabs.Tab) {
  const { config, metadata } = await loadPlan();
  const ctx = resolveTabContext(metadata, tab.url);

  const signature = menuSignature(config, metadata, ctx);
  if (signature === lastSignature) return;
  lastSignature = signature;

  try {
    await chrome.contextMenus?.removeAll();
  } catch (error) {
    console.warn("[PTD] removeAll failed:", error);
  }

  await populateContextMenus(tab);
}

function scheduleRebuild(tab: chrome.tabs.Tab) {
  // 存储变更时先失效缓存，让下一次 rebuild 读到新值
  buildChain = buildChain.then(() => rebuildMenus(tab)).catch((err) => {
    lastSignature = null; // 失败后允许下次重试，避免卡死在错误指纹上
    console.error("Failed to initialize context menus:", err);
  });
  return buildChain;
}

if (chrome.contextMenus) {
  // 浏览器启动 / 扩展安装更新后必须先建一次：Chrome 会在浏览器重启时清空菜单，
  // 旧实现只在「切标签页」时才建，导致重启后不切标签就没有任何菜单。
  chrome.runtime.onStartup?.addListener(() => {
    invalidatePlan();
    lastSignature = null;
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => tab && scheduleRebuild(tab));
  });

  chrome.runtime.onInstalled?.addListener(() => {
    invalidatePlan();
    lastSignature = null;
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => tab && scheduleRebuild(tab));
  });

  chrome.tabs.onActivated.addListener((actionInfo: chrome.tabs.OnActivatedInfo) => {
    chrome.tabs.get(actionInfo.tabId, (tab) => {
      // 绝大多数切标签（尤其是普通网页之间）指纹相同，这里会直接返回、零 IPC
      scheduleRebuild(tab);
    });
  });

  // 配置/站点/下载器变化时刷新，替代旧实现「靠切标签页顺带读到新配置」的隐式路径
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (!("config" in changes) && !("metadata" in changes)) return;
    invalidatePlan();
    lastSignature = null;
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => tab && scheduleRebuild(tab));
  });
}
