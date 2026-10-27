/**
 * 「我的下载器」同内容副本折叠的判据（`src/options/views/Overview/MyClient/reseedGroups.ts`）。
 *
 * 为什么要单独一份断言，而不是靠开浏览器点一遍：这一页的行来自 8 个下载器，
 * 各家报出的 `name` / `savePath` / `totalSize` / `infoHash` 形状都不一样（Aria2 不报添加时间、
 * 旧辅种任务没记 infoHash），而折叠判据一旦放宽就会**把一条他需要看见的种子藏掉** ——
 * 折叠态下那几条根本不在列表里，界面上没有任何痕迹，只有事后才发现。
 * 所以「什么才算同一份」必须能当场跑：用户 2026-10-13 给的口径是两层
 * （① 在辅种任务台账里的按台账并；② 不在台账里的按 下载器 + 名称 + 大小 + 保存路径 四项全等并，
 * 他那句原话是「没有出现在辅种任务里面，但是路径文件大小名字全都一样的也要折叠」），
 * 这里把它逐条钉住，含「少一项不许并」和「跨下载器不许并」这两条反面用例。
 */
import { describe, expect, it } from "vitest";

import {
  assignGroups,
  buildTaskGroups,
  clampUnitPage,
  collapseGroups,
  contentFingerprint,
  groupSiblingsOf,
  type IRowForGroup,
  sliceUnitsToPage,
} from "@/options/views/Overview/MyClient/reseedGroups.ts";

/** 一行。默认值就是截图里那批「藏经阁 1004CD」的形状 */
function row(over: Partial<IRowForGroup> & { key: string }): IRowForGroup {
  return {
    clientId: "qb-1",
    name: "藏经阁 1004CD 合集",
    totalSize: 1_818_682_368,
    savePath: "/data/downloads/藏经阁",
    ...over,
  };
}

/**
 * 只断言「组身份」，不断言组键长什么样：内容指纹那批键里嵌着指纹原文，
 * 把它换成按出现顺序编号的别名，用例才不会跟着分隔符、字段顺序这类实现细节漂。
 */
function groupsOf(rows: IRowForGroup[], taskByHash = new Map<string, string>()): (string | null)[] {
  const map = assignGroups(rows, taskByHash);
  const alias = new Map<string, string>();
  for (const group of map.values()) {
    if (group === null) continue;
    if (!alias.has(group)) alias.set(group, `G${alias.size + 1}`);
  }
  return rows.map((r) => {
    const g = map.get(r.key);
    return g ? alias.get(g)! : null;
  });
}

describe("buildTaskGroups：辅种任务台账 → infoHash", () => {
  it("items 与基准那条都算同一个任务组", () => {
    const map = buildTaskGroups([{ id: "task-1", items: [{ hash: "AAA" }, { hash: "BBB" }], baseLocal: { hash: "CCC" } }]);
    expect([...map.entries()].sort()).toEqual([
      ["aaa", "t:task-1"],
      ["bbb", "t:task-1"],
      ["ccc", "t:task-1"],
    ]);
  });

  it("哈希统一小写并去空白：各家报的大小写不固定", () => {
    const map = buildTaskGroups([{ id: 7, items: [{ hash: "  AbCd " }] }]);
    expect(map.get("abcd")).toBe("t:7");
  });

  it("旧任务没记 infoHash 就跳过，不拿标题去猜", () => {
    const map = buildTaskGroups([
      { id: 1, items: [{}, { hash: "" }, { hash: undefined }] },
      { id: 2, items: [{ hash: "x" }] },
    ]);
    expect(map.size).toBe(1);
    expect(map.get("x")).toBe("t:2");
  });
});

