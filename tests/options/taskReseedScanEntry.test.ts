/**
 * 辅种任务页那颗「查其他站点有没有这条」的**接线**判据。
 *
 * 为什么这一份单独存在（纯判据那边已经有 `tests/shared/reseedScanPlan.test.ts` 14 条）：
 * 判据写得再对，只要调用点没接上，界面上就什么都不会发生，而那在 Node 断言里是**隐形**的 ——
 * v0.110.4 那条「只测纯函数不够，要真跑 `getAllTorrents()`」记的就是同一件事。
 * 这里不 import 组件（vitest 是 node 环境、渲染不出来），按源码文本钉形状，
 * 与 `settingsSearch.test.ts`、`levelPanelBox.test.ts` 同一做法。
 *
 * ⚠️ 读源码文本之前先归一换行符：工作区那份是 LF 还是 CRLF 只取决于最后一个存盘的编辑器。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) =>
  readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const MESSAGES = read("src/messages.ts");
const OFFSCREEN = read("src/entrypoints/offscreen/utils/reseedScan.ts");
const PAGE = read("src/options/views/Overview/KeepUploadTask/Index.vue");
const DIALOG = read("src/options/views/Overview/MyClient/ReseedScanDialog.vue");

describe("消息契约：一条消息、两侧都在", () => {
  it("协议里声明了 resolveReseedScanTarget，且入参形状带 seed 与 downloaderIds", () => {
    expect(MESSAGES).toMatch(/resolveReseedScanTarget\(data: \{ seed: IReseedScanSeed; downloaderIds: string\[\] \}\)/);
  });

  it("offscreen 侧真的注册了这条消息，并调那份纯判据（不是自己再折一套键）", () => {
    const at = OFFSCREEN.indexOf('onMessage("resolveReseedScanTarget"');
    expect(at).toBeGreaterThan(-1);
    expect(OFFSCREEN.slice(at, at + 400)).toContain("reseedScanTargetOfSeed(");
  });

  it("一轮扫描与这一跳共用同一个读索引的入口（两处各读各的就会各拿一份快照）", () => {
    const calls = OFFSCREEN.match(/await readLocalEntries\(/g) ?? [];
    expect(calls.length).toBe(2);
    expect(OFFSCREEN).toMatch(/async function readLocalEntries\(downloaderIds: readonly string\[\]/);
    // 不许有人把那份循环在 runRound 里再抄一遍
    expect(OFFSCREEN.match(/getLocalFingerprintIndex\(/g) ?? []).toHaveLength(1);
  });
});

describe("清除缓存：确认框说什么就删什么", () => {
  it("消息要求传 contentKeys，处理器不再整表 clear", () => {
    expect(MESSAGES).toMatch(/clearReseedScanCache\(data: \{ contentKeys: string\[\] \}\)/);
    const at = OFFSCREEN.indexOf('onMessage("clearReseedScanCache"');
    expect(at).toBeGreaterThan(-1);
    const body = OFFSCREEN.slice(at, at + 700);
    expect(body).toContain("data.contentKeys");
    expect(body).not.toContain('.clear("reseed_scan")');
  });

  it("调用点把传进去的那批键原样交给消息（不是重新数一遍）", () => {
    const at = DIALOG.indexOf("async function clearCache()");
    expect(at).toBeGreaterThan(-1);
    expect(DIALOG.slice(at, at + 600)).toMatch(/clearReseedScanCache", \{ contentKeys: \[\.\.\.keys\] \}/);
  });
});

describe("辅种任务页：那颗键与它开起来的那一屏", () => {
  it("页面用那份纯判据折线索，不在界面里自己拼内容键", () => {
    expect(PAGE).toContain("reseedScanSeedOfTask(task)");
    // 界面侧不许出现「自己算一个 contentKey」的那条路
    expect(PAGE).not.toContain("reseedScanContentKey");
  });

  it("任务行那一格是 6 颗图标键、全部走 #icon（加一颗就要重量列宽，这条是绊线）", () => {
    const from = PAGE.indexOf('<a-space v-if="record.kind === \'task\'"');
    const to = PAGE.indexOf("<a-space v-else", from);
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    const block = PAGE.slice(from, to);
    expect((block.match(/<template #icon>/g) ?? []).length).toBe(6);
    expect(block).toContain("<ScanOutlined />");
    expect(block).toContain("openReseedScan(record.task)");
  });

  it("操作列那一档宽度与那 6 颗同源：颗数或宽度单独动一条都会红（164 是台架量出来的）", () => {
    expect(PAGE).toMatch(/key: "action",[\s\S]{0,900}?width: 164,/);
  });

  it("扫描目标整份用消息回的那一份，memberKeys 也取它的 contentKey（界面不许另折一个键）", () => {
    // 这一条钉的是「对回本地」那一跳有没有真落地：界面要是自己按任务的标题/大小折，
    // 判据那侧全绿、界面上也看不出来，坏的是与「我的下载器」互不复用 + 到不了「确有这条」
    expect(PAGE).toMatch(
      /targets: \[\{ \.\.\.resolvedTarget\.target, memberKeys: \[resolvedTarget\.target\.contentKey\] \}\]/,
    );
  });

  it("面板挂在根级（弹窗不参与 .page 网格），并明确「只查不建」与本地有没有对回来", () => {
    expect(PAGE).toMatch(/<ReseedScanDialog[\s\S]{0,400}:query-only="true"/);
    expect(PAGE).toMatch(/<ReseedScanDialog[\s\S]{0,400}:resolved="scanResolved"/);
    expect(PAGE).toMatch(/<ReseedScanDialog[\s\S]{0,400}:usable-sites="scanUsableSites"/);
  });

  it("目标站口径与「我的下载器」那一屏同一份判据（已添加且没标离线）", () => {
    expect(PAGE).toContain("isOffline !== true");
  });
});

describe("面板那一侧：复用不许把另一屏的行为带坏", () => {
  it("只有一档范围时不摆那排按钮", () => {
    expect(DIALOG).toMatch(/<a-radio-group v-if="props\.scopes\.length > 1"/);
  });

  it("一键辅种那颗键与它下面那句原因都跟着 queryOnly", () => {
    expect(DIALOG).toMatch(/<HoverTip v-if="!props\.queryOnly" :text="t\('MyClient\.reseedScan\.reseedTip'\)"/);
    expect(DIALOG).toMatch(/v-if="!props\.queryOnly && handoffWhy"/);
    expect(DIALOG).toMatch(/if \(props\.queryOnly\) return;\r?\n\s*\/\/ 拿不到就当没有重复/);
  });

  it("bases 改成可选：两处调用点都得兜住空", () => {
    expect(DIALOG).toMatch(/bases\?: IReseedHandoffBase\[\]/);
    expect((DIALOG.match(/props\.bases \?\? \[\]/g) ?? []).length).toBe(2);
  });

  it("本地没对回来时那句只在明确 false 时出现（没传 = 不说，别给「我的下载器」那一屏添一句）", () => {
    expect(DIALOG).toMatch(/v-if="props\.resolved === false"/);
    expect(DIALOG).toContain("MyClient.reseedScan.localMissing");
  });
});
