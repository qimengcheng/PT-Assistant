/**
 * 「升级进度」那张表的判据。纯函数，Node 可直接 import 跑断言（.tmp-build/level-progress-test.mjs）。
 *
 * **达标与否不归这里管** —— 那一份住在 packages/site 的 `levelRequirementUnMet`，
 * 调用方把它的结果（哪几项没达标、每项的当前值与要求值）交进来。这里只回答两件事：
 * 这一行能不能参与排序，以及谁离下一级更近。
 *
 * 「更近」不能比绝对量：上传量按字节、入站时间按毫秒、魔力按点数，跨字段加减都没有意义。
 * 所以按用户 2026-10-11 定的两档走：**先比差几项（少的在前），再比最卡那一项的完成度（高的在前）**。
 */

/**
 * 一行处在什么状态。只有 rankable 参与「谁更近」的比较，其余四档各成一档排在后面，
 * 因为把它们和 rankable 混在一起排会造出假信号 —— 「站点没给等级表」并不是「不需要升级」。
 */
export type TLevelProgressState =
  /** 有等级表、有下一级、可以算还差多远 */
  | "rankable"
  /** 已经在普通用户的最高一级 */
  | "maxed"
  /** 贵宾 / 管理组：不参与逐级升级 */
  | "special"
  /** 还没取到用户等级（未刷新或站点没解析出来） */
  | "noLevel"
  /** 站点定义里没有等级要求 */
  | "noRequirements";

/** 分档先后顺序：rankable 最前，最后两档是「信息不足」，放在最末尾 */
export const LEVEL_STATE_ORDER: readonly TLevelProgressState[] = [
  "rankable",
  "maxed",
  "special",
  "noLevel",
  "noRequirements",
];

export interface ILevelFacts {
  /** 站点定义里有 levelRequirements */
  hasRequirements: boolean;
  /** 取到了用户等级（levelId 或 levelName 至少有一个） */
  hasLevelInfo: boolean;
  /** 等级组别；null 表示按等级名也猜不出来 */
  groupType: "user" | "vip" | "manager" | null;
  /** 已是普通用户的最高一级 */
  atMaxUserLevel: boolean;
  /** 还找得到比当前更高的那一级 */
  hasNextLevel: boolean;
}

/**
 * 判定的先后是有讲究的：没有等级表排在「没有等级」前面 —— 站点压根没给等级表时，
 * 用户没上报等级是正常的，提示应该是「该站点未提供等级要求」而不是「未取到等级」。
 */
export function classifyLevelProgress(facts: ILevelFacts): TLevelProgressState {
  if (!facts.hasRequirements) return "noRequirements";
  if (!facts.hasLevelInfo) return "noLevel";
  if (facts.groupType && facts.groupType !== "user") return "special";
  if (facts.atMaxUserLevel || !facts.hasNextLevel) return "maxed";
  return "rankable";
}

/** 一个未达标项。current / required 已由调用方归一成有限数字；归不成的不要交进来 */
export interface IProgressField {
  key: string;
  current: number;
  required: number;
  /**
   * 要求是「不得超过」（H&R 未满足数那一类）。这类项不能按 当前 ÷ 要求 算完成度：
   * 要求 0 条而当前 5 条时那个商是无穷大，越差反而排得越前。
   */
  direction?: "gt" | "lt";
  /**
   * 显式标成 `false` 的项**不参与比谁更近**（计数照算）。用于「完成度这个数没有意义」的字段 ——
   * 海胆那一格存的是等级积分（四项加权和），4965/5000 = 99% 说的只是「还差 35 分」，
   * 而那 35 分按站点公式是 7000 点魔力值，跟别的站「还差 18.25 GiB 下载量」不是一个量纲。
   * 判据与系数在 `@/shared/levelScoreSites.ts`。
   */
  comparable?: boolean;
}

