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
  /** 响应头里的 Server；没有则空串。用来分「站点自己的 nginx」与「Cloudflare 边缘返回」 */
  server: string;
  /** 响应头里的 cf-mitigated；没有则空串。Cloudflare 挑战会写 challenge */
  cfMitigated: string;
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
  /** axios 的 response.headers；只读 server / cf-mitigated 两项，别的一概不落进读数 */
  headers?: unknown;
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

/**
 * 从响应头里读一项，大小写不敏感。
 * axios 的 headers 是 AxiosHeaders（带 get()），Node 断言里也可能传普通对象；两边都收。
 */
function readHeader(headers: unknown, name: string): string {
  if (headers === null || typeof headers !== "object") return "";
  const getter = safeProp(headers, "get");
  try {
    if (typeof getter === "function") {
      const value = (getter as (n: string) => unknown).call(headers, name);
      if (typeof value === "string") return value;
    }
  } catch {
    // AxiosHeaders.get 在旧版本 / 被替换成普通对象时不保证存在，走下面的逐键兜底
  }
  try {
    const lower = name.toLowerCase();
    const obj = headers as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      if (key.toLowerCase() !== lower) continue;
      const value = obj[key];
      return typeof value === "string" ? value : String(value ?? "");
    }
  } catch {
    // 观测值读不到就当没有
  }
  return "";
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
    server: readHeader(input.headers, "server"),
    cfMitigated: readHeader(input.headers, "cf-mitigated"),
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
 * 「200 + 一个 td 都没有 + 正文很短」这一档。
 *
 * 正常的用户信息页（NexusPHP 的 userdetails.php / mybonus.php）至少有几十个 td，
 * 所以这个形状不可能是「站点真报了 0」，只可能是拦截页 / 外壳页 / 跳转页。
 * 判据刻意把 `textLength > 0` 也算进去：完全空白的 200 是另一种坏法（CSP / 网络层），
 * 不在「换请求形状」能解决的范围内。
 */
export function isShellPage(shape: IPageShape): boolean {
  return (
    shape.status === 200 &&
    shape.isDocument &&
    shape.cells === 0 &&
    shape.textLength > 0 &&
    shape.textLength <= SKELETON_MAX_CHARS
  );
}

/**
 * 外壳页里明确像「站点/边缘层拦截」的那一档。
 *
 * 探针只对这类页触发：真正的用户页外壳（例如站点维护、空模板）没有理由让插件换五种请求形状
 * 去打五次；而 Forbidden / Access denied / CF 挑战这些关键字是可判的。骨架里的数字已被遮成
 * `*`，所以这里只认字母与中文，不认状态码。
 */
const BLOCK_SHELL_HINTS = [
  /forbidden/i,
  /access denied/i,
  /just a moment/i,
  /checking your browser/i,
  /attention required/i,
  /cf-error/i,
  /captcha/i,
  /人机验证/,
  /拦截/,
];

/**
 * 一段文字（标题 / 正文 / 整页结构）像不像拦截页。
 *
 * 单独导出是因为**标签页那条兜底**也要用它：后台拿不到 Document，只能拿标题和
 * `outerHTML` 去判「这一页是不是挑战页，要不要再等一拍」。两边用同一份关键字，
 * 否则一处认「Forbidden」、另一处不认，就会出现「后台以为已经加载好了，调用方却判成外壳页」。
 */
export function looksLikeBlockText(text: string): boolean {
  return BLOCK_SHELL_HINTS.some((hint) => hint.test(text));
}

export function isBlockShellPage(shape: IPageShape): boolean {
  return isShellPage(shape) && looksLikeBlockText(shape.skeleton);
}

export interface IUserInfoRequestVariant {
  /** 日志里那半句，例如「加 Referer」 */
  name: string;
  /** 交给 axios 的 headers；空串是 replaceUnsafeHeader 约定的「移除这一项」 */
  headers: Record<string, string>;
  /**
   * 可选的 body 覆盖。用户信息请求的默认配置带一个 `data: {}`，axios 会给 GET 挂上
   * `Content-Type: application/json`；「伪装成页面导航」要连这一项一起去掉（用 null）。
   */
  data?: unknown;
}

/**
 * 外壳页出现后要试的请求形状。
 *
 * 现场（2026-10-24）：PTzone 的 userdetails.php / mybonus.php 对插件返回 200 + nginx 的
 * 403 页（正文 137 字符），而匿名请求是 302 跳登录、站点搜索正常 ⇒ 站点是在**已登录**这条
 * 请求上做拒绝，且只挑用户页。浏览器导航与插件 XHR 的差别只剩这几项：没有 Referer、
 * 带 `Origin: chrome-extension://…`、`Sec-Fetch-*` 是 cors/empty。后两项里 Origin 是最像
 * 扩展的一项；Referer 是最常见的防盗链条件。所以先只试这两项，不一次把所有头都改掉 ——
 * 否则日志只能告诉我们「某种形状能过」，分不清是哪一项起的作用。
 *
 * 第四、第五种是「整条请求看起来像页面导航」的两个档次：#4 只改 Sec-Fetch 与 Accept；
 * #5 再补上地址栏导航才有的 `Upgrade-Insecure-Requests` / `Cache-Control: max-age=0` /
 * `Priority`，并把 `Sec-Fetch-Site` 置成 `none`（顶层导航是 none，页面内跳转才是 same-origin）。
 * #5 是照着「真在地址栏敲这个地址」的头逐项对齐的；DNR 改不到哪一项，请求头对照那一行会直接显出来。
 */
