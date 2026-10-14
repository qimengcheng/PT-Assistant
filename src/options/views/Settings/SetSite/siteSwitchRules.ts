/**
 * 站点列表/编辑器里那几颗布尔开关的两条落库规则：哪一颗该按住、按下要连带改哪几颗。
 *
 * 为什么要有这一份，而不是留在模板里那条表达式：v0.8.0 把上游 PT-depiler 的四段
 * `#item.userConfig.*` 插槽（`SetSite/Index.vue:264-303`，每段一份 `:disabled`）抄成了一段
 * 通用模板，于是「已离线」那一档也吃进了「离线就按住」这条 —— 结果是**一把单向锁**：
 * 用户 2026-10-13 报的「这个点成离线就点不回来了」。按住的是整行三颗（开了内容脚本例外时四颗）
 * 开关，**包括「已离线」自己**；而站点编辑器里根本没有这颗开关
 * （`Editor.vue` / `EditDialog.vue` 全文 "offline" 零命中），所以列表里关不掉就没有第二条路。
 *
 * 上游的分列语义是刻意的：`isOffline` 只被站点定义自身的 `isDead` 按住（那是「这站已经没了」，
 * 不是用户能改的状态），其余那颗才吃 `isOffline`（离线站再谈搜索/取用户信息没有意义）。
 * 这条「控制 X 的那一颗不许被 X 按住」就是本文件存在的理由 —— 模板里的表达式没有任何防线
 * （vue-tsc / check-dead-props / ESLint 都看不见它），所以判据搬到这里，由 `tests/options` 钉住。
 */

/** 一行站点里本文件要看的那两样：站点定义有没有标死、用户配置有没有标离线 */
export interface ISiteSwitchRow {
  metadata: { isDead?: true };
  userConfig: { isOffline?: boolean };
}

/**
 * 哪些开关还额外要求站点定义里有对应那一节。
 * 判据用 `Object.hasOwn` 而不是「值不等于 undefined」：定义里写了 `search: undefined` 这种
 * 空值时，上游同样按「没有搜索能力」处理，两边要一致。
 */
const CAPABILITY_BY_KEY: Readonly<Record<string, string>> = {
  "userConfig.allowSearch": "search",
  "userConfig.allowQueryUserInfo": "userInfo",
};

/** 那一列的键名 —— 模板里 `column.key` 就是这个形状 */
export const SITE_OFFLINE_KEY = "userConfig.isOffline";

/**
 * @param key 那一列的键，如 `userConfig.isOffline`
 * @param row 这一行（只读 `metadata.isDead` / `metadata` 上有没有那一节 / `userConfig.isOffline`）
 */
export function siteSwitchDisabled(key: string, row: ISiteSwitchRow): boolean {
  if (row.metadata.isDead) return true;

  // 「已离线」自己那颗不许被「已离线」按住 —— 这一条就是本次的修复，别改回去
  if (key !== SITE_OFFLINE_KEY && row.userConfig.isOffline) return true;

  const capability = CAPABILITY_BY_KEY[key];
  return capability !== undefined && !Object.hasOwn(row.metadata, capability);
}

/** `userConfig` 上的字段名：编辑器那边是直接绑字段的，拿不到列表的列键 */
export const SITE_OFFLINE_FIELD = "isOffline";

/** 打开「已离线」时要连带关掉的那两颗 */
const CASCADE_ON_OFFLINE = ["allowSearch", "allowQueryUserInfo"] as const;

/**
 * 把「已离线」打开时连带关掉的那两颗（用户 2026-10-14：「设为已离线时应该自动将另外两个也关闭」）。
 *
 * **单向**：取消离线不自动把这两颗打开。那两颗当时确实是这次联动关掉的，但它们就摆在同一行里，
 * 要恢复看得见地点回来；自动打开等于替用户决定「这个站我又要拿去搜了」，而这件事从来没有别的
 * 规则替他做过。
 *
 * 行为层早就按 `!isOffline` 门控（搜索作用域 `SearchScopeSelect`、后台 `alarms`、右键菜单），
 * 这次动的是**存储里的值** —— 为的是让列表、编辑器、筛选这三处读同一份数据时说同一句话。
 */
export function offlineCascade(offline: boolean): Record<string, boolean> {
  if (!offline) return {};
  return Object.fromEntries(CASCADE_ON_OFFLINE.map((field) => [field, false]));
}

/**
 * 列表那一格按下去要写回的整份补丁：那颗开关自己 +（只有「已离线」才有的）连带那两颗。
 *
 * @param columnKey 列键，形如 `userConfig.isOffline`
 */
export function siteSwitchPatch(columnKey: string, checked: boolean): Record<string, boolean> {
  const field = columnKey.startsWith("userConfig.") ? columnKey.slice("userConfig.".length) : columnKey;
  return { [field]: checked, ...offlineCascade(field === SITE_OFFLINE_FIELD && checked) };
}
