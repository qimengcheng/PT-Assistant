/**
 * 「换基准时原基准那条要不要从下载器删掉」的判据（用户 2026-10-20）。
 *
 * 这一族是**删东西**的那一族，所以误删与漏删要各摆一遍：
 * 漏删的代价是「下载器里多留一条」，误删的代价是「把一条正在做种的种子停了」—— 不对称，
 * 所以判据里那五档「不删」每一条都要有用例钉住，而不是只钉「removed」那一条。
 */
import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";

import { decideOldBaseRemoval } from "@/shared/rebaseOldBase.ts";

type Input = Parameters<typeof decideOldBaseRemoval<string>>[0];

const base = {
  oldHash: "aa",
  newHash: "bb",
  sameInTask: 0,
  sameInOtherTasks: 0,
  downloaderEntries: [
    { hash: "aa", id: "id-aa" },
    { hash: "bb", id: "id-bb" },
  ],
};
/** 只看落在哪一档；要拿 id 的用例自己直接调那一个函数 */
const decide = (over: Partial<Input> = {}) => decideOldBaseRemoval<string>({ ...base, ...over }).outcome;

describe("该删的那一档", () => {
  it("原基准确实在下载器里、也没有别人挂着 → 删", () => {
    expect(decide()).toBe("removed");
  });

  it("删那一步要用的 id 由判据一起交回来，且是下载器报的那个（Aria2 的 id 是数字 gid，不是 infoHash）", () => {
    expect(decideOldBaseRemoval<string>(base)).toEqual({ outcome: "removed", id: "id-aa" });
    expect(decideOldBaseRemoval({ ...base, downloaderEntries: [{ hash: "aa", id: 70123 }] })).toEqual({
      outcome: "removed",
      id: 70123,
    });
  });

  it("hash 大小写不同也算同一条（下载器报的是小写，任务里存的原样）", () => {
    expect(decide({ oldHash: "AA", downloaderEntries: [{ hash: "aa", id: "id-aa" }] })).toBe("removed");
    expect(decide({ downloaderEntries: [{ hash: "AA", id: "id-aa" }] })).toBe("removed");
  });

  it("下载器条目没报 infoHash 时算「没有这一条」，不许拿它的 id 顶上（撞上了就删错那条）", () => {
    expect(decide({ downloaderEntries: [{ id: "aa" }] })).toBe("notFound");
    expect(decide({ downloaderEntries: [{ id: "id-x" }] })).toBe("notFound");
  });
});

describe("不许删的那几档，各说清一个原因", () => {
  it("任务里没记 infoHash → 没对象，不是失败", () => {
    expect(decide({ oldHash: "" })).toBe("noHash");
    expect(decide({ oldHash: undefined })).toBe("noHash");
  });

  it("新旧是同一条 → 删下去就是把刚发出去的那条删掉", () => {
    expect(decide({ newHash: "AA" })).toBe("sameAsNew");
  });

  it("同一条还被本任务别的行挂着 → 那一行还在做种，停了它没人负责", () => {
    expect(decide({ sameInTask: 1 })).toBe("shared");
  });

  it("同一条还被别的任务挂着 → 那是别人的基准，不许顺手停掉", () => {
    expect(decide({ sameInOtherTasks: 1 })).toBe("shared");
  });

  it("下载器连不上（拿不到列表）→ 报「没删掉」而不是「删掉了」", () => {
    expect(decide({ downloaderEntries: null })).toBe("unreachable");
  });

  it("下载器里没有这一条 → 本来就不用删", () => {
    expect(decide({ downloaderEntries: [{ hash: "bb", id: "id-bb" }] })).toBe("notFound");
  });

  it("列表为空数组与连不上是两档，不许并成一条", () => {
    expect(decide({ downloaderEntries: [] })).toBe("notFound");
    expect(decide({ downloaderEntries: null })).toBe("unreachable");
  });
});

describe("档位之间的先后", () => {
  it("没记 hash 时不看后面任何一项（否则会把「没对象」报成「连不上」）", () => {
    expect(decide({ oldHash: "", downloaderEntries: null, sameInTask: 3 })).toBe("noHash");
  });

  it("「新旧同一条」排在「被别人挂着」之前 —— 这一档说的是它自己，不是别人", () => {
    expect(decide({ newHash: "aa", sameInTask: 1, downloaderEntries: null })).toBe("sameAsNew");
  });

  it("「被别人挂着」排在查列表之前 —— 连不上时也不许把该停的停掉", () => {
    expect(decide({ sameInOtherTasks: 1, downloaderEntries: null })).toBe("shared");
  });
});

/**
 * 模板那一侧的形状（vitest 是 node 环境，DOM 里没有组件可渲染，只能按源码文本验）。
 * 这几条都是「改回去不报错、不进 vue-tsc，只在界面上表现为做错了事」的东西。
 */
