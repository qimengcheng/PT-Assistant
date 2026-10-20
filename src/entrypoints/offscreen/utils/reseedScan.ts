/**
 * 「可辅种扫描」的执行侧（offscreen）。
 *
 * 这一份存在的理由用户 2026-10-18 说得很直白：「你得挨着去查有没有这个种子才有意义啊」。
 * v0.107.0 那枚「待辅 N 站」是本地按 tracker 反查算出来的，它只说得出「你添加的站点里还没挂上
 * 这份内容」，说不出「那个站上到底有没有这条种子」—— 而后半句才是"能不能辅"的前提。
 * 所以这里的每一条结论都**真的向那个站发过一次搜索**，命中的候选还要再下 .torrent 比文件清单。
 *
 * 为什么住 offscreen：站点解析要 DOM，而 `getSiteInstance` 从 `@ptd/site` 根入口走 ——
 * 那条边在 background 的静态图里是禁的（AGENTS §3.2、防线⑥）。站点定义模块顶层就 `import Sizzle`，
 * 动态 import 只躲得过静态图，躲不过运行时真执行一次工厂。
 *
 * 纯判据（折搜索词、排查询计划、粗筛候选、把结果折成四档）不在这里，住 `@/shared/reseedScanPlan.ts`，
 * 那份能被 Node 直接断言；这里只做 IO 与编排。
 */
import PQueue from "p-queue";
import { EResultParseStatus, type TSiteID } from "@ptd/site";
import type { ITorrent } from "@ptd/site";

import { onMessage } from "@/messages.ts";
import { extStore } from "@/storage.ts";
import { ptdIndexDb } from "@/shared/indexdb.ts";
import {
  planReseedScan,
  reconcileReseedScanJob,
  reseedScanLocalGroup,
  reseedScanResultId,
  reseedScanScreen,
  reseedScanVerdict,
} from "@/shared/reseedScanPlan.ts";
import { RESEED_SCAN_CONCURRENCY, RESEED_SCAN_MAX_PAIRS } from "@/shared/types/storages/reseedScan.ts";
import type {
  IReseedScanJob,
  IReseedScanRequest,
  IReseedScanResult,
  IReseedScanTarget,
} from "@/shared/types/storages/reseedScan.ts";
import type { ILocalTorrentFingerprintEntry } from "@/shared/fingerprint/types.ts";

import { getLocalFingerprintIndex } from "./fingerprint.ts";
import { getSiteInstance } from "./site.ts";
import { getTorrentInfoForVerification } from "./download.ts";
import { logger } from "./logger.ts";

/** 正在跑的那一轮。同一时刻只允许一轮：两轮并发会把同一批站点打两遍 */
let running: { cancel: () => void } | null = null;

async function readJob(): Promise<IReseedScanJob | null> {
  return await extStore.getItem("reseedScan");
}

async function writeJob(job: IReseedScanJob): Promise<void> {
  await extStore.setItem("reseedScan", job);
}

/**
 * 读进度，并顺手把「存储说在跑、这一份 offscreen 里却没有那一轮」对账掉。
 *
 * 轮次身份是模块变量 `running`，进度是存储键 —— 插件更新 / 重载只留得下后面那一份，
 * 于是界面会永远转圈、停止键按了没人接（判据与实测口径见 `reconcileReseedScanJob` 上方那段）。
 * 对账出来的那一份要**写回去**：不写的话每一次读都重新判一遍、界面每次都重新折一次结论。
 */
async function readReconciledJob(): Promise<IReseedScanJob | null> {
  const stored = await readJob();
  const healed = reconcileReseedScanJob(stored, running !== null, Date.now());
  if (healed && healed !== stored) {
    await writeJob(healed);
    logger({ msg: "可辅种扫描的进度记录是上一轮留下的（后台已重载），已就地判为中断", level: "warn" });
  }
  return healed;
}

/** 上次查过的全部结论（整表读：一张面板要显示的就是这几百条，按前缀取反而要建 index） */
async function readCache(): Promise<Map<string, IReseedScanResult>> {
  const all = await (await ptdIndexDb()).getAll("reseed_scan");
  return new Map(all.map((item) => [item.id, item]));
}

async function saveResult(result: IReseedScanResult): Promise<void> {
  await (await ptdIndexDb()).put("reseed_scan", result);
}

