/**
 * 「我的数据」那一页的收敛节拍（判据在 `src/options/views/Overview/MyData/utils/lastUserData.ts`）。
 *
 * 为什么要单独钉这一条：一轮刷新是**逐站**把用户信息写回 store 的，而表格以前直接读那份 store，
 * 于是「一条回包 = 一次整表重算 + 整表重渲染」。产物级实测（`.tmp-build/bench-mydata`）：
 * 40 行那一档一次 pass 要 261 ms，把 40 条一次写完也只 317 ms —— 钱全花在 pass 的条数上；
 * 用户 2026-10-17 读到的现象是「加载的时候点别的标签没有响应」（实测那一拍点导航要等 221~275 ms）。
 *
 * 现在表格读的是一份**每 250 ms 最多收敛一次**的快照。这条链坏的时候不报错、不进 vue-tsc、
 * 不进构建，只表现为「又开始一卡一卡」或者「数据永远不出现」，所以两半都要钉：
 * ① 合起来只画一次；② 一条都不许丢。
 *
 * 数值一律合成（站点名 alpha/beta/gamma），不含任何真实账号数据。
 *
 * 四处桩的理由：`@ptd/site` 根入口在 Node 里撞 sizzle 的顶层 `window`（AGENTS §3.2），改从子模块
 * 原样 re-export；三个 store 不装 pinia（Node 里跑插件要先 `createApp().use(pinia)`，而本次判的
 * 不是 store），但**必须是 reactive 的** —— 这条判据量的就是「写进响应式源能不能被窗口合住」。
 */
import { watch } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EResultParseStatus } from "@ptd/site";

import type { IStoredUserInfo } from "@/shared/types.ts";

const SITE_IDS = ["alpha", "beta", "gamma"];

const store = vi.hoisted(() => ({
  metadata: null as unknown,
  config: null as unknown,
}));

vi.mock("@ptd/site", async () => {
  // 真那份根入口在 Node 里会撞上 sizzle 的顶层 `window`（AGENTS §3.2），而这里要用的
  // fixRatio / EResultParseStatus 都住在子模块里 —— 原样 re-export，不抄第二份算法
  const base = await import("@ptd/site/types/base.ts");
  const level = await import("@ptd/site/utils/level.ts");
  const filesize = await import("@ptd/site/utils/filesize.ts");
  const datetime = await import("@ptd/site/utils/datetime.ts");
  return { ...base, ...level, ...filesize, ...datetime };
});

vi.mock("@/messages.ts", () => ({
  // 永不 resolve：本趟不验回包，只验「回包落地之后界面怎么收敛」
  sendMessage: () => new Promise(() => {}),
  onMessage: () => () => {},
}));

vi.mock("@/options/i18nOutside.ts", () => ({ tOutside: (key: string) => key }));

vi.mock("@/options/views/Overview/MyData/utils/siteMetadata.ts", async () => {
  const { shallowReactive } = await import("vue");
  const ids = ["alpha", "beta", "gamma"];
  return {
    allAddedSiteMetadata: shallowReactive(
      Object.fromEntries(
        ids.map((id) => [id, { id, type: "private", siteName: id, combinedSiteName: id, isDead: false, isOffline: false }]),
      ),
    ),
    loadAllAddedSiteMetadata: async () => ({}),
  };
});

vi.mock("@/options/stores/metadata.ts", async () => {
  const { reactive: vueReactive } = await import("vue");
  store.metadata = vueReactive({
    sites: {} as Record<string, unknown>,
    lastUserInfo: {} as Record<string, unknown>,
  });
  return { useMetadataStore: () => store.metadata };
});

vi.mock("@/options/stores/config.ts", async () => {
  const { reactive: vueReactive } = await import("vue");
  store.config = vueReactive({
    lang: "zh_CN",
    userInfo: { showDeadSiteInOverview: false, showPassedSiteInOverview: true },
    myDataTableControl: {},
  });
  return { useConfigStore: () => store.config };
});

