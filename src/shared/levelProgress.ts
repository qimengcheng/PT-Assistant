/**
 * 「升级进度」那张表的判据。纯函数，Node 可直接 import 跑断言（用例在 `tests/shared/levelProgress.test.ts`）。
 *
 * **达标与否不归这里管** —— 那一份住在 packages/site 的 `levelRequirementUnMet`，
 * 调用方把它的结果（哪几项没达标、每项还差多少）交进来。这里只回答两件事：
 * 这一行能不能参与排序，以及谁离下一级更近。
 *
 * ## 「更近」= 折成上传代价之后还差多少（用户 2026-10-17 定的两层）
 * 第一层：**别自己重算缺口，读达标判据折好的那一份。** packages 里分享率不足会直接折算成上传差额
 * （`neededUpload = max(当前下载, 要求下载) × 要求分享率`）—— 实测：上传 200 GiB、下载 150 GiB、
 * 要求「上传 ≥ 100 GiB 且 分享率 ≥ 2」那一档，它写进 `unmet.uploaded` 的是 **100 GiB**，
 * 而拿「等级要求 − 当前值」自己减一遍会得到 0（200 已经 ≥ 100）。v0.106.11 就是漏了这一层。
 *
 * 第二层：**上传和下载不是一个代价**（用户 2026-10-17：「下载很容易，上传是最难的」）。
 * 所以综合分 = 上传类缺口 × 1 + 下载类缺口 × 低权重，权重表在调用侧（`MyData/utils/levelProgressData.ts`），
 * 因为「哪个字段算上传、哪个算下载」是站点协议知识，不该沉进这份纯判据里。
 * 没有兑换率的那些项（魔力点数、帖子数、做种时长、海胆等级积分）**不进综合分** ——
 * 硬编一个汇率就是替数据源编数；它们仍然计入「差几项」，只是不比远近。
 *
 * 界面那一行同时把「还差」那一项的**原始缺口**画出来（不画折过权重的数），顺序与依据才落在同一个数上。
 * 算不出汇率的那一边在总分里记 0（下界），不把已经称得出重量的那半抹成「不知道」；两边都没得称才 null。
 *
 * 层与层的先后照旧：分档 → 差几项 → 代价（v0.83.0 定的第一、二层，2026-10-17 只换了第三层的算法）。
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

/** 一个未达标项 */
export interface IProgressField {
  key: string;
  /**
   * 达标判据折好的「还差多少」（该字段自己的量纲）。
   * 分享率不足那一种必须靠它 —— 那笔代价被折进了上传量，自己按 `要求 − 当前` 减会算成 0。
   * 给不出（那一档存的是阈值、或站点没写数）时留空，由下面两个值回退算。
   */
  gap?: number;
  /** 当前值与要求值：只在 `gap` 缺席时用来减 */
  current?: number;
  required?: number;
  /**
   * 要求是「不得超过」（H&R 未满足数那一类）时给 `lt`：回退算法是 `当前 − 要求`。
   * 只在 `gap` 缺席时用得上；方向给错会把「超了 5 条」算成「还差 -5」，所以要调用方点名。
   */
  direction?: "gt" | "lt";
  /**
   * 折成「上传代价」的权重：上传类 1，下载类一个明显小于 1 的数（下载容易），
   * **不给 weight 的项不进综合分**（魔力点数、帖子数、时长、海胆等级积分这些没有兑换率）。
   * 权重表由调用侧给 —— 这里不认识字段名。
   */
  weight?: number;
}

/** 一组要求：条数按站点判据数出来的原样（含拿不出数字的项），fields 只放能算缺口的项 */
export interface IUnmetGroup {
  count: number;
  fields: IProgressField[];
}

/** 「还差多少」带上字段名，是因为界面要把同一个数画出来，不能只给顺序不给依据 */
export interface ILevelGap {
  key: string;
  /** 该字段自己量纲下的缺口（字节 / 秒 / 点数 / 分享率），不为负 */
  value: number;
}

/** 一组的综合代价：折成上传代价之后的总分，加上最能代表这一行的那一项（给界面画） */
export interface IGroupCost {
  /** 各项 `缺口 × 权重` 之和；一个加权项都拿不出时 null */
  cost: number | null;
  /** 加权代价最大那一项的**原始缺口**（不画折过权重的数） */
  worst: ILevelGap | null;
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
  /** 折成上传代价的总分；null = 这一行没有任何可折算的项（或有一边压根算不出） */
  cost: number | null;
  /** 界面那句「还差」：cost 最大那一项的原始缺口；算不出为 null */
  gap: ILevelGap | null;
}

/**
 * 单项缺口。达标项不会进这个集合，所以正常算出来就 >= 0；夹一道负数是因为
 * 「当前值与要求值分别取自两次读取」时可能出现站点刚给用户加过量的那种反号 ——
 * 那种情况读作「已经不缺了（0）」，而不是让一个负缺口把这一行排到所有站前面。
 *
 * 负的**当前值**不是反号而是哨兵：`fixRatio` 与各家解析器都拿 `-1` 表示「这个数报不出」，
 * 按算式它会变成「分享率还差 3」那种看着很像真数的串（这一个数现在要直接画进界面），
 * 所以与 `ratioGuard.normalizeRatio` 同口径判成「算不出」。
 */
