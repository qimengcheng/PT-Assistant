/**
 * 「可选的辅种组合」那一列显示主标题还是副标题（用户 2026-11-06：「这一列全是英文，能不能有个
 * 开关切换显示副标题」，拍的是「切换整列 + 持久化」）。
 *
 * 判据本体在 `src/options/views/Overview/SearchEntity/reseedGroupCellText.ts`。下面那族**按源码文本**
 * 钉接线，因为纯函数全绿证不了界面上用的是它的产出（同 `reseedScanKeywordUi.test.ts` 那条教训：
 * 「上游算好、下游拿去用」这一段断掉时，判据侧一条都不红）。
 *
 * ⚠️ 读源码文本之前先归一换行符：工作区那份是 LF 还是 CRLF 只取决于最后一个存盘的编辑器。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { reseedGroupCellText, type IReseedGroupTextRow } from "@/options/views/Overview/SearchEntity/reseedGroupCellText.ts";

const read = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const DIALOG = read("src/options/views/Overview/SearchEntity/ReseedGroupDialog.vue");
const SEARCH_INDEX = read("src/options/views/Overview/SearchEntity/Index.vue");
const CONFIG_TYPE = read("src/shared/types/storages/config.ts");
const CONFIG_STORE = read("src/options/stores/config.ts");

/** 两条各站自己写的名字：一条报得出副标题、一条报不出 */
const row = (title: string, subTitle?: unknown): IReseedGroupTextRow => ({ title, subTitle });

describe("那一列显示什么字", () => {
  it("开关关掉 → 主标题，取组里第一条（有副标题也不显示，这是「切换」不是「追加」）", () => {
    expect(reseedGroupCellText([row("All Wishes Come True 2026 2160p", "八仙之瞒天过海")], false)).toBe(
      "All Wishes Come True 2026 2160p",
    );
  });

  it("开关打开 → 副标题", () => {
    expect(reseedGroupCellText([row("Silent Honor 2025 S01 2160p", "沉默的荣耀 全39集")], true)).toBe(
      "沉默的荣耀 全39集",
    );
  });

  /**
   * 这一条是整族里最容易写错的一档：一组里各站解析能力不同（只有部分站点定义解析 subTitle），
   * 固定取第一条就会让「第一条恰好落在没报出的那一站」时那一格空白。
   */
  it("开关打开、第一条没报副标题 → 用后面那条报得出的，不固定取第一条", () => {
    const rows = [row("A 2026 1080p"), row("A 2026 2160p", "中文名 全10集"), row("A 2026 4K", "另一个站写的")];
    expect(reseedGroupCellText(rows, true)).toBe("中文名 全10集");
  });

  it("开关打开、整组一条都没报出 → 退回主标题，那一格不许空白", () => {
    const rows = [row("Guarding JieFangXi S06 2025 1080p"), row("Guarding JieFangXi S06 2025 2160p")];
    expect(reseedGroupCellText(rows, true)).toBe("Guarding JieFangXi S06 2025 1080p");
  });

  it("空串 / 纯空格 / null / undefined / 非字符串都算「这一站没报副标题」", () => {
    for (const empty of ["", "   ", null, undefined, 0, {}, []]) {
      expect(reseedGroupCellText([row("Main Title", empty)], true), `副标题 = ${JSON.stringify(empty)}`).toBe(
        "Main Title",
      );
    }
  });

  it("副标题两头空白去掉，界面那一格不会出现前导空格", () => {
    expect(reseedGroupCellText([row("Main", "  中文名  ")], true)).toBe("中文名");
  });

  it("主标题也照原样 trim（关掉开关那一档同样不许带空白）", () => {
    expect(reseedGroupCellText([row("  Main Title  ")], false)).toBe("Main Title");
  });

  /** 传进来的组为空是数据侧的事，判据不许因此抛 —— 这一屏打开时父组件给的是快照 */
  it("空组返回空串而不是抛", () => {
    expect(reseedGroupCellText([], true)).toBe("");
    expect(reseedGroupCellText([], false)).toBe("");
  });

  it("条目本身缺字段（null 混在数组里）不抛", () => {
    const rows = [null as unknown as IReseedGroupTextRow, row("Second", "第二条的中文名")];
    expect(reseedGroupCellText(rows, true)).toBe("第二条的中文名");
  });
});

