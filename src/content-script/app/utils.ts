/**
 * 平移自 PT-depiler `entries/content-script/app/utils.ts`。
 *
 * 用「动态组件」的方式给 content script 实现了一个极简路由：
 * refs: https://cn.vuejs.org/guide/scaling-up/routing.html#simple-routing-from-scratch
 *
 * 相对上游的改动：`wrapperConfirmFn` / `doKeywordSearch` 原本走原生 `confirm()` / `prompt()`，
 * 现改走 @/options/components/appDialog.ts 的公共对话框实现（原生弹窗挂在页面 origin 上、
 * 阻塞主线程，且在 MV3 扩展页面被禁用）。
 */
import { computed, ref, shallowRef } from "vue";
import { Modal, notification } from "antdv-next";
import { uniq } from "es-toolkit";
import type { TSupportSocialSite } from "@ptd/social";
import { getSite as createSiteInstance } from "@ptd/site";
import type BittorrentSite from "@ptd/site/schemas/AbstractBittorrentSite.ts";
import type { TPattern } from "@ptd/site/types/base.ts";

import { sendMessage } from "@/messages.ts";
import {
  makeConfirmDanger,
  makePromptInDialog,
  type IDialogModalApi,
  type TTranslate,
} from "@/options/components/appDialog.ts";
import { i18nInstance } from "@/options/plugins/i18n.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import { formatSize } from "@/options/utils.ts";
import {
  assessRatioBatch,
  fillRatioRowNames,
  ratioMuteAfterConfirm,
  type IRatioRisk,
  type ISizeBearingTorrent,
} from "@/shared/ratioGuard.ts";
import { makeRatioGuardUi } from "@/shared/ratioGuardUi.ts";

import SocialSitePage from "./pages/SocialSitePage.vue";
import SiteListPage from "./pages/SiteListPage.vue";
import SiteDetailPage from "./pages/SiteDetailPage.vue";
import { useConfigStore } from "@/options/stores/config.ts";

export const siteInstance = shallowRef<BittorrentSite>();

type TPageType = "unknown" | "social" | "list" | "detail";

export interface IPtdData {
  siteId?: string;
  socialSite?: TSupportSocialSite;
  [key: string]: any;
}

export const pageType = ref<TPageType>("unknown");

/**
 * 用第三方站点定义里的 urlPattern 匹配当前 URL，坏正则跳过而不是让整轮 some 崩掉。
 *
 * ⚠️ 这些 pattern 来自 packages/site/definitions（外部数据），一个写错的括号就会让
 * `new RegExp` 抛 SyntaxError —— 而它在 .some() 回调里抛，整轮分类直接中断，
 * list/detail 全部退回 unknown（内容脚本的入口整个不出现）。异常还会被
 * App.vue 的裸 catch 吞掉，现场什么都不剩。
 *
 * TPattern 允许直接给 RegExp（那就别再包一层 new RegExp）。
 */
function matchesUrlPattern(pattern: TPattern | undefined, url: string): boolean {
  if (pattern === undefined || pattern === null) return false;
  try {
    const re = pattern instanceof RegExp ? pattern : new RegExp(pattern, "i");
    return re.test(url);
  } catch {
    return false;
  }
}

export async function updatePageType(ptdData: IPtdData = {}) {
  const metadataStore = useMetadataStore();

  pageType.value = "unknown"; // 重置为 unknown
  const url = location.href;

  if (ptdData.socialSite) {
    pageType.value = "social";
  } else if (ptdData.siteId) {
    const siteConfig = await metadataStore.getSiteUserConfig(ptdData.siteId);
    siteInstance.value = await createSiteInstance(ptdData.siteId, siteConfig);

    if (siteInstance.value) {
      const metadata = siteInstance.value.metadata;

      // 首先判断是否为 list 页面
      let listUrlPatterns = [];
      if (metadata.list && metadata.list.length > 0) {
        listUrlPatterns = metadata.list.flatMap((item) => item.urlPattern ?? []).filter(Boolean);
      } else {
        listUrlPatterns = uniq([
          ...(metadata.search?.requestConfig?.url ? [metadata.search.requestConfig.url] : []),
          ...(Object.values(metadata.searchEntry ?? {}).map((entry) => entry.requestConfig?.url) ?? []),
        ]).filter(Boolean);
      }

      const excludeListUrlPatterns =
        metadata.list?.flatMap((item) => item.excludeUrlPattern ?? []).filter(Boolean) ?? [];

      if (
        listUrlPatterns.some((pattern) => matchesUrlPattern(pattern, url)) &&
        !excludeListUrlPatterns.some((pattern) => matchesUrlPattern(pattern, url))
      ) {
        pageType.value = "list";
      } else {
        // 如果不是 list 页面，再判断是否为 detail 页面
        let detailUrlPatterns = metadata.detail?.urlPattern ?? [];

        if (detailUrlPatterns.some((pattern) => matchesUrlPattern(pattern, url))) {
          pageType.value = "detail";
        }
      }
    }
  }
}

/**
 * content 侧浮层宿主（shadowRoot 内那个 0x0 fixed 容器），由 init.ts 在挂载时写入。
 * App.vue 把它交给 ConfigProvider 的 getPopupContainer，模板里的浮层才落在 shadowRoot 内。
 */
export const contentOverlay = shallowRef<HTMLElement | null>(null);

const translate: TTranslate = (key) => i18nInstance.global.t(key);

