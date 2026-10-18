/**
 * 「扫描结论 → 辅种任务」那一步搬运的判据（`src/shared/reseedScanHandoff.ts`）。
 *
 * 这一族错都不报错：字段搬错一个，任务照样建出来，坏在**几分钟后发送那一刻**（站点回一句不带原因的
 * `success:false`），或者更糟 —— 把种子推到别的目录上，逼下载器重下一整份。
 * 所以这里钉的全是"搬对没有"：链接与下载链接那一对反向口径、基准必填、只吃 has-it、
 * 重复闸只认硬证据。站点、下载器、种子名一律合成。
 */
import { describe, expect, it } from "vitest";

import { handoffBlocksOf, planReseedHandoff, type IReseedHandoffBase } from "@/shared/reseedScanHandoff.ts";
import { findDuplicateTasks } from "@/shared/reseedTaskDup.ts";
import type { IKeepUploadTask, IKeepUploadTaskItem } from "@/shared/types/storages/keepUploadTask.ts";
import type { IReseedScanResult, TReseedScanVerdict } from "@/shared/types/storages/reseedScan.ts";

const KEY = "movie-2024|8000000000";

function hit(siteId: string, over: Partial<IReseedScanResult> = {}): IReseedScanResult {
  return {
    id: `${KEY}\u0000${siteId}`,
    contentKey: KEY,
    siteId,
    verdict: "has-it" as TReseedScanVerdict,
    at: 1_700_000_000_000,
    siteTitle: `Movie 2024 on ${siteId}`,
    siteSize: 8_000_000_000,
    site: {
      id: `t${siteId}`,
      title: `Movie 2024 on ${siteId}`,
      url: `https://${siteId}/details.php?id=t${siteId}`,
      link: `https://${siteId}/download.php?id=t${siteId}`,
      size: 8_000_000_000,
      hash: `hash-${siteId}`,
    },
    ...over,
  };
}

const base: IReseedHandoffBase = {
  contentKey: KEY,
  downloaderId: "qb1",
  downloaderName: "家里的 qB",
  hash: "LOCALHASH",
  name: "Movie.2024.1080p",
  savePath: "/data/movies",
};

const targets = [{ contentKey: KEY, name: "Movie.2024.1080p" }];
const fixedIds = (contentKey: string, index: number) => `task-${index}`;

/**
 * 场上一条已有的辅种任务。`title` 是**任务级**标题：`findDuplicateTasks` 那一档软证据比的是
 * `task.title` 与 `task.size`，不是 item 的标题。第一版夹具只改了 item 标题，于是
 * `sameTitleSize` 从头到尾没命中过，「把最软那一档也当成重复」这种改法抓不住
 * （反证报「改坏了却全绿」才暴露）。
 */
function existing(items: IKeepUploadTask["items"], title = "Whatever"): IKeepUploadTask[] {
  return [
    {
      id: "old",
      time: 1,
      title,
      size: 8_000_000_000,
      downloadOptions: { downloaderId: "qb1" },
      autoReseed: false,
      items,
    },
  ];
}

function plan(results: IReseedScanResult[], extra: Partial<Parameters<typeof planReseedHandoff>[0]> = {}) {
  return planReseedHandoff({
    results,
    targets,
    bases: [base],
    existingTasks: [],
    makeId: fixedIds,
    now: 1000,
    ...extra,
  });
}

describe("只有「该站有这条」那一档能变成任务", () => {
  it("「标题相符，未验文件」不替人赌：一条都不建", () => {
    const out = plan([hit("siteA", { verdict: "suspect" })]);
    expect(out.tasks).toEqual([]);
  });

  it("结论是「没搜到」的那档即使带着旧标题也不建", () => {
    const out = plan([hit("siteA", { verdict: "no-match" }), hit("siteB", { verdict: "failed" })]);
    expect(out.tasks).toEqual([]);
  });

  it("老数据没存可发送的那一半 → 报 no-site-ref，不拿标题去凑一条任务", () => {
    const legacy = hit("siteA");
    delete legacy.site;
    const out = plan([legacy]);
    expect(out.tasks).toEqual([]);
    expect(out.skipped).toEqual([{ contentKey: KEY, name: base.name, reason: "no-site-ref" }]);
  });
});

