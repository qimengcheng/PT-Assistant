/**
 * 源站简介 → 目标站简介的折算判据。
 *
 * ## 这一层为什么值得单独存在
 *
 * 转种里最容易「看起来成功、实际发出去是废帖」的一步就是简介：标题对了、分类对了、
 * 种子也提交了，结果目标站的帖子里只有一句「简介见源站」和一排裂图。而简介恰恰是唯一
 * 没法从 `info` 段里读出来的东西 —— 它只存在于源站的详情页 HTML 里。
 *
 * ## 抓什么、不抓什么
 *
 * 抓三样，都是源站页面「原样给出」的事实：
 * - 简介区的 HTML（清洗后）
 * - 简介里的截图 URL
 * - mediainfo 文本（如果源站把它贴在了简介里）
 *
 * **不生成** mediainfo 与截图。浏览器扩展拿不到媒体文件本体，也没有 ffmpeg / mediainfo
 * 二进制，本地造假（拿文件名拼一段假的 mediainfo）比留空更糟：目标站会当成伪造信息处理。
 *
 * ## 为什么判据住在这里而不是 offscreen
 *
 * DOM 那一半（找容器、读属性）必须在 offscreen；但「哪些图片算截图」「这段文字像不像
 * mediainfo」「拼成什么格式交给目标站」是纯粹的字符串判断，放这里才能直接跑 Node 断言
 * （同 `reseedCandidate.ts` / `uploadMatch.ts` 的先例）。判错的现场是「发出去的帖子里
 * 全是笑脸表情」，不是抛错。
 */
import type { ISourceDescription } from "./types.ts";

/**
 * 一眼就知道不是截图的图片。
 *
 * 这些图在 PT 站简介里到处都是：表情、论坛图标、等级徽章、附件小图标、间距占位图。
 * 它们全都带 `src`、尺寸也都正常，靠「能不能加载」区分不出来，只能按名字认。
 * 判据故意写得宽 —— 漏掉一张真截图只是少一张图，混进一堆表情会让帖子看起来像垃圾帖。
 */
const NOISE_IMAGE_HINTS = [
  "smiley",
  "smilies",
  "emoticon",
  "emotion",
  "/emot/",
  "icon",
  "logo",
  "badge",
  "button",
  "/btn",
  "btn_",
  "arrow",
  "spacer",
  "blank.gif",
  "clear.gif",
  "pixel.gif",
  "star.gif",
  "avatars",
  "/pic/smilies",
];
// 刻意**不**收 `attach`：NexusPHP 的附件系统把截图存放在 `attachments/2024/05/xxxx.jpg`，
// 那是最常见的截图路径之一。要排除的是附件旁边的小回形针图标，那种名字形如
// `attach.gif` / `attachment.png`，已经被 `icon` / 上面的具体文件名覆盖了。

