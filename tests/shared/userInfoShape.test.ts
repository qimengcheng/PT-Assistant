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
  isDefaultish,
  isSilentZeroRound,
  pageShapeOf,
  shapeLine,
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

describe("一次响应折成六个观测值", () => {
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
      isDocument: true,
      cells: 137,
      textLength: -1,
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

describe("一行读数把六个量都带上", () => {
  it("状态 / 地址 / 类型 / 正文长度 / 是不是文档 / 格子数", () => {
    const line = shapeLine(
      pageShapeOf({
        status: 200,
        transport: { responseURL: "https://ptzone.xyz/userdetails.php?id=1", responseText: "y".repeat(17680) },
        contentType: "text/html;charset=utf-8",
        data: fakeDoc(0),
      }),
    );
    expect(line).toContain("HTTP 200");
    expect(line).toContain("ptzone.xyz/userdetails.php");
    expect(line).toContain("text/html;charset=utf-8");
    expect(line).toContain("17680 字符");
    expect(line).toContain("已解析成文档");
    expect(line).toContain("td 0 个");
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
    expect(at("const response = await this.request<any>(requestConfig);")).toBeGreaterThan(-1);
    expect(at("pageShapes.push(")).toBeGreaterThan(at("const response = await this.request<any>(requestConfig);"));
  });

  it("整轮空手才出声，且不改解析行为：status 那一条仍在 logEvent 之后", () => {
    expect(at("isSilentZeroRound(flushUserInfo)")).toBeGreaterThan(-1);
    expect(at("logEvent({")).toBeGreaterThan(-1);
    expect(at("flushUserInfo.status = EResultParseStatus.success;")).toBeGreaterThan(at("logEvent({"));
  });

  it("交出去的那份只有站点与形状读数，不带正文 / 请求参数 / 文档本体", () => {
    // 按行取那一条 payload（`data: {}` 在这个文件里还有别的出处 —— 请求配置的默认值就是），
    // 找不到就是空串，下面第一条断言会红（indexOf 那类「-1 也算通过」的坑本仓踩过）
    const line = src.split("\n").find((l) => l.includes("data: { site: this.metadata.id")) ?? "";
    expect(line.length).toBeGreaterThan(0);
    expect(line).toContain("pages: pageShapes");
    for (const forbidden of ["responseText", "params", "dataDocument", "document.cookie"]) {
      expect(line).not.toContain(forbidden);
    }
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
    expect(src).toMatch(/try \{\s*\n\s*pageShapes\.push\(/);
  });
});
