/**
 * 「站点分类」的一次性回填判据：判断哪些已添加站点的分组还是空的。
 *
 * 为什么需要这一步：用户配置里的 `groups` 是在**添加站点那一刻**从站点定义的 `tags` 抄进
 * 存储的（`src/entrypoints/offscreen/utils/site.ts` 的 `groups ??=`，只在整份配置为空或
 * flush 时执行）。所以事后往定义里补 `tags`，存量站点那一列不会跟着变 —— 界面上仍是空的。
 *
 * 拆成零依赖纯函数的原因：这条判据决定要不要写用户数据（覆盖已填的分组就是丢数据），
 * 而它住在一个 import 了 340 个站点定义的模块里，模板/异步路径上的表达式没有任何防线。
 */

export interface IStoredSiteGroupRow {
  groups?: string[];
}

/**
 * 返回分组缺失或为空数组的站点 id。
 *
 * 「空数组」也算：那些正是定义当时没有 `tags` 时被抄进去的默认值，不是用户的选择。
 * 只要有一个元素就判为用户填过，一律不动。
 */
export function siteIdsNeedingGroups(
  sites: Record<string, IStoredSiteGroupRow | undefined>,
): string[] {
  const ids: string[] = [];
  for (const [siteId, config] of Object.entries(sites)) {
    if (!config) continue;
    if (Array.isArray(config.groups) && config.groups.length > 0) continue;
    ids.push(siteId);
  }
  return ids;
}
