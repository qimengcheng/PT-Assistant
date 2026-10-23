/**
 * 「这条种子还值不值得继续做种」的判据 —— 按时魔（每小时魔力）产出折。
 *
 * 为什么单独成一个模块、而且零依赖：这一条要给界面上那句「时魔产出低」供货，而那句话的下游动作是
 * **删种**（删了要重下、还会掉站点的做种考核）。判错的方向都得钉住，所以判据本体要能在 Node 里断言
 * （同 `reseedCandidate.ts`、`trackerHost.ts` 的先例）。
 *
 * ## 用户定的两条口径（2026-10-19，两条都是把我第一版驳回之后定下来的）
 *
 * ① **同一份内容挂在越多个站做种 = 价值发挥越充足，不是冗余**。
 *    我第一版把「N 个站都在做种」当成了「删掉一份也不亏」的依据，方向反了 —— 各站的魔力是各站
 *    自己发的，一份数据同时给 5 个站产出，就是 5 份产出，占的还是那一份磁盘。
 *    所以这一条是**正向**因子：站数进 `copies`，每份各算一次，再求和。
 * ② **时魔按公式算，不要以「取不到站点真数」为由不做**。
 *    时魔确实和「做种人数」「种子大小」相关（还和种子存活时长相关），那是 NexusPHP 那一族的公开公式，
 *    不必逐站抓条目页也能折出一个可比的量。见下面 `SEED_VALUE_FORMULA`。
 *
 * ## v0.123.1 纠正的一处：并组的单位是内容，不是「哪台下载器的哪个目录」
 *
 * 用户 2026-10-23 报「做种站点计算不正确」：一片内容在 qBittorrent 里有 13 份副本、各站一个分类、
 * 分类各自带一条保存路径，而这一屏每一行只报「1 份副本 · 做种站点 1」。取数层原先直接复用
 * 「我的下载器」**折叠**那套判据（名称+大小+路径+下载器四项全等），路径被当成了身份的一部分。
 * 折叠要那么严是因为它会把组员**藏掉**；这一屏是汇总，一条都不藏，所以按内容并，
 * 磁盘另按「一处物理数据」计（见 `judgeSeedValue` 的 ⑤）。
 *
 * ## 这个数是估算，界面上必须这么说
 *
 * 站点真正发放时，是把**账号下全部做种**的 A 求和之后再折一层上限（`arctan` 那一档），
 * 所以「这条种子每小时拿多少魔力」在数学上不存在 —— 存在的是它对总和的边际贡献。
 * 这里给的是**单条的时魔权重 A**：同一批内容之间可以比大小、可以排序，
 * 但它不等于站点真发的数，各站的参数（`L`、`B0`、发放周期、零魔权重）也都不同。
 */

/** 公式参数（NexusPHP 那一族的经典值，各站会改；改动要同步界面那句说明） */
export const SEED_VALUE_FORMULA = {
  /** 种子存活时长趋于 1 的特征周期，单位：周 */
  periodWeeks: 4,
  /** 做种人数的参考上限：做种人数到这个数量以上，`Di` 基本就贴着 1 了 */
  seedersRef: 7,
  /** `Di` 里根号 2 那个常数 */
  diSqrt2: Math.SQRT2,
} as const;

/** 一份内容在**一个站**上的一份副本 */
export interface ISeedValueCopy {
  /** 反查得出的所属站点；认不出留 undefined（这一份仍要算，只是站点那一栏报不出） */
  siteId?: string;
  /** 数据是否完整：只勾选下载了部分文件的那一份不产出时魔，整份都不许进合计 */
  completed: boolean;
  /** 这一份当前是不是在做种（做种中 / 正在上传都算；已暂停、已停止不算） */
  seeding: boolean;
  /** 字节 */
  totalSize: number;
  /**
   * 这条种子在**整个 swarm** 里的做种人数（qBittorrent 的 `num_complete`）。
   * 不是列表里那格「做种数」（那是我们已经连上的做种者，纯做种的种子通常是 0）。
   * 报不出的客户端留 undefined —— 那时 `Di` 取下界 1，并在界面上说明「做种人数未知，按最有利的下一档算」。
   */
  swarmSeeders?: number;
  /** 开始做种的 unix 秒（有完成时间用完成时间，否则用添加时间）；undefined = 这一格没报 */
  seedingSince?: number;
  /** 累计上传字节 */
  totalUploaded: number;
  /** 当前上传速度，字节/秒。只用来分「现在有没有在传」，不参与时魔公式 */
  uploadSpeed: number;
  /**
   * 这一份数据**实际落在哪一处**（调用方给「下载器 + 保存路径」，见 `reseedGroups.dataLocationKey`）。
   * 只有「占用磁盘」那一个数吃它：同一处的几份副本（辅种到同一个目录）只占一份字节，不同处各占一份。
   * 时魔、站数、份数都不看它 —— 魔力是各站按副本分别发的。
   * 没报的那些全归到同一个桶，等于退回「这一条内容只占一份」（v0.123.0 之前的行为）。
   */
  location?: string;
}