/** 截图常见的后缀 —— 反过来，`attachments/...` 那种站点自存图也常是截图，所以这只是加分项不是必需项 */
const SCREENSHOT_EXT = /\.(jpe?g|png|webp|bmp)(?:\?|#|$)/i;

/** 常见图床与截图域名。源站自己的域名也可能是图床，所以不靠它做否定判断 */
const SCREENSHOT_HOST_HINTS = [
  "imgbox",
  "imagebam",
  "imgbb",
  "ibb.co",
  "postimg",
  "pixhost",
  "ptpimg",
  "totheglory",
  "sm.ms",
  "catbox",
  "imgur",
  "picsum",
  "doubanio",
  "hdbits",
  "hdchina",
  "shimg",
];

/**
 * 这张图能不能当截图用。
 *
 * 只看 URL：内容取不到（跨域 + 防盗链），尺寸也读不出来，靠 URL 是这里唯一能站的判据。
 * 顺序有意为之 —— 先排除噪声再认可，因为 `attachments/smiley.gif` 同时命中两边的规则。
 */
export function isScreenshotUrl(rawUrl: string): boolean {
  const url = rawUrl.trim();
  if (url === "" || url.startsWith("data:")) return false;

  const lower = url.toLowerCase();
  if (NOISE_IMAGE_HINTS.some((hint) => lower.includes(hint))) return false;

  if (SCREENSHOT_EXT.test(lower)) return true;
  // 没有后缀但落在已知图床上（`imgbox.com/abc123` 这种）也算
  return SCREENSHOT_HOST_HINTS.some((hint) => lower.includes(hint));
}

/**
 * mediainfo 的典型行：`Some Key` 后面跟一串空格对齐，再接 `: value`。
 *
 * 用「对齐到冒号」而不是「包含冒号」：简介里的普通句子也带冒号（「导演: 张艺谋」），
 * 但不会在冒号前对齐出两列。这是区分 mediainfo 与正文最省事的一条判据。
 */
const MEDIAINFO_LINE = /^\s{0,4}\S[^:]{0,48}?\s{2,}:\s*\S/u;

/** mediainfo 的分段标题。出现这些行说明「这一段确实是 mediainfo」而不是偶然对齐的表格 */
const MEDIAINFO_SECTION = /^(General|Video|Audio|Text|Menu|Chapters|通用|视频|音频|字幕|章节)\s*$/i;

/**
 * 从一段纯文本里把 mediainfo 抠出来。
 *
 * 为什么按「块」找而不是按行找：一行 `Format  : Matroska` 在别处也可能出现（比如简介里
 * 顺手写了技术参数）。只有当 **分段标题 + 至少 4 行对齐的 key : value** 同时出现时，
 * 这一段才值得交出去；否则宁可返回 undefined 让人手填 —— 把半截表格填进目标站，
 * 审核看到的是「格式乱掉的简介」，比空着更难受。
 *
 * 允许块内出现空行（mediainfo 自己就会用空行分段），遇到连续两行既不是标题也不是
 * 对齐行时收尾。
 */
export function extractMediaInfo(rawText: string): string | undefined {
  const lines = rawText.split(/\r?\n/);

  let bestStart = -1;
  let bestEnd = -1;

  let currentStart = -1;
  let currentFieldRows = 0;
  let currentHasSection = false;
  let currentEnd = -1;
  let blankRun = 0;

  const flush = () => {
    if (currentStart >= 0 && currentHasSection && currentFieldRows >= 4) {
      const span = currentEnd - currentStart;
      const bestSpan = bestEnd - bestStart;
      // 取最长的那一段：一颗种子可能既贴了视频 mediainfo 又贴了音频的，长的信息更全
      if (bestStart < 0 || span > bestSpan) {
        bestStart = currentStart;
        bestEnd = currentEnd;
      }
    }
    currentStart = -1;
    currentFieldRows = 0;
    currentHasSection = false;
    currentEnd = -1;
    blankRun = 0;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === "") {
      blankRun++;
      if (currentStart >= 0) {
        // 空行算块内（mediainfo 自己会分段），但连续两行空行之后还不接内容就收尾
        if (blankRun >= 2) flush();
        else currentEnd = i;
      }
      continue;
    }
    blankRun = 0;

    const isSection = MEDIAINFO_SECTION.test(trimmed);
    const isField = MEDIAINFO_LINE.test(line);

    if (isSection) {
      // 遇到 `Video` / `Audio` 这类分段标题：本块的延续，或者是一个全新的块
      if (currentStart < 0) currentStart = i;
      currentHasSection = true;
      currentEnd = i;
      continue;
    }

    if (isField) {
      if (currentStart < 0) currentStart = i;
      currentFieldRows++;
      currentEnd = i;
      continue;
    }

    // 既不是标题也不是对齐行 —— mediainfo 结束了
    if (currentStart >= 0) flush();
  }

  flush();

  if (bestStart < 0) return undefined;
  const block = lines.slice(bestStart, bestEnd + 1).join("\n").trim();
  return block === "" ? undefined : block;
}

/**
 * 简介里以 BBCode 或裸链接形式出现的截图。
 *
 * 有些站把整段简介存成纯文本（`[img]https://...[/img]`），DOM 里根本没有 `<img>`；
 * 还有些人直接粘一串裸 URL。这两种都得认，否则「抓到的截图 0 张」而页面上明明有五张。
 */
