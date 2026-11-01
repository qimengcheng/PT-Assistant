/**
 * 「删除辅种任务时连下载器副本和数据文件一起删」认的是哪些条目（判据在 `src/shared/reseedCopyRemoval.ts`）。
 *
 * 这一族删的是用户的盘上数据，所以用例两头都要有：
 * - **多删** = 把不属于这条任务的种子、或者把同一份内容在别的任务上还需要的副本删了；
 * - **少删** = 勾了开关却只摘掉一条副本，盘上那份数据因为还挂着一条而根本没动，
 *   而界面上报的是「已删掉数据文件」（那就是句假话）。
 *
 * 特别注意第 2 条那一档：辅种辅出来的形状就是**同一份内容在下载器里有 N 条副本**
 * （v0.105.4 那次「matched[0] 只取第一条」把同站判定弄坏的正是同一个位置），这里必须全交出去。
 */
import { describe, expect, it } from "vitest";

import type { IKeepUploadTask, IKeepUploadTaskItem } from "@/shared/types.ts";
import { ignoresRemoveData, planReseedCopyRemoval } from "@/shared/reseedCopyRemoval.ts";

const H1 = "aa11bb22cc33dd44ee55ff66aa11bb22cc33dd44";
const H2 = "bb22cc33dd44ee55ff66aa11bb22cc33dd44ee55";

function item(over: Partial<IKeepUploadTaskItem> = {}): IKeepUploadTaskItem {
  return {
    site: "ptzone",
    title: "Demon Agent 2026 2160p WEB-DL",
    link: "https://ptzone.invalid/detail/101",
    url: "https://ptzone.invalid/download/101",
    size: 10_000,
    hash: H1,
    ...over,
  };
}

function task(over: Partial<IKeepUploadTask> = {}): IKeepUploadTask {
  return {
    id: "t1",
    time: 1_700_000_000_000,
    title: "Demon Agent 2026",
    size: 10_000,
    downloadOptions: { downloaderId: "d1" },
    items: [item()],
    ...over,
  };
}

/** 下载器报回来的条目（这一族只吃 hash 与 id 两样） */
const entry = (hash: string | undefined, id: string | number) => ({ hash, id });

describe("命中哪些条目", () => {
  it("记了 infoHash 的条目对得上时交回那一条", () => {
    const plan = planReseedCopyRemoval([task()], [entry(H1, "id-1")]);
    expect(plan).toEqual({ unreachable: false, matched: ["id-1"], noHash: 0, notFound: 0 });
  });

  it("同一份内容在下载器里有三条副本 → 三条全交回（只取第一条就是少删）", () => {
    const plan = planReseedCopyRemoval([task()], [entry(H1, "a"), entry("cc", "b"), entry(H1, "c"), entry(H1, "d")]);
    expect(plan.matched).toEqual(["a", "c", "d"]);
    expect(plan.notFound).toBe(0);
  });

  it("基准取自下载器那种任务：baseLocal.hash 也要算进来，它不在 items 里", () => {
    const plan = planReseedCopyRemoval([task({ items: [item({ hash: H2 })], baseLocal: { hash: H1, name: "本地那条" } })], [
      entry(H1, "base-id"),
      entry(H2, "copy-id"),
    ]);
    expect(plan.matched).toEqual(["base-id", "copy-id"]);
  });

  it("hash 大小写不一仍命中（各家报的写法不同）", () => {
    const plan = planReseedCopyRemoval([task({ items: [item({ hash: H1.toUpperCase() })] })], [entry(H1, "only")]);
    expect(plan.matched).toEqual(["only"]);
  });

  it("两条任务共用同一个 hash 时，那一条条目只交一次（不重复发两次删除）", () => {
    const plan = planReseedCopyRemoval([task({ items: [item({ hash: H1 })] }), task({ id: "t2", items: [item({ hash: H1 })] })], [
      entry(H1, "same"),
    ]);
    expect(plan.matched).toEqual(["same"]);
  });

  it("任务里没记 infoHash 的那几条单独数出来，不拿标题或 id 去猜", () => {
    const plan = planReseedCopyRemoval([task({ items: [item({ hash: H1 }), item({ hash: undefined }), item({ hash: "" })] })], [
      entry(H1, "hit"),
      entry("ee", "other"),
    ]);
    expect(plan).toEqual({ unreachable: false, matched: ["hit"], noHash: 2, notFound: 0 });
  });

  it("下载器条目没报 hash 时不许拿它的 id 顶上", () => {
    const plan = planReseedCopyRemoval([task()], [entry(undefined, H1)]);
    expect(plan.matched).toEqual([]);
    expect(plan.notFound).toBe(1);
  });
});

describe("「查不了」与「没有」必须分档", () => {
  it("列表没拿到（连不上）：一条都不删，且不许报 notFound", () => {
    const plan = planReseedCopyRemoval([task({ items: [item({ hash: H1 }), item({ hash: undefined })] })], null);
    expect(plan).toEqual({ unreachable: true, matched: [], noHash: 1, notFound: 0 });
  });

  it("拿到的是空列表：记过的那几条算 notFound，而不是连不上", () => {
    const plan = planReseedCopyRemoval([task({ items: [item({ hash: H1 }), item({ hash: H2 })] })], []);
    expect(plan.unreachable).toBe(false);
    expect(plan.matched).toEqual([]);
    expect(plan.notFound).toBe(2);
  });

  it("空列表与 null 给的是两个结论（这条判据的输入形状不许并档）", () => {
    expect(planReseedCopyRemoval([task()], []).notFound).toBe(1);
    expect(planReseedCopyRemoval([task()], null).notFound).toBe(0);
  });
});

describe("baseLocal 的缺席形状（存量数据）", () => {
  it("items 为空、只有基准时仍认基准那一条", () => {
    const plan = planReseedCopyRemoval([task({ items: [], baseLocal: { hash: H1, name: "本地那条" } })], [entry(H1, "base")]);
    expect(plan.matched).toEqual(["base"]);
  });

  it("基准那块在、却没记 hash（v0.131 之前建的任务）→ 数进 noHash，不许当成「下载器里没有」", () => {
    const plan = planReseedCopyRemoval([task({ items: [], baseLocal: { hash: "", name: "本地那条" } })], []);
    expect(plan).toEqual({ unreachable: false, matched: [], noHash: 1, notFound: 0 });
  });
});

describe("哪几家的接口删不了文件", () => {
  it("群晖与 Aria2 的 removeTorrent 不读第二个参数", () => {
    expect(ignoresRemoveData("synologyDownloadStation")).toBe(true);
    expect(ignoresRemoveData("Aria2")).toBe(true);
  });

  it("其余六家都读这一参，不许顺手加进这张表", () => {
    for (const type of ["qBittorrent", "Transmission", "uTorrent", "ruTorrent", "Deluge", "Flood"]) {
      expect(ignoresRemoveData(type)).toBe(false);
    }
  });

  it("报不出类型（下载器已被删掉）时按「能删文件」读，不给那句说明", () => {
    expect(ignoresRemoveData(undefined)).toBe(false);
    expect(ignoresRemoveData("")).toBe(false);
  });
});
