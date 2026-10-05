/**
 * 站点服务（纯函数层）。
 *
 * ⚠️ **本文件目前是零引用孤儿**：全仓（排除 node_modules）grep `services/site` = 0 处，
 * 没有任何组件或模块 import 它。
 *
 * 头部原注释两句话，一句落空一句还成立：
 * - 「供 options 页面直接调用」——**落空**，没有调用方；
 * - 「处理器注册已迁移到 offscreen，页面经 sendMessage 由 offscreen 响应」——**成立**，
 *   offscreen/utils/site.ts 确实注册了那批 handler，页面侧走
 *   stores/metadata.ts 的 sendMessage("getSiteUserConfig")。
 *
 * 另注意：本文件是 offscreen/utils/site.ts 的一份**逐字拷贝**（约 60 行完全相同），
 * 不是共享实现。两份各自演化，已经分叉（offscreen 那份多了消息注册层与 favicon 队列）。
 * 要么让两边共用一份，要么把这份删掉 —— 别让它再躺着了。
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

import type { IMetadataPiniaStorageSchema } from "@/shared/types.ts";
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
