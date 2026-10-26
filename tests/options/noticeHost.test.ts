/**
 * `src/options/noticeHost.ts` 的行为断言（2026-10-26 换 @zboson/ui 的通知卡片时新增）。
 *
 * 钉的是三件事，每一件都对应一处「写错了不报错、只在界面上少东西」的形状：
 *  1. 同 id 再来一次必须是**替换** —— 实测组件的 `open()` 是 push（NoticeGroup.js:79-91），
 *     少了那一次 `remove()` 就会像旧版那样「四条并排堆着」；
 *  2. 没有明细时**不许**写 modalTitle / modalText —— 组件要求两个都非空才画那颗「详情」链接，
 *     只给一个就是一颗点了开不出东西的死键；
 *  3. 宿主还没挂上时要**响**，而不是静默把通知丢掉。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NoticeGroupItem, NoticeGroupItemInput, NoticeGroupRef } from "@zboson/ui";

import { openNoticeCard, setNoticeHost } from "@/options/noticeHost.ts";

/** 只实现 NoticeGroupRef 那几个方法，把调用按顺序记下来 */
function makeFakeGroup() {
  const calls: Array<{ m: string; arg: string | NoticeGroupItemInput }> = [];
  const host: NoticeGroupRef = {
    nativeElement: null,
    open(config: NoticeGroupItemInput): NoticeGroupItem {
      calls.push({ m: "open", arg: config });
      return { ...config, id: config.id ?? "x", message: config.message ?? "", type: config.type ?? "info", duration: config.duration ?? 5 };
    },
    newNotice(): NoticeGroupItem {
      throw new Error("这条判据不走 newNotice");
    },
    remove(id: string): void {
      calls.push({ m: "remove", arg: id });
    },
    removeNotification(id: string): void {
      calls.push({ m: "removeNotification", arg: id });
    },
    clear(): void {
      calls.push({ m: "clear", arg: "" });
    },
  };
  return { host, calls };
}

const card = {
  id: "reseed-done",
  type: "success" as const,
  title: "辅种完成",
  message: "3 个任务",
};

afterEach(() => {
  setNoticeHost(null);
  vi.restoreAllMocks();
});

describe("通知卡片宿主", () => {
  it("同 id 先撤旧卡再开新卡（顺序反了就会叠着堆）", () => {
    const { host, calls } = makeFakeGroup();
    setNoticeHost(host);
    openNoticeCard(card);
    expect(calls.map((c) => c.m)).toEqual(["remove", "open"]);
    expect(calls[0].arg).toBe("reseed-done");
  });

  it("id / type / title / message / duration 原样交给组件", () => {
    const { host, calls } = makeFakeGroup();
    setNoticeHost(host);
    openNoticeCard({ ...card, duration: 8 });
    expect(calls[1].arg).toMatchObject({ id: "reseed-done", type: "success", title: "辅种完成", message: "3 个任务", duration: 8 });
  });

  it("有明细：整段进详情弹窗，逐行用换行连起来", () => {
    const { host, calls } = makeFakeGroup();
    setNoticeHost(host);
    openNoticeCard({ ...card, details: ["A 站 · 玩具总动员", "B 站 · 玩具总动员"] });
    const sent = calls[1].arg as NoticeGroupItemInput;
    expect(sent.modalText).toBe("A 站 · 玩具总动员\nB 站 · 玩具总动员");
    expect(sent.modalTitle).toBe("辅种完成");
  });

  it("没明细：modalTitle 与 modalText 一个都不写（写了就是颗死键）", () => {
    const { host, calls } = makeFakeGroup();
    setNoticeHost(host);
    openNoticeCard({ ...card, details: [] });
    const sent = calls[1].arg as NoticeGroupItemInput;
    expect(sent.modalTitle).toBeUndefined();
    expect(sent.modalText).toBeUndefined();
  });

  it("宿主没挂上：console.error 响一条，且不许抛异常打断调用方", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => openNoticeCard(card)).not.toThrow();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("卸载后（宿主置 null）同样不画、也要响", () => {
    const { host } = makeFakeGroup();
    setNoticeHost(host);
    setNoticeHost(null);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    openNoticeCard(card);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
