/**
 * 「我的下载器」列表里那几格新增列、以及名称下面那行「分类 + 标签」的取值口径。
 *
 * 单独成模块、且除了 `reseedNotice`（它自己零 import）之外什么都不依赖，是为了让
 * `tests/options/myClientColumnText.test.ts` 能直接 import 真源码跑断言 ——
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

/**
 * 名称下面那一行要摆的「分类 + 标签」。
 *
 * 为什么要去重：`label` 与 `tags` 在 qBittorrent 上是两回事（分类 / 标签），但在
 * Transmission 和 Flood 上是同一个东西的两个视图 —— 驱动里 `label` 取的就是 `labels[0]` /
 * `tags[0]`。不去重就会出现「华语电影 华语电影 2024」这种重复的一颗。
 * 空串和只含空格的也一并丢掉：qBittorrent 没挂分类时 `category` 就是空串。
 */
export function labelChips(label: string | undefined, tags: string[] | undefined): string[] {
  const out: string[] = [];
  for (const raw of [label, ...(tags ?? [])]) {
    const text = typeof raw === "string" ? raw.trim() : "";
    if (text && !out.includes(text)) out.push(text);
  }
  return out;
}
