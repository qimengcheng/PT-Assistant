/**
 * 「用户信息取数的响应形状指纹」的判据。
 *
 * 分两半钉（本仓一贯口径）：
 *   · 纯函数那半（形状怎么折、什么算整轮空手、地址怎么去 query）直接 import 真源码跑；
 *   · 接线那半（`AbstractPrivateSite` 到底调没调、交出去的那份里有没有夹带正文）
 *     只能按源码文本断言 —— 那个文件 import 了 Sizzle，Node 里挂不起来。
 *     这件事要写明白：**端到端（真站点回包 → 运行日志出现那一行）只有装机验收能验**。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  SILENT_ZERO_FIELDS,
  hostPathOf,
  isBlockShellPage,
  isDefaultish,
  isShellPage,
  isSilentZeroRound,
  pageShapeOf,
  pageSkeletonOf,
  queryShapeOf,
  shapeLine,
  skippedStepLine,
  userInfoRequestVariants,
  type IPageShape,
} from "@/shared/userInfoShape.ts";

/** 归一换行符：本仓 `core.autocrlf` 开着，工作区那份是 LF 还是 CRLF 取决于最后一个存盘的编辑器 */
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8").replace(/\r\n/g, "\n");

/** 一个「像文档」的对象：只要有 querySelectorAll 就够了（Node 里没有 Document 全局） */
const fakeDoc = (cells: number, outerHTMLLength?: number) => ({
  querySelectorAll: () => ({ length: cells }),
  ...(outerHTMLLength === undefined ? {} : { documentElement: { outerHTML: "z".repeat(outerHTMLLength) } }),
});

/**
 * 真 XHR 在 `responseType` 为 `document` 时的形状：读 `responseText` 直接抛 InvalidStateError。
 * v0.125.0 就是在调用点这么读的，结果整轮取数被外层 catch 盖成 parseError（用户 2026-10-24：「现在变成解析错误了」）。
 */
const throwingTransport = (responseURL: string) => ({
  responseURL,
  get responseText(): string {
    throw new Error("InvalidStateError: only accessible if responseType is '' or 'text'");
  },
});

/**
 * 一个「外壳页」形状的文档：没有格子、标题/正文可选带着，整页序列化长度由 `html` 控制。
 * 现场读数里那种「200 + 137 字符 + td 0 个」就是这一档（用户 2026-10-24 贴的那条）。
 */
const shellDoc = (opt: { title?: string; body?: string; html?: string }) => ({
  querySelectorAll: () => ({ length: 0 }),
  title: opt.title,
  body: opt.body === undefined ? null : { textContent: opt.body },
  documentElement: { outerHTML: opt.html ?? "<html></html>" },
});

const SITE = "packages/site/schemas/AbstractPrivateSite.ts";
const SHARED = "src/shared/userInfoShape.ts";

describe("地址只留 host + path（隐私那一半）", () => {
  it("绝对地址：去掉 query 与 hash，留下 host 与 path", () => {
    expect(hostPathOf("https://ptzone.xyz/userdetails.php?id=10001")).toBe("ptzone.xyz/userdetails.php");
    expect(hostPathOf("https://pt.novahd.top/index.php?returnto=%2Fa#x")).toBe("pt.novahd.top/index.php");
  });

  it("那一串 uid 不许从任何出口漏出去", () => {
    // 夹具用合成 id：真的账号标识不许进仓库（AGENTS.md §3.5）
    const shape = pageShapeOf({
      status: 200,
      transport: { responseURL: "https://ptzone.xyz/userdetails.php?id=10001", responseText: "x".repeat(10) },
      contentType: "text/html",
      data: fakeDoc(0),
    });
    expect(shape.hostPath).not.toContain("10001");
    expect(shape.hostPath).not.toContain("?");
    expect(shapeLine(shape)).not.toContain("10001");
    expect(JSON.stringify(shape)).not.toContain("10001");
  });

  it("相对地址（没 host）只留 path；空/非字符串给 ?", () => {
    expect(hostPathOf("/userdetails.php?id=1")).toBe("/userdetails.php");
    expect(hostPathOf("mybonus.php")).toBe("mybonus.php");
    expect(hostPathOf(undefined)).toBe("?");
    expect(hostPathOf(123)).toBe("?");
  });
});

