/**
 * 辅种检测里「推荐拿哪一条当基准」的判据。
 *
 * 为什么单独成一个模块（而不是写在弹窗里）：这两组推荐是**替用户挑一条种子**，
 * 挑错的代价是整批辅种都拿错参照物去比。判据要能被 Node 直接 import 断言，
 * 不能只活在组件里 —— 同族先例见 `src/shared/category.ts`、`SentToDownloaderDialog/categoryMatch.ts`。
 *
 * 两条推荐各回答一个问题：
 *  - `mostSeeders`：这批里谁最多人做种 —— 做种人多意味着这份数据在 tracker 上活得久，
 *    基准本身要单独下一遍，从还热着的种子里挑才不必等；
 *  - `mostSeedersFree`：免费下载的那批里谁最多人做种 —— 基准那条是**要真下一次的**，
 *    挑免费的能省下这一份流量（22 GiB 这种量级才看得见差别）。
 */
import { toCount } from "./torrentCount.ts";
// 「免费」判据住 torrentFree.ts：那边同时服务辅种推荐与「下载这一批之后分享率」的预估，
// 两处取向必须一致（同一个站不能在一处算免费、在另一处算收费）。
import { isFreeTorrent } from "./torrentFree.ts";

/** 候选条目只需要这三样：判据不碰指纹、不碰下载器 */
export interface IReseedBaseCandidate {
  id: string;
  /**
   * 站点报的做种人数。**类型是 unknown 而不是 number**：解析层只在「整串就是纯数字」时才转数，
   * 图标字符混进那一格时它会是字符串甚至 undefined（见 `torrentCount.ts` 文件头）。
   * 所以这里和表格那一列共用 `toCount` 判定 —— 界面上显示得出数字的行才许被推荐，两边不许各判一套。
   */
  seeders?: unknown;
  tags?: { name: string }[] | null;
  /**
   * 该站的分享率（`metadataStore.lastUserInfo[site].ratio`，与「我的数据」那一列同一个数）。
   * 同样写成 unknown：这个字段是可选的，站点不报或还没刷过用户信息时就是 undefined，
   * 判据要能区分「报得出且低于 1」与「压根没数」——见 `reseedRatioVerdict`。
   */
  ratio?: unknown;
}

/**
 * 分享率这一档的三种事实。
 *
 * 为什么基准要看分享率（用户 2026-10-11：「辅种界面分享率低于 1 的站点不能作为基准种子」）：
 * 基准那一条是**要真下一遍**的（其余各条跳过校验、直接算 100%），所以下了它的那一站会被
 * 记上一整份下载量、分享率往下走；其余各条只上传不下载，是把分享率往上抬的那几条。
 * 已经低于 1 的站点再背这一份，就是往错的方向推。
 */
export type TReseedRatioVerdict = "ok" | "low" | "unknown";

/** 基准这一档的下限：等于 1 算达标（不亏），低于它才拦 */
export const BASE_RATIO_FLOOR = 1;

/** 报不出（不是数字、NaN、Infinity）一律 `unknown` 而不是 `low`：判不出就不假装知道 */
export function reseedRatioVerdict(ratio: unknown): TReseedRatioVerdict {
  if (typeof ratio !== "number" || !Number.isFinite(ratio)) return "unknown";
  return ratio < BASE_RATIO_FLOOR ? "low" : "ok";
}

/** 能不能拿这一条当基准：只有明确「低于 1」才拦，报不出的照旧可当（用户 2026-10-11 定的口径） */
export function canBeReseedBase(candidate: IReseedBaseCandidate): boolean {
  return reseedRatioVerdict(candidate.ratio) !== "low";
}

/** 一个能达标的都没有（全都被明确报成低于 1）—— 界面上那句退让提示的判据 */
export function allBasesTooLow(list: IReseedBaseCandidate[]): boolean {
  return list.length > 0 && list.every((item) => reseedRatioVerdict(item.ratio) === "low");
}

/**
 * 默认拿哪一条当基准：列表里**第一条能当基准的**。
 *
 * 一个都不许当（全都低于 1）时退回列表第一条 —— 基准总得有一条，而把人堵死在建不出任务上
 * 不是这条规则的本意（用户 2026-10-11 选的就是「照旧允许，只给一句提示」）。
 * 空列表返回 null，由界面自己决定那一行长什么样。
 */
export function pickDefaultBaseId(list: IReseedBaseCandidate[]): string | null {
  const eligible = list.find((item) => canBeReseedBase(item));
  return (eligible ?? list[0])?.id ?? null;
}

export type TReseedRecommendKind = "mostSeeders" | "mostSeedersFree";

export interface IReseedRecommendation {
  kind: TReseedRecommendKind;
  id: string;
  seeders: number;
}

/** 只有拿得出非负有限数字的条目才参与推荐（与表格那一列同一判据） */
function usableSeeders(candidate: IReseedBaseCandidate): number | null {
  const n = toCount(candidate.seeders);
  return n === null || n < 0 ? null : n;
}

/** 取做种人数最多的那一条；并列时取排在前面的一条（不猜，按用户勾选的先后稳定给一个） */
function pickTop(list: IReseedBaseCandidate[]): { id: string; seeders: number } | null {
  let best: { id: string; seeders: number } | null = null;
  for (const item of list) {
    const seeders = usableSeeders(item);
    if (seeders === null) continue;
    if (!best || seeders > best.seeders) best = { id: item.id, seeders };
  }
  return best;
}

/**
 * 给出两组推荐（做种最多 / 免费里做种最多）。
 *
 * 候选先过一道分享率：分享率明确低于 1 的那几条**不进推荐池**（推荐就是替他挑，
 * 挑一条不能当基准的当推荐是给出一个点下去必然错的答案）。池子被清空时退回整份 ——
 * 与 `pickDefaultBaseId` 同一个退让口径，界面上另有那句「这批候选都低于 1」的提示。
 *
 * 四条边界：
 *  1. 一条都拿不出做种数 → 空数组（界面上那一行整个不出，而不是摆两颗假按钮）；
 *  2. 没有任何免费条目 → 只出第一组；
 *  3. 两组指向同一条 → 只报 `mostSeeders` 一组 —— 一行里出现两个词指的是同一份数据，
 *     读起来像有两个答案，其实没有。
 *  4. 全部候选分享率都低于 1 → 照旧给推荐（退让），不做成「一颗按钮都不出」。
 */
export function pickBaseRecommendations(list: IReseedBaseCandidate[]): IReseedRecommendation[] {
  const eligible = list.filter((item) => canBeReseedBase(item));
  const pool = eligible.length > 0 ? eligible : list;

  const topAll = pickTop(pool);
  if (!topAll) return [];

  const topFree = pickTop(pool.filter((item) => isFreeTorrent(item.tags)));
  if (!topFree || topFree.id === topAll.id) {
    return [{ kind: "mostSeeders", id: topAll.id, seeders: topAll.seeders }];
  }
  return [
    { kind: "mostSeeders", id: topAll.id, seeders: topAll.seeders },
    { kind: "mostSeedersFree", id: topFree.id, seeders: topFree.seeders },
  ];
}
