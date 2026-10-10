/**
 * 后台的「自动辅种」：每 1 分钟醒一次，替人走完那条本来要人守着点按钮的链。
 *
 * 一条任务的四步（判据本身在 `autoReseed.ts` 的 `planAutoReseed`，那份能直接跑 Node 断言）：
 *   1. 基准不在下载器里 → 把基准发过去，**不跳过校验**（它是要下全量的那一条）；
 *   2. 每轮看基准下完没有（认的是下载器报的 isCompleted）；本来就已下完的直接跳到第 3 步；
 *   3. 基准下完 → 把其余那几条发过去，跳过校验（内容在建任务那一步已经比过指纹）；
 *   4. 之后每轮盯这任务的做种状态：判成 wrong 的**立刻暂停**，并弹一次系统通知。
 *
 * 为什么住在后台而不是设置页：他要的是「每隔 1 分钟检测、持续监测」，而设置页一关、
 * 组件一卸载，页面里那个 setTimeout 就没了（现有的「发送后 18 秒自动回查」就是页面级的，
 * 关掉页面即失效）。service worker 里只有 `chrome.alarms` 活得过页面关闭和 SW 重启，
 * 所以每一步的进度都必须落盘在任务上（`autoState`），不能存内存。
 */
import { defineJobScheduler } from "@webext-core/job-scheduler";
import type { CTorrent } from "@ptd/downloader";

import { extStore } from "@/storage.ts";
import { onMessage, sendMessage } from "@/messages.ts";
import type { IKeepUploadTask, IKeepUploadTaskItem, IMetadataPiniaStorageSchema } from "@/shared/types.ts";

import {
  buildReseedAddTorrentOptions,
  othersAlreadySent,
  othersStillPending,
  planAutoReseed,
  reseedItemKey,
  sendReseedBatch,
} from "@/options/views/Overview/KeepUploadTask/autoReseed.ts";
import { judgeReseedTorrent, linkItemToTorrent } from "@/options/views/Overview/KeepUploadTask/seedVerify.ts";
import type { IReseedItemStatus } from "@/options/views/Overview/KeepUploadTask/seedVerify.ts";

import { whenOffscreenReady } from "./offscreen.ts";

const JOB_ID = "autoReseed";
const TICK_MS = 60 * 1000;

const jobs = defineJobScheduler();

/** 通知文案：SW 里拿不到 useI18n，按 config.lang 选一份（同 updateCheck.ts 的 notifyText） */
function notifyText(lang: string | undefined, title: string, count: number): { title: string; message: string } {
  return lang === "zh_CN"
    ? { title: "辅种没有成功", message: `「${title}」有 ${count} 条没在做种，已自动暂停，进「辅种任务」看是哪几条` }
    : {
        title: "Reseed not seeding",
        message: `"${title}": ${count} torrent(s) were not seeding and have been paused. Open Reseed tasks to see which.`,
      };
}

/** 站名：后台拿的是 metadata 里那份缓存，缺失时退回站点 id（同 contextMenus.ts 那几处） */
function siteNameOf(metadata: IMetadataPiniaStorageSchema | undefined, siteId: string): string {
  // siteNameMap 的键类型是站点键的联合，拿任意字符串索引要过不了类型检查；这里只当查表用
  const map = metadata?.siteNameMap as Record<string, string> | undefined;
  return map?.[siteId] ?? siteId;
}

/**
 * 发一条种子到下载器。入参形状与设置页那颗手动发送**一字不差**（含 link / url 互换那一处），
 * 差别只在这里没有 snakebar —— 后台没人看着界面，成败都写进日志和任务进度。
 */
async function sendOne(task: IKeepUploadTask, item: IKeepUploadTaskItem, downloader: unknown, siteName: string) {
  const addTorrentOptions = buildReseedAddTorrentOptions({
    task,
    item,
    baseEntry: task.baseLocal ? null : task.items[0] ?? null,
    downloader: downloader as { feature?: { DefaultAutoStart?: boolean } } | undefined,
    siteName,
  });
  const result = await sendMessage("downloadTorrent", {
    torrent: {
      site: item.site,
      // 与设置页那颗手动发送一样：yemapt / mteam 那 7 个站的下载链接是拿这个 id 换的，
      // 少了它站点只回 `{success:false}`，日志里就是一句看不出原因的 "API request failed"
      id: item.id,
      title: item.title,
      subTitle: item.subTitle,
      // item.link 是详情页、item.url 是种子下载链接；这里键名按 downloadTorrent 那侧的叫法摆，
      // 所以看着像反的 —— 与设置页 sendTorrentsToDownloader 同一份写法，别"顺手改对"。
      link: item.url,
      url: item.link,
      size: item.size,
    },
    downloaderId: task.downloadOptions.downloaderId,
    addTorrentOptions,
  });
  if (result?.downloadStatus === "failed") throw new Error(result.errorMessage || item.title);
}

