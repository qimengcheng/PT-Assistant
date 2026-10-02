/**
 * 右键菜单：划词搜索 / 豆瓣·IMDb 链接搜索 / 下载链接推送到下载器。
 * 平移自 PT-depiler background/utils/contextMenus.ts，适配点：
 * - extStorage → extStore（@webext-core/storage）
 * - openOptionsPage 本地实现（新项目无 base.ts）
 * - chrome.i18n.getMessage → 中文字符串（新项目未铺 _locales）
 * - 搜索路由 /search-entity → /search；图标路径 icons/logo/128.png → icon/128.png
 */
import { nanoid } from "nanoid";
import { format as dateFormat } from "date-fns";

import { type CAddTorrentOptions } from "@ptd/downloader/types.ts";
import { getHostFromUrl } from "@ptd/site/utils/html.ts"; // 不能用 @ptd/site 主入口，会把 sizzle eager 链拉进 SW
import { type ITorrent } from "@ptd/site/types/torrent.ts";

import { extStore } from "@/storage.ts";
import { onMessage, sendMessage } from "@/messages.ts";
import { type IDownloaderMetadata } from "@/shared/types/storages/metadata.ts";

const contextMenusId = "PT-Assistant-Context-Menus";

const contextMenusClickEventBus = new Map<
  string | number,
  (info: chrome.contextMenus.OnClickData, tab: chrome.tabs.Tab) => void
>();

chrome.contextMenus?.onClicked.addListener((info, tab) => {
  if (!info.menuItemId || !contextMenusClickEventBus.has(info.menuItemId)) {
    return;
  }
  const clickHandler = contextMenusClickEventBus.get(info.menuItemId);
  if (clickHandler) {
    clickHandler(info, tab!);
  }
});

function addContextMenu(data: chrome.contextMenus.CreateProperties) {
  if (!data.id) {
    data.id = nanoid();
  }

  if (data.onclick) {
    // 有 onclick 时存入事件总线（chrome.contextMenus.create 不支持直接传 onclick）
    contextMenusClickEventBus.set(data.id, data.onclick);
    delete data.onclick;
  }

  chrome.contextMenus?.create(data);
  return data.id;
}

onMessage("addContextMenu", async ({ data }) => addContextMenu(data));

function removeContextMenu(id: string) {
  chrome.contextMenus?.remove(id).catch();
  contextMenusClickEventBus.delete(id);
}

onMessage("removeContextMenu", async ({ data }) => removeContextMenu(data));

function clearContextMenus() {
  chrome.contextMenus?.removeAll().catch();
  contextMenusClickEventBus.clear();
}

onMessage("clearContextMenus", async () => clearContextMenus());

/** 打开 options 页指定路由（带 query，经 urlencode 后拼到 hash 路由上） */
function openOptionsPage(url?: string | { path: string; query?: Record<string, any> }) {
  let target: string | undefined;
  if (url && typeof url !== "string") {
    const query = new URLSearchParams(
      Object.entries(url.query ?? {}).map(([k, v]) => [k, String(v)]),
    ).toString();
    target = url.path + (query ? "?" + query : "");
  }
  target ??= "/";

  chrome.tabs.create({ url: "/options.html#" + target }).catch();
}

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
  selectionTextFilterFn?: (value?: chrome.contextMenus.OnClickData) => string;
}

