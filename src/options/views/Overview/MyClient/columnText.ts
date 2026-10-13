/**
 * 「我的下载器」列表里那几格新增列的取值口径。
 *
 * 单独成模块、且除了 `reseedNotice`（它自己零 import）之外什么都不依赖，是为了让
 * `tests/options/myClient-column-text.test.ts` 能直接 import 真源码跑断言 ——
 * 这一页原来的 `utils.ts` 牵着 messages / pinia store，Node 侧根本 import 不动，
 * `toPercent` 那 18 条断言当时只能把函数文本抠出来 eval。
 */
import { formatDurationSec } from "@/shared/reseedNotice.ts";

/**
 * 做种数 / 下载数：0 是真值（没人做种、没人下载），只有「这家压根没报这个字段」才空。
 * 所以判的是「有没有这个数」而不是「是不是 0」—— 写成 `value || "-"` 会把 0 画成横杠。
 */
export function countText(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "-";
}

/**
 * 剩余时间。各家对「算不出」的表达不一样：qBittorrent / Transmission / Deluge / Flood 回 -1，
 * 已完成的回 0，Aria2 / 群晖 干脆没这个字段 —— 一律收成 "-"，不替下载器编一个假倒计时。
 * 档位复用辅种通知那一份 `formatDurationSec`，两处各写一套就会出现「同一件事在通知里和
 * 表格里两种说法」。
 */
export function etaText(value: number | undefined, zh: boolean): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "-";
  return formatDurationSec(value, zh);
}
