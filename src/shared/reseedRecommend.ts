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

/**
 * 报不出的一律 `unknown` 而不是 `low`：判不出就不假装知道。
 *
 * ⚠️ 哨兵值必须显式挡掉（v0.105.2 起这条从「只是少个推荐」变成「停不停建」，判错的代价翻了倍）：
 * `packages/site` 的 `fixRatio` 拿不到数时回 **-1**、上下行都是 0 时回 **-Infinity**
 * （同一份口径写在 `ratioGuard.ts` 的文件头）。早先这函数只判 `Number.isFinite`，于是
 * 「这个站压根没刷过用户信息」会被读成「分享率低于 1」—— 一批站点全没刷过时，
 * 界面上就是每一行都挂着「低分享率」并且一颗都不许当基准，而那句话是假话。
 * `+Infinity`（有上传没下载）是达标里最好的一档，不是缺失。
 * 类型仍只认 `number`：`IUserInfo.ratio` 声明的就是 number，报不出时那是 undefined，
 * 走的是同一条 `unknown`；这里不替上游的串做解析（那是 `ratioGuard` 那条预估在做的事）。
 */
export function reseedRatioVerdict(ratio: unknown): TReseedRatioVerdict {
  if (typeof ratio !== "number" || Number.isNaN(ratio)) return "unknown";
  if (ratio === -Infinity || ratio < 0) return "unknown";
  if (ratio === Infinity) return "ok";
  return ratio < BASE_RATIO_FLOOR ? "low" : "ok";
}

/** 能不能拿这一条当基准：只有明确「低于 1」才拦，报不出的照旧可当（用户 2026-10-11 定的口径） */
export function canBeReseedBase(candidate: IReseedBaseCandidate): boolean {
  return reseedRatioVerdict(candidate.ratio) !== "low";
}

/**
 * 一个能达标的都没有（全都被明确报成低于 1）—— 界面上「停掉创建任务」那一行的判据。
 * 空列表返回 false：还没有候选可判，不该把它读成「全都不达标」。
 */
export function allBasesTooLow(list: IReseedBaseCandidate[]): boolean {
  return list.length > 0 && list.every((item) => reseedRatioVerdict(item.ratio) === "low");
}

/**
 * 默认拿哪一条当基准：列表里**第一条能当基准的**。
 *
 * 一个都许当（全都被明确报成低于 1）时返回 `null` —— 不自作主张挑一条低的（用户 2026-10-14：
 * 「辅种任务不能让分享率低于 1 的站点当基准种子」）。v0.82.0 那版这里是「退回头一条 +
 * 一句提示」，界面上因此出现过「标着低分享率的那一条正是基准」；现在 `null` 交给界面去停建。
 * 空列表也返回 null。
 */
export function pickDefaultBaseId(list: IReseedBaseCandidate[]): string | null {
  return list.find((item) => canBeReseedBase(item))?.id ?? null;
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
 * 挑一条不能当基准的当推荐是给出一个点下去必然错的答案）。
 *
 * 五条边界：
 *  1. 一条都拿不出做种数 → 空数组（界面上那一行整个不出，而不是摆两颗假按钮）；
 *  2. 没有任何免费条目 → 只出第一组；
 *  3. 两组指向同一条 → 只报 `mostSeeders` 一组 —— 一行里出现两个词指的是同一份数据，
 *     读起来像有两个答案，其实没有。
 *  4. 全部候选分享率都低于 1 → **一条都不推荐**（用户 2026-10-14 把这条改成硬闸；
 *     v0.82.0 这里曾退回整份候选，于是那一行会指向一条不能当基准的种子）。
 *  5. 只有低于 1 的那几条拿得出做种数 → 同样空数组：达标但报不出做种数的条目撑不起推荐，
 *     而不是回头去推荐那条不达标的。
 */
export function pickBaseRecommendations(list: IReseedBaseCandidate[]): IReseedRecommendation[] {
  const pool = list.filter((item) => canBeReseedBase(item));
  if (pool.length === 0) return [];

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
