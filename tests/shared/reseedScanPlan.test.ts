/**
 * 「可辅种扫描」的计划与判据（`src/shared/reseedScanPlan.ts`）。
 *
 * 为什么这一条要进 Vitest：这一层决定界面对一条种子说「那个站上有 / 没搜到 / 这次没查成」，
 * 三档说的话不一样，判错的方向也不一样 —— 把「没查成」说成「没有」是**假阴性**，
 * 人据此就不去辅了，比不报更糟。站点 id、标题、字节数全部合成，不带任何真实账号数据。
 */
import { describe, expect, it } from "vitest";

import {
  RESEED_SCAN_SIZE_TOLERANCE_RATIO,
  isReseedScanFresh,
  planReseedScan,
  reconcileReseedScanJob,
  reseedScanContentKey,
  reseedScanKeywords,
  reseedScanLocalGroup,
  reseedScanResultId,
  reseedScanScreen,
  reseedScanSeedOfTask,
  reseedScanTargetOfSeed,
  reseedScanVerdict,
} from "@/shared/reseedScanPlan.ts";
import type { ILocalTorrentFingerprintEntry } from "@/shared/fingerprint/types.ts";
import type { IReseedScanJob, IReseedScanResult, IReseedScanTarget } from "@/shared/types/storages/reseedScan.ts";

const GIB = 1024 ** 3;
/** 本地那份：一份 10 GiB 的发布名种子，算得出文件清单 */
const SIZE = Math.round(10 * GIB);

function entry(patch: Partial<ILocalTorrentFingerprintEntry> & Pick<ILocalTorrentFingerprintEntry, "name" | "size">): ILocalTorrentFingerprintEntry {
  return {
    hash: patch.hash ?? `hash-${patch.name}`,
    titleKey: reseedScanContentKey(patch.name, patch.size),
    trackerHosts: [],
    sites: [],
    progress: 100,
    isCompleted: true,
    ratioLimit: -2,
    seedingTimeLimit: -2,
    ...patch,
  } as ILocalTorrentFingerprintEntry;
}

function result(siteId: string, at: number, verdict: IReseedScanResult["verdict"] = "no-match", withSite = true): IReseedScanResult {
  const out: IReseedScanResult = { id: reseedScanResultId("k", siteId), contentKey: "k", siteId, verdict, at };
  // v0.109.0 起「该站有这条」/「标题相符」带着可发送的那一半；`withSite: false` 复现老记录的形状
  if (withSite && (verdict === "has-it" || verdict === "suspect")) {
    out.site = {
      id: `t-${siteId}`,
      title: `Movie 2024 on ${siteId}`,
      url: `https://${siteId}/details.php?id=t-${siteId}`,
      link: `https://${siteId}/download.php?id=t-${siteId}`,
      size: SIZE,
    };
  }
  return out;
}

describe("reseedScanKeywords：最多两档，且不烧重复的请求", () => {
  it("发布名 → 原串 + 折掉分辨率/编码/组名的核心词", () => {
    const [first, second] = reseedScanKeywords("The.Movie.2024.1080p.x264-WEB-DL-GROUP");
    expect(first).toBe("The.Movie.2024.1080p.x264-WEB-DL-GROUP");
    expect(second).toBeDefined();
    expect(second).not.toContain("1080p");
    expect(second!.toLowerCase()).toBe(second);
  });

  it("名字本身已经干净（只差大小写）时只发一档：那是同一次查询", () => {
    expect(reseedScanKeywords("Movie 2024")).toEqual(["Movie 2024"]);
  });

  it("空名 / 只有空格 → 一个词都不发（发了只会得到一个假的「没搜到」）", () => {
    expect(reseedScanKeywords("")).toEqual([]);
    expect(reseedScanKeywords("   ")).toEqual([]);
  });
});