describe("assignGroups：两层判据", () => {
  it("① 台账里的按任务并 —— 名称、路径各站报得不一样也并", () => {
    const taskByHash = buildTaskGroups([{ id: "t", items: [{ hash: "h1" }, { hash: "h2" }] }]);
    expect(
      groupsOf(
        [
          row({ key: "a", infoHash: "H1", name: "站点 A 的写法" }),
          row({ key: "b", infoHash: "h2", name: "站点 B 的写法", savePath: "/other" }),
        ],
        taskByHash,
      ),
    ).toEqual(["G1", "G1"]);
  });

  it("② 不在台账里的按四项全等并", () => {
    expect(groupsOf([row({ key: "a", infoHash: "h1" }), row({ key: "b", infoHash: "h2" })])).toEqual(["G1", "G1"]);
  });

  it("少任何一项都不许并：折叠起来的那几条是看不见的", () => {
    expect(
      groupsOf([
        row({ key: "same1", infoHash: "h1" }),
        row({ key: "same2", infoHash: "h2" }),
        row({ key: "name", infoHash: "h3", name: "差一个字" }),
        row({ key: "size", infoHash: "h4", totalSize: 1 }),
        row({ key: "path", infoHash: "h5", savePath: "/差一个目录" }),
      ]),
    ).toEqual(["G1", "G1", null, null, null]);
  });

  it("跨下载器的同名条目不并 —— 第一列就是下载器，那是两件事", () => {
    expect(
      groupsOf([
        row({ key: "a1", clientId: "qb-1", infoHash: "h1" }),
        row({ key: "a2", clientId: "qb-1", infoHash: "h2" }),
        row({ key: "b1", clientId: "tr-2", infoHash: "h3" }),
        row({ key: "b2", clientId: "tr-2", infoHash: "h4" }),
      ]),
    ).toEqual(["G1", "G1", "G2", "G2"]);
  });

  it("③ 没记哈希的几条，四项与某个任务组重合就并进那个任务组，不留两组", () => {
    const taskByHash = buildTaskGroups([{ id: "t", items: [{ hash: "h1" }] }]);
    expect(groupsOf([row({ key: "a", infoHash: "h1" }), row({ key: "b" })], taskByHash)).toEqual(["G1", "G1"]);
  });

  it("组里只有一条的退回不成组（台账认出独苗也一样）", () => {
    const taskByHash = buildTaskGroups([{ id: "t", items: [{ hash: "h1" }, { hash: "h2" }] }]);
    // 台账说这两条同组，但这一屏只有 h1 在（h2 还没落地 / 被筛掉了）—— 没有可折的东西
    expect(groupsOf([row({ key: "a", infoHash: "h1" })], taskByHash)).toEqual([null]);
  });
});

describe("contentFingerprint：四个字段都参与判组", () => {
  it("行标识不参与，改哪个业务字段都算两份", () => {
    const base = row({ key: "a" });
    expect(contentFingerprint(base)).toBe(contentFingerprint(row({ key: "b" })));
    expect(contentFingerprint(base)).not.toBe(contentFingerprint({ ...base, clientId: "qb-2" }));
    expect(contentFingerprint(base)).not.toBe(contentFingerprint({ ...base, name: "别的名字" }));
    expect(contentFingerprint(base)).not.toBe(contentFingerprint({ ...base, totalSize: base.totalSize + 1 }));
    expect(contentFingerprint(base)).not.toBe(contentFingerprint({ ...base, savePath: "/别的目录" }));
  });

  it("名称与保存路径都带冒号、空格时也不互撞（分隔符是 \\0，不是冒号）", () => {
    const a = contentFingerprint(row({ key: "a", name: "x:1", totalSize: 2, savePath: "y:3" }));
    const b = contentFingerprint(row({ key: "b", name: "x", totalSize: 12, savePath: "y:3" }));
    expect(a).not.toBe(b);
  });
});

