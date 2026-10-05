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
import { Modal } from "antdv-next";
import { uniq } from "es-toolkit";
import type { TSupportSocialSite } from "@ptd/social";
import { getSite as createSiteInstance } from "@ptd/site";
import type BittorrentSite from "@ptd/site/schemas/AbstractBittorrentSite.ts";

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
        listUrlPatterns.some((pattern) => new RegExp(pattern!, "i").test(url)) &&
        !excludeListUrlPatterns.some((pattern) => new RegExp(pattern!, "i").test(url))
      ) {
        pageType.value = "list";
      } else {
        // 如果不是 list 页面，再判断是否为 detail 页面
        let detailUrlPatterns = metadata.detail?.urlPattern ?? [];

        if (detailUrlPatterns.some((pattern) => new RegExp(pattern, "i").test(url))) {
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
