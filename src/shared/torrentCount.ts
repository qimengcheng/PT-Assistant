/**
 * 搜索结果里那几列数字（做种 / 下载 / 完成 / 评论）的取值与显示。
 * 两处用同一个判定：设置页搜索结果表（SearchEntity/Index.vue）、站点页那个批量下载弹窗
 * （content-script/app/components/AdvanceListModuleDialog.vue）—— 后者没有 bodyCell 分支，
 * 原本直接把解析值打出去，同一份污染在两边会长成不同的样子。
 *
 * 为什么要单独一层：解析层取的是格子的 innerText，并且只在「整串就是纯数字」时才转成 number
 * （`packages/site/utils/filter.ts:7-16` 的 `tryToNumber`），所以站点自己那一格里的图标字符会
 * 跟着数字一起进表 —— 用私有区码位写图标的（`\ue6a7` + 数字）、直接写 emoji 的（`💬` + 数字）都有。
 * 界面表现就是「有的行数字后面挂着个小图标、有的没有」，同时这一列的排序会被带进字符串分支
 * （`makeSorter` 的 `parseFloat` 对 `\ue6a71` 得到 NaN）。这类格子在站点定义里能查到写法：
 * `packages/site/schemas/Unit3D.ts:204`、`definitions/jpopsuki.ts:110`、`definitions/pussytorrents.ts:80`。
 *
 * 这里统一只取**第一串数字**；取不到就当这一格是空的，不把站点的原始串端给用户。
 */

/** 千分位照收（`1,024` → 1024）；小数不认，这四列本来也是计数 */
const FIRST_NUMBER_RUN = /-?[\d,]+/;

/** 拿到数字就算，拿不到返回 null（null 与 0 在界面上不是一回事，见 `countText`） */
export function toCount(raw: unknown): number | null {
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : null;
  }
  if (typeof raw !== "string") return null;

  const matched = raw.replace(/\s/g, "").match(FIRST_NUMBER_RUN);
  if (!matched) return null;

  const value = Number(matched[0].replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

/** 单元格文字：判不出来就是空串（挂个 0 会上报「这个站说没有评论」，而其实站点没给这一格） */
export function countText(raw: unknown): string {
  const value = toCount(raw);
  return value === null ? "" : String(value);
}

/**
 * 比较器吃的档位：判不出的按「比 0 还小」排，升序时这些空格浮到最上面、降序（想看评论最多的那种）沉到最下面。
 */
export function countCompare(key: "seeders" | "leechers" | "completed" | "comments") {
  return (a: any, b: any): number => (toCount(a?.[key]) ?? -1) - (toCount(b?.[key]) ?? -1);
}

/**
 * 「点了能看评论」的落点：站点的评论区就在详情页里，`#comments` 这个锚点是 Unit3D / NexusPHP 这一族的通行写法
 * （证据见文件头那几行定义）。站点自己没带锚点时补一个；带了就**不抢它的位置**。
 * 0 条评论或判不出条数时不给链接 —— 格子空着却可点，点开又是同一页，那是假 affordance。
 * 返 undefined 而不是 null：`href` 的类型是 `string | undefined`，模板那边不该再补一次转换。
 */
export function commentsHref(torrent: { url?: unknown; comments?: unknown }): string | undefined {
  const count = toCount(torrent.comments);
  if (count === null || count <= 0) return undefined;

  const url = typeof torrent.url === "string" ? torrent.url.trim() : "";
  if (!/^https?:\/\//i.test(url)) return undefined; // magnet / 相对路径 / 没有详情页，都不当页面用
  if (url.includes("#")) return url;

  return `${url}#comments`;
}
