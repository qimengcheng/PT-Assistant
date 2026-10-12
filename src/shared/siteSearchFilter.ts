/**
 * 「按关键词挑站点」的判据：一站点列表 + 一串关键词 → 命中的那些。
 *
 * 单独成模块只为了能直接跑断言（`.tmp-build/site-search-filter-test.mjs` 用 Node 直接 import 真源码）：
 * 这段逻辑住在弹窗组件里时，验它得起一整个台架挂真弹窗 + 假 store。
 *
 * 关键词按空格分词后要求**全部命中**：搜「nexusphp 电影」的人要的是同时满足这两样的那批站，
 * 不是两者的并集（并集会把 300 多个站几乎全带出来，等于没筛）。
 */

/** 这一条吃得到的那几样字段（`ISiteMetadata` 的一个子集，方便造夹具） */
export interface ISiteSearchable {
  id?: string;
  name?: string;
  aka?: string[];
  schema?: string;
  tags?: string[];
  urls?: string[];
}

/**
 * 用户会拿什么叫一个站点：界面上的名字、别名、内部 id、schema（那一颗蓝标签写的就是它）、
 * 内容标签、以及域名/地址。全部折进一条小写串里比。
 */
export function siteSearchHaystack(site: ISiteSearchable): string {
  return [site.name ?? "", site.id ?? "", site.schema ?? "", ...(site.aka ?? []), ...(site.tags ?? []), ...(site.urls ?? [])]
    .join(" ")
    .toLowerCase();
}

/** 一串关键词（空格分隔、去空、折小写）；空串/全是空白 → 空数组 = 不过滤 */
export function siteSearchWords(keyword: string): string[] {
  return keyword.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

export function filterSitesByKeyword<T extends ISiteSearchable>(sites: readonly T[], keyword: string): T[] {
  const words = siteSearchWords(keyword);
  if (words.length === 0) return [...sites];
  return sites.filter((site) => {
    const hay = siteSearchHaystack(site);
    return words.every((word) => hay.includes(word));
  });
}
