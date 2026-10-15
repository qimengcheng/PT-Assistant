/**
 * 搜索结果翻页的两个纯助手（`packages/site/utils/pagination.ts`）。
 *
 * 判据本体只在 packages 那一份，这里不抄第二份实现。它们被「取前 N 页」那条设置驱动，
 * 而那条设置最坏的两件事都由这两处守卫：把整个 POST 请求体丢掉（猜表单编码）、
 * 以及站点忽略页码时界面上出现两条点进同一个详情页的重复结果。
 */
import { describe, expect, it } from "vitest";

import { mergeSearchPages, searchPageValue, withSearchPage } from "@ptd/site/utils/pagination.ts";
import type { ISearchEntryRequestConfig, ITorrent, ITorrentPaginationRule } from "@ptd/site";

/** NexusPHP 那一族的规则：`page` 是 0 基（档位由 PTzone 真页的分页条读出） */
const nphpRule: ITorrentPaginationRule = { param: "page", firstPageIndex: 0 };
/** 表单类站点：页码写进 POST 的 data */
const formRule: ITorrentPaginationRule = { param: "page", where: "data" };

/** 造一条种子：只给断言用得上的字段，其余按 ITorrent 的必填项补最小值 */
const torrent = (over: Partial<ITorrent> & Pick<ITorrent, "title">): ITorrent => ({
  site: "ptzone",
  id: over.title,
  ...over,
});

describe("searchPageValue：页码值由规则里的 firstPageIndex 决定", () => {
  // PTzone 那一页的分页条写着：当前「1-50」，`page=1` 标的是「51-100」，`page=2` 标「101-124」
  it("NexusPHP 是 0 基：第 1 页写 0", () => {
    expect([1, 2, 3].map((p) => searchPageValue(nphpRule, p))).toEqual([0, 1, 2]);
  });

  it("没声明 firstPageIndex 时按 1 基", () => {
    expect([1, 2, 3].map((p) => searchPageValue({ param: "page" }, p))).toEqual([1, 2, 3]);
  });
});

describe("withSearchPage：页码落在哪儿", () => {
  it("默认写进 params，并保留既有的键", () => {
    const entry = { requestConfig: { url: "/torrents.php", params: { notnewword: 1, search: "关键词" } } };
    const next = withSearchPage(entry, nphpRule, 2);
    expect(next.requestConfig?.params).toEqual({ notnewword: 1, search: "关键词", page: 1 });
    expect(next.requestConfig?.url).toBe("/torrents.php");
  });

  it("声明 where=data 时写进 POST 表单对象", () => {
    const entry = { requestConfig: { data: { keyword: "abc" } } };
    expect(withSearchPage(entry, formRule, 3).requestConfig?.data).toEqual({ keyword: "abc", page: 3 });
  });

  it("requestConfig 整个缺省时也能造出 params", () => {
    expect(withSearchPage({} as ISearchEntryRequestConfig, nphpRule, 1).requestConfig?.params).toEqual({ page: 0 });
  });

  it("不改调用方传进来的那一份（同一份入口要逐页复用）", () => {
    const entry = { requestConfig: { params: { search: "x" } } };
    withSearchPage(entry, nphpRule, 2);
    withSearchPage(entry, nphpRule, 3);
    expect(entry.requestConfig?.params).toEqual({ search: "x" });
  });

  it("data 是表单编码串时不写页码，也不把请求体丢掉", () => {
    const entry = { requestConfig: { data: "keyword=abc&cat=1" } };
    const next = withSearchPage(entry, formRule, 2);
    expect(next).toBe(entry);
    expect(next.requestConfig?.data).toBe("keyword=abc&cat=1");
  });

  it("data 是 URLSearchParams 时同样原样返回（摊平它会得到空对象）", () => {
    const body = new URLSearchParams({ keyword: "abc" });
    expect(withSearchPage({ requestConfig: { data: body } }, formRule, 2).requestConfig?.data).toBe(body);
  });
});

describe("mergeSearchPages：顺序与去重", () => {
  it("第 1 页在前、第 2 页在后", () => {
    expect(mergeSearchPages([[torrent({ title: "A" })], [torrent({ title: "B" })]]).map((t) => t.title)).toEqual(["A", "B"]);
  });

  it("站点忽略页码、把第一页再给一遍时不出现重复条目", () => {
    const page = [
      torrent({ title: "A", url: "https://x/detail.php?id=1" }),
      torrent({ title: "B", url: "https://x/detail.php?id=2" }),
    ];
    expect(mergeSearchPages([page, [...page]]).map((t) => t.title)).toEqual(["A", "B"]);
  });

  it("没有 url 时按 id 认，没有 id 时按标题认", () => {
    const first = [torrent({ title: "A", id: 9, url: "" })];
    const second = [torrent({ title: "换了个标题", id: 9, url: "" })];
    expect(mergeSearchPages([first, second]).length).toBe(1);
    expect(mergeSearchPages([[torrent({ title: "同名" })], [torrent({ title: "同名" })]]).length).toBe(1);
  });

  it("链接/id/标题都认不出身份的那些不参与去重（宁留重复也不误删）", () => {
    const blank = { site: "ptzone", id: "", title: "" } as ITorrent;
    expect(mergeSearchPages([[blank], [blank]]).length).toBe(2);
  });

  it("空页与缺页都不影响另一页的结果", () => {
    expect(mergeSearchPages([[], [torrent({ title: "A" })]]).map((t) => t.title)).toEqual(["A"]);
    expect(mergeSearchPages([undefined as unknown as ITorrent[], [torrent({ title: "A" })]]).length).toBe(1);
  });
});
