/**
 * 「按所属站点自动补标签」的判据（`src/shared/torrentAutoTag.ts`）。
 *
 * 为什么这一条要进 Vitest：它输出的不是排序或提示，而是**往用户下载器里写的字面量**。
 * 打错一个标签，他以后按标签筛选就会筛出一批错的东西，而且这一步没有撤销。
 * 站点 id、站名、主机名全部合成，不带任何真实账号数据。
 */
import { describe, expect, it } from "vitest";

import { countAutoTagSkips, planAutoTagRows, type IAutoTagRow } from "@/shared/torrentAutoTag.ts";

/** 合成表：主机名 → 站点 id（与 `metadataStore.siteHostMap` 同形状） */
const HOSTS: [string, string][] = [
  ["a.example", "siteA"],
  ["b.example", "siteB"],
];
const NAMES: Record<string, string> = { siteA: "站点甲", siteB: "站点乙" };
const siteNameOf = (siteId: string) => NAMES[siteId] ?? siteId;

function row(over: Partial<IAutoTagRow> & Pick<IAutoTagRow, "id">): IAutoTagRow {
  return { downloaderId: "dl1", tracker: "https://a.example/announce.php?passkey=x", ...over };
}

describe("planAutoTagRows · 只补 tags 为空的那些条", () => {
  it("没标签 + tracker 认得出 → 打所属站名", () => {
    const plan = planAutoTagRows([row({ id: "h1" })], { hostSiteEntries: HOSTS, siteNameOf });
    expect(plan.adds).toEqual([{ downloaderId: "dl1", id: "h1", tag: "站点甲" }]);
    expect(plan.skipped).toEqual([]);
  });

  it("tags 缺席与空数组都算「没有标签」（存量那批就是这两种形状）", () => {
    const plan = planAutoTagRows([row({ id: "h1", tags: undefined }), row({ id: "h2", tags: [] })], {
      hostSiteEntries: HOSTS,
      siteNameOf,
    });
    expect(plan.adds.map((a) => a.id)).toEqual(["h1", "h2"]);
  });

  it("只有空白标签也算没有（那条不会被下载器存住）", () => {
    const plan = planAutoTagRows([row({ id: "h1", tags: ["  ", ""] })], {
      hostSiteEntries: HOSTS,
      siteNameOf,
    });
    expect(plan.adds).toHaveLength(1);
  });

  it("已经有标签的一条都不碰（用户挑的口径：不往手工打过的种子上追加）", () => {
    const plan = planAutoTagRows([row({ id: "h1", tags: ["我自己打的"] })], {
      hostSiteEntries: HOSTS,
      siteNameOf,
    });
    expect(plan.adds).toEqual([]);
    expect(plan.skipped).toEqual([{ id: "h1", reason: "hasTags" }]);
  });
});

describe("planAutoTagRows · 认不出站点就不写", () => {
  it("tracker 为空 → 跳过，不猜、不写空标签", () => {
    const plan = planAutoTagRows([row({ id: "h1", tracker: "" })], { hostSiteEntries: HOSTS, siteNameOf });
    expect(plan.adds).toEqual([]);
    expect(plan.skipped).toEqual([{ id: "h1", reason: "noSite" }]);
  });

  it("tracker 是不认识的站 → 跳过（不许退回到下载链接或分类去猜）", () => {
    const plan = planAutoTagRows([row({ id: "h1", tracker: "https://other.example/announce" })], {
      hostSiteEntries: HOSTS,
      siteNameOf,
    });
    expect(plan.adds).toEqual([]);
    expect(plan.skipped[0].reason).toBe("noSite");
  });

  it("announce 在 tracker 子域上也认得（与行上那枚标记同一份反查）", () => {
    const plan = planAutoTagRows([row({ id: "h1", tracker: "https://tracker.a.example/announce" })], {
      hostSiteEntries: HOSTS,
      siteNameOf,
    });
    expect(plan.adds[0].tag).toBe("站点甲");
  });

  it("表里存的是带 www. 的首页域名、announce 在同域另一子域上也认得（用户 2026-10-19「这个明显是海胆的啊」）", () => {
    // `siteHostMap` 的键是 `getHostFromUrl()` 的原样 host，**带 `www.`**；tracker 那一侧折出来不带。
    // 这一条钉的是两侧归一化对齐（判据在 `trackerHost.ts`），少对齐一次就是这一整批种子补不上标签。
    const plan = planAutoTagRows([row({ id: "h1", tracker: "https://announce.a.example/announce.php" })], {
      hostSiteEntries: [["www.a.example", "siteA"]],
      siteNameOf,
    });
    expect(plan.adds).toEqual([{ downloaderId: "dl1", id: "h1", tag: "站点甲" }]);
    expect(plan.skipped).toEqual([]);
  });

  it("站名算出来是空串时不写空标签，按「认不出站点」跳过", () => {
    const plan = planAutoTagRows([row({ id: "h1" })], {
      hostSiteEntries: HOSTS,
      siteNameOf: () => "",
    });
    expect(plan.adds).toEqual([]);
    expect(plan.skipped[0].reason).toBe("noSite");
  });
});

describe("planAutoTagRows · 一批里各按各的站点", () => {
  it("两行两个站 → 两个不同标签（不许拿第一条的站名套全场）", () => {
    const plan = planAutoTagRows(
      [
        row({ id: "h1", tracker: "https://b.example/announce" }),
        row({ id: "h2", tracker: "https://a.example/announce" }),
        row({ id: "h3", tracker: "https://b.example/announce" }),
      ],
      { hostSiteEntries: HOSTS, siteNameOf },
    );
    expect(plan.adds.map((a) => `${a.id}:${a.tag}`)).toEqual(["h1:站点乙", "h2:站点甲", "h3:站点乙"]);
  });

  it("downloaderId 逐条带着走（同一份内容可能同时在两台下载器上）", () => {
    const plan = planAutoTagRows([row({ id: "h1", downloaderId: "dlX" }), row({ id: "h1", downloaderId: "dlY" })], {
      hostSiteEntries: HOSTS,
      siteNameOf,
    });
    expect(plan.adds.map((a) => a.downloaderId)).toEqual(["dlX", "dlY"]);
  });

  it("顺序照传进来的行序，不重排", () => {
    const plan = planAutoTagRows(
      [row({ id: "z" }), row({ id: "a", tags: ["x"] }), row({ id: "m" })],
      { hostSiteEntries: HOSTS, siteNameOf },
    );
    expect(plan.adds.map((x) => x.id)).toEqual(["z", "m"]);
    expect(plan.skipped.map((x) => x.id)).toEqual(["a"]);
  });

  it("空输入不炸", () => {
    expect(planAutoTagRows([], { hostSiteEntries: HOSTS, siteNameOf })).toEqual({ adds: [], skipped: [] });
  });
});

describe("countAutoTagSkips · 两档不许并成一档", () => {
  it("「已经有标签」与「认不出站点」各报各的数", () => {
    expect(countAutoTagSkips([{ id: "1", reason: "hasTags" }, { id: "2", reason: "noSite" }, { id: "3", reason: "noSite" }])).toEqual({
      hasTags: 1,
      noSite: 2,
    });
  });

  it("空数组两档都是 0（不是 undefined）", () => {
    expect(countAutoTagSkips([])).toEqual({ hasTags: 0, noSite: 0 });
  });
});
