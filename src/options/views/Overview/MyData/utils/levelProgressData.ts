/**
 * 「升级进度」弹窗每一行的数据来源。
 *
 * 达标判据一律用 packages/site 那一份（`getNextLevelUnMet` → `levelRequirementUnMet`），
 * 这里只做三件它不管的事：
 * 1) **把「未达标的那几项」交出去时，缺口优先用它折好的差额**，不是自己按「等级要求 − 当前值」重减。
 *    这一条是实的：分享率不足时 packages 会按 `neededUpload = max(当前下载, 要求下载) × 要求分享率`
 *    把代价折进 `unmet.uploaded`（实测：上传 200 GiB、下载 150 GiB、要求「≥100 GiB 且 分享率 ≥ 2」
 *    那一档写进来的是 100 GiB，而自己重算得到 0 —— v0.106.11 就漏了这一层）。
 * 2) 按字段语义给每一项标「折成上传代价的权重」（见 `GAP_WEIGHTS`）：上传最难、下载容易，
 *    所以下载类打折；没有兑换率的那些（点数、帖子、时长）不折算，只计入「差几项」。
 * 3) 把站点数据里那些「压根排不进进度条」的情况分档（没等级表 / 认不出等级 / 贵宾 / 已到顶）。
 * 排序规则本身在 `@/shared/levelProgress.ts`（纯函数，Node 断言直接跑它；它不认识字段名，
 * 字段名 → 权重的这张表只住在这里）。
 */
import {
  convertIsoDurationToDate,
  getMaxUserLevelId,
  getNextLevelUnMet,
  guessUserLevelGroupType,
  guessUserLevelId,
  parseSizeString,
  type IImplicitUserInfo,
  type ILevelRequirement,
  type isoDuration,
  type IUserInfo,
  type TSiteID,
} from "@ptd/site";

import {
  classifyLevelProgress,
  rankLevelProgress,
  type ILevelGap,
  type IProgressField,
  type IUnmetGroup,
  type TLevelProgressState,
} from "@/shared/levelProgress.ts";

/** `getNextLevelUnMet` 的返回里这几项是算出来的副产物，不是一种「要求」，不能计入差几项 */
const DERIVED_KEYS = new Set(["level", "passTime", "bonusNeededInterval", "seedingBonusNeededInterval", "alternative"]);

/** 要求是「不得超过」的字段：达标判据没给差额时，回退算法是 当前 − 要求 */
const LT_KEYS = new Set(["hnrUnsatisfied", "hnrPreWarning"]);

/**
 * 各类差额折成「上传代价」的权重（用户 2026-10-17 的取向：「下载很容易，上传是最难的，
 * 所以当然是主要按照上传的差值来排，下载的权重明显要低很多」）。
 *
 * 权重表在这里改一个数就行，**它不是判据而是取向**：0.1 的意思是「1 GiB 下载只当 0.1 GiB 上传」，
 * 取值没有任何站点公布的汇率作依据 —— 界面那一行画的是**原始缺口**（折过权重的数不上界面），
 * 所以改这个数只会动顺序，不会让界面上的数字变得对不上。
 *
 * 归到「下载档」的理由逐条写：`downloaded` / `trueDownloaded` 本身就是下载；
 * `totalTraffic`（上 + 下）与 `seedingSize`（挂出去的总量）都能靠下载补，所以同档。
 * **不在这张表里的项不进综合分**：魔力点数、帖子数、发布/做种数、做种时长（秒）、
 * 海胆那类等级积分（四项加权和）都没有公布的兑换率，硬编一个就是替数据源编数 ——
 * 它们仍然计入「差几项」，只是不比远近。`ratio` / `trueRatio` 也不进：
 * 它们的代价已经被达标判据折进上面的 `uploaded` 了，再算一遍就是重复计费。
 */
const GAP_WEIGHTS: Record<string, number> = {
  uploaded: 1,
  trueUploaded: 1,
  downloaded: 0.1,
  trueDownloaded: 0.1,
  totalTraffic: 0.1,
  seedingSize: 0.1,
};

/**
 * 「还差多少」那一串能画出来的字段 —— 逐条对着 `UserLevelShowSpan.vue` 模板里那些
 * `v-if="levelRequirement.<key>"` 抄下来的。**往 `GAP_WEIGHTS` 加字段要这里一起加**，
 * 只加一边的表现是：排序按它的代价排了，界面上那句「还差」却是空的（弹窗那边会因为这个键
 * 不在集合里而不画「还差」，顺序与可见依据就对不上了）。
 *
 * 站点定义里另外这些字段没有画法（`download` / `specialSeedingSize` / `hnrUnsatisfied` /
 * `hnrPreWarning` / `perfectFlacs` / `uniqueGroups` / `groups` / `percentile` / `donation` /
 * `seedingBonusPerHour`）：它们在展开的等级表里本来就一直是空白的（同一个原因，不是本次改出来的），
 * 所以这里也不画 —— 要补应该补在 `UserLevelShowSpan`，而不是在弹窗里再写一份格式化。
 */
