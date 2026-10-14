/**
 * 「场上已经有一条辅种任务在管同一份内容」的判据（判据在 `src/shared/reseedTaskDup.ts`）。
 *
 * 用户 2026-10-14 要的是「重复建立时要有提示，不然两个一样的辅种任务但是基准又不一样会发生冲突」。
 * 这条判据两头都会伤人，所以两头的用例都得有：
 * - **漏判** = 又建出一条管同一份数据的任务，两边各自按自己的基准搬目录、各自回查，互相把对方
 *   放好的位置挪走；
 * - **误判** = 每次建任务都弹一句「重复」，弹多了就等于没有 —— 尤其不能把「同标题不同大小」
 *   （同一部片的不同版本）算成同一份内容。
 */
import { describe, expect, it } from "vitest";

import type { IKeepUploadTask, IKeepUploadTaskItem } from "@/shared/types.ts";
import { findDuplicateTasks } from "@/shared/reseedTaskDup.ts";

const TITLE = "Demon Agent 2026 2160p WEB-DL AAC H265 HDR-HDS";
const SIZE = 10_000_120_000;

function item(over: Partial<IKeepUploadTaskItem> = {}): IKeepUploadTaskItem {
  return {
    site: "ptzone",
    title: TITLE,
    link: "https://ptzone.invalid/detail/101",
    url: "https://ptzone.invalid/download/101",
    size: SIZE,
    ...over,
  };
}

function task(over: Partial<IKeepUploadTask> = {}): IKeepUploadTask {
  return {
    id: "task-old",
    time: 1_700_000_000_000,
    title: TITLE,
    size: SIZE,
    downloadOptions: { downloaderId: "d1" },
    items: [item()],
    ...over,
  };
}

/** 跑一遍并只留要点，断言读起来短一截 */
function hit(candidate: IKeepUploadTask, tasks: IKeepUploadTask[]) {
  const got = findDuplicateTasks(candidate, tasks);
  return got.map((h) => ({ reason: h.reason, shared: h.sharedItems, baseDiffers: h.baseDiffers }));
}