async function createSearchMenu(baseMenuId: string, options: ICreateSearchMenuOption = {}) {
  const metadataStore = (await extStore.getItem("metadata")) ?? ({} as any);

  const {
    thisTabSiteId = null,
    selectionTextFilterFn = (a) => a?.selectionText ?? "",
    extraCreateMenuProperties = {},
  } = options;

  // 基本关键词搜索
  addContextMenu({
    parentId: baseMenuId,
    title: "使用默认搜索方案搜索",
    contexts: ["selection"],
    ...extraCreateMenuProperties,
    onclick: (info) => {
      openOptionsPage({
        path: "/search",
        query: { search: selectionTextFilterFn(info), flush: 1 },
      });
    },
  });

  // 特定搜索方案搜索
  const solutions = Object.values((metadataStore.solutions ?? {}) as Record<string, { enabled: boolean; sort: number; id: string; name: string }>)
    .filter((x: any) => !!x.enabled)
    .sort((a: any, b: any) => b.sort - a.sort);
  if (solutions.length > 0) {
    const solutionSearchSubMenuId = addContextMenu({
      id: `${baseMenuId}**Search-In-Solutions`,
      parentId: baseMenuId,
      title: "使用指定搜索方案搜索",
      contexts: ["selection"],
      ...extraCreateMenuProperties,
    });

    for (const solution of solutions) {
      addContextMenu({
        id: `${solutionSearchSubMenuId}**${solution.id}`,
        parentId: solutionSearchSubMenuId,
        title: solution.name,
        contexts: ["selection"],
        ...extraCreateMenuProperties,
        onclick: (info) => {
          openOptionsPage({
            path: "/search",
            query: { search: selectionTextFilterFn(info), plan: solution.id, flush: 1 },
          });
        },
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
      id: `${baseMenuId}**Search-In-Site`,
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
        id: `${siteSearchSubMenuId}**${site.id}`,
        parentId: siteSearchSubMenuId,
        title: siteTitle,
        contexts: ["selection"],
        ...extraCreateMenuProperties,
        onclick: (info) => {
          openOptionsPage({
            path: "/search",
            query: { search: selectionTextFilterFn(info), plan: `site:${site.id}`, flush: 1 },
          });
        },
      });
    }
  }

  if (thisTabSiteId) {
    addContextMenu({
      id: `${baseMenuId}**Search-In-This-Site`,
      parentId: baseMenuId,
      title: "在当前站点搜索",
      contexts: ["selection"],
      ...extraCreateMenuProperties,
      onclick: (info) => {
        openOptionsPage({
          path: "/search",
          query: { search: info.selectionText, plan: `site:${thisTabSiteId}`, flush: 1 },
        });
      },
    });
  }
}

