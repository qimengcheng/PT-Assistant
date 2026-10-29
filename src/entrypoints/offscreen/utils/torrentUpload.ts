/**
 * 转载发布：把源站的一颗种子提交到目标站的上传页。
 *
 * ## 为什么是「现抓表单」而不是在站点定义里写死字段
 *
 * 上传页的字段是**页面给出的事实**：哪些下拉、每个下拉有哪些值、哪个是隐藏 token，
 * 同一套 NexusPHP 换个站就不一样（憨憨有 类型/来源/媒介/编码/分辨率/制作组 六维，
 * 有些站只有 类型/来源）。写进 340 个站点定义等于维护 340 份会过期的快照；
 * 现抓一次页面，站点改版自动被吸收。代价是每次开对话框多一次 GET。
 *
 * ## 为什么住在 offscreen
 *
 * 页面解析要 `DOMParser` / `querySelectorAll`，而 service worker 没有 DOM（AGENTS §3.2）。
 * 这里只做「抓 + 交回纯数据」，控件快照 → 表单字段的判据在
 * `@/shared/upload/formFields.ts`（那一份能直接跑 Node 断言）。
 *
 * ## 提交后怎么判成功
 *
 * NexusPHP 成功后一般 302 到 `details.php?id=…`。扩展里 axios 走 XHR，重定向由浏览器自己跟，
 * 所以拿 `responseURL` 看最终落在哪一页是最准的一路；拿不到时退回正文关键词。
 * **判不准时一律算失败**并回一段正文摘要 —— 把失败报成成功，人会以为种子已经发出去了。
 */
import type { ITorrent } from "@ptd/site";

import { onMessage } from "@/messages.ts";
import { cleanTorrentBytes } from "@/shared/upload/cleanTorrent.ts";
import { describeUploadFields, type IRawUploadControl } from "@/shared/upload/formFields.ts";
import type {
  ITransferDuplicateCheck,
  ITransferSourceLocateRequest,
  ITransferUploadRequest,
  ITransferUploadResult,
  IUploadFormDescriptor,
  IUploadOption,
} from "@/shared/upload/types.ts";
import { reseedScanKeywordsRawFirst, reseedScanScreen } from "@/shared/reseedScanPlan.ts";

import { getTorrentDownloadLink, getTorrentInfoForVerification } from "./download.ts";
import { absolutize, normalizeText, textSummary, toDocument } from "./html.ts";
import { logger } from "./logger.ts";
import { getSiteInstance } from "./site.ts";
import { isSearchAnswered, SEARCH_STATUS_TEXT } from "./reseedScan.ts";

/** 上传页的候选路径。NexusPHP 标准是 `/upload.php`，改造版偶尔放在 `/torrents/upload.php` */
const UPLOAD_PATHS = ["/upload.php", "/torrents/upload.php"];

/** 页面里出现这些字样时，说明「表单在，但你没有权限发」——要单独告诉用户，别只报「没找到表单」 */
const NO_PERMISSION_HINTS = ["没有权限", "無權限", "权限不足", "未达", "未達", "不能发布", "无权访问", "Permission denied"];

/** 提交后正文里出现这些字样判成功 */
const SUCCESS_HINTS = ["上传成功", "上傳成功", "发布成功", "發佈成功", "successfully uploaded", "upload successful"];

/** 提交后正文里出现这些字样判失败（比通用失败更具体，先查它） */
const FAILURE_HINTS = [
  "已经存在",
  "已經存在",
  "已存在",
  "重复",
  "重複",
  "already exists",
  "duplicate",
  " torrent already",
  "你只能",
  "不能上传",
  "上傳失敗",
  "上传失败",
];

function pickUploadForm(doc: Document): HTMLFormElement | null {
  const forms = Array.from(doc.querySelectorAll("form"));
  if (forms.length === 0) return null;

  // ① action 里带 takeupload 的最准
  const byAction = forms.find((f) => /takeupload/i.test(f.getAttribute("action") ?? ""));
  if (byAction) return byAction;

  // ② 含 file 控件的那个（上传页一定有）
  const byFile = forms.find((f) => f.querySelector('input[type="file"]'));
  if (byFile) return byFile;

  return forms[0];
}

/**
 * 认一个控件旁边那段说明文字。
 *
 * 顺序是实测出来的：`<label for>` 最准；NexusPHP 的表格布局里说明在 `td.rowhead`；
 * 再退到包裹它的 `<label>`。**不要先试 `closest("label")`** —— radio 组常常被整行包在
 * 一个 label 里，那样每个选项都会拿到同一段整行文字。
 */
