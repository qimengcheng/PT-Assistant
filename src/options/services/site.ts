/**
 * 站点服务（纯函数层，供 options 页面直接调用）。
 * 消息协议（getSiteUserConfig/getSiteFavicon 等）的处理器注册已迁移到 offscreen
 * 文档（src/entrypoints/offscreen/，由 background 启动时创建），页面经
 * sendMessage 调用时由 offscreen 响应。
 *
 * ⚠️ 本模块不能在 background（service worker）中 import：它 import 了 @ptd/site，
 * 其 eager 链会拉进 sizzle（顶层访问 window），SW 无 window 会崩。
 */
import { isEmpty } from "es-toolkit/compat";
import {
  checkSiteMetadataAllow,
  getDefinedSiteMetadata,
  getSite as createSiteInstance,
  type ISiteUserConfig,
  type TSiteID,
} from "@ptd/site";

import { sendMessage } from "@/messages.ts";
import type { IMetadataPiniaStorageSchema } from "@/shared/types.ts";

export async function getSiteUserConfig(siteId: TSiteID, flush = false) {
  const metadataStore = (await sendMessage("getExtStorage", "metadata")) as IMetadataPiniaStorageSchema;
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

  return storedSiteUserConfig;
}

export async function getSiteInstance<TYPE extends "private" | "public">(
  siteId: TSiteID,
  options: { mergeUserConfig?: boolean } = {},
) {
  const { mergeUserConfig = true } = options;
  let storedSiteUserConfig: ISiteUserConfig = {};
  if (mergeUserConfig) {
    storedSiteUserConfig = await getSiteUserConfig(siteId);
  }

  return await createSiteInstance<TYPE>(siteId, storedSiteUserConfig);
}
