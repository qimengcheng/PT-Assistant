/**
 * 「删除辅种任务」那颗新勾选框在界面上到底接没接上。
 *
 * 为什么单独一份（而不是并进 `tests/shared/reseedCopyRemoval.test.ts`）：本轮要钉的是
 * **判据写对了、全绿、调用点却可以没用它的产出** 那一族（v0.128.0 / v0.117.0 两次反证都撞在
 * 这里）—— 把 `for (const id of plan.matched)` 换成自己拿 `task.items[0].hash` 去下载器里找，
 * 纯判据那 15 条一个字都不红。所以这里一律按源码文本钉**传参形状**，不只钉「没自己算第二遍」。
 *
 * 读源码文本前先归一化换行符：本仓工作区的换行不是常量（`core.autocrlf`，见 v0.122.x 那条）。
 */
import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";

const read = (file: string) => readFileSync(file, "utf8").replace(/\r\n/g, "\n");

const page = read("src/options/views/Overview/KeepUploadTask/Index.vue");
const cell = read("src/options/views/Overview/KeepUploadTask/DeleteTaskConfirm.vue");

type LocaleSlice = { KeepUploadTask: Record<string, Record<string, string>> };
const zh = JSON.parse(read("src/locales/zh_CN.json")) as LocaleSlice;
const en = JSON.parse(read("src/locales/en.json")) as LocaleSlice;

/** 从某个起点取到下一个 `async function <next>` 之前，就是那一个函数的体（含它头上的注释） */
function fnBody(start: string, next: string) {
  const from = page.indexOf(start);
  expect(from, `锚点不存在：${start}`).toBeGreaterThan(-1);
  const to = page.indexOf(next, from);
  expect(to, `区间末尾不存在：${next}`).toBeGreaterThan(from);
  return page.slice(from, to);
}

const withFilesFn = () => fnBody("async function removeClientCopies", "async function deleteTask");
const confirmFn = () => fnBody("async function confirmRemoval", "/**\n * 勾了那颗勾选框之后的一步");
const singleFn = () => fnBody("async function deleteTask(", "async function deleteSelectedTasks");
const batchFn = () => fnBody("async function deleteSelectedTasks", "/**\n * 工具栏那颗");
const rebaseFn = () => fnBody("async function dropOldBase", "const promotingBase");

describe("两条删除路各打各的参数（不许并档）", () => {
  it("连数据一起删这一路必须是 removeData: true", () => {
    expect(withFilesFn()).toMatch(/sendMessage\("deleteClientTorrent", \{ downloaderId, id, removeData: true \}\)/);
    expect(withFilesFn()).not.toMatch(/removeData: false/);
  });

  it("换基准那一路照旧必须是 removeData: false（它的目的是换掉一条基准、数据留给其余副本）", () => {
    expect(rebaseFn()).toMatch(/removeData: false/);
    expect(rebaseFn()).not.toMatch(/removeData: true/);
  });
});

