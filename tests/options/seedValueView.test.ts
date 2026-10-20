/**
 * 「做种价值」那一屏的**取数与拼法**（`SeedValue/seedValueView.ts`）。
 *
 * 判据本体（时魔公式、分档）由 `tests/shared/seedValue.test.ts` 钉；这一份只管四件事会不会安静地错：
 * ① 下载器报的那一堆字段有没有折对（把暂停的当在做种、把 `completion_on = 0` 当 1970 年，
 *    都不报错，只让某一类内容算歪）；
 * ② 同内容的副本有没有并全（漏一条就少算一份产出，而他读到的是「这一项只剩一站在跑」）；
 * ③ 站点反查有没有按**每一份副本**各算一次（拿组里第一条的站点套整组，就是把 N 份产出报成 1 份）；
 * ④ 默认序的方向（这一屏的用途是「哪些可以不再做种」，排反了人就找不到那几条）。
 * 站点、下载器、种子名一律合成，不含任何真实数据。
 */
import { describe, expect, it } from "vitest";

import { CTorrentState, type CTorrent } from "@ptd/downloader/types.ts";
import {
  buildSeedValueItems,
  sortSeedValueItems,
  toSeedValueRows,
  type ISeedValueItem,
  type ISeedValueRow,
} from "@/options/views/Overview/SeedValue/seedValueView.ts";

const WEEK = 7 * 24 * 3600;
const GIB = 1024 ** 3;
const NOW = 1_800_000_000;

const hostSiteEntries: [string, string][] = [
  ["pandapt.net", "pandapt"],
  ["novahd.top", "novahd"],
];

function row(over: Partial<ISeedValueRow> & { key: string }): ISeedValueRow {
  return {
    clientId: "qb1",
    name: "Some.Show.S01E01.1080p",
    totalSize: 2 * GIB,
    savePath: "/data/shows",
    completed: true,
    seeding: true,
    totalUploaded: 0,
    uploadSpeed: 0,
    ...over,
  };
}

/**
 * 一条「折算基数恰好等于 GiB 数」的在做种副本：老种子（Ci 精确为 1）+ 人数报不出（Di 取下界 1），
 * 这样期望值是个整数，量的是拼装而不是公式。
 */
function clean(over: Partial<ISeedValueRow> & { key: string }): ISeedValueRow {
  return row({ seedingSince: NOW - 1000 * WEEK, ...over });
}

function build(rows: ISeedValueRow[], tasks: Parameters<typeof buildSeedValueItems>[2] = [], now = NOW) {
  return buildSeedValueItems(rows, hostSiteEntries, tasks, now);
}

/** 造一项的骨架，只用来给排序那两条摆权重 */
function item(key: string, name: string, weight: number): ISeedValueItem {
  return { key, name, bytes: 0, memberKeys: [], verdict: { weight } as ISeedValueItem["verdict"] };
}