describe("参数只报形状，值一个都不留", () => {
  it("「带没带 id」这一问现在读数自己答得出（用户 2026-10-24：「是不是访问的没带 userid 参数啊」）", () => {
    expect(queryShapeOf("https://ptzone.xyz/userdetails.php?id=10001")).toBe("?id=有值");
    expect(queryShapeOf("https://ptzone.xyz/userdetails.php")).toBe("（无参数）");
    expect(queryShapeOf("https://ptzone.xyz/userdetails.php?id=")).toBe("?id=空");
  });

  it("多个参数 / 无等号 / hash 之后那段不算 / 只有问号不算", () => {
    expect(queryShapeOf("https://a.test/p.php?a=1&b=&c&passkey=abc123#frag")).toBe(
      "?a=有值&b=空&c（无等号）&passkey=有值",
    );
    expect(queryShapeOf("https://a.test/p.php?")).toBe("（无参数）");
    expect(queryShapeOf("https://a.test/p.php#x?id=1")).toBe("（无参数）");
    expect(queryShapeOf(undefined)).toBe("（无参数）");
  });

  it("值不进任何出口：读数里只有参数名与「有值」", () => {
    expect(queryShapeOf("https://a.test/p.php?id=10001&passkey=SECRET")).not.toContain("10001");
    expect(queryShapeOf("https://a.test/p.php?id=10001&passkey=SECRET")).not.toContain("SECRET");
    const shape = pageShapeOf({
      status: 200,
      transport: { responseURL: "https://a.test/p.php?id=10001&passkey=SECRET" },
      data: shellDoc({ title: "x" }),
    });
    expect(shape.query).toBe("?id=有值&passkey=有值");
    expect(JSON.stringify(shape)).not.toContain("10001");
    expect(JSON.stringify(shape)).not.toContain("SECRET");
  });
});

describe("「拿到的是外壳页」那一档给内容骨架", () => {
  const doc = shellDoc({ title: "Loading", body: "please wait 1 seconds", html: "<html>xx</html>" });

  it("小页给标题与正文（数字遮掉）", () => {
    expect(pageSkeletonOf(doc, 137)).toBe("标题「Loading」 正文「please wait * seconds」");
  });

  it("标题与正文都空 → 退回整页结构那一串（跳转页常长这样）", () => {
    const bare = shellDoc({ html: '<html><head><meta http-equiv="refresh" content="0;url=login.php"></head></html>' });
    expect(pageSkeletonOf(bare, 137)).toContain('整页「<html><head><meta http-equiv="refresh"');
  });

  it("页面不小（正常页里可能写着用户名）就一律不给", () => {
    expect(pageSkeletonOf(doc, 5000)).toBe("");
  });

  it("长度未知 / 压根不是文档时也不给（不编一个骨架）", () => {
    expect(pageSkeletonOf(doc, -1)).toBe("");
    expect(pageSkeletonOf("<html>xx</html>", 9)).toBe("");
    expect(pageSkeletonOf(null, 9)).toBe("");
  });

  it("那一页真带着 uid 也只留下 * ，不进日志", () => {
    const leaky = shellDoc({ title: "user 10001", body: "id=10001" });
    const line = pageSkeletonOf(leaky, 120);
    expect(line).not.toContain("10001");
    expect(line).toContain("*");
  });
});

describe("被「字段已有」短路掉的那些步也要说出来", () => {
  it("一行里带 url、并点明它本来负责哪几个字段", () => {
    expect(skippedStepLine({ url: "/index.php", fields: ["id"] })).toBe("/index.php（已有 id）");
    expect(skippedStepLine({ url: "/userdetails.php", fields: ["name", "uploaded"] })).toBe(
      "/userdetails.php（已有 name/uploaded）",
    );
  });

  it("这一串自己不说「跳过」—— 整句前面已经有「；跳过」在点名这一族，两处都写就成括号套括号", () => {
    expect(skippedStepLine({ url: "/index.php", fields: ["id"] })).not.toContain("跳过");
    const src = read(SITE);
    expect(src).toMatch(/；跳过 \$\{skipped\}/);
  });
});

