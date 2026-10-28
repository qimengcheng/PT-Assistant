/**
 * 「可辅种扫描」面板上那一栏**搜索词**的接线判据（v0.129.0）。
 *
 * 为什么这一份单独存在：判据本体（折词、归一、词表参与新鲜期）住在
 * `tests/shared/reseedScanPlan.test.ts`，而那些断言全绿也证不了「界面上摆的词就是发出去的词」。
 * 这一族的坏形状恰好是「上游算好、下游拿去用」那一段断掉 —— 面板显示一份、`startReseedScan`
 * 发另一份，界面上看着都对，只有装机才看得出来。所以这里按源码文本钉**传参形状**，
 * 与 `taskReseedScanEntry.test.ts`、`settingsSearch.test.ts` 同一做法（vitest 是 node 环境，渲染不出来）。
 *
 * ⚠️ 读源码文本之前先归一换行符：工作区那份是 LF 还是 CRLF 只取决于最后一个存盘的编辑器。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const TYPES = read("src/shared/types/storages/reseedScan.ts");
const PLAN = read("src/shared/reseedScanPlan.ts");
const OFFSCREEN = read("src/entrypoints/offscreen/utils/reseedScan.ts");
const CANDIDATE_VIEW = read("src/options/views/Overview/MyClient/reseedCandidateView.ts");
const DIALOG = read("src/options/views/Overview/MyClient/ReseedScanDialog.vue");

describe("数据形状：两侧共用同一份声明，不许界面自己加一个键", () => {
  it("待扫的那一行与落库的那条结论都带 keywords", () => {
    expect(TYPES).toMatch(/keywords\?: string\[\];/);
    // 两处：target 那一处 + result 那一处
    expect((TYPES.match(/keywords\?: string\[\];/g) ?? []).length).toBe(2);
  });

  it("执行侧把发出去的那一份词表存进结论（不存就没人知道那句「未搜到」当时问的是什么）", () => {
    expect(OFFSCREEN).toMatch(/at: Date\.now\(\), keywords: \[\.\.\.keywords\] \}/);
  });
});

describe("界面取数：三层顺序（人改的 > 上次真查的 > 按名字折的）", () => {
  it("生效词表只经那份纯判据，且先取编辑、再取上次真查的那一份", () => {
    expect(DIALOG).toMatch(
      /reseedScanKeywordsOf\(\{\s*\n\s*name: target\.name,\s*\n\s*keywords: keywordEdits\.value\[target\.contentKey\] \?\? storedKeywords\.value\.get\(target\.contentKey\),/,
    );
  });

  it("「上次真查用的那一份」由那份纯判据整表折出，界面不自己扫一遍数组", () => {
    expect(DIALOG).toContain("reseedScanLastKeywordsByContent(results.value)");
    // 界面里不许出现第二个「按时间挑最新一条」的循环
    expect(DIALOG).not.toMatch(/results\.value\.filter\([^)]*\)\.sort\(/);
  });

  it("界面不重新实现折词：normalizeTitle 只住在判据那一份里", () => {
    expect(DIALOG).not.toContain("normalizeTitle");
    expect(PLAN).toContain("normalizeTitle(raw)");
  });
});

describe("排计划与发请求吃同一份词表（两处各折一套就是界面说的与站点收的不一致）", () => {
  it("plan 的 targets 逐条带上 keywordsOf(target)", () => {
    expect(DIALOG).toMatch(/targets: activeTargets\.value\.map\(\(target\) => \(\{ \.\.\.target, keywords: keywordsOf\(target\) \}\)\)/);
  });

  it("startReseedScan 的消息体也带 keywords（正向钉整段形状，只钉「没自己算」的那类断言抓不到漏接）", () => {
    const at = DIALOG.indexOf("async function startScan()");
    expect(at).toBeGreaterThan(-1);
    expect(DIALOG.slice(at, at + 1400)).toMatch(
      /knownSites: target\.knownSites,\s*\n\s*keywords: keywordsOf\(target\),/,
    );
  });
});

describe("面板的形状", () => {
  it("排在「开始扫描」那颗键之前：这一栏是点下去**之前**要能改的输入", () => {
    const panel = DIALOG.indexOf('class="reseed-scan__keywords"');
    const start = DIALOG.indexOf('t("MyClient.reseedScan.start")');
    expect(panel).toBeGreaterThan(-1);
    expect(start).toBeGreaterThan(panel);
  });

  it("每条内容那一排：摆的是没归一的那一份（正在输入的空行不许被吞），每一格走 :value + @update:value", () => {
    expect(DIALOG).toMatch(/v-for="\(term, index\) in termsOf\(target\)"/);
    expect(DIALOG).toMatch(/:value="term"/);
    expect(DIALOG).toMatch(/@update:value="\(value: string\) => setTerm\(target, index, value\)"/);
    // v-model 到函数调用的返回值编译不出 setter；这里必须是显式事件
    expect(DIALOG).not.toMatch(/v-model:value="termsOf\(/);
  });

  it("加一档 / 删一档 / 恢复默认三颗都在，且都在扫描中禁用", () => {
    expect(DIALOG).toMatch(/@click="addTerm\(target\)"/);
    expect(DIALOG).toMatch(/@click="removeTerm\(target, index\)"/);
    expect(DIALOG).toMatch(/v-if="isKeywordsEdited\(target\)"[\s\S]{0,120}@click="resetTerms\(target\)"/);
    expect((DIALOG.match(/:disabled="running"/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it("恢复默认写的是**显式**默认，不是删掉那一档（删了会退回上次真查用的那份，那句就没生效）", () => {
    expect(DIALOG).toMatch(/keywordEdits\.value = \{ \.\.\.keywordEdits\.value, \[target\.contentKey\]: reseedScanKeywords\(target\.name\) \}/);
  });

  it("词表空了要说一句：那一档不会发查询，不许悄悄退回默认折法", () => {
    expect(DIALOG).toMatch(/v-if="keywordsOf\(target\)\.length === 0"/);
    expect(DIALOG).toContain("MyClient.reseedScan.keywords.noTerms");
  });

  it("批量那一档只先摆几条，其余走一句显式的展开（全铺会把结果表挤出弹窗）", () => {
    expect(DIALOG).toMatch(/const KEYWORD_PREVIEW = \d+;/);
    expect(DIALOG).toMatch(/activeTargets\.value\.slice\(0, KEYWORD_PREVIEW\)/);
    expect(DIALOG).toMatch(/activeTargets\.length > KEYWORD_PREVIEW/);
  });

  it("面板跟着当前范围走：两个入口（我的下载器 / 辅种任务那一行）都自动有这一栏", () => {
    expect(DIALOG).toMatch(/v-if="activeTargets\.length" class="reseed-scan__keywords"/);
    expect(DIALOG).toMatch(/shownKeywordTargets[\s\S]{0,40}target\.contentKey/);
  });

  it("关掉面板不留没发出去的改动", () => {
    const at = DIALOG.indexOf("async function onOpen()");
    expect(at).toBeGreaterThan(-1);
    expect(DIALOG.slice(at, at + 400)).toContain("keywordEdits.value = {};");
  });
});

describe("结果表里那句「待重查」", () => {
  it("行的新旧由那份纯判据定，界面不再比一次词表", () => {
    expect(DIALOG).toMatch(/!isReseedScanRowCurrent\(item, \{ name: target\.name, keywords: keywordsOf\(target\) \}\)/);
  });

  it("两枚标记竖向排（横着挂会把这张 auto 布局的表整个撑宽）", () => {
    expect(DIALOG).toMatch(/<div class="reseed-scan__verdict">/);
    expect(DIALOG).toMatch(/\.reseed-scan__verdict \{\s*\n\s*display: flex;\s*\n\s*flex-direction: column;/);
    expect(DIALOG).toMatch(/v-if="isStaleRow\(record\)"/);
    expect(DIALOG).toContain("MyClient.reseedScan.keywords.stale");
  });
});

describe("「我的下载器」那一侧的标记共用这一维", () => {
  it("取数走那份纯判据的最新词表，并带内容名（老记录没存词表时要按当时的折法算）", () => {
    expect(CANDIDATE_VIEW).toMatch(/reseedScanLastKeywordsByContent\(results\)/);
    expect(CANDIDATE_VIEW).toMatch(/lastTerms\.get\(contentKey\)\s*\?\?\s*reseedScanKeywords\(name\)/);
    expect(CANDIDATE_VIEW).toMatch(/isReseedScanFresh\(item, now, undefined, queryOf\(item\.contentKey\)\)/);
  });

  it("内容键 → 名字那份表由行本身折出（结论里只有键、没有名字）", () => {
    expect(CANDIDATE_VIEW).toMatch(/function nameOfContent\(rows: IReseedRow\[\]\): Map<string, string>/);
    expect(CANDIDATE_VIEW).toMatch(/scanFactsByContent\(scan\.results, scan\.now, nameOfContent\(rows\)\)/);
  });
});
