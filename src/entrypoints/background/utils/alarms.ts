/**
 * 后台定时任务（平移自 PT-depiler background/utils/alarms.ts）。
 * - 自动刷新用户站点数据（支持每日时段、间隔与失败重试）
 * - 备份服务器按 backupInterval 自动备份
 * - 下载冷却结束后的种子重新推送：等多久、走哪条路压在哪一层，判据在 @/shared/reDownloadWait.ts；
 *   长等待按「到点时刻」排一次闹钟，并把这条等待写进 pendingReDownload 存档，
 *   由本文件末尾的 recoverPendingReDownload 在每次 SW 启动时认领回来
 *   （改造前那是「每 30 秒醒一轮」的轮询，且没有存档 —— 成因见那个函数的注释）。
 */
import { format } from "date-fns";
import { defineJobScheduler } from "@webext-core/job-scheduler";

import { gatedLogger } from "@/shared/consoleLog.ts";
import { EResultParseStatus, type TSiteID } from "@ptd/site/types/base.ts";

import { extStore } from "@/storage.ts";
import { onMessage, sendMessage } from "@/messages.ts";
import { planReDownload, splitPendingReDownload } from "@/shared/reDownloadWait.ts";
import type {
  IDownloadTorrentOption,
  IMetadataPiniaStorageSchema,
  IPendingReDownload,
  TTorrentDownloadKey,
} from "@/shared/types.ts";

import { whenOffscreenReady } from "./offscreen.ts";
import { sleep } from "~/helper.ts";

export enum EJobType {
  FlushUserInfo = "flushUserInfo",
  ReDownloadTorrent = "reDownloadTorrent",
  AutoBackup = "autoBackup",
}

