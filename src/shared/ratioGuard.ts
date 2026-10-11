/**
 * 发送到下载器之前的分享率分档。纯函数，Node 可直接 import 跑断言
 * （`.tmp-build/ratio-guard-test.mjs`）。
 *
 * **为什么下载前要看分享率**：下载会把下载量再抬一截，分享率已经低于 1 的站继续下载就是往
 * 保号线上压；1~2 之间是「还能下，但心里要有数」。
 *
 * **辅种不在这一条里**：那是纯上传，反而在救分享率。所以辅种任务的重发、后台自动辅种
 * 两条路都不该套这个判据，套了会把「该做的补救」也拦下来。
 *
 * 哨兵值必须显式处理，否则「报不出」会被判成风险、或者被判成完美：
 * packages/site 的 `fixRatio` 拿不到数时回 `-1`，上下行都是 0 时回 `-Infinity`，
 * 而有上传没下载时回 `+Infinity` —— 最后那个是最好的情况，不是缺失。
 */
export type TRatioTier = "danger" | "warn" | "ok" | "unknown";

/** 低于它 → 发送前要人确认 */
export const RATIO_DANGER_CEIL = 1;
/** 低于它（但不低于上一档）→ 发送后给一条提示，不拦 */
export const RATIO_WARN_CEIL = 2;

/**
 * 归一 + 分档。字符串形态（站点偶尔报 "1.5"）按 parseFloat 认，认不出就算缺失。
 * 负数一律当哨兵：协议上没有「倒欠的分享率」，-1 与 -Infinity 都是报不出。
 */
export function ratioTier(ratio: unknown): TRatioTier {
  const value = typeof ratio === "string" ? parseFloat(ratio) : ratio;
  if (typeof value !== "number" || Number.isNaN(value)) return "unknown";
  if (value === Infinity) return "ok";
  if (value === -Infinity || value < 0) return "unknown";
  if (value < RATIO_DANGER_CEIL) return "danger";
  if (value < RATIO_WARN_CEIL) return "warn";
  return "ok";
}

export interface IRatioRow {
  site: string;
  /** 面向用户的站点名（内部 id 不进界面，见 AGENTS.md §3.5） */
  name: string;
  ratio: unknown;
}

export interface IRatioRisk {
  danger: IRatioRow[];
  warn: IRatioRow[];
  unknown: IRatioRow[];
}

/**
 * 按站点去重后分档。一批 18 条结果可能全来自同一个站，报 18 行同样的话没有意义；
 * 同一站的多条取第一条的分享率（一个站的用户信息本来就只有一份）。
 *
 * 去重按 `site` 而不是按 `name`：不同站可以有同名显示（例如两条别名相同的定义），
 * 而分享率是按站点分别存的。
 */
export function summarizeRatioRisk(rows: IRatioRow[]): IRatioRisk {
  const seen = new Set<string>();
  const risk: IRatioRisk = { danger: [], warn: [], unknown: [] };

  for (const row of rows) {
    if (!row.site || seen.has(row.site)) continue;
    seen.add(row.site);
    const tier = ratioTier(row.ratio);
    if (tier !== "ok") risk[tier].push(row);
  }

  return risk;
}

/**
 * 分享率的展示形态：`0.85` / `∞` / `-`。
 *
 * 与「我的数据」那一列的 `realFormatRatio` 同一口径（∞ 与 - 两档必须两边一致，
 * 否则同一个站在两处说法不同）。差别只在它吃的是已归一的 number，这里吃 unknown 并
 * 复用 {@link ratioTier} 的哨兵判据 —— 判不出时写 `-`，不替数据源编一个 0.00。
 */
export function formatRatioText(ratio: unknown): string {
  const value = typeof ratio === "string" ? parseFloat(ratio) : ratio;
  if (value === Infinity) return "∞";
  if (ratioTier(ratio) === "unknown") return "-";
  return (value as number).toFixed(2);
}