describe("下载器那一份 → 这一屏那一份（toSeedValueRows）", () => {
  function torrent(over: Partial<CTorrent>): CTorrent {
    return {
      id: 1,
      infoHash: "aaaa",
      name: "Some.Show.S01E01.1080p",
      progress: 100,
      isCompleted: true,
      ratio: 3,
      dateAdded: 0,
      savePath: "/data/shows",
      state: CTorrentState.seeding,
      totalSize: 2 * GIB,
      uploadSpeed: 0,
      downloadSpeed: 0,
      totalUploaded: 0,
      totalDownloaded: 0,
      raw: {},
      clientId: "qb1",
      ...over,
    } as CTorrent;
  }

  it("做种中的那条：折成 completed + seeding，并透传全网做种人数", () => {
    const [one] = toSeedValueRows([torrent({ completedDate: NOW - 30 * WEEK, swarmSeeders: 9, totalUploaded: 123, uploadSpeed: 456 })]);
    expect(one!.completed).toBe(true);
    expect(one!.seeding).toBe(true);
    expect(one!.swarmSeeders).toBe(9);
    expect(one!.seedingSince).toBe(NOW - 30 * WEEK);
    expect(one!.totalUploaded).toBe(123);
    expect(one!.uploadSpeed).toBe(456);
    expect(one!.key).toBe("qb1:1");
  });

  it("「数据下完了」不等于「在做种」：暂停着的那条 seeding 必须是 false", () => {
    // 这一条是整屏最容易安静错的一档：拿 isCompleted 当 seeding，暂停的种会被算成还在产出魔力
    const [one] = toSeedValueRows([torrent({ state: CTorrentState.paused, isCompleted: true })]);
    expect(one!.completed).toBe(true);
    expect(one!.seeding).toBe(false);
  });

  it("只勾选下载了部分文件的那条：completed 为 false", () => {
    const [one] = toSeedValueRows([torrent({ isCompleted: false })]);
    expect(one!.completed).toBe(false);
  });

  it("completion_on 报 0（没下完时 qBittorrent 就这么给）时退回添加时间，不当成 1970 年", () => {
    const [one] = toSeedValueRows([torrent({ completedDate: 0, dateAdded: NOW - 5 * WEEK })]);
    expect(one!.seedingSince).toBe(NOW - 5 * WEEK);
  });

  it("两个时间都报不出时那一格留空，不许折成 0（0 会被当成一条 1970 年的老种子，Ci 直接拉满）", () => {
    const [one] = toSeedValueRows([torrent({ completedDate: 0, dateAdded: 0 })]);
    expect(one!.seedingSince).toBeUndefined();
  });

  it("做种人数没报的那一家留 undefined，不许折成 0（0 会丢掉「人数未知」那句说明）", () => {
    const [one] = toSeedValueRows([torrent({ swarmSeeders: undefined })]);
    expect(one!.swarmSeeders).toBeUndefined();
  });
});

