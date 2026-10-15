import type { ITorrent, ITorrentPaginationRule, ISearchEntryRequestConfig } from "../types";

/** 第 `pageIndex` 页（1 起）在该站规则下对应的页码值 */
export function searchPageValue(rule: ITorrentPaginationRule, pageIndex: number): number {
  return (rule.firstPageIndex ?? 1) + pageIndex - 1;
}

/** 只认普通对象：`data` 的类型允许是表单编码串或 URLSearchParams，摊平它们会静默丢掉整个请求体 */
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype;

/**
 * 把页码写进搜索入口的 requestConfig。
 *
 * 两条刻意的边界：
 * - 只复制沿途那几层、**不改调用方传进来的那份**：同一份 searchEntry 会被逐页复用，
 *   就地改会让第 2 页的入口带着第 1 页的页码去合并。
 * - 目标位置不是普通对象（例如 POST 的表单编码串）时**原样返回、不写页码**。
 *   宁可不翻页，也不猜怎么往请求体里塞 —— 猜错等于把整个表单丢掉。
 */
export function withSearchPage<T extends ISearchEntryRequestConfig>(
  searchEntry: T,
  rule: ITorrentPaginationRule,
  pageIndex: number,
): T {
  const where = rule.where ?? "params";
  const previous = searchEntry?.requestConfig?.[where];
  if (!isPlainObject(previous) && typeof previous !== "undefined") {
    return searchEntry;
  }

  return {
    ...searchEntry,
    requestConfig: {
      ...searchEntry.requestConfig,
      [where]: { ...(previous ?? {}), [rule.param]: searchPageValue(rule, pageIndex) },
    },
  };
}

/** 同一站内一条种子的身份：详情页链接最准，其次 id，最后标题（JSON 站常不报 id） */
function torrentIdentity(torrent: ITorrent): string {
  return String(torrent.url || torrent.id || torrent.title || "");
}

/**
 * 按页顺序拼成一份列表（第 1 页在前），同一站内的重复条目只保留第一次出现的那条。
 *
 * 为什么要防重复：页码参数被站点忽略时（皮肤改版、或这条规则本身判错了），
 * 第 2 页返回的就是第 1 页的内容 —— 不去重，界面会出现两条一模一样、点进同一个详情页的结果。
 * 认不出身份（链接/id/标题都空）的那条不参与去重，宁留重复也不误删。
 */
export function mergeSearchPages(pages: ITorrent[][]): ITorrent[] {
  const merged: ITorrent[] = [];
  const seen = new Set<string>();

  for (const page of pages) {
    for (const torrent of page ?? []) {
      const identity = torrentIdentity(torrent);
      if (identity && seen.has(identity)) continue;
      if (identity) seen.add(identity);
      merged.push(torrent);
    }
  }

  return merged;
}
