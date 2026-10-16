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
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const stub = vi.hoisted(() => ({
  /** 当前这一桩 `getAll` 该返回什么（含「永远不返回」那一档） */
  getAll: null as null | (() => Promise<unknown[]>),
  /** 当前这一桩按 id 单条读该返回什么（轮询那一路走它） */
  get: null as null | ((id: unknown) => unknown),
  /** 整表读到底发出去几趟：用来验「现在就重读」有没有把窗口里压着的那一次尾随撤干净 */
  getAllRuns: 0,
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
    getAll: async () => {
      stub.getAllRuns++;
      return stub.getAll ? stub.getAll() : [];
    },
    get: async (_store: string, id: unknown) => (stub.get ? stub.get(id) : undefined),
    delete: async (_store: string, key: unknown) => {
      stub.deleteCalls.push(key);
    },
  }),
}));

const MODULE = "@/options/views/Overview/DownloadHistory/utils.ts";

/** 一条放得下这张表的最小记录 */
function rec(id: number, name: string, status = "completed") {
  return { id, name, siteId: "snowpt", downloaderId: "d1", downloadStatus: status, downloadAt: 1 };
}

/** 每个用例都要一份干净的模块图：`isLoadingHistory` 和那两个序号都是模块级的 */
async function fresh() {
  vi.resetModules();
  return await import(/* @vite-ignore */ MODULE);
}

beforeAll(async () => {
  // 第一条用例慢，慢在 vite 现转 `utils.ts` 那张图（实测首转 ~4.8s，之后每条都是毫秒级）——
  // 整份套件并跑时这一笔会顶到 5s 默认超时，把第一条判成 timeout，再把它没跑完的在飞读取
  // 漏给下一条（表现是第二条数到 2 条提示）。所以先在这里把转换的钱付掉。
  await fresh();
}, 60_000);

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => {});
  stub.getAll = null;
  stub.get = null;
  stub.getAllRuns = 0;
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

  /**
   * 「数据刚改过」那一路必须当场重读。
   *
   * `throttle(fn, 1000)`（es-toolkit）在窗口内的每一次调用都把尾随那一次**重新排满 1 秒**
   *（走的是 `debounced.apply`，没有 maxWait 收窄），所以「进页面拉过一次 → 删一批 → 请求重读」
   * 最后那一脚落在窗口里，表格要等一秒多才动。台架按真页面量到 1986~1996 ms —— 那才是
   * 用户 2026-10-16 报的「删除数据后的数据刷新还是很慢」里的大头，读库本身不是（真实库
   * 1500 条 `getAll` 33 ms、10000 条 195 ms）。
   */
  it("现在就重读那一档当场就换数据，并且把窗口里压着的尾随撤掉", async () => {
    stub.getAll = async () => [rec(1, "甲")];
    const mod = await fresh();

    mod.throttleLoadDownloadHistory();
    await vi.advanceTimersByTimeAsync(10);
    expect(stub.getAllRuns).toBe(1);

    // 同一秒内再走节流那一个：被窗口吃掉，数据不动（这条就是界面上「点了没反应」的那一秒）
    stub.getAll = async () => [rec(2, "乙")];
    mod.throttleLoadDownloadHistory();
    await vi.advanceTimersByTimeAsync(10);
    expect(Object.keys(mod.downloadHistory.value)).toEqual(["1"]);

    mod.reloadDownloadHistoryNow();
    await vi.advanceTimersByTimeAsync(10);
    expect(Object.keys(mod.downloadHistory.value)).toEqual(["2"]);
    expect(stub.getAllRuns).toBe(2);

    // 窗口里原本压着一次尾随；不撤掉的话一秒后还要再整表读一遍
    await vi.advanceTimersByTimeAsync(3_000);
    expect(stub.getAllRuns).toBe(2);
  });
});

/**
 * 「下载中」那一列的逐秒轮询。
 *
 * 钉的是这一条：回包之后**只有状态真的变了**才换整表引用。`downloadHistory` 是 shallowRef，
 * 要触发任何东西就得整体替换，而一次替换带着 `downloadHistoryList` → `filteredItems` →
 * `a-table` 的 data-source 一路重算并把这一页重渲染一遍（台架按真组件量到一次 47~59 ms，
 * 与条数基本无关）。库里挂着 K 条状态停在 downloading/pending 的记录 = 每秒 K 次那种重渲染，
 * K=30 实测一轮 1506 ms > 1000 ms —— 界面再也没有空档。而僵尸行恰恰是「一秒回一次、回回来
 * 一模一样」那一类，守卫把它们的重渲染全部省掉。
 *
 * 反过来的那条更要紧：守卫不许把轮询本身弄停。状态没变这一轮不写，下一轮还得照样来。
 */
