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
 * 地址去掉 query 的**值**（只留参数名与「有没有值」，因为「到底带没带 id」正是本次要判的事）、
 * 正文默认只留长度；只有一页小到不超过 `SKELETON_MAX_CHARS` 时才附标题/正文骨架，且数字一律遮掉。
 * 后者是刻意的例外：那种小页正是「自动跳转页 / 防刷页 / 拦截页」的形状，它不含账号内容，
 * 而不给骨架这一轮就永远判不出「137 字符到底是什么页」（用户 2026-10-24 的现场）。
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
  /** 正文长度（字符数）；三条来路都拿不到时 -1 */
  textLength: number;
  /** 实际发出去的那条地址上的参数形状（值一律不记）：`?id=有值` / `（无参数）` */
  query: string;
  /** 「200 + 极短正文」那一档的内容骨架；页面不小（可能含账号文字）时是空串 */
  skeleton: string;
}

/** `pageShapeOf` 的入参：全部是「可能拿不到」的观测值，缺什么就落成 -1 / "?" */
export type TPageShapeInput = {
  status?: unknown;
  /**
   * 传输层对象本身（XHR 那类）。**刻意不收 `finalUrl` / `responseText` 两个现成的值**：
   * 真 XHR 在 `responseType` 为 `document` 时读 `responseText` 会抛 `InvalidStateError`
   * （实测报错原文：`The value is only accessible if the object's 'responseType' is '' or 'text' (was 'document')`），
   * 而用户信息那一条请求默认就是 `document` —— 在调用点直接取属性等于把取数整轮炸成 parseError（v0.125.0 就这么坏过一次）。
   * 交对象进来，读属性的那两下由本文件负责兜住。
   */
  transport?: unknown;
  requestUrl?: unknown;
  baseURL?: unknown;
  contentType?: unknown;
  data?: unknown;
};

