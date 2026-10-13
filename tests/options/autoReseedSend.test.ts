/**
 * 自动辅种「这一轮到底该发哪几条」那道闸（`src/options/views/Overview/KeepUploadTask/autoReseed.ts`
 * 的 `othersStillToSend`，以及它与 `planAutoReseed` 的接合处）。
 *
 * 为什么这一份必须进 Vitest：他 2026-10-13 那一屏是「辅种完成 11/11」「3/3」（= 下载器实况说
 * 每一条都在做种），而运行日志里每分钟一排 409「辅种条目发送失败」+「把种子加入下载器时报错」。
 * 根因是发送那一步只读台账（`autoState.othersSent`）—— 最初那次 add 回了错就没记上，
 * 而台账不记它就永远算「待发送」，于是每分钟回站点取 .torrent、推给下载器、再吃一次 409。
 * 这条循环在界面上看不见（那一列显示的是实况），只有日志里看得见，所以判据要能在 Node 里跑。
 *
 * 第 7 条是反空转用例：同一批输入，老口径（只看台账）必须算出「要发」、新口径必须算出「不发」，
 * 否则这道闸等于没加。
 */
import { describe, expect, it } from "vitest";

import {
  othersStillPending,
  othersStillToSend,
  planAutoReseed,
} from "@/options/views/Overview/KeepUploadTask/autoReseed.ts";
import type { IReseedItemStatus } from "@/options/views/Overview/KeepUploadTask/seedVerify.ts";

const seeding = (): IReseedItemStatus => ({ verdict: "seeding", rawState: "uploading", progress: 100, completed: true });
const notFound = (): IReseedItemStatus => ({ verdict: "notFound", rawState: "" });
const pending = (): IReseedItemStatus => ({ verdict: "pending", rawState: "" });
const wrong = (): IReseedItemStatus => ({ verdict: "wrong", rawState: "missingFiles" });

const item = (hash: string) => ({ hash, title: `种子 ${hash}` });
const KEYS = ["h1", "h2", "h3"];
const items = KEYS.map(item);
/** 台账：一条都没记过（就是他那两条任务当时的形状） */
const emptyLedger = {};

const sendKeys = (statuses: (IReseedItemStatus | undefined)[], state = emptyLedger) =>
  othersStillToSend({ state, items, statuses }).map((i) => i.hash);

describe("othersStillToSend：台账 + 这一轮实况，两道缺一不可", () => {
  it("台账缺记、可它已经在做种 —— 不发（他那一幕：11/11 还在每分钟发）", () => {
    expect(sendKeys([seeding(), seeding(), seeding()])).toEqual([]);
  });

  it("台账缺记、列表里确实没有 —— 发", () => {
    expect(sendKeys([notFound(), notFound(), notFound()])).toEqual(["h1", "h2", "h3"]);
  });

  it("只发查不到的那几条，别的不动", () => {
    expect(sendKeys([seeding(), notFound(), seeding()])).toEqual(["h2"]);
  });

  it("没记 infoHash 的那条查都没法查 —— 照旧按台账发，不替下载器编一个「不在」", () => {
    expect(sendKeys([seeding(), undefined, seeding()])).toEqual(["h2"]);
  });

  it("pending（刚推过去、还在下载器列表缓存闸后面）与 wrong（在但状态不对）都不再发", () => {
    // pending 再发是原地重发；wrong 再发也修不好，那一档归暂停那一步管
    expect(sendKeys([pending(), wrong(), seeding()])).toEqual([]);
  });

  it("台账已记、这一轮却查不到 —— 仍然不发（那是 pruneUnlandedOthers 的活，它先把台账摘掉）", () => {
    const state = { othersSent: { h1: 1, h2: 1, h3: 1 } };
    expect(othersStillToSend({ state, items, statuses: [notFound(), notFound(), notFound()] })).toEqual([]);
    // 摘过一遍之后才轮得到发送：见 pruneUnlandedOthers 那条用例
    expect(othersStillToSend({ state: { othersSent: { h2: 1, h3: 1 } }, items, statuses: [notFound(), notFound(), notFound()] }).map((i) => i.hash)).toEqual(["h1"]);
  });

  it("旧任务只有整批标记 othersSentAt：认它全发过，升级后的第一分钟不重发", () => {
    expect(othersStillToSend({ state: { othersSentAt: 1 }, items, statuses: [notFound(), notFound(), notFound()] })).toEqual([]);
  });
});

describe("与 planAutoReseed 的接合：闸真的改变了这一轮的结论", () => {
  const baseDone = (): IReseedItemStatus => ({ verdict: "seeding", rawState: "uploading", progress: 100, completed: true });

  const tick = (othersPending: number, others: IReseedItemStatus[]) =>
    planAutoReseed({
      baseLocal: true, // 基准取自下载器那条：这一半不是本次要测的，只求它不把发送挡住
      otherCount: items.length,
      othersPending,
      reachable: true,
      base: baseDone(),
      others,
      state: emptyLedger,
      now: 1_000,
    });

  it("老口径（只看台账）会说「发 3 条」—— 这就是那排 409 的来源", () => {
    const legacy = othersStillPending(emptyLedger, items);
    expect(legacy.length).toBe(3);
    expect(tick(legacy.length, [seeding(), seeding(), seeding()]).sendOthers).toBe(true);
  });

  it("新口径（台账 + 实况）算出 0 条，同一轮的 sendOthers 就是 false", () => {
    const next = othersStillToSend({ state: emptyLedger, items, statuses: [seeding(), seeding(), seeding()] });
    expect(next.length).toBe(0);
    expect(tick(next.length, [seeding(), seeding(), seeding()]).sendOthers).toBe(false);
  });

  it("还有一条真不在列表里时不许把发送一起挡掉：那道闸只挡已经在的", () => {
    const statuses = [seeding(), notFound(), seeding()];
    const next = othersStillToSend({ state: emptyLedger, items, statuses });
    expect(next.map((i) => i.hash)).toEqual(["h2"]);
    expect(tick(next.length, statuses).sendOthers).toBe(true);
  });
});
