import { uniq } from "es-toolkit";
import { isEmpty } from "es-toolkit/compat";
import PQueue from "p-queue";
import {
  getDefinedSiteMetadata,
  getFavicon,
  type getFaviconMetadata,
  getSite as createSiteInstance,
  NO_IMAGE,
  type ISiteUserConfig,
  type TSiteID,
  checkSiteMetadataAllow,
} from "@ptd/site";

import { onMessage } from "@/messages.ts";
import type { IMetadataPiniaStorageSchema } from "@/shared/types.ts";

import { logger } from "./logger.ts";
import { ptdIndexDb } from "../adapter/indexdb.ts";
import { extStore } from "@/storage.ts";

export async function getSiteUserConfig(siteId: TSiteID, flush = false) {
  const metadataStore = (await extStore.getItem("metadata")) as IMetadataPiniaStorageSchema;
  const storedSiteUserConfig = metadataStore?.sites?.[siteId] ?? {};

  const siteMetaData = await getDefinedSiteMetadata(siteId);

  if (flush || isEmpty(storedSiteUserConfig)) {
    const isDeadSite = siteMetaData.isDead ?? false;
    storedSiteUserConfig.isOffline ??= isDeadSite;
    storedSiteUserConfig.sortIndex ??= 100;
    storedSiteUserConfig.allowSearch ??= !isDeadSite && checkSiteMetadataAllow(siteMetaData, "search");
    storedSiteUserConfig.allowQueryUserInfo ??= !isDeadSite && checkSiteMetadataAllow(siteMetaData, "userInfo");
    storedSiteUserConfig.timeout ??= 30e3;

    const inputSetting = {} as Record<string, string>;
    if (siteMetaData.userInputSettingMeta) {
      for (const userInputMeta of siteMetaData.userInputSettingMeta) {
        inputSetting[userInputMeta.name] = "";
      }
    }
    storedSiteUserConfig.inputSetting ??= inputSetting;

    storedSiteUserConfig.groups ??= siteMetaData.tags ?? [];
    storedSiteUserConfig.downloadInterval ??= siteMetaData?.download?.interval ?? 0;
    storedSiteUserConfig.uploadSpeedLimit ??= 0;
    storedSiteUserConfig.allowContentScript ??= true;
    storedSiteUserConfig.downloadLinkAppendix ??= "";
    storedSiteUserConfig.merge ??= {};
  }

  logger({ msg: `getSiteUserConfig for ${siteId}`, data: storedSiteUserConfig });
  return storedSiteUserConfig;
}

onMessage("getSiteUserConfig", async ({ data: { siteId, flush } }) => await getSiteUserConfig(siteId, flush));

onMessage("getSiteList", async () => {
  const metadata = (await extStore.getItem("metadata")) as IMetadataPiniaStorageSchema;
  const sites = metadata?.sites ?? {};
  const nameMap = metadata?.siteNameMap ?? {};
  return Promise.all(
    Object.entries(sites).map(async ([id, config]) => {
      const siteMetaData = await getDefinedSiteMetadata(id as TSiteID);
      const isDead = siteMetaData.isDead ?? false;
      return {
        id,
        name: nameMap[id] ?? config.merge?.name ?? id,
        url: config.url ?? "",
        offline: (isDead || config.isOffline) ?? false,
      };
    }),
  );
});

export async function getSiteInstance<TYPE extends "private" | "public">(
  siteId: TSiteID,
  options: { mergeUserConfig?: boolean } = {},
) {
  const { mergeUserConfig = true } = options;
  let storedSiteUserConfig: ISiteUserConfig = {};
  if (mergeUserConfig) {
    storedSiteUserConfig = await getSiteUserConfig(siteId);
  }

  logger({ msg: `getSiteInstance for ${siteId}`, data: storedSiteUserConfig });
  return await createSiteInstance<TYPE>(siteId, storedSiteUserConfig);
}

/**
 * 站点图标抓取队列：getFavicon 最坏要串行发 4 次 HTTP（首页 → manifest → /favicon.ico → 本体）。
 * 不加限制的话，一次性初始化几十个站点会同时打出几十个全页请求，互相争抢带宽、拖慢整个页面。
 * 这里限制并发，并加一道总时长兜底。
 *
 * ⚠️ 原注释说「这些 axios 调用没有 timeout」——**上游早已改掉**：packages/site/utils/favicon.ts
 * 每个请求都显式带 timeout（FAVICON_TIMEOUT = 5e3，见其 :119/:140/:156/:202/:240）。
 * 下面这个 8s Promise.race 现在只是**总时长上限**，不是「补缺失的单请求超时」。
 */
const faviconQueue = new PQueue({ concurrency: 6 });
const FAVICON_TIMEOUT = 8000;

export async function getSiteFavicon(site: TSiteID | getFaviconMetadata, flush: boolean = false): Promise<string> {
  const siteId = typeof site === "string" ? site : site.id;
  // ⚠️ NO_IMAGE 不算命中。库里可能躺着一次失败留下的那张 1x1 透明图：把它当有效值，
  // 就等于把该站点的图标**永久**钉成空白 —— 首屏 20 行排队挤满 8s、站点当天连不上、
  // DNS 失败都会写进这么一条，之后每次读缓存都短路返回，再也没有重试的机会。
  const cached = (await (await ptdIndexDb()).get("favicon", siteId)) as string | undefined;
  let siteFavicon = cached && cached !== NO_IMAGE ? cached : false;
  if (flush || !siteFavicon) {
    const siteInstance = await getSiteInstance(siteId);
    if (siteInstance) {
      siteFavicon = await faviconQueue.add(async () => {
        // 超时兜底：站点无响应时不能让调用方（表格首屏）一直等下去
        return await Promise.race([
          getFavicon({
            id: siteId,
            urls: uniq([siteInstance.url, ...siteInstance.metadata.urls].filter(Boolean)),
            favicon: siteInstance.metadata.favicon,
          }),
          new Promise<string>((resolve) => setTimeout(() => resolve(NO_IMAGE), FAVICON_TIMEOUT)),
        ]);
      });

      // 失败不落库：落库就是把「这次没连上」写成「这个站点没有图标」。
      // 内存侧那一份由 SiteFavicon/utils.ts 的 faviconCache 管，只活到本页面卸载，
      // 所以不重试的窗口最多一次页面生命周期，不会像落库那样把结果冻死。
      if (siteFavicon && siteFavicon !== NO_IMAGE) {
        await (await ptdIndexDb()).put("favicon", siteFavicon, siteId);
      } else {
        logger({ msg: `getSiteFavicon for ${siteId} 未取到图标，不写缓存（下次仍会重试）`, level: "warn" });
      }
    }
  }

  if (!siteFavicon) {
    siteFavicon = NO_IMAGE;
    logger({ msg: `getSiteFavicon for ${siteId} failed, use default NO_IMAGE.`, level: "warn" });
  }

  return siteFavicon;
}

onMessage("getSiteFavicon", async ({ data: { site, flush } }) => (await getSiteFavicon(site, flush))!);

export async function clearSiteFaviconCache() {
  logger({ msg: `clearSiteFaviconCache` });
  return await (await ptdIndexDb()).clear("favicon");
}

onMessage("clearSiteFaviconCache", async () => await clearSiteFaviconCache());