describe("接线：那一列真的走上面那份判据", () => {
  it("界面只经 reseedGroupCellText 取那一列，不自己拼 items[0].title", () => {
    expect(DIALOG).toContain("reseedGroupCellText(group.items, showSubtitle.value)");
    expect(DIALOG).not.toMatch(/items\[0\]\?\.title/);
  });

  it("那一格与截断浮层读的是同一个数（浮层揭示的不是另一种写法）", () => {
    expect((DIALOG.match(/rowOf\(record\)\.text/g) ?? []).length).toBe(2);
    expect(DIALOG).not.toContain("rowOf(record).title");
  });

  it("开关写的是那颗持久化设置，并且当场保存", () => {
    expect(DIALOG).toMatch(/get: \(\) => configStore\.searchEntifyControl\.reseedGroupsShowSubtitle/);
    expect(DIALOG).toMatch(/configStore\.searchEntifyControl\.reseedGroupsShowSubtitle = value;\s*\n\s*configStore\.\$save\(\);/);
  });

  it("那颗开关挂在弹窗自己的说明条那一行，不在 #title 里（标题栏没有内衬）", () => {
    expect(DIALOG).toMatch(/class="intro-row"/);
    expect(DIALOG).toMatch(/v-model:checked="showSubtitle"/);
  });
});

describe("那颗开关不许冒进搜索页的「显示偏好」面板", () => {
  /**
   * 那一排的键是 `Object.keys(searchEntifyControl)` 现筛的，所以往这份对象里加布尔键
   * **默认就会出现在面板上** —— 而它的文案键在 `SearchEntity.index.` 那一族里，没有就会
   * 把键路径画进界面（防线 ③ 看不见这种动态拼出来的键）。
   */
  it("新键点名在类型 Exclude 与那份排除表里各写了一次", () => {
    expect(SEARCH_INDEX).toMatch(/"limitTorrentTitleTdWidth" \| "reseedGroupsShowSubtitle"/);
    /**
     * 排除表要按「数组里的一项」认，不能只 `toContain` 那串字面量 —— 把那一行整行注释掉，
     * 字面量还在串里（反证 ⑭ 第一趟就是这么漏的），而运行时它已经不挡了。
     */
    const arrText =
      (SEARCH_INDEX.match(/const hiddenDisplayPreferenceKeys[^=]*=[\s\S]*?\[([\s\S]*?)\];/) ?? [])[1] ?? "";
    const codeOnly = arrText
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    const keys = [...codeOnly.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(keys).toContain("reseedGroupsShowSubtitle");
  });

  /** 同理按行首认：整行注释掉的那种写法，子串断言认不出来 */
  it("类型与默认值两边都有这一键（少一边 vue-tsc 就红，也少一边存量读出来是 undefined）", () => {
    expect(CONFIG_TYPE).toMatch(/^\s{4}reseedGroupsShowSubtitle: boolean;/m);
    expect(CONFIG_STORE).toMatch(/^\s{6}reseedGroupsShowSubtitle: false,/m);
  });
});

describe("界面文案", () => {
  it("中英两侧都有那颗开关的名字和那句说明", () => {
    const readLocale = (f: string) =>
      JSON.parse(readFileSync(new URL(`../../src/locales/${f}`, import.meta.url), "utf8")).SearchEntity.reseedGroups;
    const zh = readLocale("zh_CN.json");
    const en = readLocale("en.json");
    for (const key of ["showSubtitle", "showSubtitleTip"]) {
      expect(typeof zh[key], `zh_CN 缺 SearchEntity.reseedGroups.${key}`).toBe("string");
      expect(typeof en[key], `en 缺 SearchEntity.reseedGroups.${key}`).toBe("string");
      expect(zh[key].length, `${key} 中文案不许是空串`).toBeGreaterThan(0);
    }
  });
});