export interface ISeedValueInput {
  /** 同一份内容在各站/各下载器/各目录里的副本（并组判据见 `reseedGroups.assignContentGroups`：按内容并，不看路径） */
  copies: readonly ISeedValueCopy[];
  /** 现场时间，unix 秒（不许在判据里自己读时钟，否则断言不可复现） */
  now: number;
}

/** 一副本折出来的明细；`weight` 为 null 表示这一份的数报不出（缺大小 / 没在做种） */
export interface ISeedValueCopyDetail {
  siteId?: string;
  /** 这一份有没有进合计（= 数据完整且正在做种）。界面列「在做种的站点」时只能认这一个，
   *  拿 `weight !== null` 判会漏 —— 暂停着的那一份 siteId 照样在，weight 是 null */
  counted: boolean;
  /** 时魔权重 A = Ci × Si × Di；报不出为 null */
  weight: number | null;
  /** 缺了什么导致报不出 / 按什么下界算的。给界面那一句说明用 */
  notes: TSeedValueNote[];
}

/** 算这一份时吃到的「数据不全」档 */
export type TSeedValueNote =
  /** 大小那一格报不出来（0 / 负数 / 非数字） */
  | "no-size"
  /** 开始做种的时间报不出：`Ci` 不许凭空当 1（那是高估），这一份整个不产权重 */
  | "no-since"
  /** 做种人数报不出：`Di` 取下界 1，等于按「做种人很多」那一档算，是**低估**不是高估 */
  | "no-seeders";

/** 内容级的结论 */
export interface ISeedValueVerdict {
  /** 在做种且算得出权重的那些副本的 A 之和 */
  weight: number;
  /**
   * 这一份内容当前**正在做种的站点数**（按站点去重）。
   * 用户问的就是这个数（「这个种子有多少个站在做种」）。认不出站点的那些份**不进**这个数，
   * 它们由 `unknownSiteCopies` 单独报出 —— 两个数加起来才是 `seedingCopies`。
   */
  siteCount: number;
  /** 正在做种的**份数**：同一站挂两份（两个下载器各一份）在这里是 2，在 `siteCount` 里是 1 */
  seedingCopies: number;
  /** 在做种、但 Tracker 反查不出属于哪个站的那几份。它们照样进 `weight`，只是站点那一栏报不出 */
  unknownSiteCopies: number;
  /** 这一份内容挂着的副本总数（含没在做种的） */
  copies: number;
  /**
   * 合计占用磁盘（字节）：按**一处物理数据**算一次，同一处的几份副本不重复计。
   * 「处」= 调用方给的 `location`（下载器 + 保存路径）。同一片内容各站各存一个目录时这是各份相加，
   * 全部辅到同一个目录时就是那一份 —— 这一屏报的是「占着多少磁盘」，把 13 份说成 1 份会直接判错方向。
   */
  bytes: number;
  /** 这几份副本分布在**几处**物理数据上（`bytes` 就是按它累加的）：给界面那句「13 份副本落在 3 个目录」用 */
  locations: number;
  /** 累计上传（各份相加） */
  uploaded: number;
  /** 现在有没有在传（任一份速度 > 0） */
  active: boolean;
  /** 分档，见 `SEED_VALUE_TIERS` */
  tier: TSeedValueTier;
  /** 各份明细，界面展开用 */
  details: ISeedValueCopyDetail[];
  /** 整批里有多少份的数报不出（界面上要说出这个数，不许静默少算） */
  incomplete: number;
}

export type TSeedValueTier =
  /** 一份都没在做种：不产出时魔，先判「要不要重新做种」而不是「要不要删」 */
  | "idle"
  /** 算不出可信的数（缺大小 / 缺时间），不硬判 */
  | "unknown"
  /** 时魔产出低 */
  | "low"
  /** 中间档 */
  | "normal"
  /** 时魔产出高 */
  | "high";

/**
 * 分档阈值。单位是「时魔权重」，一条 50 GiB、做种人数 3、已经做种半年的种子算出来约 80；
 * 一条 5 GiB、做种人数 20 的约 5。取的是这两个数量级之间的两刀。
 * 阈值本身是**取向**不是事实，所以导出成常量给界面引用（浮层里要点名它）。
 */
export const SEED_VALUE_TIERS = { lowBelow: 5, highFrom: 50 } as const;

/** Ci：存活时长因子，`1 - 10^(-T/T0)`，T 以周计。老种子趋近 1，新种子趋近 0 */
function ageFactor(seconds: number): number {
  const weeks = Math.max(0, seconds) / (7 * 24 * 3600);
  return 1 - Math.pow(10, -weeks / SEED_VALUE_FORMULA.periodWeeks);
}

/**
 * Di：做种人数因子，`1 + √2 · 10^(-(Ni-1)/(N0-1))`。
 * 只有一个人做种（Ni=1）时最大 = 1 + √2 ≈ 2.414；做种人数越多越趋近 1 —— 这就是「为做种人数少的种子
 * 做种能获得更多魔力」那条社区共识的解析形式。Ni 取不到时返回下界 1（低估，不吹高）。
 */
