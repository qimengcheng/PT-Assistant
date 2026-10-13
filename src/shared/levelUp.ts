/**
 * 「站点等级升上去了」的判据与文案 —— 用户 2026-10-13 要的：「用户数据更新后发现用户升级之后
 * 要祝贺用户，要有好看的烟花动画」。
 *
 * 纯函数、零 import：取数那侧（offscreen 的用户信息刷新）与渲染那侧（界面那张祝贺卡）吃**同一份**
 * 判据和**同一份**措辞，抄第二份就是「卡片说升了、通知说没升」那一类缺陷（同 `reseedNotice.ts` 的口径）。
 * 用例在 `tests/shared/levelUp.test.ts`（Vitest 直接 import 这一份）。
 *
 * 为什么等级 ID 由调用方传进来、而不是这里 `import` @ptd/site：那条根入口会把 packages 整条链
 * 拖进来，这份判据就没法在 Node 里直接跑了 —— 同 `src/shared/levelProgress.ts` 那次一样的取舍
 * （达标判据留在 packages，这一层只吃算好的事实）。
 */

/**
 * 到这一档就是贵宾 / 管理组，不参与逐级升级。
 *
 * 真值在 `packages/site/types/userinfo.ts` 的 `MinNonUserLevelId`，这里按字面量对齐，
 * 由用例里那条「与包内常量同值」钉住（先例：`reseedPath.ts` 的 `category_prefix` 与
 * `packages/downloader` 那份靠断言比同值，而不是 import 过来）。
 */
export const NON_USER_LEVEL_ID = 100;

/** 拿不到等级时 packages 那侧的哨兵值（`utils/level.ts` 写的是 `userInfo.levelId ?? -1`） */
const UNKNOWN_LEVEL_ID = -1;

/**
 * 这一趟刷新算不算「升级」。三条都成立才算，缺一条就**不吭声**（判不出就不替用户编一个恭喜）：
 *
 * 1. 上下两份都拿得出**数字**等级 ID —— 只有等级名、或站点压根没解析出等级时不比。
 *    等级名不能比：各站叫法不同而且不是全序（「资深会员」和「精英会员」谁高，界面上看不出来，
 *    而 ID 是站点定义里声明的递增序列）。
 * 2. 两份都在普通用户那一档（都 `< NON_USER_LEVEL_ID`）—— 从会员跳到贵宾是身份变化，
 *    不是「又升了一级」那种值得放烟花的事（分档口径同 `classifyLevelProgress` 的 `special`）。
 * 3. 新的**严格大于**旧的 —— 降级（保级没达标）不报，同档重刷也不报。
 *
 * 另外挡掉那个 -1 哨兵：它既不是「第 -1 级」，也不许被当成最低的正规等级去比大小，
 * 否则「没解析出来」会被报成「从 -1 升到 3，恭喜」。
 */
export function detectLevelUp(fromLevelId?: number, toLevelId?: number): boolean {
  const isUserLevel = (id?: number): id is number =>
    typeof id === "number" && Number.isFinite(id) && id > UNKNOWN_LEVEL_ID && id < NON_USER_LEVEL_ID;
  if (!isUserLevel(fromLevelId) || !isUserLevel(toLevelId)) return false;
  return toLevelId > fromLevelId;
}

/** 一次升级：站点显示名 + 升上去那一级的站点叫法 */
export interface ILevelUpItem {
  /** 站点**显示名**（`site.metadata.name`），不是内部 id —— §3.5「内部标识不进 UI」 */
  siteName: string;
  /** 站点自己的等级名（`levelName`）；站点没给就只说站点名，不编一个等级名 */
  levelName?: string;
}

/** 明细最多列几条，剩下的并成一句「另有 N 个站点」（同 v0.79.0 那张进展卡定的档） */
export const LEVEL_UP_DETAIL_MAX = 3;

const zh = (lang: string | undefined) => lang === "zh_CN";

/**
 * 标题。两边（界面卡 / 系统通知）同一句，措辞在这里定。
 */
export function levelUpTitle(lang: string | undefined): string {
  return zh(lang) ? "恭喜，站点等级提升" : "Congratulations on a level-up";
}

/**
 * 正文第一句。一条时说清是哪个站；多条时说清是几件事 —— 与下面的明细行配套，不重复。
 */
export function levelUpLead(items: ILevelUpItem[], lang: string | undefined): string {
  if (items.length > 1) {
    return zh(lang) ? `有 ${items.length} 个站点的等级升到了下一级` : `${items.length} sites leveled up`;
  }
  const only = items[0];
  if (!only) return zh(lang) ? "站点等级提升" : "A site leveled up";
  if (zh(lang)) {
    return `你在「${only.siteName}」${only.levelName ? `升到「${only.levelName}」` : "的等级提升了"}`;
  }
  return `You reached${only.levelName ? ` "${only.levelName}"` : " a new level"} on ${only.siteName}`;
}

/**
 * 明细行：最多 {@link LEVEL_UP_DETAIL_MAX} 条，剩下并成一句。
 * 只有一条时**返回空数组** —— 那句正文已经写完了这件事，多一行重复是噪声（v0.79.0 同一条判据）。
 */
export function levelUpDetailLines(items: ILevelUpItem[], lang: string | undefined): string[] {
  if (items.length <= 1) return [];
  const shown = items.slice(0, LEVEL_UP_DETAIL_MAX);
  // 「站点名 → 等级名」这一行两种语言同形：站名和等级名都是站点自己的叫法，不是我们的词
  const lines = shown.map((item) => `${item.siteName}${item.levelName ? ` → ${item.levelName}` : ""}`);
  const rest = items.length - shown.length;
  if (rest > 0) {
    lines.push(zh(lang) ? `另有 ${rest} 个站点` : `and ${rest} more sites`);
  }
  return lines;
}

/** 系统通知那一条的正文（界面卡片用上面那两个函数分行摆，这里拼成一串） */
export function levelUpNoticeMessage(items: ILevelUpItem[], lang: string | undefined): string {
  return [levelUpLead(items, lang), ...levelUpDetailLines(items, lang)].join("\n");
}