/** 一组要求：条数按站点判据数出来的原样（含拿不出数字的项），fields 只放能算完成度的那些 */
export interface IUnmetGroup {
  count: number;
  fields: IProgressField[];
}

export interface ILevelProgressInput {
  state: TLevelProgressState;
  /** 主要求 */
  primary: IUnmetGroup;
  /**
   * 可选要求（alternative）：整组只要满足其中一条就算过。
   * 它在「差几项」里只算一项 —— 用户读的是「还差 上传量 或者 做种数 二选一」，不是差两项。
   */
  alternatives?: IUnmetGroup[];
}

export interface ILevelProgressRank {
  state: TLevelProgressState;
  unmetCount: number;
  /** 最卡那一档的完成度，0~1；一项都算不出数字时为 null */
  bottleneck: number | null;
}

export function fieldFraction(field: IProgressField): number | null {
  const { current, required, direction = "gt" } = field;
  if (!Number.isFinite(current) || !Number.isFinite(required)) return null;
  if (direction === "lt") {
    // 能进未达标集合的 lt 项一定满足 current > required（ packages 那边就是这么判的）：
    // 超得越多越差，用 要求 ÷ 当前 折成完成度；要求 0 条而当前有 N 条时没有任何「完成度」可言
    if (required <= 0) return 0;
    return clamp01(required / current);
  }
  if (required <= 0) return 1;
  return clamp01(current / required);
}

/** 一组要求的完成度 = 其中最卡那一项（要全部满足才算过）；标成不可比的项不参与 */
export function groupBottleneck(group: IUnmetGroup): number | null {
  const fractions = group.fields
    .filter((field) => field.comparable !== false)
    .map(fieldFraction)
    .filter((v): v is number => v !== null);
  if (fractions.length === 0) return null;
  return Math.min(...fractions);
}

/**
 * 可选要求组的完成度 = 各条方案里最好的那条（只要满足一条就算过），
 * 一条方案的内部完成度仍然是它自己各项的最短板。
 */
export function alternativeBottleneck(groups: IUnmetGroup[]): number | null {
  const each = groups.map(groupBottleneck).filter((v): v is number => v !== null);
  if (each.length === 0) return null;
  return Math.max(...each);
}

export function rankLevelProgress(input: ILevelProgressInput): ILevelProgressRank {
  const altCount = input.alternatives && input.alternatives.length > 0 ? 1 : 0;
  const unmetCount = input.primary.count + altCount;

  const parts = [groupBottleneck(input.primary)];
  if (altCount) {
    parts.push(alternativeBottleneck(input.alternatives!));
  }
  const known = parts.filter((v): v is number => v !== null);

  return {
    state: input.state,
    unmetCount,
    // 一项数字都拿不到时不给 0：0 意味着「一点没动」，那是替数据源编出来的结论
    bottleneck: known.length === 0 ? null : Math.min(...known),
  };
}

/**
 * 排序：先分档，同档内「差几项」少的在前，再比最卡那一档的完成度（高的在前）。
 * 并列时这里返回 0，由调用方接着按站点名比 —— 完成度结构里没有站点名，
 * 而调用方手里那一行同时有 rank 和站点名，兜底放在它那边只有一份。
 */
export function compareLevelProgress(a: ILevelProgressRank, b: ILevelProgressRank): number {
  const stateDiff = LEVEL_STATE_ORDER.indexOf(a.state) - LEVEL_STATE_ORDER.indexOf(b.state);
  if (stateDiff !== 0) return stateDiff;

  if (a.state === "rankable") {
    if (a.unmetCount !== b.unmetCount) return a.unmetCount - b.unmetCount;
    // 算不出完成度的行排在「有数但进度为 0」之后：前者是不知道，后者是真的没动
    const av = a.bottleneck === null ? -1 : a.bottleneck;
    const bv = b.bottleneck === null ? -1 : b.bottleneck;
    if (av !== bv) return bv - av;
  }
  return 0;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