/**
 * 基准那条到底拿哪个 infoHash 去查。
 *
 * 老任务（v0.59.2 之前建的）没记下 infoHash，而基准认不出 hash 就判不出它在不在下载器里，
 * 整条状态机会永远卡在第一步 —— 所以这里给它按标题（其次按大小）去列表里找**唯一**匹配。
 *
 * 只给基准做这件事，而且**不写回任务**：认亲要求唯一匹配，每分钟重算出来的是同一个结果，
 * 不必存；而写回整条任务会把用户在这一分钟里改的东西（那颗「自动辅种」开关、换基准、改保存路径）
 * 一起盖回旧值。其余没记 hash 的那几条照旧当「没认出」—— 发送本来就不需要 hash，只是盯不到它的状态，
 * 界面上那行「另有 N 条没认出」会把这件事说清楚；用户点一次「回查」就补上了（那条路在页面里，写回是安全的）。
 */
function resolveBaseHash(task: IKeepUploadTask, torrents: readonly CTorrent[] | undefined): string {
  if (task.baseLocal) return String(task.baseLocal.hash).toLowerCase();
  const own = String(task.items[0]?.hash ?? "").trim();
  if (own) return own.toLowerCase();
  const base = task.items[0];
  if (!base || !torrents) return "";
  const outcome = linkItemToTorrent({ title: base.title, size: base.size }, torrents);
  return outcome.kind === "linked" ? outcome.infoHash.toLowerCase() : "";
}

/** 除了「上次跑的时刻」以外有没有真变化 —— 没变化就不碰 chrome.storage */
function worthWriting(task: IKeepUploadTask, next: IKeepUploadTask["autoState"]): boolean {
  const a = (task.autoState ?? {}) as Record<string, unknown>;
  const b = (next ?? {}) as Record<string, unknown>;
  for (const k of ["baseSentAt", "baseSendFails", "othersSentAt", "othersSent", "completedAt", "stage", "notifiedWrong"]) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return true;
  }
  return false;
}

/**
 * 把这一轮对账查到的结论写回任务的 `verify`（界面上「做种状态」那一列读它）。
 *
 * 连不上下载器时**整块不动**，沿用原先那份「没查到就别覆盖旧结论」的口径；
 * 另外结论没变也不写、不刷新 `at` —— `at` 的语义是「上一次真的看到状态是什么时候」，
 * 每分钟无脑盖一次的话，界面上那句「查于 1 分钟前」就成了假话。
 */
async function persistVerify(
  task: IKeepUploadTask,
  statuses: Record<string, IReseedItemStatus>,
  reachable: boolean,
): Promise<void> {
  if (!reachable) return;
  const prev = task.verify;
  if (prev && JSON.stringify(prev.statuses) === JSON.stringify(statuses)) return;
  const verify = { statuses, at: Date.now() };
  task.verify = verify;
  await sendMessage("patchKeepUploadTaskVerify", { taskId: task.id, verify });
}

