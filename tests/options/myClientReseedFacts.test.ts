/**
 * 「我的下载器」那一枚「待辅 N 站」的**拼法**（`MyClient/reseedCandidateView.ts`）。
 *
 * 判据本体（四档怎么分）由 `tests/shared/reseedCandidate.test.ts` 钉；这一份只管三条取数口径
 * 是不是真按界面上看得见的那半来的 —— 那三种错都不会报错，只会让标记安静地不出现或把数字算大：
 * ① 同内容的副本有没有并全（漏一条就虚报缺口）；② tracker 那一格各家形态不统一，
 * 折错就等于「这一份不知道挂在哪个站」；③ 一条没下完不许连带压掉同组另一条的结论。
 * 站点、下载器、种子名一律合成。
 */
import { describe, expect, it } from "vitest";

import {
  buildReseedFacts,
  buildReseedLocalBases,
  buildReseedScanScope,
  type IReseedRow,
} from "@/options/views/Overview/MyClient/reseedCandidateView.ts";
import { reseedScanContentKey } from "@/shared/reseedScanPlan.ts";
import type { IReseedScanResult, TReseedScanVerdict } from "@/shared/types/storages/reseedScan.ts";

const hostSiteEntries: [string, string][] = [
  ["pandapt.net", "pandapt"],
  ["novahd.top", "novahd"],
  ["m-team.io", "mteam"],
];
const usable = ["pandapt", "novahd", "mteam"];

/** 同一份内容（同下载器同名同大小同路径）的两条副本 */
function copies(trackerA?: string, trackerB?: string): IReseedRow[] {
  const base = { clientId: "qb1", name: "Some.Movie.2024.1080p", totalSize: 8e9, savePath: "/data/movies" };
  return [
    { key: "qb1:1", ...base, infoHash: "aaaa", tracker: trackerA, completed: true },
    { key: "qb1:2", ...base, infoHash: "bbbb", tracker: trackerB, completed: true },
  ];
}

describe("同内容的副本要并全", () => {
  it("两条副本挂在两个站 → 两行都读成「已挂 2 站、还差 1 站」", () => {
    const facts = buildReseedFacts(copies("https://tracker.pandapt.net/announce", "https://novahd.top/announce"), hostSiteEntries, usable, []);
    expect(facts.get("qb1:1")).toEqual({ kind: "candidate", pending: 1, covered: 2 });
    expect(facts.get("qb1:2")).toEqual({ kind: "candidate", pending: 1, covered: 2 });
  });

  it("同组里另一条这屏根本看不见（被折叠压住）也算已挂 —— 缺口不许按看得见的那几条算", () => {
    // 两条副本：代表行报得出站，组员行那一格是空的。只看第一行会算成「已挂 1 站」
    const facts = buildReseedFacts(copies("https://tracker.pandapt.net/announce", undefined), hostSiteEntries, usable, []);
    expect(facts.get("qb1:1")).toEqual({ kind: "candidate", pending: 2, covered: 1 });
    // 对照：这一组确实并成了一个组，所以第二行也读到同一份事实
    expect(facts.get("qb1:2")).toEqual({ kind: "candidate", pending: 2, covered: 1 });
  });

  it("名字与路径都对不上、但同属一条辅种台账的两份副本，也并成一组", () => {
    const rows: IReseedRow[] = [
      { key: "k1", clientId: "qb1", name: "Movie.A", totalSize: 1e9, savePath: "/a", infoHash: "hash1", tracker: "https://tracker.pandapt.net/announce", completed: true },
      { key: "k2", clientId: "tr1", name: "Movie A (remux)", totalSize: 2e9, savePath: "/b/c", infoHash: "hash2", tracker: "https://novahd.top/announce", completed: true },
    ];
    // 内容指纹认不出这俩（下载器/名称/大小/路径四项都不同），只有台账能把它们并上
    const byFingerprintOnly = buildReseedFacts(rows, hostSiteEntries, usable, []);
    expect(byFingerprintOnly.get("k1")).toEqual({ kind: "candidate", pending: 2, covered: 1 });
    const withTask = buildReseedFacts(rows, hostSiteEntries, usable, [{ id: 7, items: [{ hash: "HASH1" }, { hash: "hash2" }] }]);
    expect(withTask.get("k1")).toEqual({ kind: "candidate", pending: 1, covered: 2 });
    expect(withTask.get("k2")).toEqual({ kind: "candidate", pending: 1, covered: 2 });
  });
});