describe("一次响应折成八个观测值", () => {
  it("文档型：isDocument 为真、格子数照数", () => {
    const shape = pageShapeOf({
      status: 200,
      transport: { responseURL: "https://a.test/i.php" },
      data: fakeDoc(137),
      contentType: "text/html",
    });
    expect(shape).toEqual({
      status: 200,
      hostPath: "a.test/i.php",
      contentType: "text/html",
      server: "",
      cfMitigated: "",
      isDocument: true,
      cells: 137,
      textLength: -1,
      query: "（无参数）",
      skeleton: "",
    });
  });

  it("不是文档（例如 Content-Type 变了、XHR 按 XML 解析）：格子数是未知而不是 0", () => {
    const shape = pageShapeOf({
      status: 200,
      transport: { responseURL: "https://a.test/i.php" },
      data: "<html></html>",
      contentType: "application/xml",
    });
    expect(shape.isDocument).toBe(false);
    expect(shape.cells).toBe(-1);
    expect(shape.textLength).toBe("<html></html>".length);
  });

  it("传输层读 responseText 会抛（真 XHR 在 responseType=document 时就这样）：不许把异常传出去", () => {
    const shape = pageShapeOf({ status: 200, transport: throwingTransport("https://a.test/i.php"), data: fakeDoc(12) });
    expect(shape.hostPath).toBe("a.test/i.php");
    expect(shape.cells).toBe(12);
    expect(shape.textLength).toBe(-1);
  });

  it("文档型拿不到原文时，正文长度退回 documentElement.outerHTML", () => {
    const shape = pageShapeOf({ transport: throwingTransport("https://a.test/i.php"), data: fakeDoc(3, 4096) });
    expect(shape.textLength).toBe(4096);
  });

  it("原文拿得到时以它为准（它比序列化后的 DOM 更接近站点真发的那一份）", () => {
    const shape = pageShapeOf({ data: fakeDoc(3, 4096), transport: { responseText: "abcdefgh" }, contentType: "text/html" });
    expect(shape.textLength).toBe(8);
  });

  it("传输层整个缺席（fetch 型适配器不给 request）：其余读数照给，地址退回请求配置", () => {
    const shape = pageShapeOf({ status: 200, requestUrl: "userdetails.php", baseURL: "https://a.test/", data: fakeDoc(9) });
    expect(shape.hostPath).toBe("a.test/userdetails.php");
    expect(shape.cells).toBe(9);
  });

  it("缺什么落成什么：状态 -1、Content-Type ?，都不编一个假数", () => {
    const shape = pageShapeOf({});
    expect(shape.status).toBe(-1);
    expect(shape.contentType).toBe("?");
    expect(shape.hostPath).toBe("?");
    expect(shape.isDocument).toBe(false);
  });
});

describe("响应头只留 server / cf-mitigated（分站点 nginx 与 Cloudflare 用）", () => {
  it("大小写不敏感，普通对象与 AxiosHeaders 两种形状都收", () => {
    const plain = pageShapeOf({ headers: { Server: "cloudflare", "CF-Mitigated": "challenge" } });
    expect(plain.server).toBe("cloudflare");
    expect(plain.cfMitigated).toBe("challenge");

    const withGet = pageShapeOf({
      headers: { get: (name: string) => (name.toLowerCase() === "server" ? "nginx" : undefined) },
    });
    expect(withGet.server).toBe("nginx");
  });

  it("没有这两项时是空串，不编一个值；读数行也不写出空项", () => {
    const empty = pageShapeOf({});
    expect(empty.server).toBe("");
    expect(empty.cfMitigated).toBe("");
    expect(shapeLine(empty)).not.toContain("server=");
    expect(shapeLine(empty)).not.toContain("cf-mitigated=");
  });

  it("真拿到时才写进那一行", () => {
    const line = shapeLine(pageShapeOf({ headers: { server: "cloudflare", "cf-mitigated": "challenge" } }));
    expect(line).toContain("server=cloudflare");
    expect(line).toContain("cf-mitigated=challenge");
  });
});

