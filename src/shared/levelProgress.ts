/**
 * 「升级进度」那张表的判据。纯函数，Node 可直接 import 跑断言（`tests/shared/levelProgress.test.ts`）。
 *
 * **达标与否不归这里管** —— 那一份住在 packages/site 的 `levelRequirementUnMet`，
 * 调用方把它的结果（哪几项没达标、每项的当前值与要求值）交进来。这里只回答两件事：
 * 这一行能不能参与排序，以及谁离下一级更近。
 *
 * ## 「更近」= 还差的量最小，不是完成度百分比最高（用户 2026-10-17 改的）
 * v0.83.0 起这一档比的是「最卡那一项的 `当前 ÷ 要求`」（当时是我讲清跨字段不可通约之后他选的），
 * 用了六个版本之后他驳回：「这个不应该按百分比，而是应该按差的绝对数量来排」。
 * 现在的判据是**该行还差的量**（`要求 − 当前`，「不得超过」那类是 `当前 − 要求`），小者在前。
 *
 * **这条改动的代价必须写在脸上**：字节、秒、点数、分享率四种量纲没有共同尺度，
 * 所以按原始数值排出来的结果是「计数类（几项、几点）普遍靠前 → 时长（秒）居中 → 流量（字节）靠后」。
 * 界面那一行同时把「还差多少」画出来（同一个数、同一个口径），不让人只看到顺序看不到依据。
 * 若哪天要退回可比口径，改的是这一档判据，不是去界面里补一个百分比。
 */

/**
 * 一行处在什么状态。只有 rankable 参与「谁更近」的比较，其余四档各成一档排在后面，
 * 因为把它们和 rankable 混在一起排会造出假信号 —— 「站点没给等级表」并不是「不需要升级」。
 */
export type TLevelProgressState =
  /** 有等级表、有下一级、可以算还差多少 */
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
   * 要求是「不得超过」（H&R 未满足数那一类）。这类项的缺口是 `当前 − 要求`：
   * 超得越多越差。方向给错会把「超了 5 条」算成「还差 -5」，所以这一档必须由调用方点名。
   */
  direction?: "gt" | "lt";
  /**
   * 显式标成 `false` 的项**不参与比谁更近**（计数照算）。用于「这个数跟别的站不是一个量纲」的字段 ——
   * 海胆那一格存的是等级积分（四项加权和），「还差 35 分」按站点公式是 7000 点魔力值，
   * 跟别的站「还差 18.25 GiB 下载量」排在一起没有意义。判据与系数在 `@/shared/levelScoreSites.ts`。
   */
  comparable?: boolean;
}

/** 一组要求：条数按站点判据数出来的原样（含拿不出数字的项），fields 只放能算缺口的项 */
export interface IUnmetGroup {
  count: number;
  fields: IProgressField[];
}

/** 一行/一项「还差多少」。带上 key 是因为界面要把同一个数画出来，不能只给顺序不给依据 */
export interface ILevelGap {
  key: string;
  /** 该字段自己量纲下的缺口（字节 / 秒 / 点数 / 分享率），不为负 */
  value: number;
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
  /** 这一行最得补的那一项还差多少；一项数字都拿不出时为 null */
  gap: ILevelGap | null;
}

/**
 * 单项缺口。达标项不会进这个集合，所以正常算出来就 >= 0；夹一道负数是因为
 * 「当前值与要求值分别取自两次读取」时可能出现站点刚给用户加过量的那种反号 ——
 * 那种情况读作「已经不缺了（0）」，而不是让一个负缺口把这一行排到所有站前面。
 *
 * 负的**当前值**不是反号而是哨兵：`fixRatio` 与各家解析器都拿 `-1` 表示「这个数报不出」，
 * 而缺口按算式会把它变成「分享率还差 3」这种看着很像真数的字符串（这一个数现在要直接画进界面）。
 * 与 `ratioGuard.normalizeRatio` 同一口径判成「算不出」。
 */
export function fieldGap(field: IProgressField): number | null {
  const { current, required, direction = "gt" } = field;
  if (!Number.isFinite(current) || !Number.isFinite(required)) return null;
  if (current < 0) return null;
  const gap = direction === "lt" ? current - required : required - current;
  return gap > 0 ? gap : 0;
}

/**
 * 一组（要全部满足才算过）的缺口 = 其中最得补的那一项，即缺口最大的一项。
 * 挑「最大」而不是「完成度最低」是为了让排序键、界面那一个数和这一行的含义是同一个东西。
 */
export function groupGap(group: IUnmetGroup): ILevelGap | null {
  return worstOf(group.fields.map(toGap));
}

/**
 * 可选要求组（满足任一条即过）的缺口 = 各条方案里最省的那一条；
 * 一条方案内部的缺口仍然是它自己各项里最大的那一个。
 */
export function alternativeGap(groups: IUnmetGroup[]): ILevelGap | null {
  const each = groups.map(groupGap).filter((v): v is ILevelGap => v !== null);
  if (each.length === 0) return null;
  return each.reduce((best, cur) => (cur.value < best.value ? cur : best));
}

export function rankLevelProgress(input: ILevelProgressInput): ILevelProgressRank {
  const altCount = input.alternatives && input.alternatives.length > 0 ? 1 : 0;
  const unmetCount = input.primary.count + altCount;

  const parts = [groupGap(input.primary)];
  if (altCount) {
    parts.push(alternativeGap(input.alternatives!));
  }
  const known = parts.filter((v): v is ILevelGap => v !== null);

  return {
    state: input.state,
    unmetCount,
    // 主要求与可选要求两条都要办，所以这一行的缺口是两者里更大的那一边
    // 一项数字都拿不到时不给 0：0 意味着「只差临门一脚」，那是替数据源编出来的结论
    gap: known.length === 0 ? null : worstOf(known),
  };
}

/**
 * 排序：先分档，同档内「差几项」少的在前，再比这一行还差的量（小的在前）。
 * 并列时这里返回 0，由调用方接着按站点名比 —— 缺口结构里没有站点名，
 * 而调用方手里那一行同时有 rank 和站点名，兜底放在它那边只有一份。
 */
export function compareLevelProgress(a: ILevelProgressRank, b: ILevelProgressRank): number {
  const stateDiff = LEVEL_STATE_ORDER.indexOf(a.state) - LEVEL_STATE_ORDER.indexOf(b.state);
  if (stateDiff !== 0) return stateDiff;

  if (a.state === "rankable") {
    if (a.unmetCount !== b.unmetCount) return a.unmetCount - b.unmetCount;
    // 算不出缺口的行排在「有数但缺口为 0」之后：前者是不知道，后者是真的只差一步
    const av = a.gap === null ? Number.POSITIVE_INFINITY : a.gap.value;
    const bv = b.gap === null ? Number.POSITIVE_INFINITY : b.gap.value;
    if (av !== bv) return av - bv;
  }
  return 0;
}

function toGap(field: IProgressField): ILevelGap | null {
  if (field.comparable === false) return null;
  const value = fieldGap(field);
  return value === null ? null : { key: field.key, value };
}

function worstOf(gaps: (ILevelGap | null)[]): ILevelGap | null {
  const known = gaps.filter((v): v is ILevelGap => v !== null);
  if (known.length === 0) return null;
  return known.reduce((worst, cur) => (cur.value > worst.value ? cur : worst));
}