export function extractImageUrlsFromText(rawText: string): string[] {
  const found: string[] = [];
  const push = (url: string) => {
    const trimmed = url.trim();
    if (trimmed === "") return;
    if (!found.includes(trimmed)) found.push(trimmed);
  };

  const bbcode = /\[img(?:=[^\]]*)?\]([^[]+)\[\/img\]/gi;
  let match: RegExpExecArray | null;
  while ((match = bbcode.exec(rawText))) {
    push(match[1]);
  }

  // 裸链接这一路会把上面 BBCode 里的 URL 再抓一遍，所以必须去重 ——
  // 重复的截图在最终简介里就是同一张图贴两次
  const bare = /https?:\/\/[^\s"'<>()[\]]+\.(?:jpe?g|png|webp|bmp)(?:\?[^\s"'<>()[\]]*)?/gi;
  while ((match = bare.exec(rawText))) {
    push(match[0]);
  }

  return found;
}

/** 简介里指向 IMDb / 豆瓣的条目号 —— 目标站常有这两个独立字段，能自动带上就不用手抄 */
export function extractExternalIds(text: string): { imdbId?: string; doubanId?: string } {
  const result: { imdbId?: string; doubanId?: string } = {};

  const imdb = /imdb\.com\/title\/(tt\d{5,10})/i.exec(text);
  if (imdb) result.imdbId = imdb[1];

  const douban = /douban\.com\/(?:subject|movie\/subject)\/(\d{5,12})/i.exec(text);
  if (douban) result.doubanId = douban[1];

  return result;
}

function escapeHtml(raw: string): string {
  return raw.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function imageTag(url: string, format: "html" | "bbcode"): string {
  if (format === "bbcode") return `[img]${url}[/img]`;
  // 只给宽度约束：不同图床的原图尺寸差得远，写死高度会把竖图压扁
  return `<img src="${url}" style="max-width:100%;" />`;
}

/**
 * 把源站抓到的东西拼成一段能直接交给目标站的简介。
 *
 * 顺序是「正文 → 截图 → mediainfo」：审核看帖的习惯是从上往下，正文在前、截图居中、
 * 技术参数压底，这个顺序跟绝大多数站的手工发布习惯一致。
 *
 * **已经出现在正文里的内容不重复追加**：源站简介本身常常已经带了自己的截图与 mediainfo
 * （包在 `<pre>` 里）。再追加一遍就是同一张图贴两次 —— 那看起来像是机器发的。
 */
export function composeDescription(
  source: ISourceDescription,
  format: "html" | "bbcode" = "html",
): string {
  const parts: string[] = [];
  const body = source.descrHtml.trim();
  const bodyLower = body.toLowerCase();

  if (body !== "") parts.push(body);

  const missingScreenshots = source.screenshots.filter((url) => !bodyLower.includes(url.toLowerCase()));
  if (missingScreenshots.length > 0) {
    if (format === "html") parts.push("<br />");
    parts.push(missingScreenshots.map((url) => imageTag(url, format)).join(format === "html" ? "<br />" : "\n"));
  }

  const mediaInfo = source.mediaInfo?.trim() ?? "";
  // 正文里已经贴过 mediainfo（哪怕只贴了前几行）就不再追加。
  // 比对前**去掉所有空白**：mediainfo 靠空格对齐，而源站存进数据库、再被目标站编辑器
  // 处理一遍之后，对齐用的那串空格多半已经变了 —— 拿原样字符比会永远不相等，
  // 结果就是同一段 mediainfo 在帖子里出现两次。
  const squeeze = (raw: string) => raw.replace(/\s+/g, "").toLowerCase();
  const mediaInfoProbe = squeeze(mediaInfo.slice(0, 80));
  const alreadyHasMediaInfo = mediaInfoProbe !== "" && squeeze(body).includes(mediaInfoProbe);

  if (mediaInfo !== "" && !alreadyHasMediaInfo) {
    if (format === "html") {
      parts.push("<br />");
      parts.push(`<pre>${escapeHtml(mediaInfo)}</pre>`);
    } else {
      parts.push(`[quote]${mediaInfo}[/quote]`);
    }
  }

  return parts.join(format === "html" ? "\n" : "\n\n").trim();
}

/**
 * 目标站的简介字段名。
 *
 * **必须整名匹配**：`small_descr` 是副标题，`descr` 是简介，子串匹配会把简介灌进副标题格。
 * `body` / `release_desc` 是 Unit3D 与部分 NexusPHP 改造版的叫法。
 */
const DESCR_FIELD_NAMES = new Set(["descr", "description", "descr_html", "release_desc", "body"]);

/** 这个字段名是不是装简介的 */
export function isDescriptionFieldName(name: string): boolean {
  return DESCR_FIELD_NAMES.has(name.toLowerCase());
}