describe("外壳页判据与外壳页出现后要试的请求形状", () => {
  const shellShape = (over: Partial<IPageShape> = {}): IPageShape => ({
    status: 200,
    hostPath: "a.test/userdetails.php",
    query: "?id=有值",
    contentType: "text/html",
    server: "cloudflare",
    cfMitigated: "",
    isDocument: true,
    cells: 0,
    textLength: 137,
    skeleton: "标题「403 Forbidden」 正文「403 Forbidden nginx」",
    ...over,
  });

  it("200 + 文档 + 0 个 td + 短正文才算外壳页（现场那条 137 字符的 403 页）", () => {
    expect(isShellPage(shellShape())).toBe(true);
    expect(isShellPage(shellShape({ status: 302 }))).toBe(false);
    expect(isShellPage(shellShape({ cells: 120 }))).toBe(false);
    expect(isShellPage(shellShape({ textLength: 0 }))).toBe(false);
    expect(isShellPage(shellShape({ textLength: 5000 }))).toBe(false);
    expect(isShellPage(shellShape({ isDocument: false }))).toBe(false);
  });

  it("只有明确像拦截页的外壳才触发探针（Forbidden / Access denied / challenge）", () => {
    expect(isBlockShellPage(shellShape())).toBe(true);
    expect(isBlockShellPage(shellShape({ skeleton: "Access denied" }))).toBe(true);
    expect(isBlockShellPage(shellShape({ skeleton: "Just a moment..." }))).toBe(true);
    expect(isBlockShellPage(shellShape({ skeleton: "站点维护中" }))).toBe(false);
    expect(isBlockShellPage(shellShape({ skeleton: "", status: 302 }))).toBe(false);
  });

  it("四种形状：只加 Referer / 只去 Origin / 两者都改 / 伪装成页面导航；Referer 用站点根，不带 query 与账号值", () => {
    const variants = userInfoRequestVariants("https://ptzone.xyz/?x=1#y");
    expect(variants.map((v) => v.name)).toEqual([
      "加 Referer",
      "去 Origin",
      "加 Referer + 去 Origin",
      "伪装成页面导航",
    ]);
    expect(variants[0].headers.Referer).toBe("https://ptzone.xyz/");
    expect(variants[1].headers).toEqual({ Origin: "" });
    expect(variants[2].headers).toEqual({ Referer: "https://ptzone.xyz/", Origin: "" });
    expect(variants[3].headers).toMatchObject({
      Referer: "https://ptzone.xyz/",
      Origin: "",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Dest": "document",
    });
    // 导航形状要连 GET 上那个 JSON body/Content-Type 一起去掉
    expect(variants[3].data).toBeNull();
    expect(variants[0].data).toBeUndefined();
    expect(variants[0].headers.Referer).not.toContain("x=1");
  });

  it("站点带路径时 Referer 保留那一段（镜像站常常挂在子目录下）", () => {
    expect(userInfoRequestVariants("https://host/pt/").map((v) => v.headers.Referer)).toEqual([
      "https://host/pt/",
      undefined,
      "https://host/pt/",
      "https://host/pt/",
    ]);
  });
});

describe("什么算「整轮一格都没命中」", () => {
  it("默认值那一档：undefined / null / 空串 / 0 / false / NaN", () => {
    for (const v of [undefined, null, "", 0, false, Number.NaN]) expect(isDefaultish(v)).toBe(true);
    // "0.00 B" 是解析出来的真串，0 与 "0" 不能并档
    for (const v of ["0.00 B", "0", "无", -1, [], {}]) expect(isDefaultish(v)).toBe(false);
  });

  it("看的是界面那三格：名称 / 等级 / 上传量全停着才算空手", () => {
    expect([...SILENT_ZERO_FIELDS]).toEqual(["name", "levelName", "uploaded"]);
    expect(isSilentZeroRound({ name: "", levelName: "", uploaded: 0, status: 3 })).toBe(true);
    expect(isSilentZeroRound({ name: undefined, levelName: undefined, uploaded: undefined })).toBe(true);
  });

  it("新注册、真 0 上传的账号不许误报（它有名称与等级）", () => {
    expect(isSilentZeroRound({ name: "新用户", levelName: "普通用户", uploaded: 0 })).toBe(false);
  });

  it("三格里有一格拿到数就不算空手", () => {
    expect(isSilentZeroRound({ name: "u", levelName: "", uploaded: 0 })).toBe(false);
    expect(isSilentZeroRound({ name: "", levelName: "Lv2", uploaded: 0 })).toBe(false);
    expect(isSilentZeroRound({ name: "", levelName: "", uploaded: 1024 })).toBe(false);
  });
});