describe("一条内容 = 一个任务，命中几个站就是几条 items", () => {
  it("三个站命中 → 一条任务三条 items，items 按站点定序（同一批数据两次点要折出同样的顺序）", () => {
    const out = plan([hit("siteC"), hit("siteA"), hit("siteB")]);
    expect(out.tasks).toHaveLength(1);
    expect(out.tasks[0].items.map((item) => item.site)).toEqual(["siteA", "siteB", "siteC"]);
    expect(out.tasks[0].downloadOptions).toEqual({ downloaderId: "qb1", savePath: "/data/movies", clientName: "家里的 qB" });
  });

  it("基准取下载器里那一份：baseLocal 三条都在，任务目录就是它实际所在目录", () => {
    const task = plan([hit("siteA")]).tasks[0];
    expect(task.baseLocal).toEqual({ hash: "LOCALHASH", name: "Movie.2024.1080p", savePath: "/data/movies" });
    expect(task.autoReseed).toBe(true);
    expect(task.time).toBe(1000);
  });

  it("下载器里找不到已下完的那一份（或它没报 infoHash）→ 一条都不建，报 no-base", () => {
    const noHash = plan([hit("siteA")], { bases: [{ ...base, hash: undefined }] });
    expect(noHash.tasks).toEqual([]);
    expect(noHash.skipped[0].reason).toBe("no-base");
    expect(plan([hit("siteA")], { bases: [] }).skipped[0].reason).toBe("no-base");
  });
});

describe("搬进任务的那一条，字段口径要和「辅种检测」建出来的完全一致", () => {
  it("⚠️ 任务的 link 存详情页、url 存下载链接（ITorrent 那一侧正好相反），这条反向不许被「顺手纠正」", () => {
    const item = plan([hit("siteA")]).tasks[0].items[0];
    expect(item.link).toBe("https://siteA/details.php?id=tsiteA");
    expect(item.url).toBe("https://siteA/download.php?id=tsiteA");
  });

  it("站上的种子 id 与验文件时拿到的 infoHash 都要带上：少 id 有 7 个站发送会失败，少 hash 回查要重下一遍", () => {
    const item = plan([hit("siteA")]).tasks[0].items[0];
    expect(item.id).toBe("tsiteA");
    expect(item.hash).toBe("hash-siteA");
    expect(item.size).toBe(8_000_000_000);
  });
});

describe("重复闸只认硬证据", () => {
  it("同一颗站点种子已被别的任务管着 → 不重复建，按内容报数", () => {
    const out = plan([hit("siteA")], { existingTasks: existing([{ site: "siteA", title: "旧任务里那条", link: "https://siteA/details.php?id=tsiteA", url: "", size: 8e9 }]) });
    expect(out.tasks).toEqual([]);
    expect(out.duplicated).toEqual([KEY]);
  });

  it("只是标题+大小相同、站点条目不同 → 照建（同一份内容分两批站去辅是合法做法）", () => {
    const items: IKeepUploadTaskItem[] = [{ site: "siteA", title: "Movie 2024 on siteB", link: "https://siteA/details.php?id=tsiteA", url: "", size: 8e9 }];
    const out = plan([hit("siteB")], { existingTasks: existing(items, "Movie 2024 on siteB") });
    expect(out.tasks).toHaveLength(1);
    expect(out.duplicated).toEqual([]);
  });

  it("上一条撞到的确实是最软那一档（先钉证据，否则那条断言只是「压根没重复」的同义反复）", () => {
    const items: IKeepUploadTaskItem[] = [{ site: "siteA", title: "Movie 2024 on siteB", link: "https://siteA/details.php?id=tsiteA", url: "", size: 8e9 }];
    const candidate = plan([hit("siteB")]).tasks[0];
    expect(findDuplicateTasks(candidate, existing(items, "Movie 2024 on siteB")).map((d) => d.reason)).toEqual([
      "sameTitleSize",
    ]);
  });

  it("同一轮里两条内容撞上了同一颗种子：后折的那条被前面已建的挡住，不会建出两条管同一颗的任务", () => {
    const shared = hit("siteA");
    const otherKey = "other|1";
    const second = { ...shared, contentKey: otherKey, id: `${otherKey}\u0000siteA` };
    const out = planReseedHandoff({
      results: [shared, second],
      targets: [...targets, { contentKey: otherKey, name: "Other" }],
      bases: [base, { ...base, contentKey: otherKey }],
      existingTasks: [],
      makeId: fixedIds,
      now: 1000,
    });
    expect(out.tasks).toHaveLength(1);
    expect(out.duplicated).toEqual([otherKey]);
  });
});