describe("调用点用的是判据的产出", () => {
  it("删除的那些 id 逐字来自 planReseedCopyRemoval 的 matched", () => {
    const body = withFilesFn();
    expect(body).toMatch(/const plan = planReseedCopyRemoval\(\s*group,/);
    expect(body).toMatch(/for \(const id of plan\.matched\) \{/);
    // 反向：不许出现「自己拿第一条 hash 去列表里 find」这种退化（v0.105.4 同族盲区）
    expect(body).not.toMatch(/\.find\(/);
    expect(body).not.toMatch(/plan\.matched\[0\]/);
  });

  it("列表递给判据的是 { hash, id } 两样，且连不上时递 null 而不是空数组", () => {
    expect(withFilesFn()).toMatch(/torrents \? torrents\.map\(\(one: CTorrent\) => \(\{ hash: one\.infoHash, id: one\.id \}\)\) : null/);
  });

  it("连不上那一档在删除循环之前就跳过（顺序本身就是判据）", () => {
    const body = withFilesFn();
    const gate = body.indexOf("if (plan.unreachable) {");
    expect(gate).toBeGreaterThan(-1);
    expect(body.indexOf("continue;", gate)).toBeGreaterThan(gate);
    expect(gate).toBeLessThan(body.indexOf("for (const id of plan.matched)"));
  });
});

describe("默认关闭，且没勾时这条链与改前一字不差", () => {
  it("勾选状态初值是 false（两处：页面那份与组件那份）", () => {
    expect(confirmFn()).toMatch(/let withFiles = false;/);
    expect(confirmFn()).not.toMatch(/withFiles = true/);
    expect(cell).toMatch(/const checked = ref\(false\);/);
  });

  it("任务记录先删、下载器那一步排在它之后（否则后台那一轮会把刚删的种子重新发回去）", () => {
    const single = singleFn();
    const record = single.indexOf('sendMessage("deleteKeepUploadTask", task.id)');
    expect(record).toBeGreaterThan(-1);
    expect(single.indexOf("removeClientCopies([task])")).toBeGreaterThan(record);
    expect(single).toMatch(/if \(choice === "withFiles"\) await removeClientCopies\(\[task\]\);/);
  });

  it("不勾那一路一个下载器消息都不发", () => {
    for (const body of [singleFn(), batchFn()]) {
      expect(body).not.toContain("deleteClientTorrent");
      expect(body).not.toContain("getClientTorrents");
    }
  });

  it("批量那一路只把删除打在**真删掉记录**的那几条上", () => {
    expect(batchFn()).toMatch(/if \(choice === "withFiles"\) await removeClientCopies\(targets\.filter\(\(task\) => removed\.includes\(task\.id\)\)\);/);
    // 对象要在删除之前先抄一份：tasks.value 随后就被换成筛过的列表
    expect(batchFn()).toMatch(/const targets = tasks\.value\.filter\(\(task\) => ids\.includes\(task\.id\)\);/);
  });
});

describe("确认框的承载与范围", () => {
  it("确认框的内容是一个组件而不是页面里 h() 拼的裸节点（scoped 样式跟得进去）", () => {
    expect(confirmFn()).toMatch(/h\(DeleteTaskConfirm, \{/);
    expect(cell).toContain("<style scoped>");
    expect(page).toMatch(/import DeleteTaskConfirm from "\.\/DeleteTaskConfirm\.vue";/);
  });

  it('那两句说明只在勾上之后才画（没勾时它们是"他不会得到的结果"）', () => {
    expect(cell).toMatch(/<a-checkbox :checked="checked" @update:checked="pick"/);
    expect(cell.match(/v-if="checked/g)?.length).toBe(2);
  });

  it("「移除已完成」与「清空全部」不给那颗勾（一次点掉几十条 = 几十份内容的数据一起没）", () => {
    const done = fnBody("async function removeDoneTasks", "async function clearAllTasks");
    const clear = fnBody("async function clearAllTasks", "// 发送种子到下载器");
    for (const body of [done, clear]) {
      expect(body).not.toContain("confirmRemoval");
      expect(body).toContain("confirmDanger(");
    }
  });

  it("那句「删不了文件的下载器」由 ignoresRemoveData 驱动，不是按下载器名字硬写", () => {
    expect(confirmFn()).toMatch(/ignoresRemoveData\(metadataStore\.downloaders\[id\]\?\.type\)/);
    expect(confirmFn()).not.toMatch(/=== "synologyDownloadStation"/);
    expect(confirmFn()).toMatch(/noFileDelete: ignoreCount > 0 \? t\("KeepUploadTask\.withData\.noFileDelete", \{ count: ignoreCount \}\) : undefined/);
  });
});

describe("两份 locale 成对，且槽与调用点传的参对得上", () => {
  const sides = [
    ["zh", zh] as const,
    ["en", en] as const,
  ];

  for (const key of ["label", "shared", "noFileDelete", "removed", "unreachable", "refused", "notFound", "noHash", "detailJoin"]) {
    it(`KeepUploadTask.withData.${key} 两侧都在`, () => {
      for (const [, side] of sides) expect(typeof side.KeepUploadTask.withData[key]).toBe("string");
    });
  }

  it("四档「没删成」与那句「已删掉」都带 {count}，调用点也确实传了 count", () => {
    for (const [, side] of sides) {
      for (const key of ["noFileDelete", "removed", "unreachable", "refused", "notFound", "noHash"]) {
        expect(side.KeepUploadTask.withData[key]).toContain("{count}");
      }
      // 勾选框标签与那句「同一份数据」是终句，不该留空槽（括号空着 = 调用点少传参，防线③看不见这种键）
      for (const key of ["label", "shared"]) expect(side.KeepUploadTask.withData[key]).not.toMatch(/\{[a-z]+}/i);
    }
    for (const key of ["unreachable", "refused", "notFound", "noHash"]) {
      expect(page).toMatch(new RegExp(`t\\("KeepUploadTask\\.withData\\.${key}", \\{ count: \\w+ \\}\\)`));
    }
  });

  it("detailJoin 是两句之间唯一的缝：中文不带空格、英文必须自带那一格", () => {
    expect(zh.KeepUploadTask.withData.detailJoin).toBe("；");
    expect(en.KeepUploadTask.withData.detailJoin).toBe("; ");
    // 句子自己不许带尾随空格（缝由 detailJoin 负责，否则英文会拼出双空格）
    for (const side of [zh, en]) {
      for (const key of ["removed", "unreachable", "refused", "notFound", "noHash"]) {
        expect(side.KeepUploadTask.withData[key]).not.toMatch(/\s$/);
      }
    }
  });
});
