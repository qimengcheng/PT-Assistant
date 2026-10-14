/**
 * 站点列表里那几颗布尔开关「哪一颗该按住」。
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
