/**
 * 「这一条种子有多大」的两件事：**读得出读不出**（{@link toSizeBytes}），以及**该读哪一个数**（{@link pickTorrentSizeBytes}）。
 *
 * 为什么要单独一份，而不是各页面自己 `size ?? 0`：站点那一列是**从搜索结果页那一格的文本解析**出来的，
 * 而解析层读不懂时回的是 **0** —— `packages/site/schemas/AbstractBittorrentSite.ts:663` 那条兜底
 * 对字符串一律走 `parseSizeString`，后者在文本不匹配 `sizePattern` 时 `return 0`
 * （`packages/site/utils/filesize.ts:37`，它把「读不懂」折成了「零字节」）。
 * 0 字节不是任何一份真实内容，所以它只能算「判不出」。
 *
 * 这条判据原先只住在 `shared/bestReseed.ts`（分档那一步用），界面那侧没有它，于是同一个站
 * 在三处各说一套：搜索页大小列 `0 B`、辅种检测那一行 `0 B`、建任务落库也记 0
 * （用户 2026-10-15 报的 1PTBar 那一行）。同族先例：人数列的 `countText`（判不出留空不写 0）、
 * 进度的 `toPercent`（判不出返回 null）。
 *
 * 纯判据，不 import 任何东西，也不碰浏览器 API —— 行为断言直接 import 这个文件跑
 * （约束与 `shared/bestReseed.ts`、`shared/levelProgress.ts` 那条一样：一旦拖进 `formatSize`
 * 所在的 `options/utils.ts`，这个文件的 Node 可 import 性就没了）。
 */

/**
 * 站点/下载器报出来的大小，归一成字节数；**读不出返回 null**（缺字段 / 空串 / 0 / 负数 / NaN /
 * `"56.58 GiB"` 这种带单位的串）。类型写的是 `size?: number`，但运行时什么都可能是，所以参数是 `unknown`。
 */
export function toSizeBytes(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export interface ITorrentSizeSources {
  /**
   * 已经取回并解析过的那份 `.torrent` 的总字节（`ITorrentInfoForVerification.length`）。
   * 它是这份内容的**真实字节**，与站点把那一格写成什么样子无关。
   */
  torrentLength?: unknown;
  /** 搜索结果页那一格解析出来的字节数 —— 读不懂时是 0，只能当兜底 */
  pageShownSize?: unknown;
}

/**
 * 已经有 `.torrent` 就别再用页面那个数。
 *
 * 辅种检测那一屏每条都真的把 `.torrent` 取回来解析过（验证与三层指纹比的都是它），
 * 所以那一行的大小本来有真数可用；页面值只在 `.torrent` 还没回来的那几条上兜底。
 * 两个都读不出 → null，由调用方决定是画 `-` 还是走「算不出」那一档（不拿 0 冒充）。
 */
export function pickTorrentSizeBytes(sources: ITorrentSizeSources): number | null {
  return toSizeBytes(sources.torrentLength) ?? toSizeBytes(sources.pageShownSize);
}