describe("一行读数把这八个量都带上", () => {
  it("状态 / 地址与参数形状 / 类型 / 是不是文档 / 格子数 / 正文长度 / 骨架", () => {
    const line = shapeLine(
      pageShapeOf({
        status: 200,
        transport: { responseURL: "https://ptzone.xyz/userdetails.php?id=10001", responseText: "y".repeat(17680) },
        contentType: "text/html;charset=utf-8",
        data: fakeDoc(0),
      }),
    );
    expect(line).toContain("HTTP 200");
    expect(line).toContain("ptzone.xyz/userdetails.php?id=有值");
    expect(line).not.toContain("10001");
    expect(line).toContain("text/html;charset=utf-8");
    expect(line).toContain("17680 字符");
    expect(line).toContain("已解析成文档");
    expect(line).toContain("td 0 个");
    // 17680 字符的页给不了骨架，那一格也就不该多出个空括号
    expect(line).not.toContain("标题");
  });

  it("小页那一档把骨架接在同一行末尾（现场那种 137 字符就是靠这一条认出是什么页）", () => {
    const line = shapeLine(
      pageShapeOf({
        status: 200,
        transport: { responseURL: "https://ptzone.xyz/userdetails.php" },
        contentType: "text/html",
        data: shellDoc({ title: "Checking your browser", body: "please wait 5 seconds", html: "w".repeat(137) }),
      }),
    );
    expect(line).toContain("137 字符");
    expect(line).toContain("（无参数）");
    expect(line).toContain("标题「Checking your browser」 正文「please wait * seconds」");
  });

  it("拿不到的那两项明写「未知」，不写成 0", () => {
    const line = shapeLine(pageShapeOf({}));
    expect(line).toContain("正文长度未知");
    expect(line).toContain("格子数未知");
  });
});

describe("判据本体是纯的（Node 进得来才有这些断言）", () => {
  it("src/shared/userInfoShape.ts 没有任何 import", () => {
    expect(read(SHARED)).not.toMatch(/^import /m);
  });
});

