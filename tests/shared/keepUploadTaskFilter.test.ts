/**
 * 「辅种任务」那张表的名称搜索 + 分类筛选 + 状态筛选（判据在 `src/shared/keepUploadTaskFilter.ts`）。
 *
 * 用户 2026-10-19：「这个界面要支持名称搜索和分类筛选」，随后「还要支持状态的筛选」。这一屏的任务是
 * 几十条起步的（一次一键辅种就建 20 来条），没有筛选时人只能在「做种状态」那一列里肉眼找标题。
 *
 * 分类这一族用例特意按**真实折类判据**摆（直接 import 上游那份，不桩）：这条筛选的产物会
 * 决定人「看不到哪几条任务」，而它和发送时挑目录用的是同一份 `sharedCategory` —— 两边各折一套
 * 就会出现「下拉说它是综艺、实际按电视剧建了路径」那种两句互相打脸。
 *
 * 状态那一档反过来：`stageOf` 是**调用方注入**的，本文件不验档位怎么算出来（那由
 * `tests/shared/reseedStage.test.ts` 钉），只验「同一个注入函数进了三条闸与候选表之后行为对不对」。
 */
import { describe, expect, it } from "vitest";

import type { IKeepUploadTask, IKeepUploadTaskItem } from "@/shared/types.ts";
import type { TReseedStage } from "@/options/views/Overview/KeepUploadTask/seedVerify.ts";
import {
  categoryKindChoices,
  filterKeepUploadTasks,
  matchesTaskWord,
  reseedStageChoices,
  taskCategoryKind,
  type TSiteCategoryMapOf,
  type TStageOf,
} from "@/shared/keepUploadTaskFilter.ts";

function item(over: Partial<IKeepUploadTaskItem> = {}): IKeepUploadTaskItem {
  return {
    site: "ptzone",
    title: "玩具总动员4 2019 2160p",
    link: "https://ptzone.invalid/detail/101",
    url: "https://ptzone.invalid/download/101",
    size: 8_000_000_000,
    category: "电影",
    ...over,
  };
}

/**
 * 档位存在这张表里、不存在任务对象上 —— 因为真那一页的 `stageOf` 是从 `verify.statuses` 现算的，
 * 往夹具对象上塞一个字段就等于测了一份假数据形状。
 */
const stages = new Map<string, TReseedStage>();

function task(over: Partial<IKeepUploadTask> & { stage?: TReseedStage } = {}): IKeepUploadTask {
  const made: IKeepUploadTask = {
    id: "t1",
    time: 1_700_000_000_000,
    title: "玩具总动员4 2019 2160p",
    size: 8_000_000_000,
    downloadOptions: { downloaderId: "d1" },
    items: [item()],
    ...over,
  };
  stages.set(made.id, over.stage ?? "idle");
  return made;
}

const stageOf: TStageOf = (task) => stages.get(task.id) ?? "idle";

/** 不带覆盖表时用这一份：站点 id 一律「该站没配过映射」 */
const noMap: TSiteCategoryMapOf = () => undefined;

function filter(
  tasks: IKeepUploadTask[],
  input: { word?: string; kind?: "movie" | "tv" | "variety" | null; stage?: TReseedStage | null } = {},
) {
  return filterKeepUploadTasks(tasks, {
    word: input.word ?? "",
    kind: input.kind ?? null,
    stage: input.stage ?? null,
    siteMapOf: noMap,
    stageOf,
  }).map((x) => x.id);
}

describe("名称搜索", () => {
  it("空词全过（含只有空格的）", () => {
    const list = [task({ id: "a" }), task({ id: "b" })];
    expect(filter(list, { word: "" })).toEqual(["a", "b"]);
    expect(filter(list, { word: "   " })).toEqual(["a", "b"]);
  });

  it("命中任务标题", () => {
    const list = [task({ id: "a", title: "玩具总动员4" }), task({ id: "b", title: "镖人 2025" })];
    expect(filter(list, { word: "玩具" })).toEqual(["a"]);
  });

  it("大小写不敏感：站点标题多为英文原名，人打的是随意大小写", () => {
    const list = [task({ id: "a", title: "Toy Story 4 2160p" })];
    expect(matchesTaskWord(list[0]!, "toy story")).toBe(true);
    expect(matchesTaskWord(list[0]!, "TOY STORY")).toBe(true);
  });

  it("忽略词两端的空白，但不忽略中间", () => {
    const list = [task({ id: "a", title: "Toy Story 4" })];
    expect(matchesTaskWord(list[0]!, "  Toy Story  ")).toBe(true);
    expect(matchesTaskWord(list[0]!, "Toystory")).toBe(false);
  });

  it("副标题也算命中（条目行显示的就是那一行，人照着它搜）", () => {
    const sub = task({ id: "b", title: "某条任务", subTitle: "Toy Story 4 (2019)" });
    expect(matchesTaskWord(sub, "toy story")).toBe(true);
  });

  it("一条都不命中时返回空表，而不是全表", () => {
    expect(filter([task({ id: "a", title: "玩具总动员4" })], { word: "镖人" })).toEqual([]);
  });

  it("标题缺席的存量任务不报错、也不命中", () => {
    const broken = task({ id: "a", title: undefined as unknown as string });
    expect(matchesTaskWord(broken, "玩具")).toBe(false);
    expect(matchesTaskWord(broken, "")).toBe(true);
  });
});