describe("同内容的副本要并全（buildSeedValueItems）", () => {
  it("两条副本挂在两个站 → 一项，两份产出相加，站点数 2", () => {
    const items = build([
      clean({ key: "qb1:1", tracker: "https://pandapt.net/announce.php?passkey=x" }),
      clean({ key: "qb1:2", tracker: "https://announce.novahd.top/announce" }),
    ]);
    expect(items).toHaveLength(1);
    const verdict = items[0]!.verdict;
    expect(verdict.copies).toBe(2);
    expect(verdict.seedingCopies).toBe(2);
    expect(verdict.siteCount).toBe(2);
    // 每份 2 GiB、Ci=1、Di=1 ⇒ 合计 4
    expect(verdict.weight).toBeCloseTo(4, 10);
  });

  it("占用磁盘取的是组内最大那一份，不是各份相加", () => {
    // 大小不同就进不了内容指纹那一层，只能靠台账并组 —— 这一条同时钉住「台账那一路也认」
    const items = build(
      [
        clean({ key: "qb1:1", name: "Show S01E01", infoHash: "hashA", totalSize: 2 * GIB }),
        clean({ key: "qb1:2", name: "Show/S01E01", infoHash: "hashB", totalSize: 3 * GIB }),
      ],
      [{ id: "t1", items: [{ hash: "hashA" }, { hash: "hashB" }] }],
    );
    expect(items).toHaveLength(1);
    expect(items[0]!.bytes).toBe(3 * GIB);
    expect(items[0]!.verdict.bytes).toBe(3 * GIB);
  });

  it("累计上传按各份相加，不做去重", () => {
    const items = build([clean({ key: "qb1:1", totalUploaded: 100 }), clean({ key: "qb1:2", totalUploaded: 250 })]);
    expect(items[0]!.verdict.uploaded).toBe(350);
  });

  it("台账把「名称写法不同」的两条并成一项（与「我的下载器」折叠同一个判据）", () => {
    // 内容指纹认不出这两条（名称不同），只能靠辅种台账并组 —— 不复用那份判据就会各算一项
    const items = build(
      [
        clean({ key: "qb1:1", name: "Show S01E01", infoHash: "hashA", tracker: "https://pandapt.net/announce" }),
        clean({ key: "qb1:2", name: "Show/S01E01", infoHash: "hashB", tracker: "https://novahd.top/announce" }),
      ],
      [{ id: "t1", items: [{ hash: "hashA" }, { hash: "hashB" }] }],
    );
    expect(items).toHaveLength(1);
    expect(items[0]!.verdict.copies).toBe(2);
    expect(items[0]!.verdict.weight).toBeCloseTo(4, 10);
  });

  it("认不出站点的那两份照算进产出，只是站点那一栏报不出", () => {
    const items = build([
      clean({ key: "qb1:1", tracker: "https://pandapt.net/announce" }),
      clean({ key: "qb1:2", tracker: "https://tracker.unknown.example/announce" }),
      clean({ key: "qb1:3", tracker: undefined }),
    ]);
    const verdict = items[0]!.verdict;
    expect(verdict.seedingCopies).toBe(3);
    expect(verdict.siteCount).toBe(1);
    expect(verdict.unknownSiteCopies).toBe(2);
    expect(verdict.weight).toBeCloseTo(6, 10);
  });

  it("站点归属按每一份各反查一次（拿第一条套整组会把 3 份产出报成 1 份）", () => {
    const items = build([
      clean({ key: "qb1:1", tracker: "https://pandapt.net/announce" }),
      clean({ key: "qb1:2", tracker: "https://pandapt.net/announce" }),
      clean({ key: "qb1:3", tracker: "https://novahd.top/announce" }),
    ]);
    const verdict = items[0]!.verdict;
    // 站名去重是 2（两站），份数是 3，产出按 3 份折 —— 三个数各有各的单位，界面要分开读
    expect(verdict.siteCount).toBe(2);
    expect(verdict.seedingCopies).toBe(3);
    expect(verdict.weight).toBeCloseTo(6, 10);
    expect(verdict.details.map((detail) => detail.siteId)).toEqual(["pandapt", "pandapt", "novahd"]);
  });

  it("暂停的那一份不产权重，但仍在份数里（界面要说出「3 份里有 2 份没在做种」）", () => {
    const items = build([
      clean({ key: "qb1:1", tracker: "https://pandapt.net/announce" }),
      clean({ key: "qb1:2", seeding: false, tracker: "https://novahd.top/announce" }),
      clean({ key: "qb1:3", seeding: false, tracker: "https://novahd.top/announce" }),
    ]);
    const verdict = items[0]!.verdict;
    expect(verdict.copies).toBe(3);
    expect(verdict.seedingCopies).toBe(1);
    expect(verdict.weight).toBeCloseTo(2, 10);
    expect(verdict.details[1]!.weight).toBeNull();
    expect(verdict.details[1]!.counted).toBe(false);
    expect(verdict.siteCount).toBe(1);
  });

  it("一条都没在做种 → idle，而不是「价值低」", () => {
    const items = build([clean({ key: "qb1:1", seeding: false })]);
    expect(items[0]!.verdict.tier).toBe("idle");
  });

  it("名称、大小、路径任一项不同就各算一项，不许只按名称并", () => {
    const items = build([clean({ key: "qb1:1", tracker: "https://pandapt.net/announce" }), clean({ key: "qb1:2", savePath: "/elsewhere" })]);
    expect(items).toHaveLength(2);
  });

  it("memberKeys 要带齐组内全部行键（回「我的下载器」找那几条靠它）", () => {
    const items = build([clean({ key: "qb1:1" }), clean({ key: "qb1:2" }), clean({ key: "qb1:3", name: "Other" })]);
    expect(items.find((each) => each.name === "Some.Show.S01E01.1080p")!.memberKeys).toEqual(["qb1:1", "qb1:2"]);
  });
});

describe("默认序（sortSeedValueItems）", () => {
  it("权重从低到高：最该考虑的排最前", () => {
    const sorted = sortSeedValueItems([item("a", "B", 9), item("b", "A", 1)]);
    expect(sorted.map((each) => each.key)).toEqual(["b", "a"]);
  });

  it("权重相同再按名称，保证同一份数据每次进来序都一样", () => {
    const sorted = sortSeedValueItems([item("a", "Beta", 5), item("b", "Alpha", 5)]);
    expect(sorted.map((each) => each.name)).toEqual(["Alpha", "Beta"]);
  });

  it("不许就地排传进来那一份", () => {
    const source = [item("a", "B", 9), item("b", "A", 1)];
    sortSeedValueItems(source);
    expect(source.map((each) => each.key)).toEqual(["a", "b"]);
  });
});
