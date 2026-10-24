/**
 * 用户信息取数的「响应形状指纹」判据。
 *
 * 为什么要有这一份（用户 2026-10-24：「这两个（NovaHD / PTzone）怎么获取不到这些数据了？前几天都还可以」）：
 * `getUserInfoResult` 在 `status` 那一条上写得无遮拦 —— process 跑完就把状态盖成 `success`，
 * 至于每一步的选择器命中没命中**不参与判断**。于是「站点真的报 0」与「我们拿回来的那一页整格都没命中」
 * 在界面上是同一张脸（`0.00 B / - / 0`），日志里那条 `status: 3` 也只会把人往「请求成功」的方向带。
 * 现场能排除的都排完了（不是开关短路、不是超时、不是抓错人、不是没登录跳转、不是选择器在我们本地
 * 解析他那份原始 HTML 时失效），剩下两种形状只有**取回那一页的人**分得开：
 *   ① 我们拿到的不是他拿到的那一页（未登录版 / 提示页 / 限流页，HTTP 仍 200）；
 *   ② 响应压根没被解析成文档（Content-Type 变了 ⇒ XHR 按 XML 解析成 parsererror 文档 ⇒ 选择器全落空）。
 * 所以这里只做一件事：把「那一页长什么样」记成一行读数，交给运行日志。
 *
 * 隐私口径（AGENTS.md §3.5 的另一半）：形状里**只允许出现不含账号内容的量** ——
 * 地址去掉 query（`userdetails.php?id=<他的 uid>` 那一段）、正文只留字节数、不带任何选择器文本与页面内容。
 */

/** 一次「取回一个页面」的形状读数 */
export interface IPageShape {
  /** HTTP 状态；拿不到时 -1 */
  status: number;
  /** 最终地址的 host + path（已去掉 query 与 hash）；拿不到时 "?" */
  hostPath: string;
  /** 响应头里的 Content-Type；没有则 "?" */
  contentType: string;
  /** 拿回来的到底是不是可选中的文档（false 就是「压根没被解析成 HTML」那一档） */
  isDocument: boolean;
  /** 整页 `<td>` 的个数；不是文档时 -1（未知，不是 0） */
  cells: number;
  /** 正文字节数；拿不到时 -1 */
  bytes: number;
}

/** `pageShapeOf` 的入参：全部是「可能拿不到」的观测值，缺什么就落成 -1 / "?" */
export type TPageShapeInput = {
  status?: unknown;
  /** 重定向之后的最终地址（XHR 的 responseURL），拿不到时退回请求配置里那一条 */
  finalUrl?: unknown;
  requestUrl?: unknown;
  baseURL?: unknown;
  contentType?: unknown;
  data?: unknown;
  /** XHR 的原始文本（responseType 为 document 时它还在，是字节数的唯一来源） */
  responseText?: unknown;
};

/** 只有真的能查询元素的对象才算文档；Node 里没有 Document 全局，走这条鸭子判据 */
function looksLikeDocument(data: unknown): boolean {
  if (typeof globalThis.Document === "function") {
    return data instanceof (globalThis.Document as unknown as new () => unknown);
  }
  return !!data && typeof (data as { querySelectorAll?: unknown }).querySelectorAll === "function";
}

/**
 * 地址只留 host + path。
 *
 * 这条不是洁癖：用户信息那一格的地址通常是 `userdetails.php?id=<他的 uid>`，
 * 原样写进日志等于把账号标识交出去（AGENTS.md §3.5）。相对地址（没有 host）就只留 path 那一段。
 */
export function hostPathOf(url: unknown): string {
  if (typeof url !== "string" || url.length === 0) return "?";
  const cut = (raw: string) => raw.split(/[?#]/)[0];
  try {
    const parsed = new URL(url.startsWith("/") && !/^https?:/i.test(url) ? `http://x${url}` : url);
    const path = cut(parsed.pathname);
    return parsed.host === "x" ? path || "/" : `${parsed.host}${path}`;
  } catch {
    const stripped = cut(url);
    return stripped.length > 0 ? stripped : "?";
  }
}

/** 把一次响应缩成上面那六个数 */
export function pageShapeOf(input: TPageShapeInput): IPageShape {
  const isDocument = looksLikeDocument(input.data);
  let cells = -1;
  if (isDocument) {
    const found = (input.data as { querySelectorAll: (s: string) => { length: number } }).querySelectorAll("td");
    cells = typeof found?.length === "number" ? found.length : -1;
  }
  const bytes =
    typeof input.responseText === "string"
      ? input.responseText.length
      : typeof input.data === "string"
        ? input.data.length
        : -1;

  return {
    status: typeof input.status === "number" ? input.status : -1,
    hostPath: hostPathOf(
      typeof input.finalUrl === "string" && input.finalUrl.length > 0 ? input.finalUrl : joinUrl(input.requestUrl, input.baseURL),
    ),
    contentType: typeof input.contentType === "string" && input.contentType.length > 0 ? input.contentType : "?",
    isDocument,
    cells,
    bytes,
  };
}

/** 请求配置里那两条拼成一个绝对地址（axios 自己会这么做，这里只是给 hostPathOf 一个可解析的串） */
function joinUrl(url: unknown, baseURL: unknown): string | undefined {
  if (typeof url !== "string") return typeof baseURL === "string" ? baseURL : undefined;
  if (typeof baseURL !== "string" || /^https?:/i.test(url)) return url;
  return `${baseURL.replace(/\/+$/, "")}/${url.replace(/^\/+/, "")}`;
}

/** 一个观测值算不算「停在默认值」（解析器没命中时落的就是这几样） */
export function isDefaultish(value: unknown): boolean {
  if (value === undefined || value === null || value === "" || value === 0 || value === false) return true;
  return typeof value === "number" && Number.isNaN(value);
}

/**
 * 界面那一屏用来判「这个站有没有数据」的三格：名称、等级、上传量。
 * 刻意挑「账号身份类」的三格而不是全部字段：`bonus: 0`、`invites: 0` 这类是合法真数，
 * 拿它们当空手判据会天天误报；而一个新注册、真 0 上传的账号也照样有名称与等级。
 */
export const SILENT_ZERO_FIELDS = ["name", "levelName", "uploaded"] as const;

/** 这一轮是不是「跑完了但整页一格都没命中」 */
export function isSilentZeroRound(record: object): boolean {
  const values = record as Partial<Record<(typeof SILENT_ZERO_FIELDS)[number], unknown>>;
  return SILENT_ZERO_FIELDS.every((key) => isDefaultish(values[key]));
}

/** 一行读数（运行日志那一列是 ellipsis 的，短句优先，细节在 data 里） */
export function shapeLine(shape: IPageShape): string {
  const cells = shape.cells >= 0 ? `td ${shape.cells} 个` : "格子数未知";
  const bytes = shape.bytes >= 0 ? `${shape.bytes} 字节` : "字节数未知";
  return `HTTP ${shape.status} · ${shape.hostPath} · ${shape.contentType} · ${bytes} · ${shape.isDocument ? "已解析成文档" : "不是文档"} · ${cells}`;
}
