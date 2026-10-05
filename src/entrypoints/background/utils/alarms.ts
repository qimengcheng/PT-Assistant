/**
 * 后台定时任务（平移自 PT-depiler background/utils/alarms.ts）。
 * - 自动刷新用户站点数据（支持每日时段、间隔与失败重试）
 * - 备份服务器按 backupInterval 自动备份
 * - 下载冷却结束后的种子重新推送（短等待直接 sleep；长等待排一个 now+30s 的一次性任务，
 *   到点重下后由 offscreen/utils/download.ts 重算剩余间隔，不够就再排 30s —— 实为 30s 一轮轮询）
 */
import { format } from "date-fns";
import { defineJobScheduler } from "@webext-core/job-scheduler";
import { EResultParseStatus, type TSiteID } from "@ptd/site/types/base.ts";

import { extStore } from "@/storage.ts";
import { onMessage, sendMessage } from "@/messages.ts";
import type { IDownloadTorrentOption, IMetadataPiniaStorageSchema } from "@/shared/types.ts";

import { whenOffscreenReady } from "./offscreen.ts";
import { sleep } from "~/helper.ts";

export enum EJobType {
  FlushUserInfo = "flushUserInfo",
  ReDownloadTorrent = "reDownloadTorrent",
  AutoBackup = "autoBackup",
}

const jobs = defineJobScheduler();