export const GAP_RENDERABLE_KEYS = new Set([
  "interval",
  "totalTraffic",
  "downloaded",
  "trueDownloaded",
  "uploaded",
  "trueUploaded",
  "ratio",
  "trueRatio",
  "seeding",
  "seedingSize",
  "seedingTime",
  "averageSeedingTime",
  "bonus",
  "seedingBonus",
  "bonusPerHour",
  "uploads",
  "leeching",
  "snatches",
  "posts",
  "adoptions",
]);

/**
 * 等级定义上不是「要求」的字段。`id` / `name` 两边都有但含义完全不同（等级序列 vs 用户 ID、
 * 等级名 vs 用户名），照键名去 userInfo 取值会拿错东西，所以先按名字挡掉。
 */
const NOT_A_REQUIREMENT_FIELD = new Set([
  "id",
  "name",
  "nameAka",
  "groupType",
  "isKept",
  "privilege",
  "downgrade",
  ...DERIVED_KEYS,
]);

/**
 * 下一级那一行的「当前值」：只取该级要求里出现过的字段，值原样从 userInfo 搬过来。
 *
 * 为什么按要求筛、而不是把 userInfo 全铺出来：铺全是一排十几个图标，跟需求值并排时认不出
 * 哪一项对哪一项；筛过之后两串同字段、同图标、同单位（同一份 `UserLevelShowSpan` 渲染）。
 *
 * 只认有限数值：Gazelle 系抓不到魔力会写字符串 "N/A"，那种当前值宁可不出现 —— 走
 * `formatBonus` 的 `Number("N/A") || 0` 就画成了一个 0，那是替数据源编一个数。
 * `interval` 同理天然缺席：`IUserInfo` 把它 Omit 掉了，入站时长那一档的当前值要么自己再算
 * 一遍 elapsed，要么就没有，这里不新写第二份判据。
 */
export function buildCurrentValues(userInfo: IUserInfo, requirement: ILevelRequirement): IImplicitUserInfo {
  const userDict = userInfo as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(requirement)) {
    if (NOT_A_REQUIREMENT_FIELD.has(key)) continue;
    const value = userDict[key];
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
  }
  return out as IImplicitUserInfo;
}

const SIZE_KEYS = new Set([
  "totalTraffic",
  "downloaded",
  "download",
  "trueDownloaded",
  "uploaded",
  "trueUploaded",
  "seedingSize",
  "specialSeedingSize",
]);

/** 秒数或 ISO 时长两可的字段（等级要求里常写成 "P30D"） */
const DURATION_KEYS = new Set(["seedingTime", "averageSeedingTime"]);

const RATIO_KEYS = new Set(["ratio", "trueRatio"]);

/** 下一级的未达标明细；形状就是 packages 给的那一份，界面直接拿去喂 UserLevelsComponent */
export type TUnmetDetail = Partial<IImplicitUserInfo & { level?: ILevelRequirement; alternative?: IImplicitUserInfo[] }>;

export interface ILevelProgressRow {
  site: TSiteID;
  /** 界面要按这一行重算「下一级还差什么」，所以把原始用户信息一并带出去，不再让模板自己找 */
  userInfo: IUserInfo;
  /** 站点名（内部 id 不进界面，见 AGENTS.md §3.5）；并列时的兜底排序也读它 */
  siteName: string;
  state: TLevelProgressState;
  unmetCount: number;
  /** 折成上传代价的总分（排序键）；null = 这一行没有可折算的项 */
  cost: number | null;
  /** 界面那句「还差」：这一行加权代价最大那一项的原始缺口；null = 算不出或画不出来 */
  gap: ILevelGap | null;

  /** 该站的等级表，按 id 升序（圆点阶梯与展开的纵向阶梯都吃这一份） */
  ladder: ILevelRequirement[];
  /** 当前等级在 ladder 里的下标；-1 = 放不上阶梯（此时 state 是 noLevel） */
  currentIndex: number;
  nextLevel: ILevelRequirement | null;
  /** 下一级的未达标明细 */
  unmet: TUnmetDetail;
}

/** 需求侧与用户侧两可的值归一成数字；归不成返回 null，由调用方丢掉（不替数据源编一个 0） */
function toNumber(value: unknown, key: string, refTime: number): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  if (SIZE_KEYS.has(key)) return finite(parseSizeString(text));
  if (DURATION_KEYS.has(key) || /^P/.test(text)) {
    // 时长一律折成秒，与 packages 那边同一口径
    return finite((convertIsoDurationToDate(text as isoDuration, refTime) - refTime) / 1e3);
  }
  return finite(parseFloat(text));
}

function finite(v: number): number | null {
  return Number.isFinite(v) ? v : null;
}

/** 分享率要求允许写成 [最小, 最大]；卡住用户的是下界 */
function ratioRequired(value: unknown): number | null {
  if (Array.isArray(value)) {
    const nums = value.map((v) => (typeof v === "number" ? v : parseFloat(String(v)))).filter(Number.isFinite);
    return nums.length ? Math.min(...nums) : null;
  }
  return toNumber(value, "ratio", Date.now());
}

