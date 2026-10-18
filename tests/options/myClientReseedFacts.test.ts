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

import { buildReseedFacts, type IReseedRow } from "@/options/views/Overview/MyClient/reseedCandidateView.ts";

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
