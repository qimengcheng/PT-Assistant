/**
 * 源站详情页 → 简介素材。
 *
 * 这一层只做「读页面」：找简介容器、把里面的图片与链接绝对化、把 mediainfo 与截图交给
 * `@/shared/upload/description.ts` 的判据。**不判断该不该发、也不拼最终简介**，
 * 那些是纯字符串逻辑，放 shared 才能跑 Node 断言（AGENTS §2.3 的拆分口径）。
 *
 * ## 为什么不从站点定义里读简介
 *
 * `ISiteMetadata.detail.selectors` 只有 `title` / `link` 两项（见 `packages/site/schemas/NexusPHP.ts`），
 * 上游从来没有「简介」这个概念 —— 它的用途是「给搜索结果补详情」，不是「搬帖子」。
 * 而往上打补丁要动 `packages/`（AGENTS §0 明令不批量改写），且 340 个站点各配一份
 * 简介选择器等于维护 340 份会过期的快照。所以这里按**页面结构的两条通例**去猜：
 * `#kdescr`（NexusPHP 十年不变的那个 id）与「说明文字里带『简介』的那一行右侧单元格」。
 */
import type { ITorrent } from "@ptd/site";

import { onMessage } from "@/messages.ts";
import {
  extractExternalIds,
  extractImageUrlsFromText,
  extractMediaInfo,
  isScreenshotUrl,
} from "@/shared/upload/description.ts";
import type { ISourceDescription, ISourceDescriptionRequest } from "@/shared/upload/types.ts";

import { absolutize, normalizeText, toDocument } from "./html.ts";
import { logger } from "./logger.ts";
import { getSiteInstance } from "./site.ts";

/** 简介容器的候选：先认 id，再认「说明文字 + 右侧单元格」的表格布局 */
const DESCR_SELECTORS = ["#kdescr", "#kdescr_div", "div#kdescr"];

/** 简介那一行的说明文字（简繁 + 英文） */
const DESCR_ROW_LABELS = ["简介", "簡介", "描述", "说明", "說明", "Description", "Release Description"];

/**
 * 简介里可能有、但目标站收不了/不该带过去的东西。
 *
 * `script` 与 `iframe` 是安全底线；`form` / `input` 是切图站点的取图控件，粘过去会变成
 * 一堆坏按钮：`style` 倒是留着 —— 源站简介里常见 `width` 约束，删了竖图会撑破版面。
 */
const DROP_TAGS = [
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "form",
  "input",
  "button",
  "link",
  "meta",
  "noscript",
];

/** 只存在于源站、粘到目标站毫无意义（或指向源站内网）的属性 */
const DROP_ATTRS = ["onclick", "onload", "onerror", "onmouseover", "onmouseout", "srcset", "loading"];

function describeFetchFailure(doc: Document): string {
  const title = normalizeText(doc.title);
  if (doc.querySelector('input[name="username"]') || /login|登录|登入|登錄/i.test(title)) {
    return "源站详情页返回的是登录页，简介没抓到（源站 cookie 可能失效了）";
  }
  if (/未定义操作|not found|404|無效/i.test(title)) {
    return "源站详情页返回了「不存在」（种子可能已被删除，或详情页地址不对）";
  }
  return "源站详情页里找不到简介区";
}

/**
 * 找到简介容器。
 *
 * 顺序不是「按可靠性」排的，是按**误判代价**排的：`#kdescr` 认错的可能性几乎为零；
 * 退回表格布局时靠「说明文字里带简介」定位，万一站点把「简介」也当成了分类名，
 * 就会抓到一行短文本 —— 所以最后还要再用「这段够不够长」兜一层。
 */
function findDescriptionContainer(doc: Document): HTMLElement | null {
  for (const selector of DESCR_SELECTORS) {
    const el = doc.querySelector<HTMLElement>(selector);
    if (el && normalizeText(el.textContent).length > 0) return el;
  }

  for (const rowHead of Array.from(doc.querySelectorAll("td.rowhead, th.rowhead, td.colhead"))) {
    const label = normalizeText(rowHead.textContent);
    if (!DESCR_ROW_LABELS.some((hint) => label.includes(hint))) continue;
    const cell = rowHead.nextElementSibling;
    if (!cell) continue;
    // 短于 40 字符的多半是「见附件」这类占位，不如继续找
    if (normalizeText(cell.textContent).length < 40 && cell.querySelectorAll("img").length === 0) continue;
    return cell as HTMLElement;
  }

  // 最后一路：正文里图片最多的那个单元格。简介常常是页面上唯一带多张图的区块
  let best: Element | null = null;
  let bestScore = 0;
  for (const cell of Array.from(doc.querySelectorAll("td.rowfollow, div.rowfollow"))) {
    const images = cell.querySelectorAll("img").length;
    const text = normalizeText(cell.textContent).length;
    if (images < 2 && text < 200) continue;
    const score = images * 1000 + text;
    if (score > bestScore) {
      best = cell;
      bestScore = score;
    }
  }
  return best as HTMLElement | null;
}