/**
 * content 侧的确认框与输入框对话框。
 *
 * 复用 appDialog.ts 的实现，但 modal 换成**静态** Modal。拿不到 App 上下文的真正原因
 * 不是「没有 `<a-app>` 祖先」—— App.vue:334 自己就渲染了 `<a-app>`，SentToDownloaderDialog
 * 就挂在它里面用的 App 上下文版；而是下面这两个函数在**模块作用域**被调用，
 * 没有当前组件实例，inject 无从谈起。
 * 静态方法默认挂 document.body，那里取不到扩展的任何样式，所以必须显式 getContainer
 * 指进 shadowRoot 内的浮层宿主。
 */
const contentModal: IDialogModalApi = {
  confirm: (config) => Modal.confirm({ ...config, getContainer: () => contentOverlay.value ?? document.body }),
};
const confirmDanger = makeConfirmDanger(contentModal, translate);
const promptInDialog = makePromptInDialog(contentModal, translate);

export async function wrapperConfirmFn(
  fn: () => any,
  message = translate("contentScript.confirmDefaultAction"),
) {
  const configStore = useConfigStore();
  if (!configStore.contentScript.doubleConfirmAction) {
    fn();
    return;
  }
  // okType 用 primary：批量下载/复制链接不是破坏性操作，上游的原生 confirm 也没有红色按钮
  if (await confirmDanger(message, "primary")) {
    fn();
  }
}

/**
 * 低分享率检查（content 侧）。判据、文案、列表排版都在 `@/shared/ratioGuard*` 里，
 * 与选项页共用一份；这里只负责喂 content 这套容器：静态 Modal 要显式 getContainer 指进
 * shadowRoot 的浮层宿主（同上面 confirmDanger 的理由 —— 模块作用域拿不到 App 上下文）。
 * notification 的样式与容器都由 init.ts 那次全局配置管（holderRender + notification.config）：
 * ArgsProps 里没有 getContainer，逐次调用传会被 TS 拒掉，容器只有全局那一档。
 */
const ratioGuardUi = makeRatioGuardUi({
  modal: contentModal,
  notify: { warning: (config) => notification.warning(config) },
  t: (key, named) => i18nInstance.global.t(key, named ?? {}),
  formatSize,
  // 重弹策略与那份「当天已确认」的记录住在同一份持久化配置里，所以两边（选项页 / content）说的是一套话。
  // 这里在回调里现取 store，不吃模块作用域的那份引用：本文件是模块级构造的，
  // 而 pinia 要等 init.ts 装好 —— 取数发生在用户点发送那一刻，那时必然已经装上了。
  confirmPolicy: () => useConfigStore().download.ratioConfirmPolicy,
  confirmMute: () => useConfigStore().download.ratioConfirmMute,
  rememberConfirm: (sites) => {
    const configStore = useConfigStore();
    configStore.download.ratioConfirmMute = ratioMuteAfterConfirm(configStore.download.ratioConfirmMute, sites);
  },
});

/**
 * 一批种子 → 三档「下完这批之后的分享率」（同站多条并成一行，免费的条目不记下载量）。
 *
 * 站点名的兜底链：`siteNameMap` 是选项页启动时建的，用户只在不打开设置页的情况下用站点页
 * 下载时它可能是空的 —— 那时先退回当前站点定义里的 name（content 这一路上这批种子都属于
 * 页面上那个站），仍然没有就异步走 `getSiteName`（它会读站点定义，未添加的站也有真名）。
 * 直接 `?? site` 会把内部 id 画进界面，那是 AGENTS.md §3.5 的零容忍项，与
 * `KeepUploadDialog.vue:1332` 那条注释判的是同一件事。
 *
 * 补名字只发生在**真要画出来**的那两档（未取到那一档只报个数），所以不会为一整批发 N 次异步取数。
 */
export async function collectRatioRisk(torrents: ISizeBearingTorrent[]): Promise<IRatioRisk> {
  const metadataStore = useMetadataStore();
  const risk = assessRatioBatch(torrents, {
    accountFor: (site) => metadataStore.lastUserInfo[site],
    nameFor: (site) => metadataStore.siteNameMap[site] ?? siteInstance.value?.metadata?.name ?? "",
  });
  await fillRatioRowNames(risk, (site) => metadataStore.getSiteName(site));
  return risk;
}

export const ratioGuard = ratioGuardUi;

export async function doKeywordSearch(keywords: string, plan = "default") {
  const search = keywords || (await promptInDialog(translate("contentScript.keywordPromptTitle")));

  if (search) {
    // 上游 path 是 /search-entity；WXT 主路由是 /search，已在 router.ts 里配了 alias，
    // 这里沿用上游 path 以保持与原实现一致。
    sendMessage("openOptionsPage", {
      path: "/search-entity",
      query: { search, plan, flush: 1 },
    }).catch();
  } else {
    const runtimeStore = useRuntimeStore();
    runtimeStore.showSnakebar(i18nInstance.global.t("contentScript.keywordEmptyError"), { color: "error" });
  }
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof text !== "string" || text.length === 0) {
    return false;
  }

  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (err) {
    // ignore and fallback
  }

  if (typeof document === "undefined") {
    return false;
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const successful = document.execCommand("copy");
    document.body.removeChild(textarea);
    return successful;
  } catch (err) {
    return false;
  }
}

const routes: Record<TPageType, any> = {
  unknown: "div",
  social: SocialSitePage,
  list: SiteListPage,
  detail: SiteDetailPage,
};

export const currentView = computed(() => {
  return routes[pageType.value ?? "unknown"];
});