describe("分类筛选", () => {
  it("条目分类与筛选同类时留下", () => {
    expect(filter([task()], { kind: "movie" })).toEqual(["t1"]);
    expect(filter([task()], { kind: "tv" })).toEqual([]);
  });

  it("各站写法不同但折到同一类，照样算同类（这是复用上游判据的全部理由）", () => {
    const multi = task({
      items: [
        item({ site: "ptzone", category: "电影" }),
        item({ site: "novahd", category: "Movies" }),
        item({ site: "hhanclub", category: "Movies/电影" }),
      ],
    });
    expect(taskCategoryKind(multi, noMap)).toBe("movie");
    expect(filter([multi], { kind: "movie" })).toEqual(["t1"]);
  });

  it("一批里分类有分歧时按多数算（3 综艺 + 1 电视剧 = 综艺）", () => {
    const mixed = task({
      items: [
        item({ category: "综艺" }),
        item({ category: "Variety" }),
        item({ category: "综艺" }),
        item({ category: "电视剧" }),
      ],
    });
    expect(taskCategoryKind(mixed, noMap)).toBe("variety");
    expect(filter([mixed], { kind: "variety" })).toEqual(["t1"]);
    expect(filter([mixed], { kind: "tv" })).toEqual([]);
  });

  it("两档并列时不猜：哪一类都不出现，只在『全部分类』里看得见", () => {
    // 这一条是本文件最要紧的一档。猜错等于把一条任务从它自己的分类里挪走，
    // 而人在下拉里根本看不到它，只会以为任务被删了。
    const tie = task({ items: [item({ category: "电影" }), item({ category: "电视剧" })] });
    expect(taskCategoryKind(tie, noMap)).toBe(null);
    expect(filter([tie], { kind: null })).toEqual(["t1"]);
    expect(filter([tie], { kind: "movie" })).toEqual([]);
    expect(filter([tie], { kind: "tv" })).toEqual([]);
  });

  it("条目没写分类时判成『折不出类』，而不是当成电影", () => {
    const bare = task({ items: [item({ category: undefined })] });
    expect(taskCategoryKind(bare, noMap)).toBe(null);
    expect(filter([bare], { kind: "movie" })).toEqual([]);
    expect(filter([bare], { kind: null })).toEqual(["t1"]);
  });

  it("覆盖表按每一条自己的站点生效（那个站把叫法映射到别类，就按别类算）", () => {
    const mapOf: TSiteCategoryMapOf = (siteId) => (siteId === "ptzone" ? { 电影: "tv" } : undefined);
    const single = task({ items: [item({ site: "ptzone", category: "电影" })] });
    expect(taskCategoryKind(single, mapOf)).toBe("tv");
    // 另一个站没配映射，仍按规则折成电影
    const other = task({ items: [item({ site: "novahd", category: "电影" })] });
    expect(taskCategoryKind(other, mapOf)).toBe("movie");
  });

  it("筛选那一条链也要把覆盖表传到底（不能半路换成『没配过映射』）", () => {
    const mapOf: TSiteCategoryMapOf = (siteId) => (siteId === "ptzone" ? { 电影: "tv" } : undefined);
    const list = [task({ items: [item({ site: "ptzone", category: "电影" })] })];
    expect(filterKeepUploadTasks(list, { word: "", kind: "tv", stage: null, siteMapOf: mapOf, stageOf })).toHaveLength(1);
    expect(filterKeepUploadTasks(list, { word: "", kind: "movie", stage: null, siteMapOf: mapOf, stageOf })).toHaveLength(0);
  });

  it("items 整个缺席的存量任务判成『折不出类』，不抛错", () => {
    // 缺席的形状要照**存量**造（字段整个不存在），不是字段有值但为 undefined —— 后者测不到 `?? []`
    const broken = task({});
    delete (broken as { items?: unknown }).items;
    expect(taskCategoryKind(broken, noMap)).toBe(null);
    expect(filterKeepUploadTasks([broken], { word: "", kind: "movie", stage: null, siteMapOf: noMap, stageOf })).toHaveLength(0);
  });

  it("名称与分类两条闸是「与」：任一不满足就出局", () => {
    const list = [task({ id: "a", title: "玩具总动员4" }), task({ id: "b", title: "镖人 2025", items: [item({ category: "电视剧" })] })];
    expect(filter(list, { word: "玩具", kind: "movie" })).toEqual(["a"]);
    expect(filter(list, { word: "镖人", kind: "movie" })).toEqual([]);
    expect(filter(list, { word: "镖人", kind: "tv" })).toEqual(["b"]);
  });
});