describe("planReseedScan：哪几对要发出去", () => {
  const target = (patch: Partial<IReseedScanTarget> & Pick<IReseedScanTarget, "name">) =>
    ({
      contentKey: reseedScanContentKey(patch.name, patch.size ?? SIZE),
      name: patch.name,
      size: patch.size ?? SIZE,
      knownSites: patch.knownSites ?? [],
    }) satisfies IReseedScanTarget;

  it("已挂的那些站不再查，其余每个站排一对", () => {
    const plan = planReseedScan({
      targets: [target({ name: "Movie 2024", knownSites: ["siteA"] })],
      usableSites: ["siteA", "siteB", "siteC"],
      cache: new Map(),
    });
    expect(plan.pairs.map((pair) => pair.siteId)).toEqual(["siteB", "siteC"]);
    expect(plan.truncated).toBe(0);
  });

  it("新鲜期内查过的对子跳过并计入 skipped，过期的重查", () => {
    const now = 1_000_000_000_000;
    const cache = new Map([
      [reseedScanResultId(reseedScanContentKey("Movie 2024", SIZE), "siteB"), result("siteB", now - 1000)],
      [reseedScanResultId(reseedScanContentKey("Movie 2024", SIZE), "siteC"), result("siteC", now - 80 * 24 * 60 * 60 * 1000)],
    ]);
    const plan = planReseedScan({
      targets: [target({ name: "Movie 2024" })],
      usableSites: ["siteB", "siteC"],
      cache,
      now,
    });
    expect(plan.cached).toBe(1);
    expect(plan.pairs.map((pair) => pair.siteId)).toEqual(["siteC"]);
  });

  it("缓存里那条「该站有这条」是升级之前的形状（没存可发送的那一半）⇒ 重新排进计划", () => {
    const now = 1_000_000_000_000;
    const cache = new Map([
      [reseedScanResultId(reseedScanContentKey("Movie 2024", SIZE), "siteB"), result("siteB", now - 1000, "has-it", false)],
    ]);
    const plan = planReseedScan({ targets: [target({ name: "Movie 2024" })], usableSites: ["siteB"], cache, now });
    expect(plan.cached).toBe(0);
    expect(plan.pairs.map((pair) => pair.siteId)).toEqual(["siteB"]);
  });

  it("一条都没添加可用站点 → 空计划，不是一堆失败", () => {
    const plan = planReseedScan({ targets: [target({ name: "Movie 2024" })], usableSites: [], cache: new Map() });
    expect(plan.pairs).toEqual([]);
  });

  it("上限是硬闸，砍掉的数量要如实报出来（否则界面会以为全查完了）", () => {
    const plan = planReseedScan({
      targets: [target({ name: "Movie 2024" })],
      usableSites: ["a", "b", "c", "d", "e"],
      cache: new Map(),
      maxPairs: 2,
    });
    expect(plan.pairs.length).toBe(2);
    expect(plan.truncated).toBe(3);
  });

  it("每对都带上搜索词与本地字节：粗筛的容差按它算，不能到执行侧再猜", () => {
    const plan = planReseedScan({ targets: [target({ name: "Movie 2024" })], usableSites: ["siteB"], cache: new Map() });
    expect(plan.pairs[0]).toMatchObject({ name: "Movie 2024", size: SIZE, siteId: "siteB" });
    expect(plan.pairs[0]!.keywords.length).toBeGreaterThan(0);
  });
});

describe("isReseedScanFresh", () => {
  it("刚好到期边界上算不新鲜（宁可重查一次，不要把旧结论接着用）", () => {
    const at = 1_000_000_000_000;
    const ttl = 1000;
    expect(isReseedScanFresh(result("siteA", at), at + ttl - 1, ttl)).toBe(true);
    expect(isReseedScanFresh(result("siteA", at), at + ttl, ttl)).toBe(false);
    expect(isReseedScanFresh(undefined, at, ttl)).toBe(false);
  });

  it("「这次没查成」不按结论的新鲜期冻：它没产出任何结论", () => {
    const at = 1_000_000_000_000;
    const day = 24 * 60 * 60 * 1000;
    // 同一时刻、同一个七天 ttl：has-it 跳过，failed 不跳过
    expect(isReseedScanFresh(result("siteA", at, "has-it"), at + day, 7 * day)).toBe(true);
    expect(isReseedScanFresh(result("siteA", at, "failed"), at + day, 7 * day)).toBe(false);
  });

  it("但也不是每轮都重撞：重试间隔之内仍然跳过", () => {
    const at = 1_000_000_000_000;
    const minute = 60 * 1000;
    expect(isReseedScanFresh(result("siteA", at, "failed"), at + 29 * minute, 7 * 24 * 60 * minute)).toBe(true);
    expect(isReseedScanFresh(result("siteA", at, "failed"), at + 31 * minute, 7 * 24 * 60 * minute)).toBe(false);
  });

  it("「该站有这条」没存可发送的那一半（升级之前查的）⇒ 不算新鲜，否则一键辅种会被冻成点不动", () => {
    const at = 1_000_000_000_000;
    const day = 24 * 60 * 60 * 1000;
    expect(isReseedScanFresh(result("siteA", at, "has-it", false), at + day, 7 * day)).toBe(false);
    expect(isReseedScanFresh(result("siteA", at, "suspect", false), at + day, 7 * day)).toBe(false);
    // 同一时刻、同一档结论，带着那一半的仍然按七天算新鲜（不许把重查变成每轮都重查）
    expect(isReseedScanFresh(result("siteA", at, "has-it"), at + day, 7 * day)).toBe(true);
  });

  it("调用方给的更短 ttl 对 failed 仍然有效（只许收紧，不许放宽）", () => {
    const at = 1_000_000_000_000;
    expect(isReseedScanFresh(result("siteA", at, "failed"), at + 6 * 60 * 1000, 5 * 60 * 1000)).toBe(false);
  });
});