describe("什么算撞上了已有任务", () => {
  it("两条任务毫无交集时不提示", () => {
    const a = task({ items: [item({ link: "https://a.invalid/1", title: "别的片", size: 1 })] });
    const b = task({ id: "new", title: "这一条", size: 2, items: [item({ link: "https://b.invalid/2", title: "这一条", size: 2 })] });
    expect(hit(b, [a])).toEqual([]);
  });

  it("同一条种子（详情页链接相同）算撞上，并数出共有几条", () => {
    const old = task({ items: [item({ link: "https://ptzone.invalid/detail/101" }), item({ link: "https://novahd.invalid/detail/9", site: "novahd" })] });
    const fresh = task({ id: "new", items: [item({ link: "https://ptzone.invalid/detail/101" })] });
    expect(hit(fresh, [old])).toEqual([{ reason: "sameItem", shared: 1, baseDiffers: false }]);
  });

  it("链接对不上但 infoHash 相同，退到第二档", () => {
    const old = task({ items: [item({ link: "https://a.invalid/x", hash: "ABC" })] });
    const fresh = task({ id: "new", items: [item({ link: "https://b.invalid/y", hash: "abc" })] });
    expect(hit(fresh, [old])).toEqual([{ reason: "sameHash", shared: 1, baseDiffers: false }]);
  });

  it("只剩标题与大小相同，算最软那一档，且不报共有条数", () => {
    const old = task({ items: [item({ link: "https://a.invalid/x" })] });
    const fresh = task({ id: "new", items: [item({ link: "https://b.invalid/y" })] });
    // 这一档两边基准必然是不同站的两条种子（否则链接就撞上了），所以「基准不一样」是判得出的
    expect(hit(fresh, [old])).toEqual([{ reason: "sameTitleSize", shared: 0, baseDiffers: true }]);
  });

  it("标题相同但大小不同，不算同一份内容（同一部片的不同版本）", () => {
    const old = task({ items: [item({ link: "https://a.invalid/x" })] });
    const fresh = task({ id: "new", size: SIZE + 1, items: [item({ link: "https://b.invalid/y", size: SIZE + 1 })] });
    expect(hit(fresh, [old])).toEqual([]);
  });

  it("v0.100 之前的旧任务没有 hash 也没有 id，靠详情页链接照样认得出", () => {
    const legacy = task({ items: [item({ link: "https://ptzone.invalid/detail/101", hash: undefined, id: undefined })] });
    const fresh = task({ id: "new", items: [item({ link: "https://ptzone.invalid/detail/101", hash: "ABC", id: 101 })] });
    expect(hit(fresh, [legacy])).toEqual([{ reason: "sameItem", shared: 1, baseDiffers: false }]);
  });

  it("链接缺失时退到「站点 + 本站种子 id」", () => {
    const old = task({ items: [item({ link: "", id: 77, site: "yemapt" })] });
    const fresh = task({ id: "new", items: [item({ link: "", id: "77", site: "yemapt" })] });
    expect(hit(fresh, [old])).toEqual([{ reason: "sameItem", shared: 1, baseDiffers: false }]);
  });

  it("标题与 hash 都归一化：大小写、首尾空格不算两条不同的内容", () => {
    const old = task({ title: `  ${TITLE.toLowerCase()}  `, items: [item({ hash: " AbC " })] });
    const fresh = task({ id: "new", title: TITLE.toUpperCase(), items: [item({ link: "https://b.invalid/y", hash: "ABC" })] });
    expect(hit(fresh, [old])).toEqual([{ reason: "sameHash", shared: 1, baseDiffers: false }]);
  });

  it("不跟自己那条比（同 id 跳过）", () => {
    const same = task({ id: "new", items: [item()] });
    expect(hit(same, [same])).toEqual([]);
  });

  it("多条都撞上时，证据硬的排前面", () => {
    const byTitle = task({ id: "weak", items: [item({ link: "https://c.invalid/z" })] });
    const byItem = task({ id: "strong", items: [item({ link: "https://ptzone.invalid/detail/101" })] });
    const fresh = task({ id: "new", items: [item({ link: "https://ptzone.invalid/detail/101" })] });
    expect(findDuplicateTasks(fresh, [byTitle, byItem]).map((h) => h.task.id)).toEqual(["strong", "weak"]);
  });

  it("items 为空、字段缺串的脏任务不炸，也不误报", () => {
    const dirty = { id: "dirty", time: 0, title: "", size: 0, downloadOptions: { downloaderId: "d" }, items: [] } as IKeepUploadTask;
    const fresh = task({ id: "new", items: [item()] });
    expect(hit(fresh, [dirty])).toEqual([]);
  });
});

describe("「两边基准不是同一条种子」只在比得出结论时才断言", () => {
  it("基准是 items 头一条、两边同一条种子 → 不下「不同」这个判断", () => {
    const old = task({ items: [item({ link: "https://a.invalid/x", hash: "AAA" }), item({ link: "https://a.invalid/y" })] });
    const fresh = task({ id: "new", items: [item({ link: "https://a.invalid/x", hash: "AAA" })] });
    expect(hit(fresh, [old])[0].baseDiffers).toBe(false);
  });

  it("两边基准的 hash 不同 → 点名「基准不一样」", () => {
    const old = task({ items: [item({ link: "https://a.invalid/x", hash: "AAA" })] });
    const fresh = task({ id: "new", items: [item({ link: "https://b.invalid/y", hash: "BBB" })] });
    expect(hit(fresh, [old])).toEqual([{ reason: "sameTitleSize", shared: 0, baseDiffers: true }]);
  });

  it("一边基准取自下载器、另一边取自列表，但 hash 是同一颗 → 不算不同", () => {
    const old = task({ baseLocal: { hash: "AAA", name: "本地那条" }, items: [item()] });
    const fresh = task({ id: "new", items: [item({ hash: "aaa" })] });
    expect(hit(fresh, [old])[0].baseDiffers).toBe(false);
  });

  it("一边只有 hash、另一边只有详情页链接（跨轴比不出）→ 判不出就不断言", () => {
    const old = task({ baseLocal: { hash: "AAA", name: "本地那条" }, items: [item({ hash: "" })] });
    const fresh = task({ id: "new", items: [item({ link: "https://b.invalid/y", hash: "" })] });
    expect(hit(fresh, [old])[0].baseDiffers).toBe(false);
  });
});