export function fieldGap(field: IProgressField): number | null {
  const raw = field.gap !== undefined ? field.gap : fallbackGap(field);
  if (raw === null || !Number.isFinite(raw)) return null;
  return raw > 0 ? raw : 0;
}

/** 达标判据没给差额时（那一档存的是阈值、或站点自己没写数）按当前值与要求值减一遍 */
function fallbackGap(field: IProgressField): number | null {
  const { current, required, direction = "gt" } = field;
  if (current === undefined || required === undefined) return null;
  if (!Number.isFinite(current) || !Number.isFinite(required)) return null;
  if (current < 0) return null;
  return direction === "lt" ? current - required : required - current;
}

/** 折成上传代价：没有 weight 的项（无兑换率）一律不供分，缺口算不出的也不供 */
function fieldCost(field: IProgressField): { gap: ILevelGap; cost: number } | null {
  if (field.weight === undefined) return null;
  const value = fieldGap(field);
  if (value === null) return null;
  return { gap: { key: field.key, value }, cost: value * field.weight };
}

/**
 * 一组（要全部满足才算过）的代价 = 各项加权代价之和；代表这一行的那一项取加权最大的那个。
 * 相加而不是取最大：要升这一级，这些差额都得补，补一件不会让另一件变少。
 */
export function groupCost(group: IUnmetGroup): IGroupCost {
  const parts = group.fields.map(fieldCost).filter((v) => v !== null);
  if (parts.length === 0) return { cost: null, worst: null };
  let cost = 0;
  let worst = parts[0];
  for (const part of parts) {
    cost += part.cost;
    if (part.cost > worst.cost) worst = part;
  }
  return { cost, worst: worst.gap };
}

/**
 * 可选要求组（满足任一条即过）的代价 = 各条方案里最省的那一条；
 * 一条方案内部的代价仍然是它自己各项之和。
 */
export function alternativeCost(groups: IUnmetGroup[]): IGroupCost | null {
  const each = groups.map(groupCost).filter((v) => v.cost !== null);
  if (each.length === 0) return null;
  return each.reduce((best, cur) => (cur.cost! < best.cost! ? cur : best));
}

export function rankLevelProgress(input: ILevelProgressInput): ILevelProgressRank {
  const altGroups = input.alternatives && input.alternatives.length > 0 ? input.alternatives : null;
  const unmetCount = input.primary.count + (altGroups ? 1 : 0);

  const primary = groupCost(input.primary);
  const alternatives = altGroups ? alternativeCost(altGroups) : null;

  // 主要求与可选要求两条都要办 → 代价相加。哪一边算不出代价（全是没有兑换率的项），
  // 就把那一边按 0 计 —— 这是**下界**，不是「这一边不要钱」：宁可让这一行排得比真实距离靠前，
  // 也不把已经称得出重量的那半（比如 1 TiB 做种量）整行抹成「不知道」。
  // 两边一个加权项都没有时才给 null，那时确实没有任何依据可比远近。
  const primaryCost = primary.cost;
  const altCost = alternatives?.cost ?? null;
  if (primaryCost === null && altCost === null) {
    return { state: input.state, unmetCount, cost: null, gap: null };
  }

  // 那句「还差」取代价更大的那一边里的代表项 —— 它才是这一行最该补的那一件
  const useAlt = altCost !== null && altCost > (primaryCost ?? -1);
  const gap = useAlt && alternatives ? alternatives.worst : primary.worst;
  return { state: input.state, unmetCount, cost: (primaryCost ?? 0) + (altCost ?? 0), gap };
}

/**
 * 排序：先分档，同档内「差几项」少的在前，再比折成上传代价的总分（小的在前）。
 * 并列时这里返回 0，由调用方接着按站点名比 —— 代价里没有站点名，
 * 而调用方手里那一行同时有 rank 和站点名，兜底放在它那边只有一份。
 */
export function compareLevelProgress(a: ILevelProgressRank, b: ILevelProgressRank): number {
  const stateDiff = LEVEL_STATE_ORDER.indexOf(a.state) - LEVEL_STATE_ORDER.indexOf(b.state);
  if (stateDiff !== 0) return stateDiff;

  if (a.state === "rankable") {
    if (a.unmetCount !== b.unmetCount) return a.unmetCount - b.unmetCount;
    // 算不出代价的行排在「有数但只差一点」之后：前者是不知道，后者是真的只差一步
    const av = a.cost === null ? Number.POSITIVE_INFINITY : a.cost;
    const bv = b.cost === null ? Number.POSITIVE_INFINITY : b.cost;
    if (av !== bv) return av - bv;
  }
  return 0;
}
