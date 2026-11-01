/**
 * 「基准那份数据此刻在哪」这一格怎么随下载器刷（`refreshBaseLocalPaths`），
 * 本轮新增的是**基准那条已经不在下载器里**那一档（用户 2026-11-01：
 * 「这个其实已经移动完了，但是界面上还是卡在这里」）。
 *
 * 为什么必须记这一位：界面上那句「目录不一致」读的是 `baseLocal.savePath`，而它只在
 * 下载器报回一个新路径时才刷。基准都不在场 ⇒ 那个值永远刷不到 ⇒ 提示挂成一句
 * **再也不会变的假话**，而那一行还挂着两颗点了没用的处置键。
 *
 * 两条口径同时钉住，缺一就会退回到其中一种坏法：
 * - 「**只在真拿到列表时才写**」：下载器连不上（调用方压根不会走到这里）与"列表里没有"
 *   是两件事，把前者写成后者就是一句新的假话；
 * - 「**它不参与发送那道闸**」：本轮只改说法。所以这里断言的是记位与写回次数，
 *   不判发送。
 */
import { describe, expect, it } from "vitest";

import { refreshBaseLocalPaths, type IBasePathBearer } from "@/shared/reseedPath.ts";

/** 造一条带基准的任务：savePath 是"当初记下的那份快照"。要改别的位就拿到返回值之后再写 */
function task(over: { hash?: string; basePath?: string; taskPath?: string } = {}): {
  baseLocal: NonNullable<IBasePathBearer["baseLocal"]>;
  downloadOptions: { savePath?: string | null };
} {
  const { hash = "aaaa", basePath = "D:/data/movie", taskPath = "D:/data/movie" } = over;
  return {
    baseLocal: { hash, savePath: basePath },
    downloadOptions: { savePath: taskPath },
  };
}

/** 下载器报的列表：只给这一族吃得下的三点 */
const list = (...items: Array<{ hash?: string; savePath?: string; contentPath?: string }>) =>
  items.map((x) => ({ infoHash: x.hash, savePath: x.savePath, contentPath: x.contentPath }));

describe("基准不在场：记一位，并且只在真的变了时才要写回", () => {
  it("拿到了列表而列表里没有它 → missingInClient，并要写回", () => {
    const t = task();
    const dirty = refreshBaseLocalPaths([t], list({ hash: "bbbb", savePath: "D:/other" }));
    expect(dirty).toEqual([t]);
    expect(t.baseLocal.missingInClient).toBe(true);
  });

  it("已经记过了就不再报第二次（每分钟一趟，写回必须是幂等的）", () => {
    const t = task();
    refreshBaseLocalPaths([t], list());
    expect(refreshBaseLocalPaths([t], list())).toEqual([]);
    expect(t.baseLocal.missingInClient).toBe(true);
  });

  it("记位时不许顺手改那份快照路径（改了就等于编一个下载器没报的数）", () => {
    const t = task();
    refreshBaseLocalPaths([t], list({ hash: "bbbb", savePath: "D:/other" }));
    expect(t.baseLocal.savePath).toBe("D:/data/movie");
  });

  it("又在场了（撤销删除、重新添加）→ 撤掉那一句，也要写回", () => {
    const t = task();
    refreshBaseLocalPaths([t], list());
    expect(t.baseLocal.missingInClient).toBe(true);
    const dirty = refreshBaseLocalPaths([t], list({ hash: "aaaa", savePath: "D:/data/movie" }));
    expect(dirty).toEqual([t]);
    expect("missingInClient" in t.baseLocal).toBe(false);
  });

  it("同一趟里既撤位又刷路径：撤位那一次也要进 dirty（否则界面那句撤不掉）", () => {
    const t = task();
    t.baseLocal.missingInClient = true;
    refreshBaseLocalPaths([t], list({ hash: "aaaa", savePath: "D:/moved/here" }));
    expect(t.baseLocal.missingInClient).toBe(undefined);
    expect(t.baseLocal.savePath).toBe("D:/moved/here");
  });

  it("列表里那条没报 infoHash，而任务也没记 hash → 不算「找到了」，也不算「不在」", () => {
    const t = task({ hash: "" });
    expect(refreshBaseLocalPaths([t], list({ savePath: "D:/data/movie" }))).toEqual([]);
    expect(t.baseLocal.missingInClient).toBe(undefined);
  });

  it("hash 大小写不同也算同一条（下载器报小写，任务里存的原样）", () => {
    const t = task({ hash: "AAAA" });
    expect(refreshBaseLocalPaths([t], list({ hash: "aaaa", savePath: "D:/data/movie" }))).toEqual([]);
    expect(t.baseLocal.missingInClient).toBe(undefined);
  });

  it("任务没记 hash、而列表里也有一条没报 infoHash → 不许把那条当成它：那会把别人的目录写进这份快照", () => {
    const t = task({ hash: "", basePath: "D:/mine" });
    expect(refreshBaseLocalPaths([t], list({ savePath: "D:/someone-else" }))).toEqual([]);
    expect(t.baseLocal.savePath).toBe("D:/mine");
  });

  it("没有基准的任务整条不参与（列表那一路是辅种检测弹窗，不是这一族）", () => {
    const t: IBasePathBearer = { baseLocal: null, downloadOptions: { savePath: "D:/data" } };
    expect(refreshBaseLocalPaths([t], list())).toEqual([]);
  });
});

describe("在场那一档的既有行为不许被本轮带坏（路径照刷、意图位只在确定一致时清）", () => {
  it("下载器报了新路径 → 写进任务并要写回", () => {
    const t = task({ basePath: "D:/old", taskPath: "D:/new" });
    expect(refreshBaseLocalPaths([t], list({ hash: "aaaa", savePath: "D:/new" }))).toEqual([t]);
    expect(t.baseLocal.savePath).toBe("D:/new");
  });

  it("按新路径确定地对上了 → 清掉「正在搬」那一位", () => {
    const t = task({ basePath: "D:/old", taskPath: "D:/new" });
    t.baseLocal.moveToTaskPath = true;
    refreshBaseLocalPaths([t], list({ hash: "aaaa", savePath: "D:/new" }));
    expect("moveToTaskPath" in t.baseLocal).toBe(false);
  });

  it("任务目录还是分类名、而分类表没取到 → 判不出，不许清「正在搬」（那是「不知道」不是「已搬到」）", () => {
    const t = task({ taskPath: "category:电影", basePath: "D:/old" });
    t.baseLocal.moveToTaskPath = true;
    refreshBaseLocalPaths([t], list({ hash: "aaaa", savePath: "D:/new" }));
    expect(t.baseLocal.moveToTaskPath).toBe(true);
  });

  it("那条种子报了路径以外什么都没报（savePath 为空）→ 这一趟不动它，也不判不在", () => {
    const t = task();
    expect(refreshBaseLocalPaths([t], list({ hash: "aaaa" }))).toEqual([]);
    expect(t.baseLocal.missingInClient).toBe(undefined);
  });
});
