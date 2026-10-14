/**
 * 控制台日志总闸的行为断言（判据在 `src/shared/consoleLog.ts`）。
 *
 * 这份从 `.tmp-build/console-log-test.mjs` 搬进来，八条一条没减。
 * 量法与原来一致：**先把 console 的四档换成记账函数，再装总闸** —— 总闸在那一刻抓到的
 * 「原生实现」就是记账器，于是「有没有落到输出」是可直接数的。
 *
 * ⚠️ 记账器必须整份文件只装一次（beforeAll）：`wrapConsoleLevels` 是幂等的（模块级 `wrapped`
 * 记着），第二个用例再 startRecording 只是把记账器盖在包装层外面 —— 包装层根本没被走到，
 * 于是断言看到的是没改写的原始参数，测试会以「假 FAIL」的形式骗人。
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * `@/storage.ts` 在这里被换掉：被测的是那一道闸，不是 wxt 的存储层，而存储层在无浏览器的
 * 环境里被调用会留下自己那串孤儿 promise（`.pnpm/@wxt-dev+storage` 里的 withLock 链），
 * 表现是一堆 unhandled rejection 把整个测试跑成红的 —— 报的还不是本次改动的错。
 * 换掉之后反而能多验两条真东西：开关读到 true 要开闸、读到没有这一项要关着。
 */
const storageMock = vi.hoisted(() => ({ config: null as { consoleLog?: boolean } | null, fail: false }));

vi.mock("@/storage.ts", () => ({
  extStore: {
    getItem: async () => {
      if (storageMock.fail) throw new Error("这台环境里没有 chrome.storage");
      return storageMock.config;
    },
    setItem: async () => {},
    patchItem: async () => {},
  },
}));

import {
  gatedLogger,
  installConsoleLogGate,
  isConsoleLogEnabled,
  renameLogPrefix,
  setConsoleLogEnabled,
  wrapConsoleLevels,
} from "@/shared/consoleLog.ts";

const LEVELS = ["log", "info", "debug", "warn", "error"] as const;

const former = { ...console } as Pick<Console, (typeof LEVELS)[number]>;
let calls: unknown[][] = [];

beforeAll(() => {
  for (const level of LEVELS) {
    console[level] = (...args: unknown[]) => calls.push([level, ...args]);
  }
  // 装总闸的那一次抓到的原生实现 = 上面这几个记账器
  wrapConsoleLevels();
});

afterAll(() => {
  for (const level of LEVELS) console[level] = former[level];
});

afterEach(() => {
  calls = [];
});

describe("闸门本身", () => {
  it("默认关时 log / info / debug / warn 一条都不出，error 照出", () => {
    setConsoleLogEnabled(false);
    console.log("a");
    console.info("b");
    console.debug("c");
    console.warn("d");
    console.error("e");
    expect(calls).toEqual([["error", "e"]]);
  });

  it("打开后四档都出，且只有「以旧前缀开头」的那条被换成新前缀", () => {
    setConsoleLogEnabled(true);
    console.log("[PTD] hello", 1);
    console.debug("[PTD] site 'x' Error:", { a: 1 });
    console.warn("no prefix here");
    console.info(42, "[PTD] 前缀不在最前面");
    expect(calls.map((c) => [c[0], c[1]])).toEqual([
      ["log", "[PT-Assistant] hello"],
      ["debug", "[PT-Assistant] site 'x' Error:"],
      ["warn", "no prefix here"],
      ["info", 42],
    ]);
    // 其余参数原样带着：对象没被 stringify、后面的参数没丢
    expect([calls[1]?.[2], calls[3]?.[2]]).toEqual([{ a: 1 }, "[PTD] 前缀不在最前面"]);
  });

  it("重复安装不会套进第一层的「关着就 return」，打开时仍然只打一条", () => {
    installConsoleLogGate();
    wrapConsoleLevels();
    setConsoleLogEnabled(true);
    calls = [];
    console.log("[PTD] once");
    expect(calls).toEqual([["log", "[PT-Assistant] once"]]);
  });
});

describe("gatedLogger：给第三方库当 console 替身的那一份出口", () => {
  /**
   * 库在**模块 import 期**就打日志，那一刻 `wrapConsoleLevels()` 还没被调用，原生 console 是裸的
   * （`@webext-core/job-scheduler` 每注册一条定时任务打一行，用户 2026-10-14 控制台里那四行就是它）。
   * 所以这份出口自己判开关，不等闸门。
   *
   * 这里的「关着不出」区分不开是哪一层挡住的（本文件的 `wrapConsoleLevels` 在 beforeAll 就装了，
   * 两层都在判同一个标志）—— 它钉的是可观测结果：开关说了算、error 不受开关影响。
   */
  it("关着时 log / info / debug / warn 一条都不出，error 照出", () => {
    setConsoleLogEnabled(false);
    for (const level of ["log", "info", "debug", "warn", "error"] as const) {
      gatedLogger[level]("Scheduling job: autoFlushUserInfo");
    }
    expect(calls).toEqual([["error", "Scheduling job: autoFlushUserInfo"]]);
  });

  it("开着时四档都出", () => {
    setConsoleLogEnabled(true);
    gatedLogger.log("a");
    gatedLogger.warn("b");
    expect(calls).toEqual([
      ["log", "a"],
      ["warn", "b"],
    ]);
  });
});

describe("renameLogPrefix：改写函数单独看", () => {
  it("首参不是字符串就原样返回", () => {
    expect(renameLogPrefix([7, "[PTD] x"])).toEqual([7, "[PTD] x"]);
  });
  it("空参数原样返回", () => {
    expect(renameLogPrefix([])).toEqual([]);
  });
  it("旧前缀出现在中间不算（那是内容，不是前缀）", () => {
    expect(renameLogPrefix(["x [PTD] y"])).toEqual(["x [PTD] y"]);
  });
});

describe("installConsoleLogGate 跟着配置走", () => {
  afterEach(() => {
    storageMock.fail = false;
    storageMock.config = null;
  });

  it("读到 consoleLog: true 就开闸", async () => {
    setConsoleLogEnabled(false);
    storageMock.config = { consoleLog: true };
    installConsoleLogGate();
    await vi.waitFor(
      () => {
        expect(isConsoleLogEnabled()).toBe(true);
      },
      { timeout: 3000, interval: 20 },
    );
  });

  it("读到的是没有这一项的老存档 → 保持默认（关），不当成开", async () => {
    setConsoleLogEnabled(true);
    storageMock.config = {};
    installConsoleLogGate();
    await vi.waitFor(
      () => {
        expect(isConsoleLogEnabled()).toBe(false);
      },
      { timeout: 3000, interval: 20 },
    );
  });

  it("存储读不到时落回默认（关），异常不外泄", async () => {
    // 这条要的是「失败之后闸还在、标志落回 false」，而不是它把异常抛到调用方
    // （老环境里那一次动态 import 直接 reject；这里换成受控的 throw，判据同一件事）
    setConsoleLogEnabled(true);
    storageMock.fail = true;
    installConsoleLogGate();
    await vi.waitFor(
      () => {
        expect(isConsoleLogEnabled()).toBe(false);
      },
      { timeout: 3000, interval: 20 },
    );
  });
});