describe("reseedScanLocalGroup：把同一份内容的全部副本收齐", () => {
  it("改过名的副本靠文件清单指纹认领（同内容各站写法不同，只按标题 key 会漏）", () => {
    const fp = "aaaaaaaa";
    const copies = [
      entry({ name: "The.Movie.2024.1080p-GROUP", size: SIZE, files: { kind: "single", fileCount: 1, totalSize: SIZE, fingerprint: fp } }),
      // 这一条折出来的标题与上面那条**不相等**（差在尾注上），所以它不可能靠第 1 层 key 被认进来
      entry({ name: "The Movie 2024 导演剪辑版", size: SIZE, files: { kind: "single", fileCount: 1, totalSize: SIZE, fingerprint: fp } }),
      entry({ name: "Unrelated Show S01", size: SIZE * 2, files: { kind: "single", fileCount: 1, totalSize: SIZE * 2, fingerprint: "bbbbbbbb" } }),
    ];
    const group = reseedScanLocalGroup(copies, { name: "The.Movie.2024.1080p-GROUP", size: SIZE });
    expect(group.map((item) => item.name)).toContain("The Movie 2024 导演剪辑版");
    expect(group.map((item) => item.name)).not.toContain("Unrelated Show S01");
  });

  it("算不出文件清单的副本不凭「大小差不多」认领：没有证据就不能当成同一份", () => {
    const known = entry({ name: "Movie 2024", size: SIZE, files: { kind: "single", fileCount: 1, totalSize: SIZE, fingerprint: "cccc" } });
    const unknown = entry({ name: "Other 2024", size: SIZE, files: null });
    const group = reseedScanLocalGroup([known, unknown], { name: "Movie 2024", size: SIZE });
    expect(group.map((item) => item.name)).toEqual(["Movie 2024"]);
  });

  it("本地一条都认不出时返回空表：扫描据此退到「未验文件」那一档，而不是假装验过", () => {
    expect(reseedScanLocalGroup([], { name: "Movie 2024", size: SIZE })).toEqual([]);
  });
});

describe("reseedScanScreen：列表页粗筛只负责挑候选", () => {
  const target = { name: "The.Movie.2024.1080p.x264-GROUP", size: SIZE };

  it("标题相符 + 大小在容差内，排在只有标题相符之前（归一标题会把压制信息折掉，所以两条都算候选）", () => {
    const picked = reseedScanScreen(
      [
        { title: "The Movie 2024", size: Math.round(4 * GIB) },
        { title: "The.Movie.2024.1080p.x264-GROUP", size: Math.round(10.05 * GIB) },
      ],
      target,
      { max: 1 },
    );
    expect(picked.map((item) => item.tier)).toEqual(["titleSize"]);
    expect(picked[0]!.item.title).toContain("1080p");
  });

  it("站点那一格是约数：容差内就算候选，差得远就不算（判定仍靠文件清单）", () => {
    const ratio = RESEED_SCAN_SIZE_TOLERANCE_RATIO;
    expect(reseedScanScreen([{ title: "别的名字", size: Math.round(SIZE * (1 + ratio / 2)) }], target).length).toBe(1);
    expect(reseedScanScreen([{ title: "别的名字", size: Math.round(SIZE * (1 + ratio * 3)) }], target).length).toBe(0);
  });

  it("站点报不出大小（0 是「读不懂」不是「零字节」）时只按标题认候选", () => {
    const picked = reseedScanScreen([{ title: "The Movie 2024", size: 0 }], target);
    expect(picked.map((item) => item.tier)).toEqual(["title"]);
  });

  it("候选条数有上限：每条都要真下一次 .torrent，不能敞开", () => {
    const items = Array.from({ length: 6 }, (_, i) => ({ title: `The Movie 2024 ${i}`, size: SIZE }));
    expect(reseedScanScreen(items, { name: "The Movie 2024", size: SIZE }).length).toBe(2);
  });
});