function labelOf(el: Element): string {
  const doc = el.ownerDocument;
  const id = el.getAttribute("id");
  if (id) {
    const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id.replace(/"/g, '\\"');
    const forLabel = doc.querySelector(`label[for="${escaped}"]`);
    const text = normalizeText(forLabel?.textContent);
    if (text) return text;
  }

  const row = el.closest("tr");
  const rowHead = row?.querySelector("td.rowhead, th.rowhead, th, .rowhead");
  const rowText = normalizeText(rowHead?.textContent);
  if (rowText) return rowText;

  const wrapper = el.closest("label");
  return normalizeText(wrapper?.textContent);
}

/** 必填：页面显式标了 required，或说明文字里带 `*`（NexusPHP 的通用写法） */
function isRequired(el: Element, label: string): boolean {
  if (el.hasAttribute("required")) return true;
  return label.includes("*");
}

function optionsOf(select: HTMLSelectElement): IUploadOption[] {
  return Array.from(select.options).map((option) => ({
    value: option.value,
    label: normalizeText(option.textContent) || option.value,
  }));
}

/** Document → 控件快照。判据不在这里，在 shared 的 `describeUploadFields` */
function collectControls(form: HTMLFormElement): IRawUploadControl[] {
  const controls: IRawUploadControl[] = [];

  for (const select of Array.from(form.querySelectorAll("select"))) {
    const label = labelOf(select);
    controls.push({
      name: select.getAttribute("name") ?? "",
      tag: "select",
      type: "select",
      label,
      required: isRequired(select, label),
      options: optionsOf(select),
      value: select.value,
      multiple: select.multiple,
    });
  }

  for (const textarea of Array.from(form.querySelectorAll("textarea"))) {
    const label = labelOf(textarea);
    controls.push({
      name: textarea.getAttribute("name") ?? "",
      tag: "textarea",
      type: "textarea",
      label,
      required: isRequired(textarea, label),
      value: textarea.value,
    });
  }

  for (const input of Array.from(form.querySelectorAll("input"))) {
    const type = (input.getAttribute("type") ?? "text").toLowerCase();
    const label = labelOf(input);
    controls.push({
      name: input.getAttribute("name") ?? "",
      tag: "input",
      type,
      label,
      required: isRequired(input, label),
      value: input.value,
      checked: input.checked,
    });
  }

  return controls;
}

/** 抓到的页面里没有任何表单时，把「为什么没有」说清 */
function explainMissingForm(doc: Document): string {
  const text = normalizeText(doc.body?.textContent).slice(0, 2000);
  const hit = NO_PERMISSION_HINTS.find((hint) => text.includes(hint));
  if (hit) return `目标站没有给出上传表单：页面提示「${hit}」`;
  if (/login|登录|登入/i.test(doc.title ?? "") || doc.querySelector('input[name="username"]')) {
    return "目标站没有给出上传表单：疑似未登录（页面是登录页）";
  }
  return "目标站没有给出上传表单：页面上找不到 form 元素";
}

/**
 * GET 目标站的上传页并解析成表单描述。
 *
 * 抓不到就抛错（由调用方转成界面提示），因为「空表单」在界面上和「站点没有上传字段」
 * 长得一模一样，不能当正常结果返回。
 */
export async function fetchSiteUploadForm(siteId: string): Promise<IUploadFormDescriptor> {
  const site = await getSiteInstance(siteId);
  if (!site) throw new Error(`站点实例创建失败：${siteId}`);

  const warnings: string[] = [];
  let lastError: unknown = null;

  for (const path of UPLOAD_PATHS) {
    try {
      const response = await site.request({ url: path, method: "get", responseType: "document" });

      const doc = toDocument(response.data);
      if (!doc) throw new Error(`${path} 返回的不是 HTML 文档`);

      const form = pickUploadForm(doc);
      // 上传页不存在时会落到一个普通页面（404 / 首页），换下一个候选路径再试
      if (!form) throw new Error(explainMissingForm(doc));

      const { fields, warnings: fieldWarnings } = describeUploadFields(collectControls(form));
      warnings.push(...fieldWarnings);

      const actionAttr = form.getAttribute("action") ?? "";
      const pageUrl = new URL(path, site.url).toString();
      const action = actionAttr ? new URL(actionAttr, pageUrl).toString() : pageUrl;

      if (!fields.some((f) => f.kind === "file")) {
        warnings.push("页面里没有找到种子文件输入框，本次提交可能不带种子本体");
      }

      logger({
        msg: `[转种] 已抓取 ${site.name} 的上传表单：${fields.length} 个字段，提交到 ${action}`,
        data: fields.map((f) => `${f.name}:${f.kind}`),
      });

      return {
        siteId,
        siteName: site.name,
        pageUrl,
        action,
        fields,
        warnings,
      };
    } catch (e) {
      lastError = e;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`抓取上传页失败：${siteId}`);
}

/**
 * 一轮「按 infoHash 在这一站认一颗种子」的结果。
 *
 * `notes` 是走过的弯路（这个搜索词没搜成 / 某个候选的种子下不下来），两种调用方都要用：
 * 定位失败时它解释「源站到底是没有、还是这次没搜成」；查重时它让人知道「查过哪些词」。
 */
interface IInfoHashSearchResult {
  torrent: ITorrent | null;
  notes: string[];
  keywords: string[];
  /** 站点根地址，用来把 `details.php?id=` 这类相对链接拼成能点的地址 */
  baseUrl: string;
}

/**
 * 在某一站按 infoHash 认出一颗种子。转种的两个方向共用这一段。
 *
 * 「回源站把这颗认出来」与「目标站查重」是同一件事的两次调用：都是拿 infoHash 逐字比。
 * 抽成一份是为了让两条路的口径永远一样 —— 各写一遍，迟早有一边退化成按标题比，
 * 而按标题比在这两个场景里都是错的（源站认错 = 转错一颗种子；查重漏判 = 重复发布）。
 */
async function searchTorrentByInfoHash(input: ITransferSourceLocateRequest): Promise<IInfoHashSearchResult> {
  const site = await getSiteInstance(input.siteId);
  if (!site) throw new Error(`站点实例创建失败：${input.siteId}`);

  const baseUrl = site.url;
  const targetHash = (input.infoHash ?? "").trim().toLowerCase();
  if (!targetHash) throw new Error("下载器没有报出 infoHash，无法确认要认的是哪一颗种子");

  const notes: string[] = [];
  // 这里刻意用**两档**那一份，不跟扫描的默认折法（v0.130.0 起只发折过那一档）：
  // 这一跳是一个站认一颗种子，多一档最多是多一次请求，少一档是认不出来源、整件转种失败。
  const keywords = reseedScanKeywordsRawFirst(input.name);

  for (const keyword of keywords) {
    let items: ITorrent[];
    try {
      const result = await site.getSearchResult(keyword, {});
      if (!isSearchAnswered(result.status)) {
        notes.push(`用「${keyword}」搜时该站这一页没给出可信结果：${SEARCH_STATUS_TEXT[result.status] ?? "状态不明"}`);
        continue;
      }
      items = result.data ?? [];
    } catch (e) {
      notes.push(`用「${keyword}」搜索失败：${e instanceof Error ? e.message : String(e)}`);
      continue;
    }

    // 粗筛与辅种扫描共用一套（标题归一相等或大小在容差内），判定仍交给下面的 infoHash
    for (const candidate of reseedScanScreen(items, { name: input.name, size: input.totalSize })) {
      try {
        const info = await getTorrentInfoForVerification(candidate.item);
        if (info?.infoHash && info.infoHash.toLowerCase() === targetHash) {
          // 搜索结果里带来的 `site` 就是这一站，这里显式再盖一次：下游取 .torrent 只认这一个字段
          return {
            torrent: { ...candidate.item, site: input.siteId },
            notes,
            keywords,
            baseUrl,
          };
        }
      } catch (e) {
        notes.push(`候选「${candidate.item.title}」的种子文件没取下来：${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  return { torrent: null, notes, keywords, baseUrl };
}

/**
 * 从「我的下载器」出发时，先回到源站那颗种子**认出来**。
 *
 * ## 为什么非要走这一趟
 *
 * 下载器只报 `name` / `totalSize` / `infoHash`，没有源站条目号，也没有下载链接 ——
 * 而转种必须交**原始那颗** `.torrent`（重新打包会让 infoHash 变掉，目标站上那份就成了另一颗种子，
 * 本地这份数据一点也用不上）。所以只能回源站搜一次。
 *
 * ## 判据为什么是 infoHash 而不是文件指纹
 *
 * 辅种扫描用指纹，是因为它要比的是「两份数据是不是同一组文件」；这里的比较对象更硬：
 * 下载器里那一条的 infoHash 就是原始种子的 SHA1，**逐字节相等才是同一颗**。
 * 所以候选下下来直接比 hash，命中即返回，不掺启发式。
 *
 * 搜不到就抛错并带上一路上试过什么：这一步失败必须让人看得懂是「源站没有」还是
 * 「这次没搜成」，含混成一句「找不到」会让人以为种子没了。
 */
export async function locateSourceTorrent(input: ITransferSourceLocateRequest): Promise<ITorrent> {
  const { torrent, notes, keywords } = await searchTorrentByInfoHash(input);
  if (torrent) {
    logger({
      msg: `[转种] 已在源站认出这颗种子：${torrent.title}`,
      data: { siteId: input.siteId, infoHash: input.infoHash },
    });
    return torrent;
  }

  const tried = keywords.length > 0 ? keywords.map((k) => `「${k}」`).join("、") : "（种子名是空的，没有可用的搜索词）";
  throw new Error(
    `没能在源站认出这颗种子（已按 ${tried} 搜过）。` +
      (notes.length > 0 ? `\n${notes.slice(0, 3).join("\n")}` : "\n源站返回的候选中没有 infoHash 一致的那一颗。"),
  );
}

/**
 * 提交前在目标站查重：同一 infoHash 是不是已经有人发过。
 *
 * ## 为什么值得多花一次搜索
 *
 * 重复发布在多数站是要吃警告的，而 NexusPHP 自己的查重只会在**你填完整个表单、点了提交之后**
 * 才回一句「种子已经存在」—— 那时时间已经花了。这里趁人填分类的几十秒先搜一轮，
 * 命中了就把已有那条的链接递给他，别让他走到最后一步才被拦。
 *
 * ## 为什么「查不到」不等于「可以放心发」
 *
 * 目标站给同一部片子起的标题常常和源站不一样（不同的命名规范、不同的中字标记），
 * 搜索是分词匹配，词对不上就搜不出来。所以这里只回「搜过什么、没搜到」，
 * 界面上不能把它渲染成绿灯 —— **真正的兜底仍然是站点自己的查重**。
 *
 * 查重失败也不抛错：查不动不等于重复。拿一个没做成的检查挡住人发种子，
 * 比让站点回一句「已存在」更糟。
 */
export async function checkTransferDuplicate(input: ITransferSourceLocateRequest): Promise<ITransferDuplicateCheck> {
  const targetHash = (input.infoHash ?? "").trim().toLowerCase();
  if (!targetHash) {
    return { duplicated: false, note: "手上没有 infoHash，查不了重（可能是下载器没报出来）" };
  }

  try {
    const { torrent, notes, keywords, baseUrl } = await searchTorrentByInfoHash(input);

    if (torrent) {
      logger({
        msg: `[转种] 目标站已有这颗种子：${torrent.title}`,
        data: { siteId: input.siteId, infoHash: targetHash },
      });
      return {
        duplicated: true,
        title: torrent.title,
        url: torrent.url ? absolutize(torrent.url, baseUrl) : undefined,
      };
    }

    if (keywords.length === 0) {
      return { duplicated: false, note: "种子名是空的，没有可用的搜索词，没查成" };
    }

    const note = [`已按 ${keywords.map((k) => `「${k}」`).join("、")} 搜过，目标站没有 infoHash 相同的种子`];
    if (notes.length > 0) note.push(notes.slice(0, 2).join("；"));
    return { duplicated: false, note: note.join("；") };
  } catch (e) {
    return {
      duplicated: false,
      note: `查重没做成：${e instanceof Error ? e.message : String(e)}（这不等于目标站没有）`,
    };
  }
}

/** 取源站那颗种子的原始字节 */
async function fetchSourceTorrentBytes(siteId: string, torrent: ITorrent) {
  const site = await getSiteInstance(siteId);
  if (!site) throw new Error(`站点实例创建失败：${siteId}`);

  const downloadUrl = await getTorrentDownloadLink(torrent);
  if (!downloadUrl) throw new Error("拿不到源种子的下载链接");

  const requestConfig = await site.getTorrentDownloadRequestConfig(torrent);
  requestConfig.url = downloadUrl;
  requestConfig.responseType = "arraybuffer";

  const response = await site.request(requestConfig);
  const data: unknown = response.data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (data instanceof Uint8Array) return data;
  throw new Error("源种子下载结果不是二进制");
}

function findDetailsUrl(rawHtml: string, baseUrl: string): string | undefined {
  const match = /details\.php\?id=(\d+)/i.exec(rawHtml);
  if (!match) return undefined;
  try {
    // 相对 baseUrl 解析，不写死根路径：站点装在子目录（`/pt/details.php`）时根路径会指错
    return new URL(`details.php?id=${match[1]}`, baseUrl).toString();
  } catch {
    return undefined;
  }
}

/**
 * 提交一次转种。
 *
 * 这里**不再重复查重**：对话框在选完目标站时已经用 `checkTransferDuplicate` 搜过一轮，
 * 命中就把提交按钮禁掉了。再查一次等于让人多等一次搜索。
 * 最后一道仍是站点自己的查重 —— 重复时 NexusPHP 回「种子已经存在」，这里按失败把原文递回去。
 */
export async function submitTransferUpload(request: ITransferUploadRequest): Promise<ITransferUploadResult> {
  const { siteId, torrent, values, keepSourceTag = true } = request;
  const site = await getSiteInstance(siteId);
  if (!site) throw new Error(`站点实例创建失败：${siteId}`);

  const form = await fetchSiteUploadForm(siteId);
  const raw = await fetchSourceTorrentBytes(torrent.site, torrent);
  const cleaned = await cleanTorrentBytes(raw, { keepSourceTag });

  logger({
    msg: `[转种] 清洗种子完成：infoHash=${cleaned.infoHash}`,
    data: { siteId, removed: cleaned.removed },
  });

  const formData = new FormData();

  // ① 页面上的隐藏域与所有已填字段先落进去。hidden 缺失会让站点直接拒收，
  //    所以取「描述里的初值」而不是用户传进来的那份（用户那份可能没带 hidden）。
  for (const field of form.fields) {
    if (field.kind === "file") continue;
    const value = values[field.name] ?? field.initialValue ?? "";
    if (field.kind === "checkbox") {
      if (value === "1") formData.append(field.name, "1");
      continue;
    }
    formData.append(field.name, value);
  }

  // ② 用户额外填了表单里没出现的字段（极少见，但站点用 JS 动态加字段时会撞上）
  for (const [key, value] of Object.entries(values)) {
    if (form.fields.some((f) => f.name === key)) continue;
    if (key === "file") continue;
    formData.append(key, value);
  }

  const fileField = form.fields.find((f) => f.kind === "file");
  const fileName = `${torrent.title?.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) || cleaned.infoHash}.torrent`;
  formData.append(
    fileField?.name ?? "file",
    new Blob([cleaned.bytes as BlobPart], { type: "application/x-bittorrent" }),
    fileName,
  );

  const response = await site.request(
    {
      url: form.action,
      method: "post",
      data: formData,
      responseType: "text",
      // 让浏览器自己带 cookie 与 referer，站点侧的多重校验（含 CSRF 校验）都依赖它们
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    },
    false, // 提交结果页不套 loggedCheck：部分站的「上传成功」页不含导航栏，会被误判成掉登录
  );

  const html = typeof response.data === "string" ? response.data : String(response.data ?? "");
  const finalUrl: string = (response.request as { responseURL?: string } | undefined)?.responseURL ?? form.action;

  if (/details\.php\?id=\d+/i.test(finalUrl)) {
    return {
      ok: true,
      message: "已提交，目标站已生成种子页面",
      url: finalUrl,
    };
  }

  const summary = textSummary(html);
  const failureHit = FAILURE_HINTS.find((hint) => summary.toLowerCase().includes(hint.toLowerCase()));
  if (failureHit) {
    return { ok: false, message: `目标站拒绝：页面提示「${failureHit}」`, detail: summary };
  }

  if (SUCCESS_HINTS.some((hint) => summary.toLowerCase().includes(hint.toLowerCase()))) {
    return {
      ok: true,
      message: "已提交，目标站提示成功（未能取到种子页面地址）",
      url: findDetailsUrl(html, form.pageUrl),
    };
  }

  return {
    ok: false,
    message: "提交结果无法确认，已按失败处理",
    detail: summary,
  };
}

onMessage("getSiteUploadForm", async ({ data: siteId }) => await fetchSiteUploadForm(siteId));

onMessage("locateTransferSource", async ({ data }) => await locateSourceTorrent(data));

onMessage("checkTransferDuplicate", async ({ data }) => await checkTransferDuplicate(data));

onMessage("submitTransferUpload", async ({ data }) => await submitTransferUpload(data));