function autoFlushUserInfo(retryIndex: number = 0) {
  return async () => {
    await whenOffscreenReady();

    const configStore = (await extStore.getItem("config"))!;

    // 获取自动刷新参数
    const {
      enabled = false,
      interval = 1,
      afterTime = "00:00",
      retry: { max: retryMax = 0, interval: retryInterval = 5 } = {},
    } = configStore?.userInfo?.autoReflush ?? {};

    // 如果未启用自动刷新，则直接返回
    if (!enabled) {
      return;
    }

    const curDate = new Date();
    const curDateFormat = format(curDate, "yyyy-MM-dd");
    let metadataStore = (await extStore.getItem("metadata"))!;

    // 如果不是重试，则要检查是否满足刷新条件
    if (retryIndex === 0) {
      // 检查当前时间是否在允许的刷新时间之后
      const [afterHour, afterMinute] = afterTime.split(":").map((v) => parseInt(v));
      if (
        curDate.getHours() < afterHour ||
        (curDate.getHours() === afterHour && curDate.getMinutes() < afterMinute)
      ) {
        void sendMessage("logger", {
          msg: `Auto-refreshing user information paused since current time is before the allowed refresh time.`,
        });
        return;
      }

      metadataStore = (await extStore.getItem("metadata"))!;
      // 首次安装 / 从未刷新过时 lastUserInfoAutoFlushAt 是 undefined，
      // date-fns 的 format(undefined) 会抛 RangeError —— 整个自动刷新会静默失效（日志里都看不到）。
      // 这里归一成 0（1970），既不会抛错，又天然满足「跨天必刷一次」的判定。
      const lastFlushAt = metadataStore.lastUserInfoAutoFlushAt ?? 0;
      const lastFlushDateFormat = format(new Date(lastFlushAt), "yyyy-MM-dd");

      // 如果不是同一天，则不检查距离上次刷新时间是否超过了设定的间隔，这样能保证至少每天刷新一次（即启动浏览器后第一次检查）
      if (curDateFormat === lastFlushDateFormat) {
        const nextFlushTime = lastFlushAt + interval * 60 * 60 * 1000; // interval in hours
        // 确保距离上次刷新时间已经超过了设定的间隔
        if (curDate.getTime() < nextFlushTime) {
          void sendMessage("logger", {
            msg: `Auto-refreshing user information paused since refresh interval not reached.`,
          });
          return;
        }
      }
    }

    void sendMessage("logger", {
      msg: `Auto-refreshing user information at ${curDateFormat}${retryIndex > 0 ? `(Retry #${retryIndex})` : ""}`,
    });

    let processedSiteCount = 0;
    const failFlushSites: TSiteID[] = [];

    /**
     * 由于是后台任务，所以我们不使用 promise 来并行处理，以确保 flushQueue 中永远只有一个任务在运行，
     * 防止用户设置的并发数过大而被浏览器block
     */
    metadataStore = (await extStore.getItem("metadata"))!; // 遍历 metadataStore 中添加的站点
    for (const [siteId, siteConfig] of Object.entries(metadataStore.sites)) {
      if (!siteConfig.isOffline && siteConfig.allowQueryUserInfo) {
        try {
          // 检查当天的记录是否存在
          const thisSiteUserInfo = (await sendMessage("getSiteUserInfo", siteId as TSiteID)) ?? {};
          if (typeof thisSiteUserInfo[curDateFormat] === "undefined") {
            const userInfoResult = await sendMessage("getSiteUserInfoResult", siteId as TSiteID);
            if (userInfoResult.status !== EResultParseStatus.success) {
              failFlushSites.push(siteId as TSiteID);
            }
            processedSiteCount += 1;
          }
        } catch (e) {
          failFlushSites.push(siteId as TSiteID);
        }
      }
    }

    void sendMessage("logger", {
      msg: `Auto-refreshing user information finished, ${processedSiteCount} sites processed, ${failFlushSites.length} failed.`,
      data: { failFlushSites },
    });

    // 将刷新时间存入 metadataStore
    metadataStore = (await extStore.getItem("metadata"))!;
    metadataStore.lastUserInfoAutoFlushAt = new Date().getTime(); // 刷新时间应该是实际完成时间
    await extStore.setItem("metadata", metadataStore);

    // 如果本次有失败的刷新操作，则设置重试
    if (failFlushSites.length > 0 && retryIndex < retryMax) {
      void sendMessage("logger", {
        msg: `Retrying auto-refresh for ${failFlushSites.length} failed sites in ${retryInterval} minutes (Retry #${retryIndex + 1})`,
      });
      await jobs.scheduleJob({
        id: EJobType.FlushUserInfo + "-Retry-" + retryIndex,
        type: "once",
        date: +curDate + retryInterval * 60 * 1000, // retryInterval in minutes
        execute: autoFlushUserInfo(retryIndex + 1),
      });
    }
  };
}

// noinspection JSIgnoredPromiseFromCall
jobs.scheduleJob({
  id: EJobType.FlushUserInfo,
  type: "interval",
  duration: 1000 * 60 * 10, // check every 10 minutes
  immediate: true,
  execute: autoFlushUserInfo(),
});

/**
 * 自动备份：检查所有已启用且设置了备份间隔的备份服务器，在满足条件时触发备份
 */
function autoBackup() {
  return async () => {
    await whenOffscreenReady();

    const metadataStore = (await extStore.getItem("metadata")) as IMetadataPiniaStorageSchema | undefined;
    if (!metadataStore?.backupServers) {
      return;
    }

    const now = Date.now();

    for (const [serverId, serverConfig] of Object.entries(metadataStore.backupServers)) {
      // 仅处理已启用且有备份间隔的服务器
      if (!serverConfig.enabled || !serverConfig.backupInterval || serverConfig.backupInterval <= 0) {
        continue;
      }

      const intervalMs = serverConfig.backupInterval * 60 * 60 * 1000;
      const lastBackup = serverConfig.lastBackupAt ?? 0;

      if (now - lastBackup >= intervalMs) {
        void sendMessage("logger", {
          msg: `Auto-backup triggered for [${serverConfig.name}] (interval: ${serverConfig.backupInterval}h)`,
        });

        try {
          const backupFields = serverConfig.backupFields ?? [];
          const ok = await sendMessage("exportBackupData", {
            backupServerId: serverId,
            backupFields,
          });

          if (!ok) {
            void sendMessage("logger", {
              msg: `Auto-backup failed for [${serverConfig.name}] (returned false)`,
            });
          }
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          void sendMessage("logger", {
            msg: `Auto-backup failed for [${serverConfig.name}]: ${errMsg}`,
          });
        }
      }
    }
  };
}

// noinspection JSIgnoredPromiseFromCall
jobs.scheduleJob({
  id: EJobType.AutoBackup,
  type: "interval",
  duration: 1000 * 60 * 10, // check every 10 minutes
  immediate: true,
  execute: autoBackup(),
});

function doReDownloadTorrent(downloadOption: IDownloadTorrentOption) {
  return async () => {
    await whenOffscreenReady();
    // 按照相同的方式重新下载种子到下载器
    await sendMessage("downloadTorrent", downloadOption);
  };
}

onMessage("reDownloadTorrent", async ({ data }) => {
  // 如果需要等待的时间小于 30s，那么直接在 service worker 中等待
  if ((data.leftInterval ?? 0) < 30 * 1000) {
    await sleep(data.leftInterval ?? 0);
    doReDownloadTorrent(data)().catch(() => {
      if (data.downloadId !== undefined) {
        void sendMessage("setDownloadHistoryStatus", { downloadId: data.downloadId, status: "failed" });
      }
    });
  } else {
    jobs
      .scheduleJob({
        id: EJobType.ReDownloadTorrent + "-" + data.downloadId,
        type: "once",
        date: Date.now() + 1000 * 30, // 0.5 minute later
        execute: doReDownloadTorrent(data),
      })
      .catch(() => {
        if (data.downloadId !== undefined) {
          void sendMessage("setDownloadHistoryStatus", { downloadId: data.downloadId, status: "failed" });
        }
      });
  }
});