describe("tracker 那一格的各家形态", () => {
  it("announce 全串、裸主机名、站点域名的子域，三种都要反查得到同一个站", () => {
    const variants = ["https://Tracker.PandaPT.net:2710/announce", "tracker.pandapt.net", "pandapt.net"];
    for (const tracker of variants) {
      const facts = buildReseedFacts([{ key: "one", clientId: "qb1", name: "N", totalSize: 1, savePath: "/s", infoHash: "h", tracker, completed: true }], hostSiteEntries, usable, []);
      expect(facts.get("one")).toEqual({ kind: "candidate", pending: 2, covered: 1 });
    }
  });

  it("整组一条都认不出站 → no-site，那个数不许变成「还差全部站点」", () => {
    const facts = buildReseedFacts(copies("udp://tracker.unrelated.org/announce", "udp://tracker.unrelated.org/announce"), hostSiteEntries, usable, []);
    expect(facts.get("qb1:1")?.kind).toBe("no-site");
    // 对照：真去算缺口会虚报成 usable.length
    expect(facts.get("qb1:1")).not.toEqual({ kind: "candidate", pending: 3, covered: 0 });
  });

  it("这一格压根没报（undefined / 空串）也走 no-site，不抛", () => {
    const facts = buildReseedFacts(copies(undefined, ""), hostSiteEntries, usable, []);
    expect(facts.get("qb1:1")?.kind).toBe("no-site");
  });
});

describe("完成态按行独立", () => {
  it("同组里一条没下完只压掉它自己那条，另一条照常报缺口", () => {
    const rows = copies("https://tracker.pandapt.net/announce", "https://novahd.top/announce");
    rows[1].completed = false;
    const facts = buildReseedFacts(rows, hostSiteEntries, usable, []);
    expect(facts.get("qb1:1")).toEqual({ kind: "candidate", pending: 1, covered: 2 });
    expect(facts.get("qb1:2")).toEqual({ kind: "incomplete" });
  });

  it("整组都没下完时也照常把站并起来：判据先报没下完，但那份事实不许丢", () => {
    const rows = copies("https://tracker.pandapt.net/announce", "https://novahd.top/announce");
    rows.forEach((row) => (row.completed = false));
    const facts = buildReseedFacts(rows, hostSiteEntries, usable, []);
    expect(facts.get("qb1:1")).toEqual({ kind: "incomplete" });
  });

  it("添加的站点已经全挂上 → all-covered，界面上那枚标记不出", () => {
    const rows: IReseedRow[] = [
      { key: "a", clientId: "qb1", name: "X", totalSize: 1, savePath: "/s", infoHash: "h1", tracker: "https://tracker.pandapt.net/announce", completed: true },
      { key: "b", clientId: "qb1", name: "X", totalSize: 1, savePath: "/s", infoHash: "h2", tracker: "https://novahd.top/announce", completed: true },
      { key: "c", clientId: "qb1", name: "X", totalSize: 1, savePath: "/s", infoHash: "h3", tracker: "https://m-team.io/announce", completed: true },
    ];
    const facts = buildReseedFacts(rows, hostSiteEntries, usable, []);
    for (const key of ["a", "b", "c"]) expect(facts.get(key)).toEqual({ kind: "all-covered", covered: 3 });
  });
});

