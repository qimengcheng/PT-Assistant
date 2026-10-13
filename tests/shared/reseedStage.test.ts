/**
 * 「做种状态」那一列的档位判据（`src/options/views/Overview/KeepUploadTask/seedVerify.ts` 的 `reseedStage`）。
 *
 * 为什么现在补这一份：v0.94.2 起后台每发出去一条就把那一条的结论写成「待确认」落库，
 * 为的是让这一列当场从「还没推」翻成「辅种中 i/N」，而不是等整批串行发完。
 * 那个改变**只发生在档位上** —— 判据没动过，之前也没人从 Node 侧钉过它，
 * 于是「写 pending 到底有没有让界面翻面」这件事全靠读代码相信。这里把它钉住：
 * 第 1、2 条是那一趟改的分界（同一批条目，只多出一条 pending，档位就必须换）。
 */
import { describe, expect, it } from "vitest";

import { reseedStage, baseAlreadySent, nothingLeftToReseed } from "@/options/views/Overview/KeepUploadTask/seedVerify.ts";
import type { IReseedItemStatus } from "@/options/views/Overview/KeepUploadTask/seedVerify.ts";

const seeding = (): IReseedItemStatus => ({ verdict: "seeding", rawState: "uploading", progress: 100, completed: true });
const notFound = (): IReseedItemStatus => ({ verdict: "notFound", rawState: "" });
const pending = (): IReseedItemStatus => ({ verdict: "pending", rawState: "" });

describe("reseedStage：基准取自下载器（baseLocal）那一档", () => {
  it("一条都没露面时是「基准下载完成」，不是「辅种中」", () => {
    const info = reseedStage({ checked: true, baseLocal: {}, others: [notFound(), notFound(), notFound()] });
    expect(info.stage).toBe("baseReady");
    expect(info.doneCount).toBe(0);
  });

  it("刚发出第一条就翻成「辅种中」—— v0.94.2 逐条落库吃的就是这一条", () => {
    const info = reseedStage({ checked: true, baseLocal: {}, others: [pending(), notFound(), notFound()] });
    expect(info.stage).toBe("reseeding");
  });

  it("全部在做种才是「辅种完成」，并带出条数", () => {
    const info = reseedStage({ checked: true, baseLocal: {}, others: [seeding(), seeding()] });
    expect(info.stage).toBe("done");
    expect(info.doneCount).toBe(2);
    expect(info.totalCount).toBe(2);
  });

  it("有没记 infoHash 的条目时不许报「完成」—— 那几条压根没核对过", () => {
    const info = reseedStage({ checked: true, baseLocal: {}, others: [seeding()], untracked: 1 });
    expect(info.stage).toBe("reseeding");
  });

  it("没回查过（checked=false）时是「没查过」，不拿旧条目编出进度", () => {
    expect(reseedStage({ checked: false, baseLocal: {}, others: [] }).stage).toBe("idle");
  });
});

describe("reseedStage：异常优先与基准那条", () => {
  it("任何一条判成异常就先报异常，进度档位让位", () => {
    const info = reseedStage({
      checked: true,
      baseLocal: {},
      others: [seeding(), { verdict: "wrong", rawState: "missingFiles" }],
    });
    expect(info.stage).toBe("wrong");
    expect(info.wrongCount).toBe(1);
  });

  it("基准不在列表里时报「未发现基准种子」，不报「辅种中」", () => {
    const info = reseedStage({ checked: true, base: notFound(), others: [notFound()] });
    expect(info.stage).toBe("baseMissing");
  });

  it("基准还在下时报「基准下载中」并带进度", () => {
    const info = reseedStage({
      checked: true,
      base: { verdict: "pending", rawState: "downloading", progress: 42, completed: false, downloading: true },
      others: [notFound()],
    });
    expect(info.stage).toBe("baseDownloading");
    expect(info.progress).toBe(42);
  });
});

/**
 * 「操作」那三颗手动发送键的闸（用户 2026-10-13：「辅种都完成了还可以发送种子？
 * 基准下载中怎么还能发送基准？」）。这里断言的是**档位 → 按不按**这一半，
 * 档位本身上一节已经钉过，所以按钮和「做种状态」那一列不可能各说一套。
 */
describe("baseAlreadySent / nothingLeftToReseed：发送键的闸跟着档位走", () => {
  it("基准正在下：那颗「发送基准」按住（再发就是重复下载）", () => {
    const info = reseedStage({
      checked: true,
      base: { verdict: "pending", rawState: "downloading", progress: 4, completed: false, downloading: true },
      others: [notFound()],
    });
    expect(baseAlreadySent(info.stage)).toBe(true);
    // 基准在下、辅种条目还没露面：那两颗「发辅种」不按住，那是他手动补发的入口
    expect(nothingLeftToReseed(info.stage)).toBe(false);
  });

  it("辅种全部完成：三颗全按住", () => {
    const info = reseedStage({ checked: true, base: seeding(), others: [seeding(), seeding()] });
    expect(info.stage).toBe("done");
    expect(baseAlreadySent(info.stage)).toBe(true);
    expect(nothingLeftToReseed(info.stage)).toBe(true);
  });

  it("基准不在下载器里 / 压根没回查过：那颗「发送基准」要能点", () => {
    expect(baseAlreadySent("baseMissing")).toBe(false);
    expect(baseAlreadySent("idle")).toBe(false);
  });

  it("异常那一档放行：它只说「有某条不对」，判不出基准在不在，不替他猜", () => {
    expect(baseAlreadySent("wrong")).toBe(false);
    expect(nothingLeftToReseed("wrong")).toBe(false);
  });

  it("辅种进行中：还有没挂上的条目，那两颗发送键不许按住", () => {
    const info = reseedStage({ checked: true, base: seeding(), others: [seeding(), notFound()] });
    expect(info.stage).toBe("reseeding");
    expect(baseAlreadySent(info.stage)).toBe(true);
    expect(nothingLeftToReseed(info.stage)).toBe(false);
  });
});
