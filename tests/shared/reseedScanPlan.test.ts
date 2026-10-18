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
  reseedScanContentKey,
  reseedScanKeywords,
  reseedScanLocalGroup,
  reseedScanResultId,
  reseedScanScreen,
  reseedScanVerdict,
} from "@/shared/reseedScanPlan.ts";
import type { ILocalTorrentFingerprintEntry } from "@/shared/fingerprint/types.ts";
import type { IReseedScanResult, IReseedScanTarget } from "@/shared/types/storages/reseedScan.ts";

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

function result(siteId: string, at: number, verdict: IReseedScanResult["verdict"] = "no-match"): IReseedScanResult {
  return { id: reseedScanResultId("k", siteId), contentKey: "k", siteId, verdict, at };
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