async function initContextMenus(tab: chrome.tabs.Tab) {
  const configStore = (await extStore.getItem("config")) ?? ({} as any);
  const metadataStore = (await extStore.getItem("metadata")) ?? ({} as any);

  const tabHost = getHostFromUrl(tab.url || "https://example.com");
  const thisTabSiteId = metadataStore?.siteHostMap?.[tabHost];
  const thisTabSiteName = metadataStore?.siteNameMap?.[thisTabSiteId];

  // 清除原来的菜单
  clearContextMenus();

  // 配置中禁用右键菜单则不初始化
  if (configStore?.contextMenus?.enabled === false) {
    console.debug("[PTD] Context menus are disabled, skipping initialization.");
    return;
  }

  // 关键词搜索菜单（所有页面可用）
  if (configStore.contextMenus?.allowSelectionTextSearch ?? true) {
    const baseSearchMenusId = addContextMenu({
      id: `${contextMenusId}**Search`,
      title: "PT Assistant：搜索",
      contexts: ["selection"],
    });
    await createSearchMenu(baseSearchMenusId);
  }

  // 社交链接搜索菜单（所有页面可用）
  if (configStore.contextMenus?.allowSocialLinkSearch ?? true) {
    // 豆瓣链接
    const doubanMenuId = addContextMenu({
      id: `${contextMenusId}**SearchByDoubanLink`,
      title: "搜索豆瓣条目",
      contexts: ["link"],
      targetUrlPatterns: ["*://movie.douban.com/subject/*"],
    });
    await createSearchMenu(doubanMenuId, {
      extraCreateMenuProperties: {
        contexts: ["link"],
        targetUrlPatterns: ["*://movie.douban.com/subject/*"],
      },
      selectionTextFilterFn: (info) => {
        const failSearchText = info?.selectionText ?? "";
        if (info?.linkUrl) {
          const link = info.linkUrl.match(/subject\/(\d+)/);
          return link ? `douban|${link[1]}` : failSearchText;
        }
        return failSearchText;
      },
    });

    // IMDb 链接
    const imdbMenuId = addContextMenu({
      id: `${contextMenusId}**SearchByIMDbLink`,
      title: "搜索 IMDb 条目",
      contexts: ["link"],
      targetUrlPatterns: ["*://www.imdb.com/title/tt*"],
    });

    await createSearchMenu(imdbMenuId, {
      extraCreateMenuProperties: {
        contexts: ["link"],
        targetUrlPatterns: ["*://www.imdb.com/title/tt*"],
      },
      selectionTextFilterFn: (info) => {
        const failSearchText = info?.selectionText ?? "";
        if (info?.linkUrl) {
          const link = info.linkUrl.match(/(tt\d+)/);
          return link ? `imdb|${link[1]}` : failSearchText;
        }
        return failSearchText;
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
        id: `${contextMenusId}**Link-Download-Push`,
        title: "PT Assistant：推送到下载器",
        contexts: ["link"],
      });

      // 高级推送：跳转 options 页
      addContextMenu({
        id: `${baseLinkDownloadPushMenuId}**Link-Push`,
        parentId: baseLinkDownloadPushMenuId,
        title: "高级推送（可配置目录/标签）",
        contexts: ["link"],
        onclick: (info) => {
          openOptionsPage({ path: "/link-push", query: { link: info.linkUrl! } });
        },
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
          id: `${baseLinkDownloadPushMenuId}**${downloader.id}`,
          parentId: baseLinkDownloadPushMenuId,
          title: `推送到 ${downloader.name}（${downloader.address}）`,
          contexts: ["link"],
          onclick: (info, tab) => {
            downloadLinkPush(info.linkUrl!, downloader, undefined, tab?.title, tab?.url);
          },
        });

        let suggestFolders = (downloader.suggestFolders ?? []).filter((f) =>
          !EXCLUDE_FOLDER_KEYWORDS.some((keywords) => f.includes(keywords)),
        );

        if (thisTabSiteId) {
          suggestFolders = suggestFolders.map((f) => f.replace("$torrent.site$", thisTabSiteId));
        } else {
          suggestFolders = suggestFolders.filter((f) => !f.includes("$torrent.site$"));
        }

        if (thisTabSiteName) {
          suggestFolders = suggestFolders.map((f) => f.replace("$torrent.siteName$", thisTabSiteName));
        } else {
          suggestFolders = suggestFolders.filter((f) => !f.includes("$torrent.siteName$"));
        }

        const nowDate = new Date();
        suggestFolders = suggestFolders.map((f) =>
          f
            .replace("$date:YYYY$", dateFormat(nowDate, "yyyy"))
            .replace("$date:MM$", dateFormat(nowDate, "MM"))
            .replace("$date:DD$", dateFormat(nowDate, "dd")),
        );

        if (suggestFolders.length > 0) {
          suggestFolders = ["", ...suggestFolders]; // 空字符串 = 默认目录

          for (const suggestFolder of suggestFolders) {
            addContextMenu({
              id: `${downloaderPushSubMenuId}**${suggestFolder}`,
              parentId: downloaderPushSubMenuId,
              title: suggestFolder ? `-> ${suggestFolder}` : "-> 默认目录",
              contexts: ["link"],
              onclick: (info, tab) => {
                downloadLinkPush(info.linkUrl!, downloader, suggestFolder, tab?.title, tab?.url);
              },
            });
          }
        }
      }
    }
  }
}

if (chrome.contextMenus) {
  chrome.tabs.onActivated.addListener((actionInfo: chrome.tabs.OnActivatedInfo) => {
    chrome.tabs.get(actionInfo.tabId, (tab) => {
      initContextMenus(tab).catch((err) => console.error("Failed to initialize context menus:", err));
    });
  });
}