describe("reseedScanVerdict：四档不许并成两档", () => {
  it("一次请求都没发出去 → failed（不是「没有」）", () => {
    expect(reseedScanVerdict({ requestsSent: 0, requestFailed: false, candidates: 0, filesCompared: false }).verdict).toBe("failed");
  });

  it("发了但没一次查成（要登录 / 解析歪了）→ failed，绝不能读成 no-match", () => {
    expect(reseedScanVerdict({ requestsSent: 1, requestFailed: true, candidates: 0, filesCompared: false }).verdict).toBe("failed");
  });

  it("查成了、页面上没有相符条目 → no-match", () => {
    expect(reseedScanVerdict({ requestsSent: 2, requestFailed: false, candidates: 0, filesCompared: false }).verdict).toBe("no-match");
  });

  it("有候选 + 文件清单对上 → has-it（证据最强的一档）", () => {
    expect(
      reseedScanVerdict({ requestsSent: 1, requestFailed: false, candidates: 1, filesCompared: true, filesMatched: true }).verdict,
    ).toBe("has-it");
  });

  it("有候选 + 验过文件但不是同一份 → no-match（标题一样不算数）", () => {
    expect(
      reseedScanVerdict({ requestsSent: 1, requestFailed: false, candidates: 1, filesCompared: true, filesMatched: false }).verdict,
    ).toBe("no-match");
  });

  it("有候选但没验成文件 → suspect，不许并进 has-it 也不许并进 no-match", () => {
    const verdict = reseedScanVerdict({
      requestsSent: 1,
      requestFailed: false,
      candidates: 1,
      filesCompared: false,
      note: "本地这一条报不出文件清单",
    });
    expect(verdict.verdict).toBe("suspect");
    expect(verdict.note).toBe("本地这一条报不出文件清单");
  });

  it("查成了就压得过另一档词的失败：一档报错、一档正常且没结果 → no-match", () => {
    expect(reseedScanVerdict({ requestsSent: 2, requestFailed: false, candidates: 0, filesCompared: false }).verdict).toBe("no-match");
  });
});

/**
 * 「进度键说在跑」与「offscreen 里真有一轮在跑」的对账。
 *
 * 这一族 bug 的形状是**一份事实写两处、只有一处有人回收**：轮次身份是模块变量，插件更新 / 重载
 * 就把它清空，而存储里那句 `running` 永远留着 ⇒ 界面永远转圈、停止键按了没人接
 * （用户 2026-10-19 报的就是这个）。站点 id 与标题都是合成值。
 */