/** 读一个「可能抛」的属性：抛了就当没有，绝不让观测值反过来影响取数 */
function safeProp(obj: unknown, key: string): unknown {
  if (obj === null || typeof obj !== "object") return undefined;
  try {
    return (obj as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

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

/** 把一次响应折成上面那八个观测值 */
export function pageShapeOf(input: TPageShapeInput): IPageShape {
  const isDocument = looksLikeDocument(input.data);
  let cells = -1;
  let textLength = -1;
  if (isDocument) {
    const doc = input.data as {
      querySelectorAll: (s: string) => { length: number };
      documentElement?: { outerHTML?: string };
    };
    const found = doc.querySelectorAll("td");
    cells = typeof found?.length === "number" ? found.length : -1;
    // 文档型响应拿不到 XHR 原文，序列化后的长度是同一件事的最近读数
    const outerHTML = safeProp(safeProp(doc, "documentElement"), "outerHTML");
    if (typeof outerHTML === "string") textLength = outerHTML.length;
  }
  const transportText = safeProp(input.transport, "responseText");
  if (typeof transportText === "string" && transportText.length > 0) textLength = transportText.length;
  else if (textLength < 0 && typeof input.data === "string") textLength = input.data.length;

  const finalUrl = safeProp(input.transport, "responseURL");
  const rawUrl =
    typeof finalUrl === "string" && finalUrl.length > 0 ? finalUrl : joinUrl(input.requestUrl, input.baseURL);
  return {
    status: typeof input.status === "number" ? input.status : -1,
    hostPath: hostPathOf(rawUrl),
    query: queryShapeOf(rawUrl),
    contentType: typeof input.contentType === "string" && input.contentType.length > 0 ? input.contentType : "?",
    isDocument,
    cells,
    textLength,
    skeleton: pageSkeletonOf(input.data, textLength),
  };
}

/** 请求配置里那两条拼成一个绝对地址（axios 自己会这么做，这里只是给 hostPathOf 一个可解析的串） */
function joinUrl(url: unknown, baseURL: unknown): string | undefined {
  if (typeof url !== "string") return typeof baseURL === "string" ? baseURL : undefined;
  if (typeof baseURL !== "string" || /^https?:/i.test(url)) return url;
  return `${baseURL.replace(/\/+$/, "")}/${url.replace(/^\/+/, "")}`;
}

/**
 * query 只留「有哪些参数名、每个有没有值」，**值一个都不留**。
 *
 * 为什么不能像 hostPath 那样整段剥掉：用户信息那一步的地址是 `userdetails.php?id=<uid>`，
 * 「到底带没带 id」正是排查时要判的事（用户 2026-10-24：「是不是访问的没带 userid 参数啊」）。
 * 所以这里给的是形状：`?id=有值` / `?id=空` / `?a&b=有值` / `（无参数）`。
 */
export function queryShapeOf(url: unknown): string {
  if (typeof url !== "string") return "（无参数）";
  // 先按 # 切、再按 ? 切：反过来会把 hash 里那个 `?` 之后的东西当成参数（`p.php#x?id=1` 会多出一条读数）
  const q = url.split("#")[0].split("?")[1];
  if (!q) return "（无参数）";
  const parts = q
    .split("&")
    .filter((kv) => kv.length > 0)
    .map((kv) => {
      const eq = kv.indexOf("=");
      if (eq < 0) return `${decodeName(kv)}（无等号）`;
      const name = decodeName(kv.slice(0, eq));
      const value = kv.slice(eq + 1).trim();
      return `${name}=${value.length > 0 ? "有值" : "空"}`;
    });
  return parts.length > 0 ? `?${parts.join("&")}` : "（无参数）";
}

function decodeName(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * 「拿到的是外壳页」那一档的内容骨架。
 *
 * 只在**页面小到一定程度**时才给：这一档正是「200 + 极短正文」的现场（自动跳转页 / 防刷页 /
 * 拦截页），它不含账号内容；而正常大页面里可能写着用户名，所以一律不给 —— 骨架是给排查用的，
 * 不是把正文抄进日志（AGENTS.md §3.5）。数字一律遮成 `*`：万一那页真带着 uid，也不进日志。
 */
const SKELETON_MAX_CHARS = 2000;

export function pageSkeletonOf(data: unknown, textLength: number): string {
  if (!looksLikeDocument(data) || textLength < 0 || textLength > SKELETON_MAX_CHARS) return "";
  const doc = data as {
    title?: unknown;
    body?: { textContent?: unknown } | null;
    documentElement?: { outerHTML?: string } | null;
  };
  const title = maskDigits(collapse(String(safeProp(doc, "title") ?? "")));
  const body = maskDigits(collapse(String(safeProp(safeProp(doc, "body"), "textContent") ?? "")));
  const bits: string[] = [];
  if (title) bits.push(`标题「${title.slice(0, 40)}」`);
  if (body) bits.push(`正文「${body.slice(0, 80)}」`);
  if (bits.length === 0) {
    // 标题与正文都空 —— 外壳页常常正是这个形状，那这一格不能空着：直接把结构那一串交出来。
    // 仍是同一档隐私口径（只给小页、数字遮掉），跳转页 meta refresh 的 target 就靠这一条认出来。
    const html = maskDigits(collapse(String(safeProp(safeProp(doc, "documentElement"), "outerHTML") ?? "")));
    if (html) bits.push(`整页「${html.slice(0, 120)}」`);
  }
  return bits.join(" ");
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function maskDigits(text: string): string {
  return text.replace(/\d/g, "*");
}

/**
 * 「这一步压根没发出去」那一档的读数。
 *
 * process 循环开头有一条 `existField.length === processFields.length → continue`
 * （要取的字段已经在 `flushUserInfo` 里就跳过整步），而 `pickLast` 恰好会把上一轮的 `id`
 * 并进本轮 —— 于是「取不到数据」的一轮里，**第一步 /index.php 可以一次都不发**，
 * 界面与日志里那个 id 纯粹是存档带过来的。光看实发的那几条读数判不出这件事，
 * 所以把「一共几步、哪几步被跳过、跳掉的那步本来负责哪几个字段」也记一行。
 * 这里的 url 取自**站点定义**（还没经过 assertion 填参数），不含账号值；字段名是内部键名，
 * 不进界面（§3.5 只管界面）。
 */
export function skippedStepLine(step: { url: string; fields: readonly string[] }): string {
  return `${step.url}（跳过：已有 ${step.fields.join("/")}）`;
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
  const text = shape.textLength >= 0 ? `${shape.textLength} 字符` : "正文长度未知";
  // query 跟在地址后面、不另起一段：`userdetails.php?id=有值` 与 `userdetails.php（无参数）`
  // 这两种读起来就是一句话，而后者正是「参数没带上」的直接证据。
  const bits = [
    `HTTP ${shape.status}`,
    `${shape.hostPath}${shape.query}`,
    shape.contentType,
    shape.isDocument ? "已解析成文档" : "不是文档",
    cells,
    text,
  ];
  if (shape.skeleton) bits.push(shape.skeleton);
  return bits.join(" · ");
}