describe("一键辅种的基准来源（buildReseedLocalBases）", () => {
  it("内容键与扫描范围同一条算式：两边对不上号就会「查到了却说找不到基准」", () => {
    const rows: IReseedRow[] = [{ key: "k1", clientId: "qb1", name: "Some.Movie.2024.1080p", totalSize: 8e9, savePath: "/data/movies", infoHash: "aaaa", completed: true }];
    const scope = buildReseedScanScope(rows, hostSiteEntries, []);
    const bases = buildReseedLocalBases(rows, { qb1: "家里的 qB" });
    expect(bases.map((base) => base.contentKey)).toEqual(scope.map((item) => item.contentKey));
    expect(bases[0]).toEqual({ contentKey: scope[0].contentKey, downloaderId: "qb1", downloaderName: "家里的 qB", hash: "aaaa", name: "Some.Movie.2024.1080p", savePath: "/data/movies" });
  });

  it("没下完的那份不进基准清单（与扫描范围同一条：数据不全不能拿去辅）", () => {
    const rows: IReseedRow[] = [{ key: "k1", clientId: "qb1", name: "X", totalSize: 1, savePath: "/s", infoHash: "h", completed: false }];
    expect(buildReseedLocalBases(rows, {})).toEqual([]);
  });

  it("同一份内容有几份副本时，取第一条报得出 infoHash 的（baseLocal.hash 是必填的）", () => {
    const rows: IReseedRow[] = [
      { key: "k1", clientId: "qb1", name: "X", totalSize: 1, savePath: "/a", completed: true },
      { key: "k2", clientId: "qb1", name: "X", totalSize: 1, savePath: "/b", infoHash: "h2", completed: true },
      { key: "k3", clientId: "tr1", name: "X", totalSize: 1, savePath: "/c", infoHash: "h3", completed: true },
    ];
    const bases = buildReseedLocalBases(rows, {});
    expect(bases).toHaveLength(1);
    expect(bases[0]).toMatchObject({ hash: "h2", savePath: "/b", downloaderId: "qb1" });
  });
});

/**
 * 扫描结论 → 行上那枚标记（v0.109.8）。
 *
 * 用户 2026-10-18：「已经查过的在下载器里要标记出来，不再显示有多少站待查了」。
 * 这一族钉的是**拼法**而不是判据（判据在 `tests/shared/reseedCandidate.test.ts`）：
 * ① 结论按**整组副本**的内容键并起来 —— 同一份内容在下载器里标题写法不一致时各有 contentKey，
 *   只看其中一行就会「一半查过、仍报待查」，而那正是这一档要撤掉的东西；
 * ② 新鲜期沿用扫描那侧同一个判据（`isReseedScanFresh`）：过期的结论下一轮会被重查，
 *   这时候还标「已查」就是替人把门关上；`failed` 那一档只有 30 分钟；
 * ③ 不传扫描事实时判据与 v0.109.7 一字不差（结论还没读到 ≠ 已经查过）。
 */