/**
 * 站点实例按轮缓存。
 *
 * 一轮里同一个站会被打好几次（一条内容 × 一个站），而 `getSiteInstance` 每次都要读一遍站点
 * 用户配置 + 动态 import 那个站点定义的 chunk。缓存的是「同一个站的实例」，不是结论 ——
 * 结论仍然每次都真发请求，所以这不违反「挨着去查」那条。
 */
function createSiteCache() {
  const cache = new Map<TSiteID, Promise<Awaited<ReturnType<typeof getSiteInstance<"public">>>>>();
  return (siteId: TSiteID) => {
    const hit = cache.get(siteId);
    if (hit) return hit;
    const pending = getSiteInstance<"public">(siteId);
    cache.set(siteId, pending);
    return pending;
  };
}

/**
 * 这一档搜索状态算不算「真的查成了」。
 *
 * 导出去给「定位源站那颗种子」（`torrentUpload.ts`）复用：那一步同样要在「搜过、没有」
 * 与「这一次没搜成」之间分开，两处各判一套就会有一处把「要登录」说成「那个站没有」。
 */
export function isSearchAnswered(status: EResultParseStatus): boolean {
  // 只有这两档是「站点给了一个可信的页」：success = 解析出内容，noResults = 页面正常但这条词没结果。
  // 其余（要登录 / 要凭据 / 被 CF 挡 / 解析歪了 / 超时）都不能拿来判「那个站没有这条种子」。
  return status === EResultParseStatus.success || status === EResultParseStatus.noResults;
}

/**
 * 解析状态 → 人读的一句话。
 *
 * ⚠️ 不直接搬 `result.statusMsg`：那个字段可以是 `i18n.xxx` 这样的**键路径**（只有搜索状态
 * 弹窗那一种调用方会把它翻成真句子），而这里的 note 会被界面原样摆出来 —— 按 AGENTS §3.5，
 * 内部标识进 UI 是零容忍项。
 */
export const SEARCH_STATUS_TEXT: Partial<Record<EResultParseStatus, string>> = {
  [EResultParseStatus.needLogin]: "需要重新登录",
  [EResultParseStatus.noUserInput]: "该站必填的凭据没有填写",
  [EResultParseStatus.CFBlocked]: "被 Cloudflare 挡住",
  [EResultParseStatus.parseError]: "那一页解析失败（可能只回了一半）",
  [EResultParseStatus.unknownError]: "未知错误",
};

/**
 * 站上那条 → 够拿去建辅种任务的最小形状。
 *
 * 为什么在这一步就存下来而不是点辅种时再搜一遍：`id` 少存一个，那 7 个靠 id 换下载链接的站
 * （yemapt / mteam 那批）发送会失败且只回一句不带原因的 `success:false`；`hash` 更是只有
 * 验文件清单那一步下过 .torrent 才拿得到。这两样现场都已经有，不存就是让下一次白下一遍。
 * ⚠️ `link` 在 NexusPHP 那一族带 passkey：它只落本机 IndexedDB，不进日志、不上界面。
 */
function toSiteRef(item: ITorrent, hash?: string): IReseedScanResult["site"] {
  const title = typeof item?.title === "string" ? item.title : "";
  if (!title) return undefined;
  return {
    id: item.id,
    title,
    subTitle: item.subTitle,
    category: item.category,
    url: item.url ?? "",
    link: item.link ?? "",
    size: typeof item.size === "number" ? item.size : 0,
    seeders: item.seeders,
    leechers: item.leechers,
    hash,
  };
}

