/**
 * 站点服务（本轮运行在 options 页上下文，具备 DOM，可做页面解析）。
 * 移植自 PT-depiler entries/offscreen/utils/site.ts（去掉 favicon/indexdb 部分），
 * 后续引入 offscreen 入口时把 onMessage 注册迁移过去，options 侧保留同名本地处理器即可
 * （消息 wrapper 优先本地调用，两端不冲突）。
 *
 * ⚠️ 本模块不能在 background（service worker）中注册：它 import 了 @ptd/site，
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

import { onMessage, sendMessage } from "@/messages.ts";
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

onMessage("getSiteUserConfig", async ({ data: { siteId, flush } }) => await getSiteUserConfig(siteId, flush));

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