describe("分类下拉该列哪些档", () => {
  it("只列这批任务里真有的，且按 CATEGORY_KINDS 定序、不按出现次数", () => {
    const list = [
      task({ id: "a", items: [item({ category: "电视剧" })] }),
      task({ id: "b", items: [item({ category: "电视剧" })] }),
      task({ id: "c", items: [item({ category: "电影" })] }),
      task({ id: "d", items: [item({ category: "综艺" })] }),
    ];
    // 电视剧出现两次排最前也不许赢：顺序要稳定，同一份数据两次打开不能变
    expect(categoryKindChoices(list, noMap)).toEqual(["movie", "tv", "variety"]);
  });

  it("折不出类的那些不撑出一档", () => {
    const list = [task({ id: "a", items: [item({ category: "电影" })] }), task({ id: "b", items: [item({ category: undefined })] })];
    expect(categoryKindChoices(list, noMap)).toEqual(["movie"]);
  });

  it("空清单给空下拉候选（调用方那档「全部分类」是自己加的固定项）", () => {
    expect(categoryKindChoices([], noMap)).toEqual([]);
  });

  it("传进来的那份必须只按名称筛过 —— 拿筛完的算会把自己锁死", () => {
    const list = [
      task({ id: "a", items: [item({ category: "电影" })] }),
      task({ id: "b", items: [item({ category: "电视剧" })] }),
    ];
    // 选了「电影」之后再算一次候选，就只剩电影一档，人再也换不回电视剧
    const afterKind = filterKeepUploadTasks(list, {
      word: "",
      kind: "movie",
      stage: null,
      siteMapOf: noMap,
      stageOf,
    });
    expect(categoryKindChoices(afterKind, noMap)).toEqual(["movie"]);
    expect(categoryKindChoices(list, noMap)).toEqual(["movie", "tv"]);
  });
});

describe("状态筛选", () => {
  it("只留下档位相同的那几条", () => {
    const list = [task({ id: "a", stage: "done" }), task({ id: "b", stage: "reseeding" }), task({ id: "c", stage: "done" })];
    expect(filter(list, { stage: "done" })).toEqual(["a", "c"]);
    expect(filter(list, { stage: "idle" })).toEqual([]);
    expect(filter(list, { stage: null })).toEqual(["a", "b", "c"]);
  });

  it("每一档都给得出档位：没有「折不出」那一形状（与分类那条正好相反，别顺手补一道）", () => {
    // 界面上「做种状态」那一列对任何任务都画得出一个词（压根没回查就是「未回查」），
    // 所以这一族不许出现「哪一档都不算」的任务 —— 那会让人以为任务被删了
    const list = [task({ id: "z" })];
    expect(filter(list, { stage: "idle" })).toEqual(["z"]);
    expect(filter(list, { stage: "done" })).toEqual([]);
  });

  it("名称 / 分类 / 状态三条闸是与：任一不满足就出局", () => {
    const list = [
      task({ id: "a", title: "玩具总动员4", stage: "done" }),
      task({ id: "b", title: "镖人 2025", stage: "done", items: [item({ category: "电视剧" })] }),
      task({ id: "c", title: "镖人 2026", stage: "reseeding", items: [item({ category: "电视剧" })] }),
    ];
    expect(filter(list, { word: "镖人", kind: "tv", stage: "done" })).toEqual(["b"]);
    expect(filter(list, { word: "镖人", kind: "tv", stage: "reseeding" })).toEqual(["c"]);
    expect(filter(list, { word: "镖人", kind: "movie", stage: "done" })).toEqual([]);
    expect(filter(list, { word: "玩具", kind: "movie", stage: "done" })).toEqual(["a"]);
  });
});

describe("状态下拉该列哪些档", () => {
  it("只列这批里真有的，按固定表定序（异常最先、其余按流程），不按出现次数", () => {
    const list = [
      task({ id: "a", stage: "done" }),
      task({ id: "b", stage: "done" }),
      task({ id: "c", stage: "done" }),
      task({ id: "d", stage: "wrong" }),
      task({ id: "e", stage: "reseeding" }),
    ];
    expect(reseedStageChoices(list, stageOf)).toEqual(["wrong", "reseeding", "done"]);
  });

  it("同一档位重复出现只算一档", () => {
    const list = [task({ id: "a", stage: "done" }), task({ id: "b", stage: "done" })];
    expect(reseedStageChoices(list, stageOf)).toEqual(["done"]);
  });

  it("空清单给空候选（调用方那档「全部状态」是自己加的固定项）", () => {
    expect(reseedStageChoices([], stageOf)).toEqual([]);
  });

  it("候选那份底既不能按状态筛过、也不能按分类筛过 —— 两枚下拉互不缩候选", () => {
    const list = [
      task({ id: "a", stage: "done", items: [item({ category: "电影" })] }),
      // b 的分类是 1+1 并列（在任何具体类下都不出现），但它的档位必须仍出现在状态候选里
      task({
        id: "b",
        stage: "wrong",
        items: [item({ category: "电影" }), item({ site: "novahd", category: "电视剧" })],
      }),
    ];
    const afterKind = filterKeepUploadTasks(list, {
      word: "",
      kind: "movie",
      stage: null,
      siteMapOf: noMap,
      stageOf,
    });
    expect(reseedStageChoices(afterKind, stageOf)).toEqual(["done"]);
    expect(reseedStageChoices(list, stageOf)).toEqual(["wrong", "done"]);
  });
});
