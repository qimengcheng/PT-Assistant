import { shallowReactive } from "vue";

import { definitionList, type ISiteMetadata, NO_IMAGE, type TSiteID } from "@ptd/site";

import { sendMessage } from "@/messages.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";

export interface IExtendSiteMetadata extends Pick<ISiteMetadata, "id" | "type"> {
  siteName: string; // 解析后的站点名称（当前用户使用的）
  combinedSiteName: string; // 所有该站点的名称，使用 "|$|" 分隔
  hasUserInfo: boolean; // 是否有用户配置
  isDead: boolean; // 是否为失效站点
  isOffline: boolean; // 是否为离线站点
  faviconSrc: string;
  faviconElement: HTMLImageElement; // 站点的图片
}

export type TOptionSiteMetadatas = Record<TSiteID, IExtendSiteMetadata>;

export const allAddedSiteMetadata = shallowReactive<TOptionSiteMetadatas>({});

/**
 * 站点图标是「网络请求」：getFavicon 最坏情况要串行发 4 次 HTTP
 * （首页 HTML → web manifest → /favicon.ico → 图标本体），对 siteUrls 还是逐个串行尝试，
 * 且这些 axios 调用没有设 timeout。11 个站点意味着几十次真实网络往返。
 *
 * 所以这里绝不能 await 图标 —— 否则表格首屏要等最慢的那个站点才能出第一行。
 * 改为：先用 NO_IMAGE 占位把行建出来渲染，图标拿到后再整条替换回填。
 */
async function fillFaviconAsync(siteId: TSiteID, placeholder: IExtendSiteMetadata) {
  try {
    const siteFaviconUrl = await sendMessage("getSiteFavicon", { site: siteId });
    if (!siteFaviconUrl) return;

    const siteFavicon = new Image();
    siteFavicon.src = siteFaviconUrl;
    siteFavicon.decode().catch(() => {
      siteFavicon.src = NO_IMAGE;
      siteFavicon.decode();
    });

    // allAddedSiteMetadata 是 shallowReactive：直接改 entry 的属性不会触发更新，
    // 必须整体替换该 key 才能让依赖它的模板重渲染。
    allAddedSiteMetadata[siteId] = {
      ...placeholder,
      faviconSrc: siteFaviconUrl,
      faviconElement: siteFavicon,
    };
  } catch (e) {
    // 保留占位图，不影响表格首屏
    console.error(`[PTD] 站点图标获取失败（保留占位图）: ${siteId}`, e);
  }
}

export async function loadAllAddedSiteMetadata(sites?: string[]): Promise<TOptionSiteMetadatas> {
  const loadSites = sites ?? definitionList;
  const metadataStore = useMetadataStore();

  await Promise.allSettled(
    loadSites.map(async (siteId) => {
      if (allAddedSiteMetadata[siteId]) return;

      try {
        // 以下都是本地数据（站点定义 + 本地配置），不触网，可以直接等
        const siteMetadata = await metadataStore.getSiteMetadata(siteId);
        const siteName = await metadataStore.getSiteName(siteId);

        const placeholderImage = new Image();
        placeholderImage.src = NO_IMAGE;

        const entry: IExtendSiteMetadata = {
          id: siteId,
          type: siteMetadata.type,
          siteName,
          combinedSiteName: Array.from(
            new Set([siteName, siteMetadata.name, ...(siteMetadata.aka ?? [])].filter(Boolean)),
          ).join("|$|"),
          hasUserInfo: Object.hasOwn(siteMetadata, "userInfo"),
          isDead: siteMetadata.isDead ?? false,
          isOffline: metadataStore.sites[siteId]?.isOffline ?? false,
          faviconSrc: NO_IMAGE,
          faviconElement: placeholderImage,
        };

        allAddedSiteMetadata[siteId] = entry;

        // 不 await：图标异步回填，不阻塞表格首屏
        void fillFaviconAsync(siteId, entry);
      } catch (e) {
        console.error(`[PTD] loadAllAddedSiteMetadata 失败: ${siteId}`, e);
      }
    }),
  );

  return allAddedSiteMetadata;
}
