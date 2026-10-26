/**
 * 「未知」那一格的两句提示，各自在什么条件下出现。
 *
 * 判据本体在 `src/options/views/Overview/MyClient/stateTip.ts`（那里写了为什么抽出来）。
 * 这一格要紧的原因是它**只在这一档出现**：认得出的状态多说一句就是噪声，
 * 而认不出的状态少说一句就只剩「未知」两个字（用户 2026-10-26 那一屏只能靠猜）。
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { CTorrentState } from "@ptd/downloader/types.ts";

import { unknownStateTipOf } from "@/options/views/Overview/MyClient/stateTip.ts";

describe("未知档的提示选择", () => {
  it("认得出的状态不挂提示（界面上那颗标签已经把话说完了）", () => {
    for (const state of [
      CTorrentState.downloading,
      CTorrentState.seeding,
      CTorrentState.paused,
      CTorrentState.queued,
      CTorrentState.checking,
      CTorrentState.error,
    ]) {
      expect(unknownStateTipOf(state, "stoppedUP")).toBe(null);
    }
  });

  it("未知 + 有原文 → 报出那个值", () => {
    expect(unknownStateTipOf(CTorrentState.unknown, "someBrandNewState")).toEqual({
      key: "MyClient.state.unknownRaw",
      args: { raw: "someBrandNewState" },
    });
  });

  /** 这一档的覆盖面是其余七家驱动（它们没往 `stateRaw` 里逐字转） */
  it("未知 + 没原文 → 说「读不到」，不替下载器编一个值", () => {
    expect(unknownStateTipOf(CTorrentState.unknown, undefined)).toEqual({ key: "MyClient.state.unknownNoRaw" });
    expect(unknownStateTipOf(CTorrentState.unknown, "")).toEqual({ key: "MyClient.state.unknownNoRaw" });
    expect(unknownStateTipOf(CTorrentState.unknown, "   ")).toEqual({ key: "MyClient.state.unknownNoRaw" });
  });

  it("原文两头空白去掉，界面那句不会出现「状态是「  」」", () => {
    const tip = unknownStateTipOf(CTorrentState.unknown, "  stalledUP  ");
    expect(tip?.args?.raw).toBe("stalledUP");
  });

  /** 两家键名混用的那档：报出的是数字码也要原样写出来，不许因为不是字符串就闭嘴 */
  it("原文不是字符串（数字码那类）按取不到处理，不画 [object Object]", () => {
    expect(unknownStateTipOf(CTorrentState.unknown, 6 as unknown as string)).toEqual({
      key: "MyClient.state.unknownNoRaw",
    });
  });

  /**
   * 键是从判据里**返回**的，调用点写的是 `t(stateTip.value.key)` —— 防线 ③ 只认字面量
   * `t("a.b.c")`，这种动态键它看不见（与防线 ⑩ 补 `common.categoryKind.*` 是同一族），
   * 所以两侧齐全要在这里自己钉。
   */
  it("两句提示的键在中英两侧都在，占位符也都在", () => {
    const read = (f: string) =>
      JSON.parse(readFileSync(new URL(`../../src/locales/${f}`, import.meta.url), "utf8")).MyClient.state;
    const zh = read("zh_CN.json");
    const en = read("en.json");
    for (const key of ["unknownRaw", "unknownNoRaw"]) {
      expect(typeof zh[key], `zh_CN 缺 MyClient.state.${key}`).toBe("string");
      expect(typeof en[key], `en 缺 MyClient.state.${key}`).toBe("string");
    }
    expect(zh.unknownRaw).toContain("{raw}");
    expect(en.unknownRaw).toContain("{raw}");
  });
});
