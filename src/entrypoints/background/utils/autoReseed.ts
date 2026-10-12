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
  pruneUnlandedOthers,
  reseedItemKey,
  sendReseedBatch,
} from "@/options/views/Overview/KeepUploadTask/autoReseed.ts";
import { judgeReseedTorrent, linkItemToTorrent } from "@/options/views/Overview/KeepUploadTask/seedVerify.ts";
import type { IReseedItemStatus } from "@/options/views/Overview/KeepUploadTask/seedVerify.ts";
import { detectBasePathMismatch, isCategorySavePath, type IClientCategory } from "@/shared/reseedPath.ts";
import {
  estimateEtaSec,
  reseedNoticeGroupMessage,
  reseedNoticeTitle,
  type IReseedNoticeGroup,
  type IReseedNoticeItem,
  type TReseedNoticeKind,
} from "@/shared/reseedNotice.ts";
import { isPluginPageVisible, pushReseedNotice } from "@/shared/reseedPresence.ts";

import { whenOffscreenReady } from "./offscreen.ts";

const JOB_ID = "autoReseed";
const TICK_MS = 60 * 1000;

const jobs = defineJobScheduler();

/**
 * 一轮内进展通知的收集器：任务循环里**只登记**，整轮跑完再一次性投递（`flush`）。
 *
 * 为什么不当场就发：一轮会翻好几条任务，同一类事件于是可能连着发好几条 —— 他 2026-10-11 的截图
 * 里就是四条「辅种完成」并排堆着。那四条说的是同一件事（这一轮有四条任务走完了），逐条弹等于把
 * 「一轮」当成「N 轮」读。所以按 kind 合并成一条，具体是哪几条列在正文下面。
 *
 * 通道（**人在插件页面 → 界面右上角的 notification 卡片；不在 → 浏览器系统通知**）一轮判一次：
 * 「在不在页面里」对同一轮的各组是同一个答案。判据本身在 `src/shared/reseedPresence.ts` ——
 * `chrome.runtime.getContexts()` 只能告「有没有一个活的 options 页面」，告不出它是不是前台，
 * 而 manifest 里没有 `tabs` 权限，也不该为这件事加权限。
 * 文案两边共用 `reseedNotice*`（SW 里拿不到 useI18n，同 `notifyText` 那条取舍）。
 * 写存储失败（session 配额那种极端情况）就整批退到系统通知，不能因为选不了通道就不吭声。
 */
function createReseedNotifier(lang: string | undefined) {
  const byKind = new Map<TReseedNoticeKind, IReseedNoticeItem[]>();
  return {
    add(kind: TReseedNoticeKind, item: IReseedNoticeItem): void {
      const list = byKind.get(kind);
      if (list) list.push(item);
      else byKind.set(kind, [item]);
    },
    async flush(): Promise<void> {
      if (byKind.size === 0) return;
      const groups: IReseedNoticeGroup[] = [...byKind].map(([kind, items]) => ({ kind, items }));
      byKind.clear();
      try {
        if (await isPluginPageVisible()) {
          await pushReseedNotice({ at: Date.now(), groups });
          return;
        }
      } catch (e) {
        void sendMessage("logger", {
          msg: `Auto-reseed: 进展通知改走系统通知栏 (${e instanceof Error ? e.message : e})`,
        });
      }
      for (const group of groups) {
        // 同一个 kind 用同一个 id：下一轮再 create 是替换，不会在通知栏堆一排
        chrome.notifications?.create(`reseed-${group.kind}`, {
          type: "basic",
          iconUrl: chrome.runtime.getURL("icon/128.png"),
          title: reseedNoticeTitle(group.kind, lang),
          message: reseedNoticeGroupMessage(group, lang),
        });
      }
    },
  };
}