describe("辅种任务页的模板与调用顺序", () => {
  const sfc = readFileSync(
    new URL("../../src/options/views/Overview/KeepUploadTask/Index.vue", import.meta.url),
    "utf8",
  );

  it("「站点」那一列的图标外面包了一层悬停浮层，说的是站点名", () => {
    const cell = /<template v-if="column\.key === 'site'">([\s\S]*?)<\/template>/.exec(sfc);
    expect(cell, "找不到站点那一列的分支").toBeTruthy();
    expect(cell![1]).toContain("<HoverTip");
    expect(cell![1]).toContain('siteNameOf(rowSiteId(record))');
    expect(cell![1]).toContain("<SiteFavicon");
  });

  it("那颗「发送并换为基准」已经删干净（用户 2026-10-20：设为基准后就会自动发送）", () => {
    expect(sfc).not.toContain("sendOneAndPromote");
    expect(sfc).not.toContain("sendAndSetBase");
  });

  it("删除那一步必须写着 removeData: false —— 改成 true 就是把整批副本的数据删了", () => {
    expect(sfc).toMatch(/removeData: false/);
    expect(sfc).not.toMatch(/removeData:\s*true/);
  });

  it("换基准那一趟的先后：先存顺序 → 再发送 → 发成功才删原基准", () => {
    const body = /async function setAsBaseTorrent[\s\S]*?\n\}/.exec(sfc);
    expect(body, "找不到 setAsBaseTorrent 本体").toBeTruthy();
    const at = (s: string) => body![0].indexOf(s);
    expect(at("updateKeepUploadTask")).toBeGreaterThan(-1);
    expect(at("const sent = await sendTorrentsToDownloader")).toBeGreaterThan(at("updateKeepUploadTask"));
    expect(at("await dropOldBase")).toBeGreaterThan(at("const sent = await sendTorrentsToDownloader"));
    // 「没发出去就不许删」是这条链上唯一那道闸，被拆掉就会留下「既没新的也没旧的」。
    // ⚠️ 这里必须先验 it 存在再用位置比：`indexOf` 找不到时是 -1，而 -1 小于任何位置，
    // 只写「排在 dropOldBase 之前」的话，把整道 `if (!sent)` 删掉反而是绿的（反证第一次就全绿，抓到的正是这条）。
    const gate = /if \(!sent\) \{([\s\S]*?)\n {2}\}/.exec(body![0]);
    expect(gate, "找不到「没发出去就不许删」那道闸").toBeTruthy();
    expect(gate![0]).toContain("return;");
    expect(at("if (!sent)")).toBeLessThan(at("await dropOldBase"));
  });

  it("删不删、删哪一条都只问那份判据，组件里不许自己再判一遍或再查一遍表", () => {
    const body = /async function dropOldBase[\s\S]*?\n\}/.exec(sfc);
    expect(body, "找不到 dropOldBase 本体").toBeTruthy();
    expect(body![0]).toContain("decideOldBaseRemoval({");
    expect(body![0]).not.toContain('=== "notFound"');
    expect(body![0]).not.toContain('=== "shared"');
    // 「查第二遍表取 id」正是让这两半各说一套的写法：判据判的是一条、删下去的是另一条
    expect(body![0]).not.toContain(".find(");
    expect(body![0]).toContain("id: result.id");
  });
});

/**
 * 界面那句「为什么没删」走的是**动态拼出来的** i18n 键
 * （`t(\`KeepUploadTask.rebase.keep.${outcome}\`)`），防线③ 只看字面 `t("a.b.c")`，看不见这种。
 * 所以这里把「判据能返回的每一档」与「两侧文案里有的每一档」对账：加一档判据而忘了补键，
 * 界面上不会报错，只会画出键路径本身（`KeepUploadTask.rebase.keep.xxx`）。
 */
describe("每一档结论都说得出一句人话", () => {
  /** 六档各造一条只落在那一档的输入 —— 集合对不上就说明有档位没被覆盖到 */
  const oneOfEach = {
    removed: decide({}),
    noHash: decide({ oldHash: "" }),
    sameAsNew: decide({ newHash: "aa" }),
    shared: decide({ sameInTask: 1 }),
    unreachable: decide({ downloaderEntries: null }),
    notFound: decide({ downloaderEntries: [] }),
  };
  const reasons = ["noHash", "sameAsNew", "shared", "unreachable", "notFound"];

  it("判据返回的档位集合与用例摆的六档一字不差", () => {
    expect([...new Set(Object.values(oneOfEach))].sort()).toEqual([...reasons, "removed"].sort());
  });

  for (const file of ["zh_CN", "en"]) {
    it(`${file}.json 里那五档原因都在，一档不多一档不少`, () => {
      const locale = JSON.parse(
        readFileSync(new URL(`../../src/locales/${file}.json`, import.meta.url), "utf8"),
      ) as { KeepUploadTask: { rebase: Record<string, unknown> } };
      const rebase = locale.KeepUploadTask.rebase;
      expect(Object.keys(rebase.keep as object).sort()).toEqual([...reasons].sort());
      for (const key of ["removed", "kept", "failed", "refused", "sendFailed"]) {
        expect(typeof rebase[key]).toBe("string");
      }
    });
  }
});
