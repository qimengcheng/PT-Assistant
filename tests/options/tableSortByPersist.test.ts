/**
 * 「该写进持久化的那一份 sortBy」的判据（本体在 `src/options/components/tableSorters.ts`
 * 的 `nextSortByOf`，这里不抄第二份实现）。
 *
 * 用户 2026-10-31 报的是：「我的数据」那一列**多点几次排序就失效了，再点就没有反应**。
 * 根因是取消排序没落地 —— 列带受控 `sortOrder`，而库里那份永远停在 descend，
 * 于是表头的下一档永远算成「取消排序」，而取消又永远写不进去，那一列就此点不动。
 * 端到端的证据在台架 `.tmp-build/bench-sortlock`（改前那份是 `git show HEAD:` 拷来的真身，
 * 四栏并排各点四下：改前两栏第③④下读数一字不差，改后第③下清空、第④下回到升序）。
 * 这里钉的是那条判据本身对**每一种输入形状**分别给什么。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import type { TableSorterResult } from "@zboson/ui";

import { nextSortByOf, type TColumnSort } from "@/options/components/tableSorters.ts";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

/** src 下所有 .ts / .vue（台架与构建产物不在里面，不用排除） */
function walk(dirRel: string): string[] {
  const abs = join(repoRoot, dirRel);
  const out: string[] = [];
  for (const name of readdirSync(abs)) {
    const full = join(abs, name);
    if (statSync(full).isDirectory()) out.push(...walk(join(dirRel, name)));
    else if (/\.(ts|vue)$/.test(name)) out.push(join(dirRel, name).replaceAll("\\", "/"));
  }
  return out;
}

const S = (o: Partial<TableSorterResult>) => o as TableSorterResult;
const ONE: TColumnSort[] = [{ key: "bonusPerHour", order: "desc" }];

describe("取消排序必须写空数组（本次修的就是这一档）", () => {
  it("rc-table 取消时递回来的那一份（order 与 columnKey 都被它显式置空）⇒ 折成 []，不是「不写」", () => {
    // 这就是 generateSorterInfo 在「一个活跃排序都没有但排序列非空」时递出来的形状
    const cancelled = S({ column: undefined, order: undefined, field: undefined, columnKey: undefined });
    expect(nextSortByOf(cancelled, ONE)).toEqual([]);
  });

  it("多列全取消（数组里每一项都没 order）⇒ 同样折成 []", () => {
    expect(nextSortByOf([S({ order: undefined, columnKey: "a" }), S({ order: undefined, columnKey: "b" })], ONE)).toEqual([]);
  });

  it("压根没递 sorter（undefined / null）⇒ 不写：没报排序不等于报「清空」", () => {
    expect(nextSortByOf(undefined, ONE)).toBeNull();
    expect(nextSortByOf(null as unknown as TableSorterResult, ONE)).toBeNull();
  });
});

describe("折法", () => {
  it("ascend / descend 各折成 asc / desc", () => {
    expect(nextSortByOf(S({ order: "ascend", columnKey: "bonusPerHour" }), [])).toEqual([{ key: "bonusPerHour", order: "asc" }]);
    expect(nextSortByOf(S({ order: "descend", columnKey: "bonusPerHour" }), [])).toEqual([{ key: "bonusPerHour", order: "desc" }]);
  });

  it("columnKey 是数字也要落成字符串（持久化与列 key 同一种形状，否则 sortOrderOf 找不回来）", () => {
    expect(nextSortByOf(S({ order: "ascend", columnKey: 7 }), [])).toEqual([{ key: "7", order: "asc" }]);
  });

  it("没带 columnKey 的那一项不算排序（只有 order 是半截信息）", () => {
    expect(nextSortByOf(S({ order: "ascend", columnKey: undefined }), ONE)).toEqual([]);
  });

  it("单列档只取第一条，多列档全留", () => {
    const two = [S({ order: "ascend", columnKey: "a" }), S({ order: "descend", columnKey: "b" })];
    expect(nextSortByOf(two, [], { multiSort: false })).toEqual([{ key: "a", order: "asc" }]);
    expect(nextSortByOf(two, [], { multiSort: true })).toEqual([
      { key: "a", order: "asc" },
      { key: "b", order: "desc" },
    ]);
  });
});

describe("「不写」只留给「排序压根没变」", () => {
  it("折出来与场上那份逐列相同 ⇒ null（翻页 / 改每页条数也带着当前排序回来，别每次落盘）", () => {
    expect(nextSortByOf(S({ order: "descend", columnKey: "bonusPerHour" }), ONE)).toBeNull();
    expect(nextSortByOf(S({ order: undefined, columnKey: undefined }), [])).toBeNull();
  });

  it("同一批列换了先后算「变了」：要写回去（持久化的顺序就是多列排序的优先级）", () => {
    const current: TColumnSort[] = [
      { key: "a", order: "asc" },
      { key: "b", order: "asc" },
    ];
    expect(nextSortByOf([S({ order: "ascend", columnKey: "b" }), S({ order: "ascend", columnKey: "a" })], current, { multiSort: true })).toEqual([
      { key: "b", order: "asc" },
      { key: "a", order: "asc" },
    ]);
  });

  it("同一列从降翻回升算「变了」，且只有这一列（不许把旧的留着）", () => {
    expect(nextSortByOf(S({ order: "ascend", columnKey: "bonusPerHour" }), ONE)).toEqual([{ key: "bonusPerHour", order: "asc" }]);
  });

  it("换到另一列 ⇒ 那一列独占（单列档）", () => {
    expect(nextSortByOf(S({ order: "ascend", columnKey: "bonus" }), ONE)).toEqual([{ key: "bonus", order: "asc" }]);
  });
});

/**
 * 接线：判据写对了 ≠ 调用点用的是它的产出（v0.109.0 / v0.117.0 那两条同族教训）。
 * `useTableBehavior` 要吃 `nextSortByOf` 的结果、并且**只在它给 null 时**才不写。
 * 按源码文本钉（这一层要跑起来得配 pinia + chrome.storage，不值得为它搭运行时）。
 */
describe("接线", () => {
  // 本仓工作区的换行符不是常量（core.autocrlf + 有的会话直接写 LF），读源码文本先归一化
  const readText = (rel: string) => readFileSync(join(repoRoot, rel), "utf8").replace(/\r\n/g, "\n");

  it("useTableBehavior 把排序那一整段交给 nextSortByOf，并且判的是「null 才不写」", () => {
    const src = readText("src/options/directives/useTableBehavior.ts");
    expect(src).toContain("nextSortByOf(sorter, sortBy.value, { multiSort })");
    expect(src).toContain("if (resolved === null) return;");
    expect(src).toContain('configStore.updateTableBehavior(tableKey, "sortBy", resolved)');
  });

  it("那个「取消要不要写」的开关整个不存在了（它只有「留着 bug」这一档）", () => {
    const hits = walk("src").filter((rel) => readText(rel).includes("clearOnEmpty"));
    expect(hits).toEqual([]);
  });

  it("三页受控接线仍在（正是它让「不写空」变成永久锁死，别把它当成修法撤掉）", () => {
    expect(readText("src/options/views/Overview/MyData/Index.vue")).toContain("buildSortOrderMap(sortBy.value)");
    expect(readText("src/options/views/Overview/DownloadHistory/Index.vue")).toContain('sortOrder: sortOrderOf("downloadAt")');
    expect(readText("src/options/views/Overview/SearchEntity/SnapshotManagerDialog.vue")).toContain('sortOrder: sortOrderOf("name")');
  });
});
