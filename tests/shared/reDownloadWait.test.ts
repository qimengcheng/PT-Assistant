/**
 * 「站点最小重下载间隔」的排程判据（`src/shared/reDownloadWait.ts`）。
 *
 * 这份从 `.tmp-build/re-download-wait-test.mjs` 搬进来（v0.92.4 当场跑的那 14 条，一条没减）。
 * 搬的原因不是形式：`.tmp-build` 在 .gitignore 里，判据断言放在那儿等于每清一次目录就没了，
 * 而这条判据选错路是不报错的（等待排给了闹钟、SW 一重启就没人认领 —— 见 alarms.ts 的恢复函数）。
 */
import { describe, expect, it } from "vitest";

import { SLEEP_IN_SW_MAX_MS, planReDownload, splitPendingReDownload } from "@/shared/reDownloadWait.ts";
import type { IPendingReDownload } from "@/shared/types.ts";

const NOW = 1_800_000_000_000;

/**
 * 一条等待记录。判据只读 `downloadOption.downloadId` 和 `retryAt` 两个字段，
 * 其余按协议要求给最小值（`torrent` / `downloaderId` 是必填项，不能省）。
 */
const row = (downloadId: number, retryAt: number): IPendingReDownload => ({
  downloadOption: { downloadId, torrent: {}, downloaderId: "local" },
  retryAt,
});

describe("planReDownload：短等待睡在 SW 里，长等待排到点时刻", () => {
  it("5 秒走 sleep，到点时刻就是 now+5000", () => {
    expect(planReDownload(5_000, NOW)).toEqual({ via: "sleep", retryAt: NOW + 5_000 });
  });

  it(`贴着下限内侧的 ${SLEEP_IN_SW_MAX_MS - 1} 毫秒仍走 sleep`, () => {
    expect(planReDownload(SLEEP_IN_SW_MAX_MS - 1, NOW).via).toBe("sleep");
  });

  it("下限本身（30 秒）交给闹钟，不在 SW 里干等", () => {
    expect(planReDownload(SLEEP_IN_SW_MAX_MS, NOW)).toEqual({ via: "alarm", retryAt: NOW + SLEEP_IN_SW_MAX_MS });
  });

  it("15 分钟一次算准到点时刻，不再排「now+30s 再看一眼」", () => {
    expect(planReDownload(15 * 60 * 1000, NOW)).toEqual({ via: "alarm", retryAt: NOW + 900_000 });
  });

  it.each([
    ["undefined（协议里这一项是可选的）", undefined],
    ["0", 0],
    ["负数", -5000],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("leftInterval 是 %s 时判成不用等", (_label, value) => {
    expect(planReDownload(value, NOW)).toEqual({ via: "sleep", retryAt: NOW });
  });
});

describe("splitPendingReDownload：SW 每次醒来把存档里的等待任务认领回来", () => {
  const store: Record<string, IPendingReDownload> = {
    "12": row(12, NOW - 1),
    "7": row(7, NOW),
    "99": row(99, NOW + 60_000),
  };

  it("retryAt <= now 归「过期补跑」（含正好压在这一毫秒的那条）", () => {
    expect(splitPendingReDownload(store, NOW).due).toHaveLength(2);
  });

  it("retryAt > now 归「重新排闹钟」", () => {
    const { waiting } = splitPendingReDownload(store, NOW);
    expect(waiting).toHaveLength(1);
    expect(waiting[0]?.downloadOption.downloadId).toBe(99);
  });

  it("过期那批按到点先后排，最该早发的排最前", () => {
    const ids = splitPendingReDownload(store, NOW).due.map((e) => e.downloadOption.downloadId);
    expect(ids).toEqual([12, 7]);
  });

  it("认不出到点时刻的条目既不补跑也不重排（留着它就永远长这条键）", () => {
    const broken = {
      a: null,
      b: { downloadOption: { downloadId: 1 } },
      c: { downloadOption: { downloadId: 2 }, retryAt: Number.NaN },
      // 存档来自 chrome.storage，类型注解撒过谎也不该把整次认领带崩
      d: { downloadOption: { downloadId: 3 }, retryAt: "1800000000000" },
      e: row(4, NOW + 1000),
    } as unknown as Record<string, IPendingReDownload>;
    const { due, waiting } = splitPendingReDownload(broken, NOW);
    expect(due).toHaveLength(0);
    expect(waiting).toHaveLength(1);
  });

  it("存档为空或没建过时返回两个空数组，不抛", () => {
    expect(splitPendingReDownload(null, NOW)).toEqual({ due: [], waiting: [] });
    expect(splitPendingReDownload(undefined, NOW)).toEqual({ due: [], waiting: [] });
  });
});