async function autoReseedTick() {
  await whenOffscreenReady();

  const all = (await sendMessage("getKeepUploadTasks", undefined)) as IKeepUploadTask[] | undefined;
  /**
   * **对账**吃全部任务，**动手**只吃开了自动辅种的那些（下面 `task.autoReseed !== true` 就 continue）。
   * 原先这一行是 `filter((task) => task.autoReseed === true)`，于是关着开关的任务后台一眼都不看 ——
   * 他 2026-10-10 那句「应该自动去检查啊，非得用户手动去刷新吗」说的就是这个。
   */
  const tasks = all ?? [];
  if (tasks.length === 0) return;

  const metadata = (await extStore.getItem("metadata")) as IMetadataPiniaStorageSchema | undefined;
  const config = await extStore.getItem("config");

  // 同一台下载器只拉一次列表，多个任务共用那份（qBittorrent 那边 15 秒才刷一次，多拉没意义）
  const byDownloader = new Map<string, IKeepUploadTask[]>();
  for (const task of tasks) {
    const group = byDownloader.get(task.downloadOptions.downloaderId) ?? [];
    group.push(task);
    byDownloader.set(task.downloadOptions.downloaderId, group);
  }

  for (const [downloaderId, group] of byDownloader) {
    let torrents: CTorrent[] | undefined;
    try {
      torrents = await sendMessage("getClientTorrents", downloaderId);
    } catch {
      // 连不上：这一轮这一台名下的任务整批跳过，但**不许**把「没查到」写成「不在下载器里」
      torrents = undefined;
    }
    const reachable = !!torrents;
    const index = new Map((torrents ?? []).map((t) => [String(t.infoHash).toLowerCase(), t]));

    for (const task of group) {
      // 一条任务的任何意外都不许终止整轮：这一层以前没有隔离罩，`resolveBaseHash` /
      // `planAutoReseed` / 最后那次写回只要抛一下，后面所有下载器组、所有任务这一分钟就都不再推进
      // （他这次问的「别的怎么也受影响」，一半是下面那个逐条发送的挡，另一半就是这里）。
      try {
        const baseHash = resolveBaseHash(task, torrents);
        const probe = (hash?: string): IReseedItemStatus | undefined => {
          const key = String(hash ?? "").toLowerCase();
          if (!reachable || key === "") return undefined;
          const found = index.get(key);
          return judgeReseedTorrent(
            found
              ? { state: found.state, rawState: found.raw?.state, progress: found.progress, isCompleted: found.isCompleted }
              : undefined,
            { isBase: key === baseHash },
          );
        };

        /**
         * 先把这一轮看到的结论按 hash 存进任务的 `verify`，再谈要不要动手。
         * 顺序要紧：界面上那一列吃的是 `verify`，而下面那些动作可能整段跳过（没开自动辅种），
         * 放在后面就永远不会写。
         */
        const statuses: Record<string, IReseedItemStatus> = {};
        if (reachable) {
          for (const item of task.items) {
            const key = String(item.hash ?? "").toLowerCase();
            const status = probe(item.hash);
            if (key !== "" && status) statuses[key] = status;
          }
        }
        await persistVerify(task, statuses, reachable);

        // 没开自动辅种的到这儿就结束：**只看不动手** —— 不发种子、不暂停、不弹通知。
        // 「查」和「动他的种子」是两件事，用户关的是后者，不是前者。
        if (task.autoReseed !== true) continue;

        const base = probe(baseHash);
        /** 除基准外的全部条目（`baseLocal` 那种任务里就是整份 items） */
        const allOthers = task.baseLocal ? task.items : task.items.slice(1);
        const others = allOthers.map((item) => probe(item.hash));
        const untracked = allOthers.filter((i) => String(i.hash ?? "").trim() === "").length;
        /** 其中还没成功发出去的那几条（逐条记，不再拿「整批发过一次」当闸） */
        const othersToSend = othersStillPending(task.autoState ?? {}, allOthers);

        const tick = planAutoReseed({
          baseLocal: !!task.baseLocal,
          otherCount: allOthers.length,
          othersPending: othersToSend.length,
          reachable,
          base,
          others,
          untracked,
          state: task.autoState ?? {},
          now: Date.now(),
        });

        const next = { ...tick.next };

        const downloader = metadata?.downloaders?.[downloaderId];
        let acted = false;

        if (tick.sendBase) {
          try {
            await sendOne(task, task.items[0], downloader, siteNameOf(metadata, task.items[0].site));
            next.baseSentAt = Date.now();
            void sendMessage("logger", { msg: `Auto-reseed: base torrent sent for [${task.title}]` });
          } catch (e) {
            next.baseSendFails = (next.baseSendFails ?? 0) + 1;
            void sendMessage("logger", {
              msg: `Auto-reseed: sending base failed for [${task.title}] (${e instanceof Error ? e.message : e})`,
            });
          }
          acted = true;
        }

        if (tick.sendOthers && !tick.sendBase) {
          const at = Date.now();
          const sent: Record<string, number> = { ...othersAlreadySent(task.autoState ?? {}, allOthers) };
          const { sentKeys, failed } = await sendReseedBatch({
            items: othersToSend,
            keyOf: reseedItemKey,
            // 日志要点名是**哪一颗**坏的。原先只报任务标题（=基准那一条），于是日志读起来像
            // 「这一整个任务失败」，看不出是同批里某一站的接口挂了。
            titleOf: (item) => `${siteNameOf(metadata, item.site)} / ${item.title}`,
            send: async (item) => {
              await sendOne(task, item, downloader, siteNameOf(metadata, item.site));
            },
            onFailure: (f) => {
              void sendMessage("logger", {
                msg: `Auto-reseed: reseed torrent failed for [${task.title}] → ${f.title} (${f.message})`,
              });
            },
          });
          for (const key of sentKeys) sent[key] = at;
          next.othersSent = sent;
          // 一条不剩才写这个老标记（它现在的含义就是「整批都发出去了」；旧任务那份逐条记录
          // 也由它回填，见 `othersAlreadySent`）
          if (allOthers.every((item) => sent[reseedItemKey(item)] !== undefined)) next.othersSentAt = at;
          if (sentKeys.length > 0) {
            void sendMessage("logger", {
              msg:
                `Auto-reseed: ${sentKeys.length} reseed torrent(s) sent for [${task.title}]` +
                (failed.length > 0 ? `（另有 ${failed.length} 条失败，下一轮只重试这几条）` : ""),
            });
          }
          acted = true;
        }

        // 要暂停的那几条：基准 + 其余里判成 wrong 的那些。id 用下载器列表里那一条的 id
        // （qBittorrent 的 pause 认的是它的 gid/hash 组合键，不是任务里的字段）
        // ⚠️ 下标吃的是 `allOthers`（= `tick.pauseIndexes` 的那份输入），不是筛过一遍的 `othersToSend`
        const pauseTargets = [
          ...(tick.pauseBase ? [{ label: task.items[0]?.title ?? "base", id: index.get(baseHash)?.id }] : []),
          ...tick.pauseIndexes.map((i) => ({
            label: allOthers[i]?.title ?? "?",
            id: index.get(String(allOthers[i]?.hash ?? "").toLowerCase())?.id,
          })),
        ];
        let paused = 0;
        for (const one of pauseTargets) {
          if (!one.id) continue;
          try {
            if (await sendMessage("pauseClientTorrent", { downloaderId, id: one.id })) paused++;
          } catch {
            // 暂停失败只记日志：下一轮还会看到它 wrong，还会再试一次
            void sendMessage("logger", { msg: `Auto-reseed: pause failed for [${task.title}] ${one.label}` });
          }
        }
        if (paused > 0) acted = true;

        if (tick.notify) {
          const count = tick.pauseIndexes.length + (tick.pauseBase ? 1 : 0);
          const { title, message } = notifyText(config?.lang, task.title, count);
          // 一条任务只挂一条通知：同一个 id 再 create 是替换，不会堆一屏
          chrome.notifications?.create(`auto-reseed-${task.id}`, {
            type: "basic",
            iconUrl: chrome.runtime.getURL("icon/128.png"),
            title,
            message,
          });
          void sendMessage("logger", { msg: `Auto-reseed: ${count} torrent(s) not seeding for [${task.title}], paused` });
        }

        if (acted || worthWriting(task, next)) {
          // 只 patch `autoState` 这一块，不写整条任务 —— 理由见 `resolveBaseHash` 那段
          task.autoState = next;
          await sendMessage("patchKeepUploadTaskAutoState", { taskId: task.id, autoState: next });
        }
      } catch (e) {
        void sendMessage("logger", {
          msg: `Auto-reseed: task [${task.title}] 这一轮没走完 (${e instanceof Error ? e.message : e})`,
        });
      }
    }
  }
}