/** 一次「内容 × 站点」的查询：搜（两档词）→ 粗筛候选 → 候选下 .torrent 比文件清单 */
async function scanOnePair(input: {
  contentKey: string;
  siteId: TSiteID;
  name: string;
  size: number;
  keywords: string[];
  /** 本地这一条内容的全部副本；空数组 = 拿不到文件清单可比 */
  locals: ILocalTorrentFingerprintEntry[];
  getSite: ReturnType<typeof createSiteCache>;
}): Promise<IReseedScanResult> {
  const { contentKey, siteId, name, size, keywords, locals, getSite } = input;
  const base = { id: reseedScanResultId(contentKey, siteId), contentKey, siteId, at: Date.now() };
  const localFingerprints = new Set(locals.map((entry) => entry.files?.fingerprint).filter(Boolean) as string[]);

  let requestsSent = 0;
  let answered = false;
  let candidates = 0;
  let filesCompared = false;
  let filesMatched = false;
  let hit: ITorrent | undefined;
  let hitHash: string | undefined;
  let note: string | undefined;

  try {
    const site = await getSite(siteId);

    for (const keyword of keywords) {
      let items: ITorrent[];
      try {
        requestsSent++;
        const result = await site.getSearchResult(keyword, {});
        if (!isSearchAnswered(result.status)) {
          note = `该站这一页没给出可信结果：${SEARCH_STATUS_TEXT[result.status] ?? "状态不明"}`;
          continue;
        }
        answered = true;
        items = result.data ?? [];
      } catch (error) {
        note = `向该站发搜索失败：${error instanceof Error ? error.message : String(error)}`;
        continue;
      }

      const screened = reseedScanScreen(items, { name, size });
      if (screened.length === 0) continue;

      candidates += screened.length;
      hit ??= screened[0].item;

      // 本地算不出文件清单就没法把「相符」升级成「确有这条」——如实停在 suspect，不假装验过
      if (localFingerprints.size === 0) {
        note = "下载器里这一条报不出文件清单（客户端不支持或请求失败），只能停在标题与大小相符";
        continue;
      }
      for (const candidate of screened) {
        try {
          const info = await getTorrentInfoForVerification(candidate.item);
          filesCompared = true;
          hit = candidate.item;
          const fp = info?.filesFingerprint?.fingerprint;
          filesMatched = fp !== undefined && localFingerprints.has(fp);
          // 只有比上了的那一条才把 infoHash 记下来：没比上的那条不是这一份内容，
          // 存了就会有一行「该站有这条」指向错的那颗种子
          hitHash = filesMatched ? info?.infoHash : undefined;
        } catch (error) {
          note = `候选那条的种子文件没取下来：${error instanceof Error ? error.message : String(error)}`;
          continue;
        }
        if (filesMatched) break;
      }
      if (filesMatched) break;
      // 候选验过但不是同一份：这条词的页面上没有相符条目，换第二档词再试一次
      if (filesCompared && !filesMatched) {
        candidates = 0;
        note = "页面上相符的那条验过文件清单，与本地这份不是同一组文件";
      }
    }
  } catch (error) {
    note = `站点实例建不起来：${error instanceof Error ? error.message : String(error)}`;
  }

  const verdict = reseedScanVerdict({
    requestsSent,
    requestFailed: !answered,
    candidates,
    filesCompared,
    filesMatched,
    note,
  });

  // `no-match` 那一档不带上 site：那时 `hit` 是「验过文件、确认不是这一份」的那条，
  // 把它一起存下来就等于让界面上那行「没搜到相符条目」指向一颗无关的种子
  const reportable = verdict.verdict === "has-it" || verdict.verdict === "suspect";

  return {
    ...base,
    verdict: verdict.verdict,
    note: verdict.note,
    siteTitle: reportable ? hit?.title : undefined,
    siteSize: reportable ? hit?.size : undefined,
    site: reportable && hit ? toSiteRef(hit, hitHash) : undefined,
  };
}

/**
 * 一轮扫描的全部过程。发起方不 await 它（一次扫描是几十到几百次站点请求，消息不能挂那么久），
 * 进度一路写进 `reseedScan` 那个键，由界面轮询。
 */