vi.mock("@/options/stores/runtime.ts", async () => {
  const { reactive: vueReactive } = await import("vue");
  const runtime = vueReactive({ userInfo: { flushPlan: {} }, showSnakebar: () => {} });
  return { useRuntimeStore: () => runtime };
});

/** 每次写入都换一个新对象，和真那条路（`lastUserInfo[site] = userInfo`）同形 */
function account(id: string, seed: number): IStoredUserInfo {
  return {
    site: id,
    status: EResultParseStatus.success,
    name: `user-${seed}`,
    uploaded: seed * 1000,
    downloaded: 1000,
    ratio: seed,
    levelId: 1,
    levelName: `等级${seed}`,
    messageCount: 0,
    joinTime: 1_700_000_000_000,
    updateAt: 1_700_000_000_000,
  } as IStoredUserInfo;
}

async function seedSites() {
  const { useMetadataStore } = await import("@/options/stores/metadata.ts");
  const metadata = useMetadataStore();
  SITE_IDS.forEach((id, i) => {
    metadata.sites[id] = { sortIndex: i, isOffline: false, allowQueryUserInfo: true };
  });
  return metadata;
}

async function importTableData() {
  const mod = await import("@/options/views/Overview/MyData/utils/lastUserData.ts");
  return mod.tableData;
}

describe("我的数据：逐站写回只让整表收敛一次", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
  });

  it("窗口之内的两条写入只重算一次，且两条都在表里", async () => {
    const metadata = await seedSites();
    const tableData = await importTableData();

    const converges = vi.fn();
    watch(tableData, converges, { flush: "post" });

    // 首条：离上一次收敛还不足一个窗口，也要在下一个切片落地（不许等满 250ms）
    metadata.lastUserInfo.alpha = account("alpha", 1);
    await vi.advanceTimersByTimeAsync(0);
    await nextTickFlush();
    expect(converges).toHaveBeenCalledTimes(1);

    // 窗口之内的两条：合起来只该再画一次
    converges.mockClear();
    metadata.lastUserInfo.beta = account("beta", 2);
    metadata.lastUserInfo.gamma = account("gamma", 3);
    await nextTickFlush();
    expect(converges, "两条写入各自当场重算 = 这次要消掉的整表重渲染").not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(250);
    expect(converges).toHaveBeenCalledTimes(1);

    const bySite = Object.fromEntries(tableData.value.map((row) => [row.site, row.name]));
    expect(bySite).toEqual({ alpha: "user-1", beta: "user-2", gamma: "user-3" });
  });

  it("过了窗口的写入会再收敛一次，不会一直攒着不画", async () => {
    const metadata = await seedSites();
    const tableData = await importTableData();

    metadata.lastUserInfo.alpha = account("alpha", 1);
    await vi.advanceTimersByTimeAsync(0);
    await nextTickFlush();
    expect(tableData.value.find((row) => row.site === "alpha")?.name).toBe("user-1");

    await vi.advanceTimersByTimeAsync(1000);
    metadata.lastUserInfo.alpha = account("alpha", 9);
    await vi.advanceTimersByTimeAsync(250);
    await nextTickFlush();
    expect(tableData.value.find((row) => row.site === "alpha")?.name).toBe("user-9");
  });

  it("模块装上时 store 里已经有的数，首屏当场就在表里（不许先空一帧再等窗口）", async () => {
    const metadata = await seedSites();
    metadata.lastUserInfo.alpha = account("alpha", 7);

    const tableData = await importTableData();
    await nextTickFlush();

    expect(tableData.value.find((row) => row.site === "alpha")?.name).toBe("user-7");
  });
});

/** Vue 的 flush: "post" 走的是微任务队列，fake timer 不推进它，要自己排空一次 */
async function nextTickFlush() {
  const { nextTick } = await import("vue");
  await nextTick();
  await nextTick();
}