export function userInfoRequestVariants(siteUrl: string): IUserInfoRequestVariant[] {
  let referer = siteUrl;
  try {
    const parsed = new URL(siteUrl);
    parsed.search = "";
    parsed.hash = "";
    referer = parsed.toString();
  } catch {
    // 不是绝对 URL 就原样用；request() 里它本来也会被当作 baseURL
  }

  return [
    { name: "加 Referer", headers: { Referer: referer } },
    { name: "去 Origin", headers: { Origin: "" } },
    { name: "加 Referer + 去 Origin", headers: { Referer: referer, Origin: "" } },
    {
      // 这一种只把 Sec-Fetch 改成导航，仍留着 Referer / 同源 Site：有些人会把「同站页面里
      // 点进来的」当成合法来源，先试这一档比一步跳到「地址栏直开」更容易过。
      // `data: null` 顺带去掉 GET 上那个 JSON Content-Type（默认配置的 `data: {}` 会带出来）。
      name: "伪装成页面导航",
      data: null,
      headers: {
        Referer: referer,
        Origin: "",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-User": "?1",
      },
    },
    {
      // 最后这一种逐项照着「地址栏敲进去」对齐：没有 Referer、Site 是 none、带上导航特有的
      // UIR / Cache-Control / Priority。真跑不通也只是探针多一条失败读数，不影响原请求。
      name: "地址栏直开",
      data: null,
      headers: {
        Origin: "",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
        "Cache-Control": "max-age=0",
        Priority: "u=0, i",
      },
    },
  ];
}

/** 一条请求头读数（各值已由后台按隐私口径遮过：Cookie 只剩条数） */
export interface IHeaderTraceLike {
  /** `xmlhttprequest` / `main_frame` 等 */
  type: string;
  /** host + path，不含 query */
  hostPath: string;
  headers: Record<string, string>;
}

/** 一行：`Sec-Fetch=site/mode/dest/user｜Origin=…｜Referer=…｜…` */
function headerTraceOne(trace: IHeaderTraceLike): string {
  const headers = trace.headers ?? {};
  const fetchBits = ["sec-fetch-site", "sec-fetch-mode", "sec-fetch-dest", "sec-fetch-user"].map(
    (key) => headers[key] || "空",
  );
  const pick = (label: string, key: string) => `${label}=${headers[key] || "无"}`;

  return [
    `Sec-Fetch=${fetchBits.join("/")}`,
    pick("Origin", "origin"),
    pick("Referer", "referer"),
    pick("Cookie", "cookie"),
    pick("UIR", "upgrade-insecure-requests"),
    pick("Cache-Control", "cache-control"),
    pick("Priority", "priority"),
    `Accept=${headers.accept?.split(",")[0] || "无"}`,
    pick("Content-Type", "content-type"),
  ].join("｜");
}

/**
 * 把一轮里的请求头读数折成一句给人看的话：**XHR 的末条**与**导航的末条**并排。
 *
 * 为什么是「末条」：探针是按顺序打的，末条 XHR 就是最后一个变体（地址栏直开），
 * 拿它跟导航比才能判出「DNR 到底改没改到 Sec-Fetch / Origin」。更早的几条只留在 data 里，
 * 不挤进这一行 —— 这一行会跟着拦截那条 warn 一起进运行日志。
 *
 * 这条是**观测件**：解析不了站点地址就返回空串、没有任何读数就直说，绝不抛。
 */
export function headerTraceLine(traces: readonly IHeaderTraceLike[], siteUrl: string): string {
  let host = "";
  try {
    host = new URL(siteUrl).host;
  } catch {
    return "";
  }

  const mine = traces.filter((trace) => host && trace.hostPath.startsWith(`${host}/`));
  if (mine.length === 0) {
    return "没有拿到请求头读数";
  }

  const xhrs = mine.filter((trace) => trace.type === "xmlhttprequest");
  const navigations = mine.filter((trace) => trace.type === "main_frame");
  const parts: string[] = [];

  parts.push(
    xhrs.length > 0
      ? `XHR ${xhrs.length} 条、末条：${headerTraceOne(xhrs[xhrs.length - 1])}`
      : "没有 XHR 读数",
  );
  parts.push(
    navigations.length > 0
      ? `导航 ${navigations.length} 条、末条：${headerTraceOne(navigations[navigations.length - 1])}`
      : "没有导航读数",
  );

  return parts.join("；");
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
  // 不带「跳过」二字：整串前面已经有「跳过：」在点名这一族了，这里再写一遍会把括号套括号
  return `${step.url}（已有 ${step.fields.join("/")}）`;
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
    ...(shape.server ? [`server=${shape.server}`] : []),
    ...(shape.cfMitigated ? [`cf-mitigated=${shape.cfMitigated}`] : []),
    shape.isDocument ? "已解析成文档" : "不是文档",
    cells,
    text,
  ];
  if (shape.skeleton) bits.push(shape.skeleton);
  return bits.join(" · ");
}
