/**
 * 「把本地文件移到任务目录」要一起带上哪几条（`src/shared/reseedMoveCohort.ts`）。
 *
 * 用户 2026-10-14 报的形状：同一份内容在 qBittorrent 里 13 条副本共用一个文件夹，昨天只搬了
 * 基准那一条，其余 8 条今天开下载器全变「丢失文件」。他要的是**以后一起改**（已经断的那批他自己
 * 处理），所以「谁算相关」这条判据必须能当场跑：漏判 = 又弄坏几条，多判 = 把不相干的种子改到
 * 别的目录去（那比漏判更糟 —— 它会把好端端的做种挪走）。两边用例都得有。
 */
import { describe, expect, it } from "vitest";

import { pickRelocateCohort, type ICohortTorrent } from "@/shared/reseedMoveCohort.ts";

const OLD = "/downloads/pt";
const NEW = "/nas/pt";

/** 基准：藏宝阁那条已下完的（名字就是盘上那个文件夹名） */
const BASE_NAME = "沉默的荣耀.Silent.Honor.2025.S01.2160p.IQ.WEB-DL.H265.AAC-PTerWEB";

function torrent(hash: string, over?: Partial<ICohortTorrent>): ICohortTorrent {
  return { hash, name: BASE_NAME, savePath: OLD, ...over };
}

const BASE = torrent("AAAA");

function pick(torrents: ICohortTorrent[], over?: Partial<Parameters<typeof pickRelocateCohort>[0]>) {
  return pickRelocateCohort({ torrents, baseHash: "AAAA", oldPath: OLD, newPath: NEW, ...over });
}

describe("会被这一次搬运带走的，就是同目录同种子名那几条", () => {
  it("同目录 + 同名（每站一条的副本）全部进集合", () => {
    const got = pick([BASE, torrent("BBBB"), torrent("CCCC"), torrent("DDDD")]);
    expect(got.hashes).toEqual(["aaaa", "bbbb", "cccc", "dddd"]);
  });

  it("同目录但不同种子名 = 别的内容的另一个文件夹，不进", () => {
    const got = pick([BASE, torrent("BBBB", { name: "凡人修仙传.2025.FS" })]);
    expect(got.hashes).toEqual(["aaaa"]);
  });

  it("同名但在别的目录下 = 另一份数据，不进", () => {
    const got = pick([BASE, torrent("BBBB", { savePath: "/downloads/other" })]);
    expect(got.hashes).toEqual(["aaaa"]);
  });

  it("路径写法差异（反斜杠 / 尾斜杠 / 盘符大小写）不能把真副本判没", () => {
    const winOld = "C:/pt/movies";
    const got = pickRelocateCohort({
      torrents: [
        { hash: "AAAA", name: BASE_NAME, savePath: "c:\\pt\\movies\\" },
        { hash: "BBBB", name: BASE_NAME, savePath: "C:/pt/movies" },
        { hash: "CCCC", name: BASE_NAME, savePath: "C:\\pt\\movies\\" },
      ],
      baseHash: "aaaa",
      oldPath: winOld,
      newPath: "D:/pt/movies",
    });
    expect(got.hashes).toEqual(["aaaa", "bbbb", "cccc"]);
  });
});

describe("任务里记着的那几条即使站点给的名字不同也一起带上", () => {
  it("items 的 hash 命中旧目录 → 进；顺带那几条按「不属于任务」计数", () => {
    const got = pick([BASE, torrent("BBBB", { name: "沉默的荣耀 (BTSCHOOL 版)" }), torrent("CCCC")], {
      itemHashes: ["bbbb"],
    });
    expect(got.hashes).toEqual(["aaaa", "bbbb", "cccc"]);
    expect(got.outsideTaskCount).toBe(1);
  });

  it("名字没报上来（undefined）时，只有 items 里记着的才进", () => {
    const got = pick([BASE, torrent("BBBB", { name: undefined }), torrent("CCCC", { name: undefined })], {
      itemHashes: ["bbbb"],
    });
    expect(got.hashes).toEqual(["aaaa", "bbbb"]);
    expect(got.outsideTaskCount).toBe(0);
  });
});

describe("基准永远排第一（真正挪文件的是它，顺序反了发送那道闸就永远不放行）", () => {
  it("hash 大小写与空白归一，且不重复", () => {
    const got = pickRelocateCohort({
      torrents: [torrent("  AaAa "), torrent("BBBB"), torrent("bbbb")],
      baseHash: "aaaa",
      oldPath: OLD,
      newPath: NEW,
    });
    expect(got.hashes[0]).toBe("aaaa");
    expect(got.hashes).toEqual(["aaaa", "bbbb"]);
  });
});

describe("判不出的几种情况一律退回「只搬基准」，不猜", () => {
  it("旧目录或新目录缺失", () => {
    expect(pick([BASE, torrent("BBBB")], { oldPath: "" }).hashes).toEqual(["aaaa"]);
    expect(pick([BASE, torrent("BBBB")], { newPath: "  " }).hashes).toEqual(["aaaa"]);
  });

  it("两个目录本来就相同（没有搬运这回事）", () => {
    expect(pick([BASE, torrent("BBBB")], { newPath: "/downloads/pt/" }).hashes).toEqual(["aaaa"]);
  });

  it("基准不在这份列表里（列表还没取到 / 已被删）", () => {
    expect(pick([torrent("BBBB")]).hashes).toEqual(["aaaa"]);
  });

  it("列表为空", () => {
    expect(pick([]).hashes).toEqual(["aaaa"]);
  });
});

describe("反空转：不比大小，也不整行放倒", () => {
  it("大小报得不一样（各家字段含义不同）的真副本仍然进", () => {
    const got = pick([
      { hash: "AAAA", name: BASE_NAME, savePath: OLD },
      { hash: "BBBB", name: BASE_NAME, savePath: OLD },
    ]);
    expect(got.hashes).toEqual(["aaaa", "bbbb"]);
  });

  it("一份列表里混着「该带的」和「不该带的」时，只挑出该带的那些", () => {
    const got = pick([
      BASE,
      torrent("BBBB"),
      torrent("CCCC", { name: "别的种子" }),
      torrent("DDDD", { savePath: "/elsewhere" }),
      torrent("EEEE", { name: "" }),
    ]);
    expect(got.hashes).toEqual(["aaaa", "bbbb"]);
    expect(got.outsideTaskCount).toBe(1);
  });
});
