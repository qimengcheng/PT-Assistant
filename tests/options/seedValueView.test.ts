/**
 * 「做种价值」那一屏的**取数与拼法**（`SeedValue/seedValueView.ts`）。
 *
 * 判据本体（时魔公式、分档）由 `tests/shared/seedValue.test.ts` 钉；这一份只管四件事会不会安静地错：
 * ① 下载器报的那一堆字段有没有折对（把暂停的当在做种、把 `completion_on = 0` 当 1970 年，
 *    都不报错，只让某一类内容算歪）；
 * ② 同内容的副本有没有并全（漏一条就少算一份产出，而他读到的是「这一项只剩一站在跑」）；
 * ③ 站点反查有没有按**每一份副本**各算一次（拿组里第一条的站点套整组，就是把 N 份产出报成 1 份）；
 * ④ 默认序的方向（这一屏的用途是「哪些可以不再做种」，排反了人就找不到那几条）；
 * ⑤ 分类那一档折得对不对、下拉候选与两条闸接得对不对（v0.123.0 加的分类筛选）。
 * 站点、下载器、种子名一律合成，不含任何真实数据。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CTorrentState, type CTorrent } from "@ptd/downloader/types.ts";
import {
  buildSeedValueItems,
  filterSeedValueItems,
  seedValueCategoryChoices,
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

function build(
  rows: ISeedValueRow[],
  tasks: Parameters<typeof buildSeedValueItems>[2] = [],
  now = NOW,
  siteMapOf: Parameters<typeof buildSeedValueItems>[4] = () => undefined,
) {
  return buildSeedValueItems(rows, hostSiteEntries, tasks, now, siteMapOf);
}

/** 造一项的骨架，只用来给排序与筛选那几条摆数据 */
function item(key: string, name: string, weight: number, over: Partial<ISeedValueItem> = {}): ISeedValueItem {
  return { key, name, bytes: 0, memberKeys: [], categoryKind: null, verdict: { weight } as ISeedValueItem["verdict"], ...over };
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

  it("下载器挂的分类（qBittorrent 的 category）交下来给折类用；没挂的留 undefined", () => {
    // 这一条钉的是接线：判据本体（sharedCategory）有自己的用例，但 `label` 没搬下来的话
    // 那一整档原料会安静地消失 —— 反证 ⑨ 第一次就是这么全绿的
    const [withLabel] = toSeedValueRows([torrent({ label: "电影" })]);
    expect(withLabel!.category).toBe("电影");
    const [without] = toSeedValueRows([torrent({ label: undefined })]);
    expect(without!.category).toBeUndefined();
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

  it("大小不同就各算一项（同名的两条不同压制版本不许并成一条）", () => {
    const items = build([clean({ key: "qb1:1" }), clean({ key: "qb1:2", totalSize: 3 * GIB })]);
    expect(items).toHaveLength(2);
  });

  it("memberKeys 要带齐组内全部行键（回「我的下载器」找那几条靠它）", () => {
    const items = build([clean({ key: "qb1:1" }), clean({ key: "qb1:2" }), clean({ key: "qb1:3", name: "Other" })]);
    expect(items.find((each) => each.name === "Some.Show.S01E01.1080p")!.memberKeys).toEqual(["qb1:1", "qb1:2"]);
  });
});

/**
 * 并组的单位是**内容**，不是「同一台下载器的同一个目录」（用户 2026-10-23：「做种站点计算不正确」）。
 *
 * 原先这一屏直接复用「我的下载器」**折叠**那套判据（名称 + 大小 + 路径 + 下载器四项全等），
 * 而 qBittorrent 给每个站点建一个分类、分类各自带一条保存路径 ⇒ 同一片内容被折成 N 组，
 * 每一行都只报「1 份副本 · 做种站点 1」。折叠那边把路径当判据是有理由的（折叠会**藏行**，
 * 并错一条等于把他需要看见的一条种子藏起来），这一屏不藏任何东西 —— 组里每一条都还在
 * `memberKeys` 与份数里，所以它可以、也应当按内容并。
 */
describe("同内容跨目录 / 跨下载器的副本要并成一项", () => {
  it("一份内容各站各存一个目录（他那 13 份的形状）→ 一项，站点数按各站算", () => {
    const items = build([
      clean({ key: "qb1:1", savePath: "/data/pandapt", tracker: "https://pandapt.net/announce" }),
      clean({ key: "qb1:2", savePath: "/data/novahd", tracker: "https://novahd.top/announce" }),
      clean({ key: "qb1:3", savePath: "/data/elsewhere", tracker: "https://tracker.unknown.example/announce" }),
    ]);
    expect(items).toHaveLength(1);
    const verdict = items[0]!.verdict;
    expect(verdict.copies).toBe(3);
    expect(verdict.seedingCopies).toBe(3);
    expect(verdict.siteCount).toBe(2);
    expect(verdict.unknownSiteCopies).toBe(1);
    expect(verdict.weight).toBeCloseTo(6, 10);
    expect(verdict.locations).toBe(3);
  });

  it("路径不同 ⇒ 磁盘按两处各算一份（这个数是他决定「还占不占着」的依据，少说 13 倍比多说更坏）", () => {
    const items = build([
      clean({ key: "qb1:1", savePath: "/data/pandapt" }),
      clean({ key: "qb1:2", savePath: "/data/novahd" }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]!.bytes).toBe(4 * GIB);
    expect(items[0]!.verdict.bytes).toBe(4 * GIB);
    expect(items[0]!.verdict.locations).toBe(2);
  });

  it("路径相同（辅种指向同一个目录）⇒ 磁盘只算一份", () => {
    const items = build([clean({ key: "qb1:1", tracker: "https://pandapt.net/announce" }), clean({ key: "qb1:2", tracker: "https://novahd.top/announce" })]);
    expect(items[0]!.bytes).toBe(2 * GIB);
  });

  it("两家下载器上路径字面相同也算两处（各自占各自的磁盘）", () => {
    const items = build([clean({ key: "qb1:1", clientId: "qb1" }), clean({ key: "tr1:1", clientId: "tr1" })]);
    expect(items).toHaveLength(1);
    expect(items[0]!.verdict.bytes).toBe(4 * GIB);
    expect(items[0]!.verdict.siteCount).toBe(0);
  });

  it("标题写法不同但归一后是同一份内容（分隔符 / 压制组尾标的差异）→ 并成一项", () => {
    // 站点各自重打包 .torrent 时标题写法不一样：`A.B.2024.1080p-WiKi` 与 `A B (2024) 1080p-WiKi`
    const items = build([
      clean({ key: "qb1:1", name: "A.B.2024.1080p.WEB-DL.H264-WiKi", tracker: "https://pandapt.net/announce" }),
      clean({ key: "qb1:2", name: "A B (2024) 1080p WEB-DL H264-WiKi", tracker: "https://novahd.top/announce" }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]!.verdict.siteCount).toBe(2);
  });

  it("名称折不出可用信息的那几行不许只按大小并组（那是把不同内容吹成一条）", () => {
    // `normalizeTitle` 对纯符号名返回空串，此时内容键只剩大小 —— 同大小不等于同内容
    const items = build([clean({ key: "qb1:1", name: "???" }), clean({ key: "qb1:2", name: "!!!" })]);
    expect(items).toHaveLength(2);
  });

  it("名称折不出时，台账仍能把它们并成一项（台账是精确证据，不看字面）", () => {
    const items = build(
      [
        clean({ key: "qb1:1", name: "???", infoHash: "hashA", tracker: "https://pandapt.net/announce" }),
        clean({ key: "qb1:2", name: "!!!", infoHash: "hashB", tracker: "https://novahd.top/announce" }),
      ],
      [{ id: "t1", items: [{ hash: "hashA" }, { hash: "hashB" }] }],
    );
    expect(items).toHaveLength(1);
    expect(items[0]!.verdict.siteCount).toBe(2);
  });

  it("同一份数据的两条副本（同下载器同目录）不因并组而漏掉任何一行", () => {
    const items = build([clean({ key: "qb1:1" }), clean({ key: "qb1:2" }), clean({ key: "qb1:3" })]);
    expect(items).toHaveLength(1);
    expect(items[0]!.memberKeys).toEqual(["qb1:1", "qb1:2", "qb1:3"]);
    expect(items[0]!.verdict.copies).toBe(3);
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

describe("这一组算哪一类（categoryKind）", () => {
  it("下载器自己挂的分类能单独折出一档", () => {
    const items = build([clean({ key: "qb1:1", category: "电影" })]);
    expect(items[0]!.categoryKind).toBe("movie");
  });

  it("台账条目在各站上的叫法一起投票，按多的那档算（与辅种任务页、目录预选同一口径）", () => {
    // 三份副本都挂在同一条台账上：站点写法 3 综艺 + 1 电视剧 ⇒ 综艺赢
    const items = build(
      [
        clean({ key: "qb1:1", name: "Show A", infoHash: "h1" }),
        clean({ key: "qb1:2", name: "Show B", infoHash: "h2" }),
        clean({ key: "qb1:3", name: "Show C", infoHash: "h3" }),
        clean({ key: "qb1:4", name: "Show D", infoHash: "h4" }),
      ],
      [
        {
          id: "t1",
          items: [
            { hash: "h1", site: "pandapt", category: "综艺" },
            { hash: "h2", site: "pandapt", category: "电视剧" },
            { hash: "h3", site: "pandapt", category: "综艺" },
            { hash: "h4", site: "pandapt", category: "综艺" },
          ],
        },
      ],
    );
    expect(items[0]!.categoryKind).toBe("variety");
  });

  it("站点自己的分类映射（设置页「其他设置 → 分类映射」）参与折类", () => {
    const items = build(
      [clean({ key: "qb1:1", name: "Show A", infoHash: "h1", category: undefined })],
      [{ id: "t1", items: [{ hash: "h1", site: "pandapt", category: "特殊分类" }] }],
      NOW,
      (siteId) => (siteId === "pandapt" ? { 特殊分类: "music" } : undefined),
    );
    expect(items[0]!.categoryKind).toBe("music");
    // 反证锚点：覆盖表没读时「特殊分类」折出来是 other（= 说不清，不投票），这一条会跟着变 null
    expect(
      build([clean({ key: "qb1:1", name: "Show A", infoHash: "h1" })], [
        { id: "t1", items: [{ hash: "h1", site: "pandapt", category: "特殊分类" }] },
      ])[0]!.categoryKind,
    ).toBeNull();
  });

  it("一条台账在一组里只算一次票（按副本重复计票会把下载器那一档压掉）", () => {
    // 组里两条副本都认到 t1；t1 的条目是 2 综艺 + 1 电视剧，两条副本各挂一个「电影」。
    // 去重：综艺 2 vs 电影 2 → 并列不猜 → null。没去重：综艺 4 vs 电影 2 → variety。
    const items = build(
      [
        clean({ key: "qb1:1", name: "Show A", infoHash: "h1", category: "电影" }),
        clean({ key: "qb1:2", name: "Show B", infoHash: "h2", category: "电影" }),
      ],
      [
        {
          id: "t1",
          items: [
            { hash: "h1", site: "pandapt", category: "综艺" },
            { hash: "h2", site: "pandapt", category: "综艺" },
            { hash: "h2", site: "pandapt", category: "电视剧" },
          ],
        },
      ],
    );
    expect(items).toHaveLength(1);
    expect(items[0]!.categoryKind).toBeNull();
  });

  it("折不出类别的那些（other）不投票，也不否决别人", () => {
    // 「自制分类X」谁都折不出：它既不该成为一档，也不该把「电影」那一条拖成说不清
    const items = build([clean({ key: "qb1:1", category: "自制分类X" }), clean({ key: "qb1:2", category: "电影" })]);
    expect(items[0]!.categoryKind).toBe("movie");
  });

  it("一条都报不出分类时是 null，不是「其他」", () => {
    const items = build([clean({ key: "qb1:1" })]);
    expect(items[0]!.categoryKind).toBeNull();
  });
});

describe("分类下拉的候选（seedValueCategoryChoices）", () => {
  it("只列这批里真有的，按 CATEGORY_KINDS 定序而不是按出现次数", () => {
    // 出现先后故意摆成 anime → tv → movie，与 CATEGORY_KINDS 的定序正好相反：
    // 反证 ⑤ 第一次全绿就是因为夹具的插入序恰好等于期望序，`[...present]` 那种改坏测不出来
    const list = [
      item("a", "A", 1, { categoryKind: "anime" }),
      item("b", "B", 1, { categoryKind: "tv" }),
      item("c", "C", 1, { categoryKind: "tv" }),
      item("d", "D", 1, { categoryKind: "tv" }),
      item("e", "E", 1, { categoryKind: "movie" }),
    ];
    expect(seedValueCategoryChoices(list)).toEqual(["movie", "tv", "anime"]);
  });

  it("折不出（null）的那些不进候选", () => {
    expect(seedValueCategoryChoices([item("a", "A", 1), item("b", "B", 1, { categoryKind: "movie" })])).toEqual(["movie"]);
  });

  it("一批全是 null 时候选是空表，而不是给一档「其他」兜着", () => {
    expect(seedValueCategoryChoices([item("a", "A", 1), item("b", "B", 1)])).toEqual([]);
  });
});

describe("两条闸（filterSeedValueItems）", () => {
  const low = (key: string, categoryKind: ISeedValueItem["categoryKind"]): ISeedValueItem => ({
    ...item(key, key, 1),
    verdict: { weight: 1, tier: categoryKind === null ? "low" : "high" } as ISeedValueItem["verdict"],
    categoryKind,
  });
  const list = [low("a", "movie"), low("b", "tv"), low("c", null), low("d", "movie")];

  it("两个都不筛时原样全出（顺序也不动）", () => {
    expect(filterSeedValueItems(list, { lowOnly: false, kind: null }).map((each) => each.key)).toEqual(["a", "b", "c", "d"]);
  });

  it("按分类筛：折不出（null）那一条不出现", () => {
    expect(filterSeedValueItems(list, { lowOnly: false, kind: "movie" }).map((each) => each.key)).toEqual(["a", "d"]);
    expect(filterSeedValueItems(list, { lowOnly: false, kind: "tv" }).map((each) => each.key)).toEqual(["b"]);
  });

  it("两条闸是「与」：勾上只看低价值后再按分类筛，两个条件都要满足", () => {
    expect(filterSeedValueItems(list, { lowOnly: true, kind: "movie" }).map((each) => each.key)).toEqual([]);
    expect(filterSeedValueItems(list, { lowOnly: true, kind: null }).map((each) => each.key)).toEqual(["c"]);
  });

  it("不许就地改传进来那一份（下拉的候选要拿同一份未筛过的底再算一次）", () => {
    filterSeedValueItems(list, { lowOnly: true, kind: "movie" });
    expect(list).toHaveLength(4);
  });
});

/**
 * 页面那一侧的接线（按源码文本钉）。
 *
 * 为什么在这儿钉：上面那些判据改坏了用例会红，但**页面把候选从筛完的那一份算**、
 * 或者**筛选变了却不回到第 1 页**，纯函数层一个字都不红 —— 而这两条坏起来都是界面上
 * 「换了个筛选就什么都没有」（v0.112.0 / v0.46.0 各犯过一次）。与 `settingsSearch.test.ts` 同一做法。
 * ⚠️ 读源码文本前先归一换行符：本仓工作区经 core.autocrlf 是 CRLF，钉的是形状不是换行符。
 */
describe("页面那一侧的形状", () => {
  const page = readFileSync(
    fileURLToPath(new URL("../../src/options/views/Overview/SeedValue/Index.vue", import.meta.url)),
    "utf8",
  ).replace(/\r\n/g, "\n");

  it("候选从不筛过的那一份算（拿筛完的算 = 选了之后换不回去）", () => {
    const choices = /const categoryOptions = computed\(\(\) => \[[\s\S]*?\n\]\);/.exec(page);
    expect(choices, "找不到 categoryOptions 那一段").toBeTruthy();
    expect(choices![0]).toContain("seedValueCategoryChoices(items.value)");
    expect(choices![0]).not.toContain("visible.value");
  });

  it("筛选与那一勾都改回第 1 页", () => {
    expect(page).toMatch(/watch\(\[onlyLow, categoryFilter\], \(\) => \{\n {2}tablePage\.value = 1;/);
    // 受控分页真接上了：表格的 @change 走 onTableChange，不是直接把 handleTableChange 挂上去
    expect(page).toMatch(/@change="onTableChange"/);
    expect(page).toMatch(/current: tablePage\.value/);
  });

  it("那一列折不出时留空，不画「其他」", () => {
    const cell = /<template v-else-if="column\.key === 'category'">([\s\S]*?)<\/template>/.exec(page);
    expect(cell, "找不到分类那一格").toBeTruthy();
    expect(cell![0]).toMatch(/v-if="record\.categoryKind"/);
    expect(cell![0]).not.toMatch(/其他|other/);
  });

  it("表头与下拉的「全部」档都走 i18n，两侧都有键", () => {
    expect(page).toContain('t("SeedValue.column.category")');
    expect(page).toContain('t("SeedValue.filter.categoryAll")');
    for (const file of ["zh_CN", "en"]) {
      const j = JSON.parse(
        readFileSync(fileURLToPath(new URL(`../../src/locales/${file}.json`, import.meta.url)), "utf8"),
      ) as { SeedValue: { column: Record<string, string>; filter: Record<string, string> } };
      expect(j.SeedValue.column.category, `${file} 缺 SeedValue.column.category`).toBeTypeOf("string");
      expect(j.SeedValue.filter.categoryAll, `${file} 缺 SeedValue.filter.categoryAll`).toBeTypeOf("string");
    }
  });

  it("「占用磁盘」那一格说清按几处计，且只有一份副本时不叠浮层", () => {
    // 这一屏的磁盘数换了单位（一处物理数据算一次），不说清就会让人以为 13 份也只占一份；
    // 而只有一份时那句话是把旁边的数字重复一遍（AGENTS §3.4：那种浮层不叠）
    const cell = /<template v-else-if="column\.key === 'size'">([\s\S]*?)<\/template>\s*\n/.exec(page);
    expect(cell, "找不到大小那一格").toBeTruthy();
    expect(cell![0]).toMatch(/<HoverTip v-if="record\.verdict\.copies > 1" :text="sizeTip\(record\)">/);
    expect(page).toMatch(/function sizeTip\(item: ISeedValueItem\): string \{\n {2}return t\("SeedValue\.sizeTip", \{ copies: item\.verdict\.copies, locations: item\.verdict\.locations \}\);/);
    for (const file of ["zh_CN", "en"]) {
      const j = JSON.parse(
        readFileSync(fileURLToPath(new URL(`../../src/locales/${file}.json`, import.meta.url)), "utf8"),
      ) as { SeedValue: { sizeTip: string } };
      expect(j.SeedValue.sizeTip, `${file} 缺 SeedValue.sizeTip`).toBeTypeOf("string");
      // 插值参数少给一个就是「分布在 {locations} 处」这种半截话（v0.109.7 那一族）
      for (const token of ["{copies}", "{locations}"]) {
        expect(j.SeedValue.sizeTip, `${file} 的 sizeTip 应当含 ${token}`).toContain(token);
      }
    }
  });
});
