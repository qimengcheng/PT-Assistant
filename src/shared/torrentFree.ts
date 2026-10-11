/**
 * 「这一条种子下载了不记下载量」的判据 —— 判的是**促销标签**，不是 `ITorrent` 上的字段：
 * 站点解析层把页面上的免费/促销标记统一归一进 `tags`（`packages/site/utils/tags.ts`），
 * 类型里压根没有 `isFree` 这一项，所以标签是唯一来路。
 *
 * 为什么单独成模块：这条判据有两个下游，取向必须一致 ——
 *  - `reseedRecommend.ts`：挑辅种基准时「下这一份不花钱」的那几条才值得推荐；
 *  - `ratioGuard.ts`：算「下载这一批之后分享率会变成多少」时，免费的条目**不增加下载量**，
 *    所以不压低预估。
 * 两处各写一套的话，同一个站在两处会一个算免费、一个算收费。
 *
 * ⚠️ 打折档（25% / 30% / 35% / 50% / 70% / 75% / 2x50%）**按全额下载量算**，`NL.`（中性 =
 * 0 上传 0 下载）也不算免费。前者是宁可多警不误警，后者是它的双向归零与「下载不花钱」
 * 不是一回事（这条口径从 reseedRecommend 原样带过来，两处共用）。
 */

/** 归一化之后的免费类标签名（`packages/site/utils/tags.ts` 的 preDefinedTorrentTagMap） */
const FREE_TAG_NAMES = new Set(["Free", "2xFree", "Freeload"]);

/**
 * 站点原始标签没被归一化时剩下的写法（标签文本直接来自页面，见 NexusPHP 的 customTags 解析）。
 * 逐条写死而不是 `/free/i` 一把抓：`notFree` 这类含 free 的词会被顺手认成免费。
 */
const FREE_TAG_PATTERNS: RegExp[] = [/^free$/i, /^2x?free$/i, /freeleech/i, /freeload/i, /免费/];

/** 这一条是不是免费下载（促销标签里带免费性质的都算） */
export function isFreeTorrent(tags?: { name: string }[] | null): boolean {
  if (!tags?.length) return false;
  return tags.some(
    (tag) => FREE_TAG_NAMES.has(tag.name) || FREE_TAG_PATTERNS.some((re) => re.test(tag.name)),
  );
}