function seedersFactor(seeders: number | undefined): number {
  if (seeders === undefined || !Number.isFinite(seeders) || seeders < 1) return 1;
  return 1 + SEED_VALUE_FORMULA.diSqrt2 * Math.pow(10, -(seeders - 1) / (SEED_VALUE_FORMULA.seedersRef - 1));
}

function foldCopy(copy: ISeedValueCopy, now: number): Omit<ISeedValueCopyDetail, "counted"> {
  const notes: TSeedValueNote[] = [];
  const size = Number(copy.totalSize);
  if (!Number.isFinite(size) || size <= 0) {
    return { siteId: copy.siteId, weight: null, notes: ["no-size"] };
  }
  if (copy.seedingSince === undefined || !Number.isFinite(copy.seedingSince)) {
    // 缺时间就不算这一份：Ci 凭空取 1 等于把一条昨天刚下的种子当成年老种，那是往高里编
    return { siteId: copy.siteId, weight: null, notes: ["no-since"] };
  }
  const sizeGb = size / 1024 ** 3;
  const age = ageFactor(now - copy.seedingSince);
  const seeders = seedersFactor(copy.swarmSeeders);
  if (copy.swarmSeeders === undefined) notes.push("no-seeders");
  return { siteId: copy.siteId, weight: age * sizeGb * seeders, notes };
}

/**
 * 一份内容的做种价值。
 *
 * 四条口径写死在这里，别到界面那一层再判一遍：
 * ① **只有「数据完整 + 正在做种」的副本进合计** —— 暂停着的那一份不产出时魔，
 *    把它算进去等于说「你删了也不亏」，而它恰恰是删了要重下的那一类；
 * ② 认不出站点的副本**照算**（它确实在产出魔力，只是不知道在哪个站），只让 `unknownSiteCopies` 多一个，
 *    不许把它从 `weight` 里漏掉 —— 漏掉就是把用户问的那句「有多少个站在做种」答小了；
 * ③ 一份都没在做种时判 `idle` 而不是 `low` —— 「没在做种」要的动作是把它做起来，不是删掉它；
 * ④ **`siteCount` 按站点去重，`seedingCopies` 按份数**：同一站挂两份（两个下载器各一份）时前者是 1、
 *    后者是 2，而 `weight` 是 2 份都算 —— 魔力是各站按副本分别发的。三个数各有各的单位，
 *    所以各起各的名，别合成一个（合成一个就必然有一个是错的）。
 * ⑤ **`bytes` 按 `location` 去重，不按内容**：一片内容各站各存一个目录时它确实占着 N 份磁盘，
 *    全辅到同一个目录时只占一份。这一屏的动作是「还占不占着」，把 N 份报成 1 份是往错方向推
 *    （v0.123.1；原判据写死「同一份内容不管挂几个站都只占一份」，那个前提只在共用目录时成立）。
 */
export function judgeSeedValue(input: ISeedValueInput): ISeedValueVerdict {
  const counting = input.copies.filter((copy) => copy.completed && copy.seeding);
  const details: ISeedValueCopyDetail[] = input.copies.map((copy) => {
    const counted = copy.completed && copy.seeding;
    return counted
      ? { counted, ...foldCopy(copy, input.now) }
      : { siteId: copy.siteId, counted, weight: null, notes: [] as TSeedValueNote[] };
  });
  const weights = details.map((item) => item.weight).filter((item): item is number => item !== null && Number.isFinite(item));

  const bytesByLocation = new Map<string, number>();
  for (const copy of input.copies) {
    const size = Number.isFinite(copy.totalSize) ? Math.max(0, copy.totalSize) : 0;
    const location = copy.location ?? "";
    bytesByLocation.set(location, Math.max(bytesByLocation.get(location) ?? 0, size));
  }
  const bytes = [...bytesByLocation.values()].reduce((sum, one) => sum + one, 0);
  const uploaded = input.copies.reduce((sum, copy) => sum + (Number.isFinite(copy.totalUploaded) ? copy.totalUploaded : 0), 0);
  const active = input.copies.some((copy) => copy.seeding && Number.isFinite(copy.uploadSpeed) && copy.uploadSpeed > 0);
  const sites = new Set(counting.map((copy) => copy.siteId).filter((siteId): siteId is string => !!siteId));

  const base = {
    weight: weights.reduce((sum, item) => sum + item, 0),
    siteCount: sites.size,
    seedingCopies: counting.length,
    unknownSiteCopies: counting.filter((copy) => !copy.siteId).length,
    copies: input.copies.length,
    bytes,
    locations: bytesByLocation.size,
    uploaded,
    active,
    details,
    /** 在做种、但这一份的数报不出（缺大小 / 缺时间）的份数：界面要说出这个数，不许静默少算 */
    incomplete: counting.length - weights.length,
  };

  if (counting.length === 0) return { ...base, tier: "idle" };
  // 一条都算不出可信的数：不硬判，界面上报「数据不全」而不是「价值低」
  if (weights.length === 0) return { ...base, tier: "unknown" };
  return { ...base, tier: base.weight < SEED_VALUE_TIERS.lowBelow ? "low" : base.weight >= SEED_VALUE_TIERS.highFrom ? "high" : "normal" };
}