/**
 * 那颗键为什么是 (0)（用户 2026-10-18 报的正是这个：屏上 23 条「该站有这条」，键却点不动）。
 *
 * 灰着的 `<button>` 不发鼠标事件 ⇒ 悬停浮层在这条路上是空的，原因只能写成屏幕上的一行字。
 * 这一份判据住在 shared 里，为的就是那句原因**说得出口也被断得住**。
 */
describe("handoffBlocksOf：点不动时要能点名是哪一类", () => {
  it("有任务可建 → 不解释", () => {
    expect(handoffBlocksOf(plan([hit("siteA")]), 1)).toEqual([]);
  });

  it("升级之前查的那批（没存可发送的那一半）→ legacy，条数按**内容**报（一条内容 = 一个任务）", () => {
    const otherKey = "other|1";
    const a = hit("siteA");
    delete a.site;
    const b = { ...hit("siteB"), contentKey: otherKey, id: `${otherKey}\u0000siteB` };
    delete b.site;
    const out = planReseedHandoff({
      results: [a, b],
      targets: [...targets, { contentKey: otherKey, name: "Other" }],
      bases: [base, { ...base, contentKey: otherKey }],
      existingTasks: [],
      makeId: fixedIds,
      now: 1000,
    });
    expect(handoffBlocksOf(out, 2)).toEqual([{ reason: "legacy", count: 2 }]);
  });

  it("下载器里没有已下完的那一份 → no-base", () => {
    expect(handoffBlocksOf(plan([hit("siteA")], { bases: [] }), 1)).toEqual([{ reason: "no-base", count: 1 }]);
  });

  it("已被现有任务管着 → duplicated", () => {
    const out = plan([hit("siteA")], {
      existingTasks: existing([{ site: "siteA", title: "旧", link: "https://siteA/details.php?id=tsiteA", url: "", size: 8e9 }]),
    });
    expect(handoffBlocksOf(out, 1)).toEqual([{ reason: "duplicated", count: 1 }]);
  });

  it("三类都没有、也没有命中的结论 → no-hit（这一档说的是「还没查」，不是「查了没有」）", () => {
    expect(handoffBlocksOf(plan([]), 0)).toEqual([{ reason: "no-hit", count: 0 }]);
  });

  it("混着来的那一批：每一档各报自己的数，不许只报第一条", () => {
    const legacy = hit("siteA");
    delete legacy.site;
    const otherKey = "other|1";
    const noBase = { ...hit("siteB"), contentKey: otherKey, id: `${otherKey}\u0000siteB` };
    const out = planReseedHandoff({
      results: [legacy, noBase],
      targets: [...targets, { contentKey: otherKey, name: "Other" }],
      bases: [base],
      existingTasks: [],
      makeId: fixedIds,
      now: 1000,
    });
    expect(handoffBlocksOf(out, 2)).toEqual([
      { reason: "legacy", count: 1 },
      { reason: "no-base", count: 1 },
    ]);
  });
});