describe("reconcileReseedScanJob · 孤儿轮次", () => {
  const NOW = 9_000_000;
  const orphan = (): IReseedScanJob => ({
    status: "running",
    startedAt: 1_000,
    total: 258,
    done: 172,
    skipped: 1571,
    remaining: 3,
    currentSite: "novahd",
    currentName: "示例影片",
  });

  it("存储说在跑而场上没有那一轮 → 判成中断，进度那几格原样留着", () => {
    const healed = reconcileReseedScanJob(orphan(), false, NOW)!;
    expect(healed.status).toBe("stopped");
    expect(healed.interrupted).toBe(true);
    expect(healed.finishedAt).toBe(NOW);
    expect({ total: healed.total, done: healed.done, skipped: healed.skipped, remaining: healed.remaining }).toEqual({
      total: 258,
      done: 172,
      skipped: 1571,
      remaining: 3,
    });
    // 「正在查哪一对」说的是那一轮，轮次没了就不该再点名一个不存在的查询
    expect(healed.currentSite).toBeUndefined();
    expect(healed.currentName).toBeUndefined();
  });

  it("改判返回的是新对象，不许就地改传进来那一份（调用方拿引用相等判有没有改过）", () => {
    const stored = orphan();
    const healed = reconcileReseedScanJob(stored, false, NOW)!;
    expect(healed).not.toBe(stored);
    expect(stored.status).toBe("running");
    expect(stored.interrupted).toBeUndefined();
  });

  it("场上真有一轮时一个字都不动：那是正在跑的，不是孤儿", () => {
    const stored = orphan();
    expect(reconcileReseedScanJob(stored, true, NOW)).toBe(stored);
  });

  it("其余三档一律原样返回，也不许补 interrupted", () => {
    for (const status of ["idle", "stopped", "done"] as const) {
      const job: IReseedScanJob = { status, startedAt: 1, total: 10, done: 10 };
      expect(reconcileReseedScanJob(job, false, NOW)).toBe(job);
    }
    // 人自己按过停止的那一条：已经 stopped，不许被这次对账改写成「中断」
    const byHand: IReseedScanJob = { status: "stopped", startedAt: 1, total: 10, done: 4, finishedAt: 2 };
    expect(reconcileReseedScanJob(byHand, false, NOW)).toBe(byHand);
  });

  it("没有进度记录时返回 null：没跑过不等于在跑", () => {
    expect(reconcileReseedScanJob(null, false, NOW)).toBeNull();
    expect(reconcileReseedScanJob(null, true, NOW)).toBeNull();
  });

  it("判过一次之后不会反复改判：第二次读进来已经是 stopped", () => {
    const once = reconcileReseedScanJob(orphan(), false, NOW)!;
    expect(reconcileReseedScanJob(once, false, NOW + 1)).toBe(once);
  });
});

/**
 * 辅种任务那一行 → 可扫描的线索（v0.128.0：任务行那颗「查其他站点」）。
 *
 * 全部用合成标题与合成 hash，不带任何真实种子名或账号数据。
 */
describe("reseedScanSeedOfTask：任务能给的那点线索", () => {
  it("基准在下载器里时，hash 取基准那一条（语义上最准）", () => {
    const seed = reseedScanSeedOfTask({
      title: "Some.Show.S01E01.1080p.WEB-DL",
      size: 1234.6,
      baseLocal: { hash: "AAAA1111" },
      items: [{ site: "nova", hash: "BBBB2222" }],
    })!;
    expect(seed.hash).toBe("AAAA1111");
    // 字节数取整：与本地指纹索引那第 1 层同一个取法，不round 两边 key 就不相等
    expect(seed.size).toBe(1235);
  });

  it("没有基准时才退到 items 里第一条报了 hash 的", () => {
    const seed = reseedScanSeedOfTask({
      title: "X",
      size: 10,
      items: [{ site: "a" }, { site: "b" }, { site: "c", hash: "CC" }],
    })!;
    expect(seed.hash).toBe("CC");
  });

  it("标题折不出搜索词（空 / 纯空格）时返回 null：宁可不给查", () => {
    expect(reseedScanSeedOfTask({ title: "   ", size: 10 })).toBeNull();
    expect(reseedScanSeedOfTask({ size: 10 })).toBeNull();
  });

  it("大小报不出（undefined / 负 / NaN）时记 0，不拿一个假字节进内容键", () => {
    for (const size of [undefined, -1, Number.NaN, Number.POSITIVE_INFINITY] as const) {
      expect(reseedScanSeedOfTask({ title: "X", size: size as number | undefined })!.size).toBe(0);
    }
  });

  it("已挂站点：数字 id 要收得进来、去重、忽略缺值", () => {
    const seed = reseedScanSeedOfTask({
      title: "X",
      size: 10,
      items: [{ site: 12 }, { site: "nova" }, { site: 12 }, {}, { site: undefined }],
    })!;
    expect(seed.knownSites.sort()).toEqual(["12", "nova"]);
  });
});

