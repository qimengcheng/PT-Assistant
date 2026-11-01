/**
 * 「把某一条待辅条目换成这一批的新基准」这道判断（用户 2026-11-01 拍的方向）。
 *
 * 这一族的代价是**不对称**的：换对了其余各条就挂得上，换错了其余各条带着 `skip_checking`
 * 推到一份根本没下完的数据上 = 整批 0% 卡住。所以五种「不换」各要有一条用例，
 * 而且「拿不准」那一档必须落在不换那一边。
 */
import { describe, expect, it } from "vitest";

import { decidePromoteItemToBase } from "@/shared/reseedPromoteBase.ts";

const item = { hash: "AAAA", title: "以法之名 S01" };
/** 下载器报的列表：`list({})` = 恰好一条对得上的；不传参是**空列表**（别拿它当"那一条"） */
const list = (...over: Array<Record<string, unknown>>) =>
  over.map((x) => ({ infoHash: "aaaa", name: "In the Name of Justice 2025", savePath: "G:/TVSeries", isCompleted: true, ...x }));

describe("换得成的那一档", () => {
  it("条目此刻在下载器里、已下完、报得出目录 → 用它当新基准", () => {
    expect(decidePromoteItemToBase(item, list({}))).toEqual({
      kind: "promoted",
      baseLocal: { hash: "aaaa", name: "In the Name of Justice 2025", savePath: "G:/TVSeries" },
    });
  });

  it("hash 两侧都归一到小写并剥空白（下载器报小写，任务里存的原样）", () => {
    expect(decidePromoteItemToBase({ hash: " AAaa ", title: "" }, list({ infoHash: "aaaa" })).kind).toBe("promoted");
  });

  it("下载器没报种子名时退回条目自己的标题（那一行要说的是「基准是哪条」，不能是空串）", () => {
    const out = decidePromoteItemToBase(item, list({ name: "  " }));
    if (out.kind !== "promoted") throw new Error(`应当判成 promoted，实际 ${out.reason}`);
    expect(out.baseLocal.name).toBe("以法之名 S01");
  });

  it("交回来的那份只有三个键：`contentIsFile` 不写 —— 这里没有文件清单，没资格判那一档", () => {
    const out = decidePromoteItemToBase(item, list({}));
    if (out.kind !== "promoted") throw new Error(`应当判成 promoted，实际 ${out.reason}`);
    expect(Object.keys(out.baseLocal).sort()).toEqual(["hash", "name", "savePath"]);
  });
});

describe("五种不换，各说清一个原因（出路不同，不许并档）", () => {
  it("任务里没记下 infoHash → noHash", () => {
    expect(decidePromoteItemToBase({ hash: "", title: "x" }, list({}))).toEqual({
      kind: "blocked",
      reason: "noHash",
    });
    expect(decidePromoteItemToBase({ hash: undefined, title: "x" }, list({}))).toEqual({
      kind: "blocked",
      reason: "noHash",
    });
  });

  it("列表压根没拿到（连不上）→ unreachable，不许说成「不在下载器里」", () => {
    for (const torrents of [null, undefined]) {
      expect(decidePromoteItemToBase(item, torrents)).toEqual({ kind: "blocked", reason: "unreachable" });
    }
  });

  it("拿到了列表而没有它 → notInClient", () => {
    expect(decidePromoteItemToBase(item, list({ infoHash: "bbbb" }))).toEqual({
      kind: "blocked",
      reason: "notInClient",
    });
    // 列表里那条自己没报 infoHash 也不算它（否则空串会跟空串撞上）
    expect(decidePromoteItemToBase({ hash: "", title: "x" }, list({ infoHash: "" }))).toEqual({
      kind: "blocked",
      reason: "noHash",
    });
  });

  it("没下完 → incomplete；`isCompleted` 缺席也算没下完（不许拿缺字段猜成完成）", () => {
    expect(decidePromoteItemToBase(item, list({ isCompleted: false }))).toEqual({
      kind: "blocked",
      reason: "incomplete",
    });
    expect(decidePromoteItemToBase(item, list({ isCompleted: undefined }))).toEqual({
      kind: "blocked",
      reason: "incomplete",
    });
  });

  it("下完了但没报保存目录 → noPath（换过去照样核对不了，等于白换）", () => {
    expect(decidePromoteItemToBase(item, list({ savePath: "   " }))).toEqual({ kind: "blocked", reason: "noPath" });
    expect(decidePromoteItemToBase(item, list({ savePath: undefined }))).toEqual({ kind: "blocked", reason: "noPath" });
  });
});