describe("collapseGroups：折叠只出代表行，展开整组相邻", () => {
  const rows = [
    row({ key: "solo1", infoHash: "s1" }),
    row({ key: "a", infoHash: "h1" }),
    row({ key: "solo2", infoHash: "s2" }),
    row({ key: "b", infoHash: "h2" }),
    row({ key: "c", infoHash: "h3" }),
  ];
  const groupOf = (r: IRowForGroup) => (["a", "b", "c"].includes(r.key) ? "G1" : null);

  it("默认折叠：整页只剩代表行，组员一条都不出现", () => {
    expect(collapseGroups(rows, groupOf, new Set()).rows.map((r) => r.key)).toEqual(["solo1", "a", "solo2"]);
  });

  it("展开：整组连着代表行一起出现，组的位置仍是组内第一条在输入里的位置", () => {
    expect(collapseGroups(rows, groupOf, new Set(["G1"])).rows.map((r) => r.key)).toEqual([
      "solo1",
      "a",
      "b",
      "c",
      "solo2",
    ]);
  });

  it("meta：只有代表行 anchor=true，count 是组内总条数（含折叠时没出现的那些）", () => {
    const { meta } = collapseGroups(rows, groupOf, new Set());
    expect(meta.get("a")).toEqual({ group: "G1", count: 3, anchor: true });
    expect(meta.get("b")).toEqual({ group: "G1", count: 3, anchor: false });
    expect(meta.get("solo1")).toBeUndefined();
  });

  it("members：勾代表行要连着整组算（勾选回调靠它，不认折叠态看不见的那些）", () => {
    const { members } = collapseGroups(rows, (r) => (["a", "b", "c"].includes(r.key) ? "G1" : null), new Set());
    expect(members.get("G1")).toEqual(["a", "b", "c"]);
  });

  it("组内保持输入顺序 —— 添加时间的先后由调用方排好，这里不重新排", () => {
    const pair = [row({ key: "z", infoHash: "h1" }), row({ key: "y", infoHash: "h2" })];
    expect(collapseGroups(pair, () => "G1", new Set(["G1"])).rows.map((r) => r.key)).toEqual(["z", "y"]);
  });
});

/**
 * 分页的单位：一组 = 一个不许被页边界劈开的整体。
 *
 * 为什么单独测这一族（用户 2026-10-26 那张截图）：这一页原先把折叠后的行**摊平**交给表格，
 * 而 antd 的前端分页是按固定步长切那一份数组 —— 展开一组时它在原地多出 5 行，
 * 页边界一落在组中间就变成「6 条同内容点开只画 4 条，剩下两条在下一页」。
 * 判据要钉的是两半：**一组绝不跨页**（宁可让面板出滚动条），以及**没展开时与改动前一字不差**
 * （单位数就是折叠后的行数，分页条出不出 / 共几页这些判据吃的数都没换）。
 */
describe("collapseGroups 的 units：分页单位", () => {
  const rows = [
    row({ key: "solo1", infoHash: "s1" }),
    row({ key: "a", infoHash: "h1" }),
    row({ key: "b", infoHash: "h2" }),
    row({ key: "c", infoHash: "h3" }),
    row({ key: "solo2", infoHash: "s2" }),
  ];
  const groupOf = (r: IRowForGroup) => (["a", "b", "c"].includes(r.key) ? "G1" : null);
  const keysOf = (list: IRowForGroup[][]) => list.map((unit) => unit.map((r) => r.key));

  it("折叠态：每个单位就是单独一行，单位数与行数相等（= 改动前的分页输入）", () => {
    const { rows: flat, units } = collapseGroups(rows, groupOf, new Set());
    expect(units.map((u) => u.map((r) => r.key))).toEqual([["solo1"], ["a"], ["solo2"]]);
    expect(units.length).toBe(flat.length);
    expect(flat.map((r) => r.key)).toEqual(["solo1", "a", "solo2"]);
  });

  it("展开态：单位数一个字不变（还是 3 个），只是那一个单位里有 3 行", () => {
    const { units } = collapseGroups(rows, groupOf, new Set(["G1"]));
    expect(units.length).toBe(3);
    expect(keysOf(units)).toEqual([["solo1"], ["a", "b", "c"], ["solo2"]]);
  });

  it("展开出来的那几行仍然连着代表行、按输入顺序排在一个单位里", () => {
    const { rows: flat } = collapseGroups(rows, groupOf, new Set(["G1"]));
    expect(flat.map((r) => r.key)).toEqual(["solo1", "a", "b", "c", "solo2"]);
  });

  it("不成组的行各自是一个单位，组的位置仍是组内第一条在输入里的位置", () => {
    const pair = [row({ key: "x", infoHash: "sx" }), row({ key: "a", infoHash: "h1" }), row({ key: "b", infoHash: "h2" })];
    const units = collapseGroups(pair, groupOf, new Set(["G1"])).units;
    expect(keysOf(units)).toEqual([["x"], ["a", "b"]]);
  });
});