/**
 * 一组要求（主要求，或可选要求里的某一条）归一成「差几项 + 各项还差多少 + 各项权重」。
 * 项数按未达标明细的键数（去掉副产物），不认能不能算出数字 —— 「差 3 项」里有 1 项站点没报数，
 * 用户也该看到 3，只是那一项不参与比谁更近。
 */
function buildUnmetGroup(
  unmet: Record<string, unknown>,
  requirement: IImplicitUserInfo | undefined,
  userInfo: IUserInfo,
  now: number,
): IUnmetGroup {
  const keys = Object.keys(unmet).filter((k) => !DERIVED_KEYS.has(k));
  const fields: IProgressField[] = [];
  const reqDict = (requirement ?? {}) as Record<string, unknown>;
  const userDict = userInfo as unknown as Record<string, unknown>;
  const joinTime = typeof userInfo.joinTime === "number" ? userInfo.joinTime : now;

  for (const key of keys) {
    let required: number | null;
    let current: number | null;
    /** 达标判据折好的差额；null = 这一档它给的不是差额（或压根不是数） */
    let converted: number | null = null;

    if (key === "interval") {
      // 入站时间的要求值在 packages 那边已经折成绝对达标时刻（passTime）。用它减入站时刻才是
      // 「这一级总共要等多久」，拿原始 iso 串在这里重算会因两次取值间的时钟差而漂。
      const passTime = typeof unmet.passTime === "number" ? unmet.passTime : null;
      if (passTime === null) continue;
      required = passTime - joinTime;
      current = now - joinTime;
      // `unmet.interval` 是 "P1M15D" 那种只到「天」的串，passTime 才是精确时刻
      converted = passTime - now;
    } else if (RATIO_KEYS.has(key)) {
      // 这一档 `unmet` 里存的是**卡住的那个阈值**，不是差额；它的代价已经折进 uploaded 了
      required = ratioRequired(reqDict[key]);
      current = toNumber(userDict[key] ?? 0, key, now);
    } else {
      required = toNumber(reqDict[key], key, now);
      current = toNumber(userDict[key] ?? 0, key, now);
      converted = toNumber(unmet[key], key, now);
    }

    // 三者里有一个拿得出来就留着这一项。上一版只认「当前值 + 要求值都在」，于是
    // 「差额折好了、当前值取不到」那种（Gazelle 魔力报 "N/A" 而站点确实说你还差 1000 点）会被整条丢掉
    if (required === null && current === null && converted === null) continue;

    fields.push({
      key,
      gap: converted ?? undefined,
      current: current ?? undefined,
      required: required ?? undefined,
      direction: LT_KEYS.has(key) ? "lt" : "gt",
      weight: GAP_WEIGHTS[key],
    });
  }

  return { count: keys.length, fields };
}

export function buildLevelProgressRow(
  userInfo: IUserInfo,
  levelRequirements: ILevelRequirement[],
  siteName: string,
): ILevelProgressRow {
  const now = Date.now();
  const ladder = [...levelRequirements].sort((a, b) => a.id - b.id);
  const hasRequirements = ladder.length > 0;

  const levelId =
    typeof userInfo.levelId === "number" ? userInfo.levelId : userInfo.levelName ? guessUserLevelId(userInfo, ladder) : undefined;
  const currentIndex = levelId === undefined ? -1 : ladder.findIndex((level) => level.id === levelId);

  const matched = currentIndex >= 0 ? ladder[currentIndex] : undefined;
  const groupType = matched?.groupType ?? (userInfo.levelName ? guessUserLevelGroupType(userInfo.levelName) : null);

  const unmet: TUnmetDetail =
    hasRequirements && levelId !== undefined ? (getNextLevelUnMet(userInfo, ladder) as TUnmetDetail) : {};
  const nextLevel = unmet.level ?? null;

  const state = classifyLevelProgress({
    hasRequirements,
    // 认不出「你在哪一级」和「压根没取到等级」在界面上是同一件事：阶梯上没有一个点是亮着的
    hasLevelInfo: currentIndex >= 0,
    groupType,
    atMaxUserLevel: levelId !== undefined && levelId >= getMaxUserLevelId(ladder),
    hasNextLevel: !!nextLevel,
  });

  const primary = buildUnmetGroup(unmet as Record<string, unknown>, nextLevel ?? undefined, userInfo, now);
  const alternatives = (unmet.alternative ?? []).map((alt, i) =>
    buildUnmetGroup(alt as Record<string, unknown>, (nextLevel?.alternative ?? [])[i], userInfo, now),
  );
  const rank = rankLevelProgress({ state, primary, alternatives: alternatives.length ? alternatives : undefined });

  return {
    site: userInfo.site,
    userInfo,
    siteName,
    state: rank.state,
    unmetCount: rank.unmetCount,
    cost: rank.cost,
    gap: rank.gap,
    ladder,
    currentIndex,
    nextLevel,
    unmet,
  };
}
