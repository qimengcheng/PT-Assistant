/**
 * 「下载历史」那一页读取的在飞标志（判据在 `src/options/views/Overview/DownloadHistory/utils.ts`）。
 *
 * 为什么要单独钉这一条：那个 boolean 同时管着两件事 —— 界面上那圈转（表格与刷新键共用它）和
 * 「不许再发一次」那道闸。用户 2026-10-16 报的「删除了几条之后就一直转圈圈卡死」就是它卡在 true：
 * 一旦卡住，之后每次点刷新都被自己的闸吃掉，整页变成只能重开的僵尸。所以
 * 「到点一定放开」和「放开之后晚到的那一轮不许再把位置占回去」这两条必须能当场跑 ——
 * 它们坏的时候不报错、不进 vue-tsc、不进构建。
 *
 * 三处桩各有一个理由：
 * - `@/shared/indexdb.ts`：要的是「读可以永远不返回」这一种形状，真库里造不出来。
 * - 两个 store：`showSnakebar` 只记账；`lang` 固定中文。不装 pinia —— Node 里跑插件要先
 *   `createApp().use(pinia)`，而这里要判的不是 store。
 * - `@ptd/site`：这一页的筛选面板用它解析尺寸/时间，与本次判据无关，而它的根入口在 Node 里
 *   会撞上 sizzle 的顶层 `window`（AGENTS §3.2），所以整条挡掉。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stub = vi.hoisted(() => ({
  /** 当前这一桩 `getAll` 该返回什么（含「永远不返回」那一档） */
  getAll: null as null | (() => Promise<unknown[]>),
  deleteCalls: [] as unknown[],
  snakebars: [] as string[],
}));

vi.mock("@ptd/site", () => ({
  parseSizeString: (s: unknown) => Number(s) || 0,
  parseValidTimeString: (s: unknown) => Number(s) || 0,
}));

vi.mock("@/options/stores/runtime.ts", () => ({
  useRuntimeStore: () => ({ showSnakebar: (text: string) => stub.snakebars.push(text) }),
}));

vi.mock("@/options/stores/config.ts", () => ({
  useConfigStore: () => ({ lang: "zh_CN" }),
}));

vi.mock("@/shared/indexdb.ts", () => ({
  ptdIndexDb: async () => ({
    getAll: async () => (stub.getAll ? stub.getAll() : []),
    delete: async (_store: string, key: unknown) => {
      stub.deleteCalls.push(key);
    },
  }),
}));

const MODULE = "@/options/views/Overview/DownloadHistory/utils.ts";

/** 一条放得下这张表的最小记录 */
function rec(id: number, name: string) {
  return { id, name, siteId: "snowpt", downloaderId: "d1", downloadStatus: "completed", downloadAt: 1 };
}

/** 每个用例都要一份干净的模块图：`isLoadingHistory` 和那两个序号都是模块级的 */
async function fresh() {
  vi.resetModules();
  return await import(/* @vite-ignore */ MODULE);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => {});
  stub.getAll = null;
  stub.deleteCalls = [];
  stub.snakebars = [];
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("下载历史读取的在飞标志", () => {
  it("正常一趟：先占住，回来就放开，数据落地", async () => {
    stub.getAll = async () => [rec(1, "甲"), rec(2, "乙")];
    const mod = await fresh();

    mod.throttleLoadDownloadHistory();
    expect(mod.isLoadingHistory.value).toBe(true);

    await vi.advanceTimersByTimeAsync(10);
    expect(mod.isLoadingHistory.value).toBe(false);
    expect(Object.keys(mod.downloadHistory.value)).toEqual(["1", "2"]);
    expect(stub.snakebars).toEqual([]);
  });

  it("读取永远不返回：到点放开标志并明确报错，不许把整页冻成只能重开", async () => {
    stub.getAll = () => new Promise(() => {});
    const mod = await fresh();

    mod.throttleLoadDownloadHistory();
    expect(mod.isLoadingHistory.value).toBe(true);

    await vi.advanceTimersByTimeAsync(19_000);
    expect(mod.isLoadingHistory.value).toBe(true); // 还没到点，这一趟仍在等

    await vi.advanceTimersByTimeAsync(2_000);
    expect(mod.isLoadingHistory.value).toBe(false); // 到点放开：刷新键又能用了
    expect(stub.snakebars.length).toBe(1);
    expect(stub.snakebars[0]).toContain("刷新下载记录列表"); // 提示要点名那颗键，不能只说「超时」
  });

  it("放开之后：晚到的上一轮既不许占掉新一轮的标志，也不许把旧数据盖回去", async () => {
    let settleFirst: (rows: unknown[]) => void = () => {};
    stub.getAll = () => new Promise((resolve) => (settleFirst = resolve));
    const mod = await fresh();

    mod.throttleLoadDownloadHistory();
    await vi.advanceTimersByTimeAsync(20_000); // 第一轮卡住 → 看门狗放开
    expect(mod.isLoadingHistory.value).toBe(false);

    // 他点第二次刷新；这一轮故意也挂着，好量「第一轮先回来」那一刻标志归谁
    let settleSecond: (rows: unknown[]) => void = () => {};
    stub.getAll = () => new Promise((resolve) => (settleSecond = resolve));
    await vi.advanceTimersByTimeAsync(1_100); // 越过节流窗口，让这一次点真的发得出去
    mod.throttleLoadDownloadHistory();
    expect(mod.isLoadingHistory.value).toBe(true);

    settleFirst([rec(9, "旧的一轮")]);
    await vi.advanceTimersByTimeAsync(10);
    expect(mod.isLoadingHistory.value).toBe(true); // 过期的一轮不许关掉别人的标志
    expect(Object.keys(mod.downloadHistory.value)).toEqual([]); // 也不许盖数据

    settleSecond([rec(7, "新的一轮")]);
    await vi.advanceTimersByTimeAsync(10);
    expect(mod.isLoadingHistory.value).toBe(false);
    expect(Object.keys(mod.downloadHistory.value)).toEqual(["7"]);
  });

  it("删除走本地库那一份，不再绕 offscreen 一跳", async () => {
    const mod = await fresh();
    await mod.removeDownloadHistoryById(42);
    expect(stub.deleteCalls).toEqual([42]);
  });
});