/**
 * 跑一轮，且**一轮没跑完不起第二轮**：定时器那一轮和用户催的这一轮会撞在一起
 * （两边都去拉下载器列表、都往同一批任务上写进度）。
 *
 * 正在跑时不是「丢掉这次」而是记下来补跑一轮 —— 刚建好的任务很可能正是在那一轮取完任务列表
 * 之后才落盘的，不补跑就还是「等下一分钟」。
 */
let running: Promise<void> | null = null;
let again = false;

function runAutoReseedTick(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  // `running = null` 写在函数体末尾而不是 `.finally()`：那样它在这轮真正结束前就已生效，
  // 不会有人拿着一个已经 settle 的 promise 以为「排上了」
  const job = (async () => {
    try {
      do {
        again = false;
        try {
          await autoReseedTick();
        } catch (e) {
          // 一轮失败不影响补跑，也不让定时器就此哑掉（下一分钟照常再来）
          void sendMessage("logger", { msg: `Auto-reseed: tick failed (${e instanceof Error ? e.message : e})` });
        }
      } while (again);
    } finally {
      running = null;
    }
  })();
  running = job;
  return job;
}

// 建完任务那一侧催的（判据仍只有 `autoReseedTick` 这一份，这里只是把触发时刻提前）
onMessage("runAutoReseedTick", () => {
  void runAutoReseedTick();
});

// noinspection JSIgnoredPromiseFromCall
jobs.scheduleJob({
  id: JOB_ID,
  type: "interval",
  duration: TICK_MS,
  immediate: true,
  execute: () => runAutoReseedTick(),
});
