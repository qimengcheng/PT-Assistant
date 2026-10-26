/**
 * 表格行底那三档 CSS 的形状断言（v0.127.2：我方那条全站斑马纹删掉，改用 @zboson/ui 自带那档）。
 *
 * 为什么用源码文本而不是行为断言：这三件事全在样式表里，Node 里没有渲染，能钉的只有"规则在不在"。
 * 而它们每一条都对应一次真实的返工：
 *  · 我方那条（第 1/3/5 行 td 实色 #fafafa）已由用户 2026-10-26 一句
 *    「zboson的表格已经自带斑马线了,把你之前自己另外加的斑马线删掉吧」删掉。
 *    台架 .tmp-build/bench-zebra 量过：fork 自带那条在**第 2/4/6 行的 `<tr>`** 上，
 *    是两层 45° / −45° 斜纹（`@zboson/ui/dist/table/style/yon.js:31`，无条件生成），
 *    最深一档 alpha 0.02 ⇒ 白底上合成约 #fbfbfb；我方那条是 td 上的 #fafafa。
 *    两条同时在场的界面不是"一套斑马纹"，是奇偶两档各一种纹理 —— 所以不许有人"顺手补回来"。
 *  · 下面那两条悬停规则仍然要留着：fork 的条纹落在 `<tr>`，而 antd 的悬停/选中底色落在 `<td>`，
 *    悬停那一档只有写在 td 上才一定盖得住行底（v0.37.4 的教训就是条纹放 tr 时被悬停整行盖掉）。
 *  · options 与 content 是两份样式表（影域读不到对面那份），判据要求两处**同改**。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 工作区换行符不是常量（core.autocrlf），按源码文本判形状一律先归一化；
 * 再把 `/* … *\/` 注释整段剥掉 —— 判的是**规则**，不是散文。
 * 这一步不是洁癖：本仓那条「注释里的反例把扫描喂成假结果」在这里照样成立，
 * 而我这一轮的文件头注释里就逐字写着那条被删掉的选择器（不剥注释，第一条判据会因为它报红）。
 */
const read = (f: string) =>
  readFileSync(fileURLToPath(new URL(f, import.meta.url)), "utf8").replace(/\r\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "");

const OPTIONS = read("../../src/entrypoints/options/style.css");
const CONTENT = read("../../src/content-script/app/app.css");

/** 我方那条奇数行条纹的写法（`odd` 与 `2n+1` 都算 —— CSSOM 会把它序列化回 2n+1） */
const ODD_TD_STRIPE = /nth-of-type\((?:odd|2n\+1)\)\s*>?\s*td/;

describe("表格行底", () => {
  it("options 那份里没有我方那条奇数行条纹（已交给 fork 自带那档）", () => {
    expect(OPTIONS).not.toMatch(ODD_TD_STRIPE);
  });

  it("content 那份里也没有（两份样式表同判据、要同改）", () => {
    expect(CONTENT).not.toMatch(ODD_TD_STRIPE);
  });

  it("把 antd 那个 JS 悬停类改透明的规则两份都还在", () => {
    for (const [name, css] of [["options", OPTIONS], ["content", CONTENT]] as const) {
      expect(css, name).toContain("td.ant-table-cell-row-hover");
    }
  });

  it("悬停底色自己落在 td 上（不是 tr）—— 落 tr 就压不住、也会把行底整行盖掉", () => {
    for (const [name, css] of [["options", OPTIONS], ["content", CONTENT]] as const) {
      const at = css.indexOf("tr.ant-table-row:not(.ant-table-row-selected):hover");
      expect(at, `${name} 那条 CSS :hover 悬停规则不见了`).toBeGreaterThan(-1);
      expect(css.slice(at, at + 120), name).toContain("> td");
    }
  });
});