/** 深拷贝后清洗：去掉会执行的东西、去掉源站专属属性，并把相对地址补全 */
function sanitizeDescriptionHtml(container: HTMLElement, baseUrl: string): string {
  const clone = container.cloneNode(true) as HTMLElement;

  for (const selector of DROP_TAGS) {
    for (const el of Array.from(clone.querySelectorAll(selector))) el.remove();
  }

  for (const el of Array.from(clone.querySelectorAll("*"))) {
    for (const attr of DROP_ATTRS) el.removeAttribute(attr);

    if (el.tagName === "IMG") {
      const src = el.getAttribute("src") ?? el.getAttribute("data-src") ?? "";
      if (src === "") {
        el.remove();
        continue;
      }
      el.setAttribute("src", absolutize(src, baseUrl));
      // 源站的 `width/height` 常是按源站版面给的，到目标站会把图压得极小；统一交给 max-width
      el.removeAttribute("width");
      el.removeAttribute("height");
      el.setAttribute("style", "max-width:100%;");
    }

    if (el.tagName === "A") {
      const href = el.getAttribute("href");
      if (!href) continue;
      // `javascript:` 会被原样留在 href 上，而这段 HTML 之后要在 options 页里 `v-html` 渲染。
      // 去掉了 onclick 却没去掉协议，等于留了一个「点一下就执行」的口子。
      if (/^\s*javascript:/i.test(href)) {
        el.removeAttribute("href");
        continue;
      }
      el.setAttribute("href", absolutize(href, baseUrl));
    }
  }

  return clone.innerHTML.trim();
}

/**
 * 简介里的 mediainfo。
 *
 * 先看 `<pre>`（绝大多数人的做法），再看 `[class*=code]`（NexusPHP 的代码框），
 * 最后拿整段正文过一遍正则 —— 有人直接把 mediainfo 粘成普通段落，那样没有 `<pre>` 可找。
 * 每一路都交给 `extractMediaInfo` 判定，判定不过就当没有：宁可让人手填，也不把
 * 半截表格塞进目标站。
 */
function pickMediaInfo(container: HTMLElement): string | undefined {
  const candidates = [
    ...Array.from(container.querySelectorAll("pre")),
    ...Array.from(container.querySelectorAll('[class*="codemain"], [class*="code"], [id*="codemain"]')),
  ];

  for (const el of candidates) {
    const found = extractMediaInfo(el.textContent ?? "");
    if (found) return found;
  }

  return extractMediaInfo(container.textContent ?? "");
}

/** 截图：DOM 里的 `<img>` 与纯文本里的 `[img]` / 裸链接都要收 */
function collectScreenshots(container: HTMLElement, baseUrl: string): string[] {
  const urls: string[] = [];
  const push = (raw: string) => {
    const url = absolutize(raw, baseUrl);
    if (!isScreenshotUrl(url)) return;
    if (!urls.includes(url)) urls.push(url);
  };

  for (const img of Array.from(container.querySelectorAll("img"))) {
    push(img.getAttribute("src") ?? img.getAttribute("data-src") ?? "");
  }

  // 纯文本形式的（整段简介被存成 BBCode / 裸链接）
  const text = container.textContent ?? "";
  for (const url of extractImageUrlsFromText(text)) push(url);

  return urls;
}

/**
 * 详情页地址。
 *
 * `ITorrent.url` 在 NexusPHP 的定义里是**相对路径**（`/details.php?id=123`，由
 * `prepend` 过滤器拼出来），不能直接拿去请求；老站点还可能装在子目录（`/pt/details.php`），
 * 所以用 `new URL(path, site.url)` 而不是硬拼根路径。
 */
async function resolveDetailsUrl(siteUrl: string, torrent: ITorrent): Promise<string> {
  if (torrent.url && torrent.url.trim() !== "") {
    return absolutize(torrent.url, siteUrl);
  }
  if (torrent.id !== undefined && torrent.id !== "") {
    return absolutize(`/details.php?id=${torrent.id}`, siteUrl);
  }
  throw new Error("这颗种子既没有详情页地址也没有条目号，没法去源站取简介");
}

/** 去源站详情页抓简介素材 */
export async function fetchSourceDescription(request: ISourceDescriptionRequest): Promise<ISourceDescription> {
  const { siteId, torrent } = request;
  const site = await getSiteInstance(siteId);
  if (!site) throw new Error(`站点实例创建失败：${siteId}`);

  const pageUrl = await resolveDetailsUrl(site.url, torrent);

  const response = await site.request({ url: pageUrl, method: "get", responseType: "document" });
  const doc = toDocument(response.data);
  if (!doc) throw new Error(`${pageUrl} 返回的不是 HTML 文档`);

  const container = findDescriptionContainer(doc);
  if (!container) throw new Error(describeFetchFailure(doc));

  const warnings: string[] = [];
  const descrHtml = sanitizeDescriptionHtml(container, pageUrl);
  const mediaInfo = pickMediaInfo(container);
  const screenshots = collectScreenshots(container, pageUrl);

  if (descrHtml === "") {
    warnings.push("源站的简介区是空的（或只有图片），目标站的简介需要自己写");
  }

  const { imdbId, doubanId } = extractExternalIds(`${container.innerHTML}\n${container.textContent ?? ""}`);

  // 源站的截图普遍挂了 referer 白名单，目标站直接引用会裂图。这不是「抓失败」，
  // 是「抓到了但还不能直接用」，所以要单独说清是下一步（图床转存）而不是本次失败。
  if (screenshots.length > 0) {
    warnings.push(
      `简介里有 ${screenshots.length} 张截图来自源站，源站多半有防盗链，直接引用到目标站可能裂图（图床转存还没做）`,
    );
  }

  if (!mediaInfo) {
    warnings.push("源站简介里没有 mediainfo 文本；扩展不能自己生成（拿不到媒体文件与 ffmpeg），需要手动补");
  }

  logger({
    msg: `[转种] 已抓取 ${site.name} 的种子简介`,
    data: {
      pageUrl,
      descrLength: descrHtml.length,
      screenshots: screenshots.length,
      hasMediaInfo: Boolean(mediaInfo),
      imdbId,
      doubanId,
    },
  });

  return { descrHtml, mediaInfo, screenshots, imdbId, doubanId, pageUrl, warnings };
}

onMessage("getSourceDescription", async ({ data }) => await fetchSourceDescription(data));
