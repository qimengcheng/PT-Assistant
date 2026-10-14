/**
 * 把 `seedingBonus` 字段当「复合积分」用的站点。
 *
 * 这个字段本来的含义是**做种积分**（各站自己发的一种点数，按做种时长/大小累积）。
 * 但海胆把站上的「等级积分」存进了它 —— 那一串是四项加权和，站点自己在「等级积分」页写明了
 * 公式：`等级积分 = 发种数 × 10 + 上传量 × 0.01 + 下载量 × 0.2 + 魔力值 × 0.005`
 * （上传/下载的单位按站点显示的那个数计，即 1024 进制）。
 *
 * 于是两件事跟着错：
 * 1) 界面上那一格写着「做种积分还差 38」，用户读不出 38 分要拿什么去换；
 * 2) 「离下一级更近」按 当前 ÷ 要求 算完成度，4965/5000 = 99% 看着几乎到位，
 *    而那 35 分按公式是 7000 点魔力值 —— 跟别的站「还差 18.25 GiB 下载量」不是一个量纲。
 *
 * 所以这里点名哪些站的 `seedingBonus` 是复合分，并给出各项的折算系数：
 * 显示层用它把缺口换算成「要多少上传/下载/魔力值/活种」，排序层用它把这一项从完成度里摘出去。
 * 系数是站点定的，不是我们挑的：改之前先去那一页核一遍。
 */
import type { TSiteID } from "@ptd/site";

export interface ILevelScoreCoefficients {
  /** 每 1 字节上传量折多少分（站点写 GB，这里统一按 1024³ 存） */
  uploaded: number;
  downloaded: number;
  /** 每 1 点魔力值（`bonus`）折多少分 */
  bonus: number;
  /** 每个活种（`seeding`，站点原话是「个人所发而且处于活种状态的种子数量」）折多少分 */
  seeding: number;
}

/** 界面上这一项要显示几种等价物就列几种；顺序即显示顺序 */
export const LEVEL_SCORE_CURRENCIES = ["uploaded", "downloaded", "bonus", "seeding"] as const;
export type TLevelScoreCurrency = (typeof LEVEL_SCORE_CURRENCIES)[number];

export const COMPOSITE_LEVEL_SCORES: Partial<Record<TSiteID, ILevelScoreCoefficients>> = {
  haidan: { uploaded: 0.01, downloaded: 0.2, bonus: 0.005, seeding: 10 },
};

/** 这一站这一字段是不是「存进 seedingBonus 的复合积分」 */
export function isCompositeLevelScore(site: TSiteID | undefined, key: string): boolean {
  return key === "seedingBonus" && !!site && COMPOSITE_LEVEL_SCORES[site] !== undefined;
}

/**
 * 把「还差多少分」换算成某一维度的量。返回的数值单位与界面其他地方一致：
 * 流量类是**字节**（交给 formatSize），点数/个数就是原值。
 * 系数缺失或分数不是有限数时返回 null —— 不替站点编一个 0。
 */
export function convertLevelScoreGap(site: TSiteID | undefined, currency: TLevelScoreCurrency, gap: number): number | null {
  const coefficients = site ? COMPOSITE_LEVEL_SCORES[site] : undefined;
  const rate = coefficients?.[currency];
  if (!rate || !(gap > 0)) return null;
  const raw = gap / rate;
  if (!Number.isFinite(raw)) return null;
  return currency === "uploaded" || currency === "downloaded" ? raw * 1024 ** 3 : raw;
}