async function runRound(request: IReseedScanRequest, isCancelled: () => boolean): Promise<void> {
  const startedAt = Date.now();
  let job: IReseedScanJob = { status: "running", startedAt, total: 0, done: 0 };
  const getSite = createSiteCache();
  let doneCount = 0;

  try {
    const cache = await readCache();
    const entries: ILocalTorrentFingerprintEntry[] = [];
    for (const downloaderId of request.downloaderIds) {
      const index = await getLocalFingerprintIndex(downloaderId);
      entries.push(...(index?.entries ?? []));
    }

    const targets: IReseedScanTarget[] = request.targets ?? [];
    const plan = planReseedScan({
      targets,
      usableSites: request.usableSites ?? [],
      cache: request.refresh ? new Map() : cache,
      now: startedAt,
      maxPairs: RESEED_SCAN_MAX_PAIRS,
    });

    // 本地副本按内容键缓存：一条内容要打好几个站，每站重筛一遍整片索引是白功
    const groupCache = new Map<string, ILocalTorrentFingerprintEntry[]>();
    const groupOf = (target: { contentKey: string; name: string; size: number }) => {
      const hit = groupCache.get(target.contentKey);
      if (hit) return hit;
      const group = reseedScanLocalGroup(entries, target);
      groupCache.set(target.contentKey, group);
      return group;
    };

    job = { ...job, total: plan.pairs.length, skipped: plan.cached, remaining: plan.truncated };
    if (plan.pairs.length === 0) {
      // 一趟都没排出来：要么全在新鲜期内（那不算错），要么范围/站点是空的（界面自己会说清）
      await writeJob({ ...job, status: "done", finishedAt: Date.now() });
      logger({ msg: `可辅种扫描没有需要查的条目（跳过新鲜期内查过的 ${plan.cached} 对）` });
      return;
    }
    await writeJob(job);
    logger({
      msg: `可辅种扫描开始：${plan.pairs.length} 对（跳过新鲜期内查过的 ${plan.cached} 对${plan.truncated ? `、超出上限没查 ${plan.truncated} 对` : ""}）`,
    });

    const queue = new PQueue({ concurrency: RESEED_SCAN_CONCURRENCY });
    for (const pair of plan.pairs) {
      // 不 await：await 会把并发压成串行，一轮几百次请求要跑到天荒地老
      void queue.add(async () => {
        if (isCancelled()) return;
        await writeJob({ ...job, currentSite: pair.siteId, currentName: pair.name });

        const result = await scanOnePair({
          contentKey: pair.contentKey,
          siteId: pair.siteId,
          name: pair.name,
          size: pair.size,
          keywords: pair.keywords,
          locals: groupOf(pair),
          getSite,
        });
        await saveResult(result);

        doneCount += 1;
        job = { ...job, done: doneCount };
        await writeJob(job);
      });
    }
    await queue.onIdle();

    await writeJob({
      ...job,
      status: isCancelled() ? "stopped" : "done",
      finishedAt: Date.now(),
      currentSite: undefined,
      currentName: undefined,
    });
    logger({ msg: `可辅种扫描结束：${isCancelled() ? "被叫停" : "跑完"}，共查 ${doneCount} 对` });
  } catch (error) {
    // 编排自己出错（读库失败、下载器整片不可达这一类）：写成失败，不能让界面永远转圈
    await writeJob({ ...job, status: "stopped", finishedAt: Date.now(), currentSite: undefined, currentName: undefined }).catch(
      () => undefined,
    );
    logger({
      msg: `可辅种扫描异常中止：${error instanceof Error ? error.message : String(error)}`,
      level: "warn",
    });
  }
}

onMessage("startReseedScan", async ({ data }) => {
  const startedAt = Date.now();
  if (running) {
    // 已经在跑：不排队第二轮（两轮打同一批站点只会更早撞上站点频率限制），把当前进度回给它
    return (await readJob()) ?? { status: "running", startedAt, total: 0, done: 0 };
  }

  let cancelled = false;
  running = { cancel: () => (cancelled = true) };
  const job: IReseedScanJob = { status: "running", startedAt, total: 0, done: 0 };
  await writeJob(job);
  void runRound(data, () => cancelled).finally(() => {
    running = null;
  });
  return job;
});

onMessage("getReseedScanJob", async () => await readReconciledJob());

onMessage("stopReseedScan", async () => {
  running?.cancel();
  // 只把标志翻过来：真正落到 stopped 是队列排空之后那一次写（那时才知道还剩几条没排）。
  // 走 readReconciledJob 是为了「场上压根没有那一轮」那种情况也能当场有个说法，
  // 而不是把那句 running 原样回给界面（那等于让人再按一次停止）。
  return await readReconciledJob();
});

onMessage("getReseedScanResults", async ({ data }) => {
  const all = await (await ptdIndexDb()).getAll("reseed_scan");
  const keys = data?.contentKeys;
  return keys?.length ? all.filter((item) => keys.includes(item.contentKey)) : all;
});

onMessage("clearReseedScanCache", async () => {
  await (await ptdIndexDb()).clear("reseed_scan");
  logger({ msg: "已清空可辅种扫描的结果缓存" });
});