const jobs = defineJobScheduler({ logger: gatedLogger });

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

    // 自动刷新只有这一条全局闸：每日时段（在 afterTime 之前不干活）。重试轮不受它管。
    if (retryIndex === 0) {
      const [afterHour, afterMinute] = afterTime.split(":").map((v) => parseInt(v));
      if (
        curDate.getHours() < afterHour ||
        (curDate.getHours() === afterHour && curDate.getMinutes() < afterMinute)
      ) {
        void sendMessage("logger", {
          msg: `自动刷新用户信息本轮跳过：当前时间还没到设定的刷新时间点`,
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
    // ⚠️ 不能用 `!`：空库（还没装过站点）时 getItem 返回 null，这里直接 TypeError，
    // 于是这个 job 每轮都在同一处崩、lastUserInfoAutoFlushAt 永远推不进去。
    // 没有可刷的站点就正常收尾（对齐下面 autoBackup 的守卫写法）。
    const metadataStore = ((await extStore.getItem("metadata")) ?? {}) as IMetadataPiniaStorageSchema;
    for (const [siteId, siteConfig] of Object.entries(metadataStore.sites ?? {})) {
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
      msg: `于 ${curDateFormat} 自动刷新用户信息${retryIndex > 0 ? `（第 ${retryIndex} 次重试）` : ""}`,
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
      msg: `自动刷新用户信息结束：处理 ${processedSiteCount} 个站点，失败 ${failFlushSites.length} 个`,
      data: { failFlushSites },
    });

    // 将刷新时间存入 metadataStore：走到这里说明这一轮真的刷过站点
    // （这个字段的名字就是"上次刷新时间"，所以没刷的那轮不能推进它 —— 上面已经提前 return 了）
    // ⚠️ 按路径写而不是「读整块 → 改一个字段 → 写回整块」：metadata 同时被 offscreen
    // （lastUserInfo / lastBackupAt）读写，而 writeQueues 只在单上下文内互斥，
    // 两个 10 分钟 immediate job 的时间窗一重叠就会互相丢字段。
    await extStore.patchItem("metadata", "lastUserInfoAutoFlushAt", new Date().getTime()); // 刷新时间应该是实际完成时间

    // 如果本次有失败的刷新操作，则设置重试
    if (failFlushSites.length > 0 && retryIndex < retryMax) {
      void sendMessage("logger", {
        msg: `${retryInterval} 分钟后重试这 ${failFlushSites.length} 个失败的站点（第 ${retryIndex + 1} 次重试）`,
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
          msg: `已触发自动备份：服务器 [${serverConfig.name}]（间隔 ${serverConfig.backupInterval} 小时）`,
        });

        try {
          const backupFields = serverConfig.backupFields ?? [];
          const ok = await sendMessage("exportBackupData", {
            backupServerId: serverId,
            backupFields,
          });

          if (!ok) {
            void sendMessage("logger", {
              msg: `自动备份失败：服务器 [${serverConfig.name}]（返回 false）`,
            });
          }
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          void sendMessage("logger", {
            msg: `自动备份失败：服务器 [${serverConfig.name}]：${errMsg}`,
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

/**
 * 等待中的重推任务在存档里的键。
 *
 * 正常来路（offscreen/utils/download.ts 那句 sendMessage）在发这条消息之前已经把下载历史写好了，
 * 所以 downloadId 必有；那个 `?? "unknown"` 只是兜住「协议里这一项是可选的」这一形，
 * 不让它在 String(undefined) 之外留下一个看不出是谁的键。
 */
function pendingKeyOf(downloadId: TTorrentDownloadKey | undefined): string {
  return String(downloadId ?? "unknown");
}

function reDownloadJobId(downloadId: TTorrentDownloadKey | undefined): string {
  return `${EJobType.ReDownloadTorrent}-${pendingKeyOf(downloadId)}`;
}

/**
 * 记下一条正在等冷却的任务。
 *
 * 用整键读-改-写而不是 `patchItem`：`patchItem` 读到 null 时直接 return（键从没写过的时候
 * 它建不出外层那个对象），而这条键恰恰是「第一次要等就得先建」。
 * 写者只有 SW 这一个上下文，且每一跳的写都排在上一跳之后，所以本上下文这条写队列够用。
 */
async function rememberPendingReDownload(entry: IPendingReDownload): Promise<void> {
  const store = { ...(await extStore.getItem("pendingReDownload")) };
  store[pendingKeyOf(entry.downloadOption.downloadId)] = entry;
  await extStore.setItem("pendingReDownload", store);
}

/** 批量销账：一次读-改-写把这几条都去掉，同一次唤醒里逐条销会互相盖回去 */
async function forgetPendingReDownloads(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const store = { ...(await extStore.getItem("pendingReDownload")) };
  let touched = false;
  for (const key of keys) {
    if (key in store) {
      delete store[key];
      touched = true;
    }
  }
  if (!touched) return; // 没账可销就不白写一次存储
  await extStore.setItem("pendingReDownload", store);
}

/**
 * 把下载历史标成 failed（写的是 IndexedDB，经 offscreen 代写）。
 * 这里必须 catch —— 裸发的 sendMessage 在 offscreen 未就绪时会 reject，而它已经在 catch 分支里，
 * 再抛就成了 SW 的 unhandled rejection。
 * ⚠️ handler 不能省：实测 `p.catch()`（不传参）等价于 then(undefined, undefined)，
 * 派生出来的那个 promise 照样带着同一个 rejection 没人管，等于没接。
 */
function markDownloadHistoryFailed(downloadId: TTorrentDownloadKey | undefined): void {
  if (downloadId === undefined) return;
  void sendMessage("setDownloadHistoryStatus", { downloadId, status: "failed" }).catch(() => {});
}

/**
 * 到点重推这一条。整条链上「无声什么都不发生」的失败点都收在这里，所以兜到底：
 * 重推抛错就把下载历史标成 failed，至少界面上看得见这一条没成。
 */
async function fireReDownload(downloadOption: IDownloadTorrentOption): Promise<void> {
  try {
    await forgetPendingReDownloads([pendingKeyOf(downloadOption.downloadId)]);
  } catch {
    // 销账失败不挡重推：下一次唤醒会把它当「已过期」再补跑一次
  }
  try {
    await whenOffscreenReady();
    // 按照相同的方式重新下载种子到下载器
    await sendMessage("downloadTorrent", downloadOption);
  } catch {
    markDownloadHistoryFailed(downloadOption.downloadId);
  }
}

onMessage("reDownloadTorrent", async ({ data }) => {
  const { retryAt, via } = planReDownload(data.leftInterval, Date.now());

  // 先落存档，再排等待：这条等待必须经得起「等待中途 SW 被终止」（末尾那个函数解释为什么）
  await rememberPendingReDownload({ downloadOption: data, retryAt });

  if (via === "sleep") {
    // 短等待就地睡完：这条消息的通道一直挂着，SW 在这一段里不会被判空闲终止
    await sleep(retryAt - Date.now());
    void fireReDownload(data);
    return;
  }

  try {
    await jobs.scheduleJob({
      id: reDownloadJobId(data.downloadId),
      type: "once",
      date: retryAt, // 冷却到点的那一刻，不是「半小时后再看一眼」
      execute: () => fireReDownload(data),
    });
  } catch {
    // 闹钟排不上（alarms 权限没了这类）：干等没有意义，明说这一条失败了
    try {
      await forgetPendingReDownloads([pendingKeyOf(data.downloadId)]);
    } catch {
      // 连账也销不掉时只能留给下一次唤醒处理，这里不再往下抛
    }
    markDownloadHistoryFailed(data.downloadId);
  }
});

/**
 * SW 每次启动都要从存档里把等待中的重推任务认领回来。
 *
 * 为什么必须有这一步（改造前那条链就断在这里）：`@webext-core/job-scheduler` 的 `once` 任务
 * 在 chrome.alarms 那边只留下一个闹钟，**execute 回调存在它自己那张内存表里**，`onAlarm` 是
 * 拿闹钟名字去那张表查的；而 MV3 的 SW 空闲 30 秒就被终止，站点冷却通常是 15~30 分钟，
 * 等闹钟到点把 SW 唤醒时那张表是刚建好的空表 —— 查不到回调就什么也不做，`once` 闹钟烧掉
 * 就不再回来。于是「等冷却后重推」几乎必然静默失效，下载历史永远停在「等待中」。
 *
 * 已过期那一拨当场补跑，而不是重新排闹钟：错过的那个点不会再有第二次闹钟替它兑现。
 */
async function recoverPendingReDownload(): Promise<void> {
  try {
    const store = await extStore.getItem("pendingReDownload");
    const { due, waiting } = splitPendingReDownload(store, Date.now());
    await forgetPendingReDownloads(due.map((entry) => pendingKeyOf(entry.downloadOption.downloadId)));
    for (const entry of due) void fireReDownload(entry.downloadOption);
    for (const entry of waiting) {
      await jobs.scheduleJob({
        id: reDownloadJobId(entry.downloadOption.downloadId),
        type: "once",
        date: entry.retryAt,
        execute: () => fireReDownload(entry.downloadOption),
      });
    }
  } catch {
    // 认领失败不该拖垮 SW 启动：这份读不到，下一次唤醒还会再来一遍
  }
}

// 挂在模块级而不是 chrome.runtime.onStartup：那个事件只在浏览器启动时发，
// 而这里的「认领」是每次 SW 被唤醒都要做一遍的事（上面两个 job 的注册也在同一层）。
void recoverPendingReDownload();