describe("扫描结论要盖掉待查数", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = 1_800_000_000_000;

  /** 造一条结论：`has-it` 那两档必须带 `site.title`，否则判据按「老记录」判它不新鲜 */
  function result(contentKey: string, siteId: string, verdict: TReseedScanVerdict, at = now - 60_000): IReseedScanResult {
    return {
      id: `${contentKey}\u0000${siteId}`,
      contentKey,
      siteId,
      verdict,
      at,
      ...((verdict === "has-it" || verdict === "suspect") && { site: { title: "站上那条", url: "https://x/t", link: "https://x/d", size: 8e9 } }),
    } as IReseedScanResult;
  }

  /**
   * 同一份内容的两条副本：标题、大小、下载器、路径全不一样（⇒ **各有自己的内容键**），
   * 只有一条辅种台账能把它们并成一组 —— 上面第 51 行那条用例立的形状。
   * 为什么非要这样造：并组这一层只有「同组内内容键不止一个」时才看得出来，
   * 用同名同大小的两条副本，两条算式（并组 / 并内容键）会退化成同一件事，断言就空转了。
   */
  function twinRows(): IReseedRow[] {
    return [
      { key: "r1", clientId: "qb1", name: "Some.Movie.2024.1080p", totalSize: 1e9, savePath: "/a", infoHash: "hash1", tracker: "https://tracker.pandapt.net/announce", completed: true },
      { key: "r2", clientId: "tr1", name: "Some Movie (2024) 1080p", totalSize: 2e9, savePath: "/b", infoHash: "hash2", tracker: "https://novahd.top/announce", completed: true },
    ];
  }
  /** 把上面那两条并成一组的那条台账（`pandapt` + `novahd` 已挂，`mteam` 是唯一的待查格） */
  const twinTasks = [{ id: 7, items: [{ hash: "HASH1" }, { hash: "hash2" }] }];

  const keyOf = (row: IReseedRow) => reseedScanContentKey(row.name, Math.round(row.totalSize ?? 0));
  const stillPending = { kind: "candidate", pending: 1, covered: 2 };

  it("结论只记在其中一条副本的内容键上 → 并组之后两行都报「已查」", () => {
    const rows = twinRows();
    const facts = buildReseedFacts(rows, hostSiteEntries, usable, twinTasks, { results: [result(keyOf(rows[0]!), "mteam", "no-match")], now });
    const scanned = { kind: "scanned", scanned: 1, covered: 2, tally: { hasIt: 0, suspect: 0, noMatch: 1, failed: 0 } };
    expect(facts.get("r1")).toEqual(scanned);
    // 第二条副本自己的内容键上压根没有这条结论 —— 不并组它就会继续报「待查 1 站」
    expect(facts.get("r2")).toEqual(scanned);
  });

  it("结论落在两个内容键之外 → 两行都退回待查（上一条不是靠「怎么都算已查」蒙过去的）", () => {
    const rows = twinRows();
    const facts = buildReseedFacts(rows, hostSiteEntries, usable, twinTasks, { results: [result("别的键", "mteam", "no-match")], now });
    expect(facts.get("r1")).toEqual(stillPending);
    expect(facts.get("r2")).toEqual(stillPending);
  });

  it("结论过了七天就不再算查过：标记要退回「待查」，让人有机会重查", () => {
    const rows = twinRows();
    const stale = [result(keyOf(rows[0]!), "mteam", "no-match", now - 8 * DAY), result(keyOf(rows[1]!), "mteam", "no-match", now - 8 * DAY)];
    expect(buildReseedFacts(rows, hostSiteEntries, usable, twinTasks, { results: stale, now }).get("r1")).toEqual(stillPending);
  });

  it("「这次没查成」只压 30 分钟：八小时前的失败要重新变成待查", () => {
    const rows = twinRows();
    const longAgo = rows.map((row) => result(keyOf(row), "mteam", "failed", now - 8 * 60 * 60 * 1000));
    expect(buildReseedFacts(rows, hostSiteEntries, usable, twinTasks, { results: longAgo, now }).get("r1")).toEqual(stillPending);
    // 对照：同一条失败放在 10 分钟前，就确实算「查过了」—— 且**记在 failed 那一档**，
    // 不许被折进「没搜到」（把「这次没查成」说成「那个站没有」是假阴性，见 reseedScanPlan 文件头）
    const fresh = rows.map((row) => result(keyOf(row), "mteam", "failed", now - 10 * 60 * 1000));
    expect(buildReseedFacts(rows, hostSiteEntries, usable, twinTasks, { results: fresh, now }).get("r1")).toEqual({
      kind: "scanned",
      scanned: 1,
      covered: 2,
      tally: { hasIt: 0, suspect: 0, noMatch: 0, failed: 1 },
    });
  });

  it("升级之前那批查到的记录（没存可发送的那一半）不算查过 —— 与「一键辅种」那条同一口径", () => {
    const rows = twinRows();
    const legacy = rows.map((row) => ({ ...result(keyOf(row), "mteam", "has-it"), site: undefined }));
    expect(buildReseedFacts(rows, hostSiteEntries, usable, twinTasks, { results: legacy, now }).get("r1")).toEqual(stillPending);
  });

  it("不传扫描事实时与 v0.109.7 一字不差（结论没读到不许把人挡在门外）", () => {
    expect(buildReseedFacts(twinRows(), hostSiteEntries, usable, twinTasks).get("r1")).toEqual(stillPending);
  });
});