/** 通知文案：SW 里拿不到 useI18n，按 config.lang 选一份（同 updateCheck.ts 的 notifyText） */
function notifyText(lang: string | undefined, title: string, count: number): { title: string; message: string } {
  return lang === "zh_CN"
    ? { title: "辅种未成功", message: `「${title}」有 ${count} 条未正常做种，已自动暂停，请在「辅种任务」页查看具体条目` }
    : {
        title: "Reseed not seeding",
        message: `"${title}": ${count} torrent(s) were not seeding and have been paused. Open Reseed tasks to see which.`,
      };
}

/**
 * 「基准那份不在任务目录里」那条通知的文案。
 *
 * 这里**不**走 i18n：service worker 里没有 useI18n，而那两条路径是用户自己的数据，
 * 本来就不在语言包里（见 `src/options/i18nOutside.ts` 同一件事的取舍）。
 */
function pathMismatchText(
  lang: string | undefined,
  title: string,
  mismatch: { basePath: string; taskPath: string },
): { title: string; message: string } {
  return lang === "zh_CN"
    ? {
        title: "辅种已停止发送",
        message: `「${title}」的基准数据位于 ${mismatch.basePath}，而任务目录为 ${mismatch.taskPath}，两者不一致。请在「辅种任务」页选择处置方式`,
      }
    : {
        title: "Reseed paused",
        message:
          `"${title}": the base files are in ${mismatch.basePath} but the task folder is ${mismatch.taskPath}. ` +
          "Open Reseed tasks to pick a fix.",
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
 * 一起盖回旧值。其余没记 hash 的那几条照旧当「未匹配」—— 发送本来就不需要 hash，只是盯不到它的状态，
 * 界面上那行「另有 N 条未匹配」会把这件事说清楚；用户点一次「回查」就补上了（那条路在页面里，写回是安全的）。
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
  for (const k of [
    "baseSentAt",
    "baseSendFails",
    "othersSentAt",
    "othersSent",
    // 「没落地就放开重发」的次数。漏在这一条里的话它进不了存储 —— 每轮都读到 0，
    // 那个封顶就永远够不着，变成每 5 分钟重发一次没完（基准那边同一个道理，见上面注释）。
    "othersResent",
    "completedAt",
    "stage",
    "notifiedWrong",
    "notifiedPathMismatch",
    // 这三条是「弹过没有」的记账。漏在这里的话，标记写不进存储 ——
    // 下一轮又读到 undefined，用户每分钟收到一条同样的通知。
    "notifiedBaseStarted",
    "notifiedHalfway",
    "notifiedBaseDone",
    // 「基准有没有在动」那一档的三个键。漏在这里的话标记进不了存储：每一轮都读到 undefined、
    // 每一轮都把计时器重新起算，15 分钟那条判据永远走不到 —— 通知一次都不会弹，而且看着像功能没做。
    // 代价说清：基准在下时字节每分钟都在变，于是这一档会让「正在下的任务」每分钟多一次 IDB 写
    // （只 patch `autoState` 那一块，不是整条任务）。
    "baseBytes",
    "baseBytesAt",
    "notifiedBaseStall",
  ]) {
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
  /** 这一轮的进展：任务循环里只登记，函数末尾一次性投递（合并 + 选通道都在那儿） */
  const notices = createReseedNotifier(config?.lang);

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

    /**
     * 分类表。任务那一栏的保存路径允许写成 `category:电影` —— 那是分类，不是目录：
     * 不翻成目录就没法判「基准那份在不在任务目录」（翻不出按判不出走），而拿它当移动目标
     * 会被下载器当场拒掉（判据见 `src/shared/reseedPath.ts`）。只有这一组里真有用到分类写法才取。
     */
    let categories: Record<string, IClientCategory> | null = null;
    if (group.some((task) => isCategorySavePath(task.downloadOptions.savePath))) {
      try {
        categories = await sendMessage("getClientTorrentCategories", downloaderId);
      } catch {
        categories = null;
      }
    }

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
        /**
         * 先把「记为已发出、这一轮却查不到、且已超过 5 分钟」的那几条从发送记录里摘掉，
         * 再算还有几条要发。判据与基准那条对称（见 `pruneUnlandedOthers`）—— 不摘的话，
         * 一次「add 成功但没落地」会让这一条永远挂着「下载器中未找到」，而后台每轮都读到
         * 「这条发过了」。摘完的这份 `stateForPlan` 会一路带下去，所以 `next` 里写的就是它。
         */
        const pruned = pruneUnlandedOthers({ state: task.autoState ?? {}, items: allOthers, statuses: others, now: Date.now() });
        const stateForPlan: IKeepUploadTask["autoState"] = { ...(task.autoState ?? {}), othersSent: pruned.sent, othersResent: pruned.resent };
        /** 其中还没成功发出去的那几条（逐条记，不再拿「整批发过一次」当闸） */
        const othersToSend = othersStillPending(stateForPlan, allOthers);

        /**
         * 基准那份数据**此刻**到底在不在任务目录里。
         *
         * 认的是下载器刚报的那条的路径，不是建任务时记下的快照 —— 人自己搬过文件、或刚点过
         * 「把本地文件移到任务目录」，那份快照都还是旧的，拿它判就会在已经好了的任务上挂一条
         * 永远不消失的警告。连不上下载器时退回快照：那种情况下 `reachable` 已经先把发送挡住了，
         * 不会因为快照旧而误发什么。
         */
        const liveBase = task.baseLocal ? index.get(String(task.baseLocal.hash).toLowerCase()) : undefined;
        const baseMismatch = task.baseLocal
          ? detectBasePathMismatch({
              basePath: liveBase?.savePath ?? task.baseLocal.savePath,
              taskPath: task.downloadOptions.savePath,
              categories,
            })
          : null;

        const tick = planAutoReseed({
          baseLocal: !!task.baseLocal,
          otherCount: allOthers.length,
          othersPending: othersToSend.length,
          reachable,
          base,
          // 判「基准长时间没有进展」要的是已下字节，那份只在下载器这一轮的原始条目上有（`base` 那个
          // 结论对象里没有）；认不出基准是哪条时 `baseHash` 是空串 → undefined → 那一档整轮不判
          baseBytes: index.get(baseHash)?.totalDownloaded,
          others,
          untracked,
          pathMismatch: !!baseMismatch,
          state: stateForPlan,
          now: Date.now(),
        });

        const next = { ...tick.next };

        /**
         * ① 基准下到一半。判据（一条任务只弹一次、下完了不补报、baseLocal 不报）都在
         * `planAutoReseed`，它已经把 `notifiedHalfway` 写进 `next` 了；这里只补它算不出的那半句
         * —— 预计剩余时间要吃下载器的实时字节数和速度，那是这一层才有的东西。
         */
        if (tick.notifyHalfway) {
          const entry = index.get(baseHash);
          notices.add("baseHalfway", {
            title: task.title,
            progress: base?.progress,
            etaSec: entry ? estimateEtaSec(entry) : undefined,
          });
        }

        /**
         * ②「基准长时间没有进展」。判据（15 分钟、认字节不认整数百分比、人为暂停不报、
         * 重新动起来之后可以再报）全在 `planAutoReseed`；这里只补它算不出的那半句 ——
         * 「卡了多久」要从最后一次字节变化的时刻起算，而那份记账就在 `next` 里。
         */
        if (tick.notifyStall) {
          const since = next.baseBytesAt ?? Date.now();
          notices.add("baseStalled", {
            title: task.title,
            progress: base?.progress,
            stalledSec: Math.round((Date.now() - since) / 1000),
          });
        }

        const downloader = metadata?.downloaders?.[downloaderId];
        let acted = false;

        if (tick.sendBase) {
          try {
            await sendOne(task, task.items[0], downloader, siteNameOf(metadata, task.items[0].site));
            next.baseSentAt = Date.now();
            void sendMessage("logger", { msg: `Auto-reseed: base torrent sent for [${task.title}]` });
            // ②「基准已交给下载器，开始下全量」。一条任务只报一次；那次发送没落地被放开重发时，
            // 判据会把标记清掉，于是重发成功会再报一次 —— 那是又一次真的进展，不是重复轰炸。
            if (next.notifiedBaseStarted === undefined) {
              next.notifiedBaseStarted = Date.now();
              notices.add("baseStarted", { title: task.title });
            }
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
          // 吃摘过一遍的那份，不是原始 `task.autoState`：否则刚摘掉的那几条会被旧记录又填回
          // 「已发出」，这一轮发成功了下一轮又算成没发过 —— 自愈变成每轮重发。
          const sent: Record<string, number> = { ...othersAlreadySent(stateForPlan, allOthers) };
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
            // ③「基准下完了，那几条已推给下载器」。只报第一次成功 —— 后面那些重试轮次再报一遍，
            // 用户读到的是同一件事。N 说的是这一轮真的发出去几条，不是这批一共几条。
            if (next.notifiedBaseDone === undefined) {
              next.notifiedBaseDone = Date.now();
              notices.add("baseDone", { title: task.title, count: sentKeys.length });
            }
          }
          acted = true;
        }

        /**
         * 卡在「目录不一致」上不会自己解开 —— 要人挑一种处置（改任务目录 / 把数据搬过去）。
         * 所以弹一次系统通知就够：一条任务只弹一次，等它真的解开了再把标记清掉。
         * 只在「基准下载完成、确实有内容要发」时弹，不然刚建好的任务会被一条还没发生的卡住打扰。
         */
        if (
          baseMismatch &&
          othersToSend.length > 0 &&
          base?.completed === true &&
          !task.autoState?.notifiedPathMismatch
        ) {
          const { title, message } = pathMismatchText(config?.lang, task.title, baseMismatch);
          chrome.notifications?.create(`auto-reseed-path-${task.id}`, {
            type: "basic",
            iconUrl: chrome.runtime.getURL("icon/128.png"),
            title,
            message,
          });
          next.notifiedPathMismatch = Date.now();
          void sendMessage("logger", {
            msg:
              `Auto-reseed: [${task.title}] 的辅种暂停发送 —— 基准那份在 ${baseMismatch.basePath}，` +
              `任务目录是 ${baseMismatch.taskPath}`,
          });
        } else if (!baseMismatch && next.notifiedPathMismatch) {
          next.notifiedPathMismatch = undefined;
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

        /**
         * ④「全部条目均已正常做种」。判据是「第一次走到 done 那一档」（见 planAutoReseed）；
         * 后来某条坏了又修好的话会再报一次 —— 那是用户想知道的第二件事。
         */
        if (tick.firstDone) {
          notices.add("allSeeded", { title: task.title });
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

  /**
   * 一轮的进展在这一行一次性投递（按 kind 合并 + 选通道，都在 `createReseedNotifier` 里）。
   * 为什么放末尾而不是各事件当场：登记之后每一处都在按任务的 try/catch 里，抛出去也只到
   * 「那一条任务不吭声」这一层，其余任务和这一行的 flush 都照常走到。
   */
  await notices.flush();
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

// 建完任务那一侧、以及辅种任务页「回查做种状态」/「移到任务目录」之后催的
// （判据仍只有 `autoReseedTick` 这一份，这里只是把触发时刻提前）。
// ⚠️ 回包**等这一轮真的跑完**（原先是 `void`，立刻回包）：调用点拿它当「已经推进过了」的证据，
// 回得太早的话，它随后拉回来的还是上一轮的状态，界面表现为「我点了回查，什么都没发生」。
onMessage("runAutoReseedTick", () => runAutoReseedTick());

// noinspection JSIgnoredPromiseFromCall
jobs.scheduleJob({
  id: JOB_ID,
  type: "interval",
  duration: TICK_MS,
  immediate: true,
  execute: () => runAutoReseedTick(),
});