describe("接线：AbstractPrivateSite 真的用了这份判据", () => {
  const src = read(SITE);
  const at = (needle: string) => src.indexOf(needle);

  it("每一步都折一份形状，且就在拿到响应那一行之后", () => {
    expect(at("let response = await this.request<unknown>(requestConfig);")).toBeGreaterThan(-1);
    expect(at("pageShapes.push(")).toBeGreaterThan(at("let response = await this.request<unknown>(requestConfig);"));
  });

  it("外壳页探针：只在 200+0 td 时触发、一轮一次；试出来的形状用于解析，后续步骤沿用", () => {
    expect(at("isBlockShellPage(shape) && !probedShellPage")).toBeGreaterThan(-1);
    expect(at("probeUserInfoShellPage(")).toBeGreaterThan(-1);
    expect(at("userInfoRequestVariants(siteUrl)")).toBeGreaterThan(-1);
    expect(at("winningVariant = { headers: winner.headers")).toBeGreaterThan(-1);
    expect(at("requestConfig.headers = {")).toBeGreaterThan(-1);
    expect(at("requestConfig.data = winningVariant.data")).toBeGreaterThan(-1);
    // 第二个假设：这一步 /index.php 被 pickLast 短路掉了，站点可能要一次页面访问来刷新反爬状态
    expect(at('url: "/index.php"')).toBeGreaterThan(-1);
    expect(at("visitIndexFirst = true")).toBeGreaterThan(-1);
    expect(at("本轮改为先访问首页再取用户页")).toBeGreaterThan(-1);
    // 探针在解析字段之前（否则 winner 那份 dataDocument 用不上）
    expect(at("probeUserInfoShellPage(")).toBeLessThan(at("for (const key of processFields)"));
    expect(src).toMatch(/const probeConfig: AxiosRequestConfig = \{/);
    // Cloudflare 挑战页也可能有很多 td，不能被当成「能用的用户页」
    expect(at("!shape.cfMitigated")).toBeGreaterThan(-1);
  });

  it("整轮空手才出声，且不改解析行为：status 那一条仍在 logEvent 之后", () => {
    expect(at("isSilentZeroRound(flushUserInfo)")).toBeGreaterThan(-1);
    expect(at("logEvent({")).toBeGreaterThan(-1);
    expect(at("flushUserInfo.status = EResultParseStatus.success;")).toBeGreaterThan(at("logEvent({"));
  });

  it("交出去的那份只有站点与形状读数，不带正文 / 请求参数 / 文档本体", () => {
    // 按行取那一条 payload（`data: {}` 在这个文件里还有别的出处 —— 请求配置的默认值就是），
    // 找不到就是空串，下面第一条断言会红（indexOf 那类「-1 也算通过」的坑本仓踩过）
    const lines = src.split("\n");
    const silentLine = lines.find((l) => l.includes("data: { site: this.metadata.id")) ?? "";
    expect(silentLine.length).toBeGreaterThan(0);
    expect(silentLine).toContain("pages: pageShapes");

    // 探针那条 data 是分行的，按 baseline 定位它那一段，一起验「不带响应对象」
    const probeStart = lines.findIndex((l) => l.includes("baseline: shape"));
    expect(probeStart).toBeGreaterThan(-1);
    const probeBlock = lines.slice(probeStart - 2, probeStart + 8).join("\n");
    expect(probeBlock).toContain("probes: probes.map");
    expect(probeBlock).toContain("index: indexShape");

    for (const forbidden of ["responseText", "params", "dataDocument", "document.cookie", "response:"]) {
      expect(silentLine).not.toContain(forbidden);
      expect(probeBlock).not.toContain(forbidden);
    }
  });

  it("被「字段已有」短路掉的那几步记在 continue 之前，且一条都没发时也要出声", () => {
    // pickLast 会把上一轮的 id 并进本轮 ⇒ 第一步 /index.php 可以整轮一次都不发，
    // 而界面上那个 id 看着像「本轮取到的」（用户 2026-10-24 问的「是不是没带 userid」正卡在这）。
    expect(at("skippedSteps.push(")).toBeGreaterThan(-1);
    expect(at("continue; // 如果全部数据都有则直接跳过本轮")).toBeGreaterThan(-1);
    expect(at("skippedSteps.push(")).toBeLessThan(at("continue; // 如果全部数据都有则直接跳过本轮"));
    // 那道门放宽成「至少动过一步」，否则「压根没联网」那一档在读数上是隐形的
    expect(src).toMatch(/\(pageShapes\.length > 0 \|\| skippedSteps\.length > 0\) && isSilentZeroRound/);
    expect(src).toMatch(/一次请求都没发/);
    expect(src).toMatch(/共 \$\{totalCount\} 步、实发 \$\{sentCount\} 次/);
  });

  it("出声那条也不许有弄坏取数的能力（连同步抛都要兜住）", () => {
    const adapter = read("packages/site/utils/adapter.ts");
    const body = adapter.slice(adapter.indexOf("export function logEvent"));
    expect(body).toMatch(/try \{[\s\S]*sendMessage\("logger"[\s\S]*\} catch/);
  });

  it("调用点交的是传输层对象本身，不在那里读它的属性", () => {
    // v0.125.0 坏在 `transport?.responseText`：真 XHR 在 responseType=document 时读它会抛
    // InvalidStateError，而这一句在 try 里 ⇒ 整轮取数被外层 catch 盖成 parseError。
    // 读属性归判据管（那边逐条 try 过），所以这一条按「调用点不出现属性读」来钉。
    expect(src).toMatch(/transport:\s*response\.request,/);
    expect(src).not.toMatch(/\?\.(responseText|responseURL)/);
    // 外面那一层 try 是「观测件不许有弄坏被观测那条路的能力」这条规矩的落地
    expect(src).toMatch(/try \{\s*\n\s*shape = this\.userInfoShapeOf\(/);
  });
});
