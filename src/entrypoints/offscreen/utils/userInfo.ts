import PQueue from "p-queue";
import { format } from "date-fns";
import { isEmpty } from "es-toolkit/compat";
import type { IUserInfo } from "@ptd/site";
import { EResultParseStatus } from "@ptd/site";

import { onMessage, sendMessage } from "@/messages.ts";
import type { IMetadataPiniaStorageSchema, IConfigPiniaStorageSchema } from "@/shared/types.ts";

import { logger } from "./logger.ts";
import { getSiteInstance } from "./site.ts";
import { extStore } from "@/storage.ts";
import { deleteArchiveEntries, putArchiveEntry, readSiteArchive } from "@/shared/userInfoArchive.ts";

const flushQueue = new PQueue({ concurrency: 1 }); // 默认设置为 1，避免并发搜索
const setSiteLastUserInfoQueue = new PQueue({ concurrency: 1 }); // 专门用于 setSiteLastUserInfo 的队列

flushQueue.on("active", async () => {
  const configStoreRaw = (await extStore.getItem("config")) as IConfigPiniaStorageSchema;
  const queueConcurrency = configStoreRaw?.userInfo?.queueConcurrency ?? 1;

  if (flushQueue.concurrency != queueConcurrency) {
    flushQueue.concurrency = queueConcurrency;
    logger({
      msg: `The concurrency of the user information refresh queue has been updated to ${flushQueue.concurrency}`,
    });
  }
});

onMessage("cancelUserInfoQueue", () => {
  flushQueue.clear();
});

export async function getSiteUserInfoResult(siteId: string) {
  return (await flushQueue.add(async () => {
    logger({ msg: `getSiteUserInfoResult for ${siteId}` });

    // 获取站点实例和配置信息
    const site = await getSiteInstance<"private">(siteId);

    // 尝试延长cookies
    try {
      await sendMessage("checkAndExtendCookies", { url: site.url, siteId });
    } catch (error) {
      // 静默处理错误，不影响用户信息获取流程
      logger({ msg: `Failed to extend cookies for site ${siteId}`, level: "debug" });
    }

    // 获取历史信息
    const metadataStoreRaw = (await extStore.getItem("metadata")) as IMetadataPiniaStorageSchema;
    const configStoreRaw = (await extStore.getItem("config")) as IConfigPiniaStorageSchema;
    let lastUserInfo = metadataStoreRaw?.lastUserInfo?.[siteId as string] ?? {};
    if (
      !(configStoreRaw.userInfo.alwaysPickLastUserInfo ?? true) ||
      (lastUserInfo as IUserInfo).status !== EResultParseStatus.success
    ) {
      lastUserInfo = {} as IUserInfo;
    }

    let userInfo = lastUserInfo;
    if (site.allowQueryUserInfo) {
      // 调用站点实例获取用户信息
      userInfo = await site.getUserInfoResult(userInfo);
    } else if (site.metadata.type === "private" && !site.isOnline && isEmpty(lastUserInfo)) {
      // 如果 private 站点不允许查询用户信息（），则尝试从 userInfo 中获取最近一次的用户信息（回退），以避免 metadata.lastUserInfo 为 undefined 的情况
      const userInfoSite = await readSiteArchive(siteId);

      let maxDate = null;
      for (const date in userInfoSite) {
        if (
          userInfoSite[date].status === EResultParseStatus.success && // 如果是 PTPP 导入，可能存在 status 为 unknownError 的情况
          (!maxDate || new Date(date) > new Date(maxDate))
        ) {
          maxDate = date;
        }
      }

      if (maxDate) {
        userInfo = userInfoSite[maxDate];
      }
    }

    await setSiteLastUserInfo(userInfo);
    return userInfo!;
  }))!;
}

onMessage("getSiteUserInfoResult", async ({ data: siteId }) => await getSiteUserInfoResult(siteId));

export async function setSiteLastUserInfo(userData: IUserInfo) {
  return setSiteLastUserInfoQueue.add(async () => {
    logger({ msg: `setSiteLastUserInfo for ${userData.site}`, data: userData });
    const site = userData.site;

    // 存储用户信息到 metadata 中（ pinia/webExtPersistence 会自动同步该部分信息 ）
    const metadataStore = ((await extStore.getItem("metadata")) ?? {}) as IMetadataPiniaStorageSchema;
    (metadataStore as IMetadataPiniaStorageSchema).lastUserInfo ??= {};
    (metadataStore as IMetadataPiniaStorageSchema).lastUserInfo[site] = userData;
    await extStore.setItem("metadata", metadataStore);

    // 按天存档（仅当获取成功时）。
    // 迁移前这里是「读整个 userInfo 键 → 改一条 → 写回整块」，刷完 23 个站点就是 23 次
    // 全量读写，且成本随使用年限线性上涨（那份数据每天每站点只增不减）。
    // 现在走 IndexedDB 复合主键 put，O(1)，不碰其他站点。
    if (userData.status === EResultParseStatus.success) {
      await putArchiveEntry(site, format(userData.updateAt, "yyyy-MM-dd"), userData);
    }
  });
}

onMessage("setSiteLastUserInfo", async ({ data: userData }) => await setSiteLastUserInfo(userData));

onMessage("getSiteUserInfo", async ({ data: siteId }) => await readSiteArchive(siteId));

onMessage("removeSiteUserInfo", async ({ data: { siteId, date } }) => await deleteArchiveEntries(siteId, date));