describe("下载状态轮询只在状态真的变了时才换整表引用", () => {
  /** 首屏先落一条 downloading，再把在飞的那轮轮询推进 */
  async function armed(status: string) {
    stub.getAll = async () => [rec(1, "甲", "downloading")];
    stub.get = () => rec(1, "甲", status);
    const mod = await fresh();
    mod.throttleLoadDownloadHistory();
    await vi.advanceTimersByTimeAsync(10);
    return mod;
  }

  it("状态没变：引用一动不动（等于不重渲染这一页）", async () => {
    const mod = await armed("downloading");
    const before = mod.downloadHistory.value;

    await vi.advanceTimersByTimeAsync(1_000);
    expect(mod.downloadHistory.value).toBe(before);
    expect(mod.downloadHistory.value[1].downloadStatus).toBe("downloading");
  });

  it("状态变了：换引用并带进新状态（这一列要当场从「下载中」变成「已完成」）", async () => {
    const mod = await armed("completed");
    const before = mod.downloadHistory.value;

    await vi.advanceTimersByTimeAsync(1_000);
    expect(mod.downloadHistory.value).not.toBe(before);
    expect(mod.downloadHistory.value[1].downloadStatus).toBe("completed");
  });

  it("跳过写入之后轮询必须还活着：连着三轮，第三轮才来回包变化的那种", async () => {
    const mod = await armed("downloading");
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(mod.downloadHistory.value[1].downloadStatus).toBe("downloading");

    stub.get = () => rec(1, "甲", "completed");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(mod.downloadHistory.value[1].downloadStatus).toBe("completed");
  });

  it("记录已经不在库里：停掉这一条的轮询，也不许把整表换掉", async () => {
    const mod = await armed("downloading");
    stub.get = () => undefined;
    const before = mod.downloadHistory.value;

    await vi.advanceTimersByTimeAsync(1_000);
    expect(mod.downloadHistory.value).toBe(before);

    // 已经停了：就算库里又冒出来一条变化的，也不该再有人读它
    stub.get = () => rec(1, "甲", "completed");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(mod.downloadHistory.value).toBe(before);
    expect(mod.downloadHistory.value[1].downloadStatus).toBe("downloading");
  });

  it("重读整表时那一轮还在飞：晚到的回包既不写回、也不清新一轮的台账", async () => {
    let settleGet: (v: unknown) => void = () => {};
    stub.getAll = async () => [rec(1, "甲", "downloading")];
    stub.get = () => new Promise((r) => (settleGet = r));
    const mod = await fresh();

    mod.throttleLoadDownloadHistory();
    await vi.advanceTimersByTimeAsync(1_000); // id=1 那一轮发出，卡在 await 上

    // 期间他又拉了一次整表：这一趟把上一轮整个作废，并给 id=9 挂上新的一轮
    stub.getAll = async () => [rec(9, "乙", "downloading")];
    await vi.advanceTimersByTimeAsync(200); // 越过节流窗口，让这一次真的发得出去
    mod.throttleLoadDownloadHistory();
    await vi.advanceTimersByTimeAsync(10);
    expect(Object.keys(mod.downloadHistory.value)).toEqual(["9"]);

    settleGet(rec(1, "甲", "completed")); // 上一轮现在才回来，带着一条「变了」的状态
    await vi.advanceTimersByTimeAsync(2_000);
    expect(mod.downloadHistory.value[1]).toBeUndefined(); // 不许把 id=1 复活进表
    expect(Object.keys(mod.downloadHistory.value)).toEqual(["9"]);
    // 新一轮（id=9）还挂在台账里，等它自己的回包 —— 下面那条用例专门钉这件事
  });

  it("被作废的那一轮不许替新一轮留下「已经不在库里」的判据", async () => {
    let settleGet: (v: unknown) => void = () => {};
    stub.getAll = async () => [rec(1, "甲", "downloading")];
    stub.get = () => new Promise((r) => (settleGet = r));
    const mod = await fresh();

    mod.throttleLoadDownloadHistory();
    await vi.advanceTimersByTimeAsync(1_000);

    stub.getAll = async () => [rec(1, "甲", "downloading")];
    await vi.advanceTimersByTimeAsync(200);
    mod.throttleLoadDownloadHistory();
    await vi.advanceTimersByTimeAsync(10);
    const mapFromNewRound = mod.downloadHistory.value;

    settleGet(undefined); // 上一轮读到的是一条已经不存在的记录
    await vi.advanceTimersByTimeAsync(0);
    expect(mod.downloadHistory.value).toBe(mapFromNewRound);

    // 它不能顺手把 id=1 的定时器摘掉：那一格现在是新一轮挂上去的，摘了就再也没人盯这条下载
    stub.get = () => rec(1, "甲", "completed");
    await vi.advanceTimersByTimeAsync(1_200);
    expect(mod.downloadHistory.value[1].downloadStatus).toBe("completed");
  });
});