describe("sliceUnitsToPage：一组绝不跨页", () => {
  /** 单位形状：1 行 / 3 行 / 1 行 / 1 行（第 2 个单位是一整组同内容副本） */
  const units = [["s1"], ["a", "b", "c"], ["s2"], ["s3"]].map((list) => list.map((key) => ({ key })));

  it("容量 2 时第 1 页把那一整组画全（4 行），哪怕超了「每页 2 条」", () => {
    expect(sliceUnitsToPage(units, 1, 2).map((r) => r.key)).toEqual(["s1", "a", "b", "c"]);
  });

  it("被这一组顶到下一页的，是后面的单位而不是它的组员", () => {
    expect(sliceUnitsToPage(units, 2, 2).map((r) => r.key)).toEqual(["s2", "s3"]);
  });

  it("容量 1 也照样整组画 —— 「放不下就出滚动条」是他要的，不是「少画两条」", () => {
    expect(sliceUnitsToPage(units, 1, 1).map((r) => r.key)).toEqual(["s1"]);
    expect(sliceUnitsToPage(units, 2, 1).map((r) => r.key)).toEqual(["a", "b", "c"]);
  });

  it("逐页拼起来不重不漏：所有页串起来等于全部行", () => {
    for (const size of [1, 2, 3, 4]) {
      const pages = Math.ceil(units.length / size);
      const all: string[] = [];
      for (let p = 1; p <= pages; p++) all.push(...sliceUnitsToPage(units, p, size).map((r) => r.key));
      expect(all).toEqual(["s1", "a", "b", "c", "s2", "s3"]);
    }
  });

  it("空列表切出空页，不抛", () => {
    expect(sliceUnitsToPage([], 1, 10)).toEqual([]);
  });
});

describe("clampUnitPage：受控页码要夹回存在的页", () => {
  it("单位数变小（筛选、删除）之后停在第 5 页 → 夹到最后一页", () => {
    expect(clampUnitPage(5, 5, 2)).toBe(3); // 5 个单位 / 每页 2 个 = 3 页
    expect(clampUnitPage(9, 1, 11)).toBe(1);
  });

  it("0、负数、NaN 一律当第 1 页（这一页的页码是外部状态，形状不可信）", () => {
    expect(clampUnitPage(0, 30, 11)).toBe(1);
    expect(clampUnitPage(-3, 30, 11)).toBe(1);
    expect(clampUnitPage(Number.NaN, 30, 11)).toBe(1);
  });

  it("容量报成 0 或 -1（Vuetify 遗留的「不分页」）不许算出负数页", () => {
    expect(clampUnitPage(2, 30, 0)).toBe(2); // 容量按 1 兜底，于是页数就是 30 页
    expect(clampUnitPage(2, 30, -1)).toBe(2);
    expect(clampUnitPage(99, 30, -1)).toBe(30);
  });

  it("正常范围内不动它：翻页与页码本身是受控的，夹错一次就跳页", () => {
    expect(clampUnitPage(2, 30, 11)).toBe(2);
    expect(clampUnitPage(3, 30, 11)).toBe(3);
  });

  it("一个单位都没有（筛到零条）时页码也是 1，不是 0", () => {
    // 0 会被当成「第 0 页」切出空数组，界面上是「一条都不画」而不是「空态那一行」
    expect(clampUnitPage(1, 0, 10)).toBe(1);
    expect(clampUnitPage(7, 0, 10)).toBe(1);
    expect(sliceUnitsToPage([], 7, 10)).toEqual([]);
  });
});

describe("groupSiblingsOf：行内那颗删除键要端出去的那几条", () => {
  const rows = [row({ key: "a" }), row({ key: "b" }), row({ key: "solo" })];
  const { meta, members } = collapseGroups(rows, (r) => (["a", "b"].includes(r.key) ? "G1" : null), new Set());

  it("代表行 → 整组，含折叠态下没出现在列表里的那条", () => {
    expect(groupSiblingsOf("a", meta, members)).toEqual(["a", "b"]);
  });
  it("组员行（展开态下点它）→ 同样是整组，不只是它自己", () => {
    expect(groupSiblingsOf("b", meta, members)).toEqual(["a", "b"]);
  });
  it("不成组的行 → 空数组，调用方据此走原来的单条确认框", () => {
    expect(groupSiblingsOf("solo", meta, members)).toEqual([]);
  });
  it("meta 有但组里只剩一条（数据自相矛盾）→ 也返回空，不出「整组就一条」的勾选框", () => {
    const one = new Map(meta);
    one.set("a", { group: "G9", count: 1, anchor: true });
    expect(groupSiblingsOf("a", one, new Map([["G9", ["a"]]]))).toEqual([]);
  });
});
