/**
 * tracker 主机名 → 站点 的反查判据（`src/shared/trackerHost.ts`）。
 *
 * 为什么要进 Vitest：用户 2026-10-15 那一屏「本地 5 份副本 5 个站，辅种检测只标 3 个做种中」。
 * 拿「种子详情 → Tracker 列表」看到的 announce 一比对就定位了：PandaPT 首页是 `pandapt.net`，
 * announce 是 `tracker.pandapt.net`，而反查表里只有首页那个域名，精确等值认不上 →
 * 那一份副本的 `sites` 是空的 → 它那一行不标「做种中」。
 *
 * 每条都配一个「老口径（只做精确等值）会得到什么」的对照。主机名一律合成。
 */
import { describe, expect, it } from "vitest";

import { isSameSiteHostRelation, resolveTrackerHostSite } from "@/shared/trackerHost.ts";

describe("isSameSiteHostRelation：按 label 边界的父子域", () => {
  it("announce 在站点域名的子域上算同一个域（这次那条就是这一档）", () => {
    expect(isSameSiteHostRelation("tracker.pandapt.net", "pandapt.net")).toBe(true);
    // 反方向同样要认：站点存的是子域、announce 是父域
    expect(isSameSiteHostRelation("pandapt.net", "tracker.pandapt.net")).toBe(true);
    expect(isSameSiteHostRelation("pandapt.net", "pandapt.net")).toBe(true);
  });

  it("不是按子串比：隔壁那个域名字面上包含它，也不算同一个域", () => {
    expect(isSameSiteHostRelation("evilpandapt.net", "pandapt.net")).toBe(false);
    expect(isSameSiteHostRelation("pandapt.net.evil.org", "pandapt.net")).toBe(false);
  });

  it("空串不认（表里有空地址时不能把所有主机名都匹配上）", () => {
    expect(isSameSiteHostRelation("", "")).toBe(false);
    expect(isSameSiteHostRelation("pandapt.net", "")).toBe(false);
  });
});

describe("resolveTrackerHostSite：认不出可以，认错不行", () => {
  const entries: [string, string][] = [
    ["pandapt.net", "pandapt"],
    ["1ptba.com", "1ptba"],
    ["pt.novahd.top", "novahd"],
    ["tracker.novahd.top", "novahd"],
  ];

  it("精确等值优先，且不走歧义判断", () => {
    expect(resolveTrackerHostSite("pandapt.net", entries)).toBe("pandapt");
  });

  it("只有父子域关系时也认得出（老口径在这里返回 undefined，那一份副本就成了「没挂过站」）", () => {
    expect(resolveTrackerHostSite("tracker.pandapt.net", entries)).toBe("pandapt");
    // 对照：老口径 `hostMap.get(host)`
    expect(new Map(entries).get("tracker.pandapt.net")).toBeUndefined();
  });

  it("两个站点都跟这个主机名有父子关系时不猜，返回 null", () => {
    const twoSites: [string, string][] = [
      ["example.com", "siteA"],
      ["x.example.com", "siteB"],
    ];
    // 这一条主机名既是 A 的子域、也是 B 的子域：两边都沾亲 → 不认
    expect(resolveTrackerHostSite("t.x.example.com", twoSites)).toBeNull();
    // 而它精确等于表里某一项时不需要歧义判断
    expect(resolveTrackerHostSite("x.example.com", twoSites)).toBe("siteB");
  });

  it("跟谁都不沾亲返回 null（不拿最近的一个凑数）", () => {
    expect(resolveTrackerHostSite("tracker.other.org", entries)).toBeNull();
  });

  it("表里的空地址不参与", () => {
    expect(resolveTrackerHostSite("anything.net", [["", "broken"] as [string, string]])).toBeNull();
  });
});
