import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * 「下载失败要说得出停在哪一步」这一屏的接线对账。
 *
 * 为什么按源码文本断言而不是 import 组件：那些键名是 `DOWNLOAD_FAIL_KEYS` 表里的**字符串字面量**，
 * 不是 `t("…")` 的直接实参 —— 防线③只查后者，写错一个键名它看不见，界面表现是
 * 「这一格直接把键路径画出来」或「回落成那句笼统的失败」（AGENTS §3.4）。
 * 判据本体（哪一档对应哪个码）住在 `@/shared/updatePackage.ts`，那份有行为断言；
 * 这里只钉「界面把每一档都接上了、两侧语言都有这句话」。
 */
const VUE = fileURLToPath(new URL("../../src/options/views/Settings/SetBase/UpdateWindow.vue", import.meta.url));
const ZH = fileURLToPath(new URL("../../src/locales/zh_CN.json", import.meta.url));
const EN = fileURLToPath(new URL("../../src/locales/en.json", import.meta.url));

/**
 * 归一换行符：工作区那一份是 LF 还是 CRLF 取决于最后一个存盘的编辑器，而这里钉的是源码形状。
 * `[\s\S]*?\n\}` 那一族本来就能吃下 `\r\n`，归一是为了不让某一条改成显式 `\n` 时静默空转。
 */
const readText = (file: string) => readFileSync(file, "utf8").replace(/\r\n/g, "\n");

const page = readText(VUE);
const zh = JSON.parse(readFileSync(ZH, "utf8"));
const en = JSON.parse(readFileSync(EN, "utf8"));

/** 那张表的值：`noDigest: "SetUpdate.downloadFail.noDigest"` 这一族的键名 */
const table = /const DOWNLOAD_FAIL_KEYS: Record<string, string> = \{([\s\S]*?)\n\};/.exec(page);
const keys = [...(table?.[1] ?? "").matchAll(/"SetUpdate\.[^"]+"/g)].map((m) => m[0].slice(1, -1));

/** 两侧 locale 都按点号路径读一遍 */
function pick(dict: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, seg) => (acc as Record<string, unknown>)?.[seg], dict);
}

describe("失败原因的键表", () => {
  it("表在读得到（锚点没被模板改动打断）", () => {
    expect(table, "找不到 DOWNLOAD_FAIL_KEYS 那一段").toBeTruthy();
  });

  it("七档一条不缺：判据新增一档而界面没接上，就会在这一条变红", () => {
    expect(keys.map((k) => k.split(".").pop()).sort()).toEqual(
      ["allSources", "digest", "noDigest", "notZip", "save", "size", "untrusted"].sort(),
    );
  });

  it("每一把键在 zh 与 en 两侧都真的有这句话（防线③看不见表里的字符串字面量）", () => {
    for (const key of keys) {
      expect(pick(zh, key), `zh 缺 ${key}`).toBeTypeOf("string");
      expect(pick(en, key), `en 缺 ${key}`).toBeTypeOf("string");
    }
  });

  it("校验结论那句带占位符，而调用点真传了参", () => {
    expect(pick(zh, "SetUpdate.download.verified")).toContain("{source}");
    expect(pick(en, "SetUpdate.download.verified")).toContain("{source}");
    expect(page).toContain('t("SetUpdate.download.verified", { source: s.downloadSource })');
  });

  it("码表里不许出现动态拼键（那种写法防线③与 vue-tsc 都看不见）", () => {
    expect(table?.[1] ?? "").not.toMatch(/`SetUpdate/);
  });

  it("回落到那句笼统的失败只发生在「码表里没有这一档」时", () => {
    expect(page).toMatch(/DOWNLOAD_FAIL_KEYS\[s\.downloadFailCode\] \?\? "SetUpdate\.download\.failed"/);
  });
});

/**
 * 后台那一路的接线（按源码文本钉）。
 *
 * 为什么在这儿钉而不是只靠纯函数用例：`noDigest` / `untrustedDigest` 这两道闸在判据里改坏了
 * 用例会红，但**调用方把 `from` 写死成 `"github"`** 判据就永远不会走到那一档，Node 断言一个字
 * 都不红 —— 与 v0.109.6「子行不参与在纯函数层反证不了」、v0.114.2「offscreen 那三行接线反证不了」
 * 同一族。本轮真犯过的另一处（拿摘要串的头当文件头）也只有这种断言抓得到。
 */
describe("后台那一路的接线", () => {
  const sw = readText(fileURLToPath(new URL("../../src/entrypoints/background/utils/updateCheck.ts", import.meta.url)));
  const at = (needle: string) => sw.indexOf(needle);

  it("校验吃的 `from` 必须是现场那份摘要来源，不许写死成 github", () => {
    expect(at("from: state.digestFrom")).toBeGreaterThan(-1);
    expect(sw).not.toMatch(/from:\s*"github"/);
  });

  it("「是不是 zip」吃的是文件头那几个字节，不是算出来的摘要", () => {
    expect(at("head: buffer.subarray(0, 4)")).toBeGreaterThan(-1);
  });

  it("摘要缺失 / 来自镜像这两道闸都在，且在开始取字节之前", () => {
    for (const guard of ['if (!state.assetSha256)', 'if (state.digestFrom !== "github")']) {
      expect(at(guard), `找不到那道闸：${guard}`).toBeGreaterThan(-1);
    }
    const fetchAt = at("const candidates = updatePackageCandidates(");
    expect(fetchAt).toBeGreaterThan(-1);
    expect(at("if (!state.assetSha256)")).toBeLessThan(fetchAt);
    expect(at('if (state.digestFrom !== "github")')).toBeLessThan(fetchAt);
  });

  it("没验过的字节不许交给下载管理器：download() 排在 verified 判定之后", () => {
    const downloadAt = at("await chrome.downloads.download(");
    const verifiedAt = at("if (!verified)");
    expect(verifiedAt).toBeGreaterThan(-1);
    expect(downloadAt).toBeGreaterThan(-1);
    expect(verifiedAt).toBeLessThan(downloadAt);
  });

  it("每档各自起表：那次计时器必须排在逐档循环的里面（共一份就会被前一档卡死拖垮后两档）", () => {
    const loopAt = at("for (const url of candidates)");
    const controllerAt = at("new AbortController()");
    expect(loopAt).toBeGreaterThan(-1);
    expect(controllerAt).toBeGreaterThan(-1);
    expect(loopAt).toBeLessThan(controllerAt);
  });
});
