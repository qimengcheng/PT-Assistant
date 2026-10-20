/**
 * 把简介里出现的源图地址换掉（转存到图床之后）。
 *
 * ## 为什么是字符串替换而不是 DOMParser 重新序列化
 *
 * 要替换的都是**我们自己产出的绝对地址**（`absolutize` 的结果），而 NexusPHP 的简介里
 * HTML 与 BBCode 混着写（`[img]`、`<img src>`、裸链接三种都见过）。解析成 DOM 再序列化
 * 会把 BBCode 文本、`<pre>` 里的对齐空格一起改写 —— 那些正是 mediainfo 的可读性来源。
 * 逐条精确替换只动我们认得的那几个 URL，别的字节一个不碰。
 *
 * ## 唯一要处理的坑
 *
 * HTML 属性里的 `&` 会写成 `&amp;`：带查询串的图床地址（`?a=1&b=2`）在 HTML 里存的是
 * `?a=1&amp;b=2`，直接用原串搜是搜不到的。所以替换分两趟：先换转义形态，再换原样形态。
 */

/**
 * `urlMap` 是「源图地址 → 图床地址」。空 map 直接原样返回（省掉一遍全文字符串扫描）。
 *
 * `from === to` 的条目跳过：有些图床（或用户手填的 custom 地址）会把原地址原样还回来，
 * 那时替换与否结果一样，但会白白多扫一遍。
 */
export function replaceImageUrls(text: string, urlMap: Record<string, string>): string {
  if (text === "") return text;
  let out = text;

  for (const [from, to] of Object.entries(urlMap)) {
    const source = (from ?? "").trim();
    const target = (to ?? "").trim();
    if (source === "" || target === "" || source === target) continue;

    const sourceEscaped = source.replace(/&/g, "&amp;");
    if (sourceEscaped !== source) {
      out = out.split(sourceEscaped).join(target.replace(/&/g, "&amp;"));
    }
    out = out.split(source).join(target);
  }

  return out;
}

/** 把一组地址按 map 换成新地址；没有映射的保持原样（顺序不变，调用方靠顺序配对） */
export function replaceUrlList(urls: string[], urlMap: Record<string, string>): string[] {
  return urls.map((url) => urlMap[url] ?? url);
}