describe("reseedScanTargetOfSeed：对回本地那一份再折内容键", () => {
  const LOCAL_NAME = "Some Show S01E01";
  const LOCAL_SIZE = Math.round(11 * GIB);
  const TASK_NAME = "Some.Show.S01E01.1080p.WEB-DL.H264-GRP";
  const TASK_SIZE = Math.round(10.8 * GIB);

  const localCopy = (patch: { hash: string; name?: string; size?: number; sites?: string[] }) => ({
    hash: patch.hash,
    name: patch.name ?? LOCAL_NAME,
    size: patch.size ?? LOCAL_SIZE,
    sites: patch.sites,
  });

  const taskSeed = (patch: Partial<{ hash: string; knownSites: string[] }> = {}) => ({
    name: TASK_NAME,
    size: TASK_SIZE,
    hash: "ABCDEF",
    knownSites: ["march"],
    ...patch,
  });

  it("命中本地时 name/size/内容键一律改用本地那一份 —— 这是与「我的下载器」复用同一份结论的前提", () => {
    const { target, resolved } = reseedScanTargetOfSeed(taskSeed(), [localCopy({ hash: "abcdef" })]);
    expect(resolved).toBe(true);
    expect(target.name).toBe(LOCAL_NAME);
    expect(target.size).toBe(LOCAL_SIZE);
    expect(target.contentKey).toBe(reseedScanContentKey(LOCAL_NAME, LOCAL_SIZE));
    // 反面对账：界面要是自己按任务那一份折，得到的会是**另一个**键（同一颗种子两个键 = 互不复用）
    expect(target.contentKey).not.toBe(reseedScanContentKey(TASK_NAME, TASK_SIZE));
  });

  it("hash 比的是大小写归一：站点那边常写大写", () => {
    expect(reseedScanTargetOfSeed(taskSeed({ hash: "AbCdEf" }), [localCopy({ hash: "abcdef" })]).resolved).toBe(true);
  });

  it("已挂站点取并集：任务 items 的 + 本地那份 tracker 反查出来的", () => {
    const { target } = reseedScanTargetOfSeed(taskSeed(), [
      localCopy({ hash: "abcdef", sites: ["nova", "march"] }),
      localCopy({ hash: "ABCDEF", name: "另一份副本", size: LOCAL_SIZE, sites: ["ptzone"] }),
    ]);
    expect(target.knownSites.sort()).toEqual(["march", "nova", "ptzone"]);
  });

  it("对不回本地时就照任务那一份原样折，并如实回 resolved=false（界面上要据此说结论的上限）", () => {
    const { target, resolved } = reseedScanTargetOfSeed(taskSeed(), [localCopy({ hash: "999999" })]);
    expect(resolved).toBe(false);
    expect(target.contentKey).toBe(reseedScanContentKey(TASK_NAME, TASK_SIZE));
    expect(target.name).toBe(TASK_NAME);
    // 这时已知站点只有任务那一份：没有本地副本，就没有 tracker 可反查
    expect(target.knownSites).toEqual(["march"]);
  });

  it("任务压根没记下 hash（老记录）时不去猜：直接按原样折", () => {
    const { target, resolved } = reseedScanTargetOfSeed(taskSeed({ hash: undefined }), [localCopy({ hash: "abcdef" })]);
    expect(resolved).toBe(false);
    expect(target.name).toBe(TASK_NAME);
  });

  it("两条已知站点重合时不写两遍（否则计划里那一站会被跳两次、界面上的数也对不上）", () => {
    const { target } = reseedScanTargetOfSeed(taskSeed({ knownSites: ["nova", "nova"] }), [
      localCopy({ hash: "abcdef", sites: ["nova"] }),
    ]);
    expect(target.knownSites).toEqual(["nova"]);
  });

  it("对回来才复用得上缓存：同一颗种子，resolved 的那条排 0 对，对不上的那条照样重查", () => {
    const now = 2_000_000_000_000;
    const hit = reseedScanTargetOfSeed(taskSeed(), [localCopy({ hash: "abcdef" })]).target;
    const miss = reseedScanTargetOfSeed(taskSeed({ hash: undefined }), []).target;
    // 现场：hit 那一对在「我的下载器」那一屏已经查过、且还在七天新鲜期里
    const earlier: IReseedScanResult = {
      id: reseedScanResultId(hit.contentKey, "ptzone"),
      contentKey: hit.contentKey,
      siteId: "ptzone",
      verdict: "has-it",
      at: now - 60_000,
      site: { id: "42", title: LOCAL_NAME, url: "https://ptzone/details.php?id=42", link: "https://ptzone/download.php?id=42", size: LOCAL_SIZE },
    };
    const plan = planReseedScan({
      targets: [hit, miss],
      usableSites: ["ptzone"],
      cache: new Map([[earlier.id, earlier]]),
      now,
    });
    // 只有没对回本地那一条要重查 —— 对回来的那条复用得上，这正是「必须由本地折键」这一跳换来的
    expect(plan.pairs.map((pair) => pair.contentKey)).toEqual([miss.contentKey]);
    expect(plan.cached).toBe(1);
  });
});