/**
 * 「可辅种扫描」的范围清单（同一份文件的 `buildReseedScanScope`）。
 *
 * 这一份要钉的是**扫描会不会白跑或漏跑**：
 * ① `knownSites` 少并一条 → 已挂在的那个站也被查一遍，得到一个「该站有这条」的废话结论；
 * ② 内容键与 offscreen 那侧本地指纹索引不同算法 → 查回来的结论对不上任何条目；
 * ③ 未下完的进来了 → 查到了也不能拿去辅，白烧一次站点请求。
 */
describe("buildReseedScanScope：扫描要吃的那批内容", () => {
  const key = (name: string, size: number) => reseedScanContentKey(name, size);

  it("同内容的两条副本并成一条待扫项，已挂站点取并集", () => {
    const items = buildReseedScanScope(copies("https://tracker.pandapt.net/announce", "https://novahd.top/announce"), hostSiteEntries, []);
    expect(items).toHaveLength(1);
    expect(items[0]!.knownSites.sort()).toEqual(["novahd", "pandapt"]);
    expect(items[0]!.memberKeys.sort()).toEqual(["qb1:1", "qb1:2"]);
    // 只取第一条副本的站，就会把还挂在 novahd 的那一条漏掉（v0.105.4 同族）
    expect(items[0]!.knownSites).not.toEqual(["pandapt"]);
  });

  it("内容键与 offscreen 那侧同一个算法，且字节数取整（两处都 round 才对得上）", () => {
    const rows: IReseedRow[] = [
      { key: "one", clientId: "qb1", name: "Some.Movie.2024", totalSize: 8_000_000_000.6, savePath: "/s", infoHash: "h", tracker: "", completed: true },
    ];
    const items = buildReseedScanScope(rows, hostSiteEntries, []);
    expect(items[0]!.contentKey).toBe(key("Some.Movie.2024", Math.round(8_000_000_000.6)));
    expect(items[0]!.size).toBe(Math.round(8_000_000_000.6));
  });

  it("跨下载器的同一份内容也只排一次（否则同一条查询要发两遍）", () => {
    const rows: IReseedRow[] = [
      { key: "qb1:9", clientId: "qb1", name: "Same 2024", totalSize: 5e9, savePath: "/a", infoHash: "h1", tracker: "novahd.top", completed: true },
      { key: "tr1:9", clientId: "tr1", name: "Same 2024", totalSize: 5e9, savePath: "/b", infoHash: "h2", tracker: "m-team.io", completed: true },
    ];
    const items = buildReseedScanScope(rows, hostSiteEntries, []);
    expect(items).toHaveLength(1);
    expect(items[0]!.memberKeys.sort()).toEqual(["qb1:9", "tr1:9"]);
    expect(items[0]!.knownSites.sort()).toEqual(["mteam", "novahd"]);
  });

  it("没下完的不进清单；同组里那条已下完的照常进，且已挂集合仍含未下完那条报的站", () => {
    const rows = copies("https://tracker.pandapt.net/announce", "https://novahd.top/announce");
    rows[1].completed = false;
    const items = buildReseedScanScope(rows, hostSiteEntries, []);
    expect(items).toHaveLength(1);
    expect(items[0]!.memberKeys).toEqual(["qb1:1"]);
    expect(items[0]!.knownSites.sort()).toEqual(["novahd", "pandapt"]);
  });
});
