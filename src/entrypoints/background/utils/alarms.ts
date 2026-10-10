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

    const intervalMs = interval * 60 * 60 * 1000; // interval 的单位是小时（设置页标签也这么写）
    const curDate = new Date();
    const curDateFormat = format(curDate, "yyyy-MM-dd");
    let metadataStore: IMetadataPiniaStorageSchema;

    // 自动刷新只有这一条全局闸：每日时段（在 afterTime 之前不干活）。重试轮不受它管。
    if (retryIndex === 0) {
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
    }

    // 这里原先还有一条**全局**间隔闸：拿 `lastUserInfoAutoFlushAt`（上一轮任务开跑的时刻）
    // 加上间隔，没到就把整轮 return 掉。它和下面那条「按站点自己的 updateAt 判到期」不是一回事，
    // 于是要坏：
    //  ① 一轮哪怕只刷了 3 个站，也把整闸推到 6 小时之后 —— 另外那些已经超时的站被这一轮"代表"了，
    //     最坏要等接近两倍间隔才轮到；
    //  ② 一个站都没刷的那轮同样会把整闸推进（写在轮尾，不看刷没刷成），
    //     于是刚超时一分钟的站又要等满一个间隔。
    // 用户 2026-10-08 撞上的就是这条：设定 6 小时，「我的数据」里有站已经 7 时 44 分没刷，
    // 而日志在 16:37 报 "refresh interval not reached"。
    // 现在间隔只对**每个站点自己**生效（下面那条判据），整轮不再有闸；「跨天必刷一次」的保证
    // 也不丢 —— 换天之后当天没有记录，`!todayRecord` 那一支本来就会刷。

    /**
     * 先只读各站自己的存档挑出「到期」的站点（这一段不联网），一个都没有就静默结束这一轮。
     *
     * 判"这个站点要不要刷"看的是**当天那条记录自己的 updateAt**，不是"今天有没有记录"。
     * 上游 PT-depiler 那份判的是后者，本仓库 v0.12.2（8d837d8） alarms.ts 入库时照抄，
     * 于是「刷新间隔（小时）」设 1 和设 24 没有任何区别：每天第一次刷完之后，后面每一轮
     * 都是 0 个站点被处理 —— 表现就是日志里任务一直在跑、我的数据里的时间却停在早上。
     * 失败重试走的是同一条闸，且不受影响：存档只在 status=success 时写（offscreen
     * /utils/userInfo.ts），所以失败的站点当天没有记录、照旧会重试，刚刷成功的记录还新、不会被重刷。
     */
    const dueSites: TSiteID[] = [];
    metadataStore = (await extStore.getItem("metadata"))!; // 遍历 metadataStore 中添加的站点
    for (const [siteId, siteConfig] of Object.entries(metadataStore.sites)) {
      if (siteConfig.isOffline || !siteConfig.allowQueryUserInfo) continue;
      try {
        const thisSiteUserInfo = (await sendMessage("getSiteUserInfo", siteId as TSiteID)) ?? {};
        const todayRecord = thisSiteUserInfo[curDateFormat];
        if (!todayRecord || curDate.getTime() - (todayRecord.updateAt ?? 0) >= intervalMs) {
          dueSites.push(siteId as TSiteID);
        }
      } catch (e) {
        // 连自己的存档都读不出来：交给下面那一趟去刷（原先这种站点是直接记进失败列表）
        dueSites.push(siteId as TSiteID);
      }
    }

    if (dueSites.length === 0) {
      // 没站到期就整轮静默返回：既不刷、也不写 lastUserInfoAutoFlushAt、也不排重试。
      return;
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
    for (const siteId of dueSites) {
      try {
        const userInfoResult = await sendMessage("getSiteUserInfoResult", siteId);
        if (userInfoResult.status !== EResultParseStatus.success) {
          failFlushSites.push(siteId);
        }
        processedSiteCount += 1;
      } catch (e) {
        failFlushSites.push(siteId);
      }
    }

    void sendMessage("logger", {
      msg: `Auto-refreshing user information finished, ${processedSiteCount} sites processed, ${failFlushSites.length} failed.`,
      data: { failFlushSites },
    });

    // 将刷新时间存入 metadataStore：走到这里说明这一轮真的刷过站点
    // （这个字段的名字就是"上次刷新时间"，所以没刷的那轮不能推进它 —— 上面已经提前 return 了）
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
  // 把下载历史标成 failed：写的是 IndexedDB，经 offscreen 代写。
  // 这里必须 catch —— 裸发的 sendMessage 在 offscreen 未就绪时会 reject，
  // 而它已经在.catch 回调里，再抛就成了 SW 的 unhandled rejection。
  // ⚠️  handler 不能省：实测 `p.catch()`（不传参）等价于 then(undefined, undefined)，
  // 派生出来的那个 promise 照样带着同一个 rejection 没人管，等于没接。
  const markFailed = () => {
    if (data.downloadId === undefined) return;
    void sendMessage("setDownloadHistoryStatus", {
      downloadId: data.downloadId,
      status: "failed",
    }).catch(() => {});
  };

  // 如果需要等待的时间小于 30s，那么直接在 service worker 中等待
  if ((data.leftInterval ?? 0) < 30 * 1000) {
    await sleep(data.leftInterval ?? 0);
    doReDownloadTorrent(data)().catch(markFailed);
  } else {
    jobs
      .scheduleJob({
        id: EJobType.ReDownloadTorrent + "-" + data.downloadId,
        type: "once",
        date: Date.now() + 1000 * 30, // 0.5 minute later
        execute: doReDownloadTorrent(data),
      })
      .catch(markFailed);
  }
});
