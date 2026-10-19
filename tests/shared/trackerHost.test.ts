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

import { isSameSiteHostRelation, resolveTrackerHostSite, trackerFieldToHost } from "@/shared/trackerHost.ts";

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

  /**
   * 用户 2026-10-19 那一屏：「这个明显是海胆的啊，怎么会认不出来呢？」
   * 海胆首页是 `www.haidan.cc`（站点定义 `urls`，rot13 解出来），announce 却在同域的另一个子域
   * `announce.haidan.cc` 上。表里存的是 `getHostFromUrl()` 的原样 host（**留着 `www.`**），
   * 而 tracker 那一侧折出来是脱过 `www.` 的 —— 两侧归一化不同源，于是父子域那一档比的是
   * `announce.haidan.cc` 对 `www.haidan.cc`，两个都是 `haidan.cc` 的孩子、谁也不是谁的父。
   */
  it("站点表里存的是带 www. 的首页域名，announce 挂在同域另一子域上 → 仍要认得出", () => {
    const entries: [string, string][] = [["www.haidan.cc", "haidan"]];
    expect(resolveTrackerHostSite("announce.haidan.cc", entries)).toBe("haidan");
    // 对照：这就是坏掉的那一步 —— 不先把两侧过同一个归一化，父子域判据结构上比不到
    expect(isSameSiteHostRelation("announce.haidan.cc", "www.haidan.cc")).toBe(false);
  });

  it("整条链从 announce 全串走到站点（两步之间不许再各自补一次规整）", () => {
    const entries: [string, string][] = [["www.haidan.cc", "haidan"]];
    expect(resolveTrackerHostSite(trackerFieldToHost("https://announce.haidan.cc/announce.php?x=1"), entries)).toBe("haidan");
    // 首页域名自己报回来时也认得（announce 就挂在 www 那个域上，是另一种常见形状）
    expect(resolveTrackerHostSite(trackerFieldToHost("https://www.haidan.cc/announce.php"), entries)).toBe("haidan");
  });

  it("脱 www. 不许把歧义蒙过去：两个站分别占着同一个父域的两种写法时仍返回 null", () => {
    // 有人把 `www.aaa.com` 和 `aaa.com` 加成两个站（同域站群、或同一个站的两个账号）。
    // 归一化之后这两项都成了 `aaa.com` 的亲 —— 这正是「脱 www.」唯一可能造出来的新歧义，
    // 判据的口径不变：两边都沾亲就不猜，返回 null（认错站比少标一条坏得多）。
    const twoSites: [string, string][] = [
      ["www.aaa.com", "siteA"],
      ["aaa.com", "siteB"],
    ];
    expect(resolveTrackerHostSite("announce.aaa.com", twoSites)).toBeNull();
    // 而精确等值那一档不经过歧义判断，照旧直接给
    expect(resolveTrackerHostSite("aaa.com", twoSites)).toBe("siteB");
  });
});

/**
 * 各家 `CTorrent.tracker` 那一格的形态不统一（qBittorrent 给 announce 全串、Deluge 给裸主机名、
 * Transmission / Flood 给 `udp://…/announce`），所以「折成主机名」这一步要单独钉住：
 * 折错了不报错，只是那一行**悄悄不标**「待辅 N 站」—— 认不出站就等于不知道它挂在哪个站。
 */
describe("trackerFieldToHost：三种形态都折成同一个主机名", () => {
  it("完整 announce 地址脱掉方案、路径与端口", () => {
    expect(trackerFieldToHost("https://Tracker.Example.NET:2710/announce")).toBe("tracker.example.net");
    expect(trackerFieldToHost("udp://tracker.example.net/announce")).toBe("tracker.example.net");
  });

  it("裸主机名原样能用（Deluge 的 tracker_host 就是这一档，不该走 new URL 报错那条路）", () => {
    expect(trackerFieldToHost("tracker.example.net")).toBe("tracker.example.net");
    expect(trackerFieldToHost("tracker.example.net:80")).toBe("tracker.example.net");
  });

  it("www. 前缀与末尾的点都去掉（这一侧的规整要和表里那一侧对齐）", () => {
    // ⚠️ 这条原先的说明写反了：它写着「反查表里存的是不带这两样的主机名」，而表里存的
    // 是 `getHostFromUrl()` 的原样 host，**带 `www.`**（`siteHostMap` 还要给内容脚本按整串 URL 查）。
    // 那句假前提就是海胆那一档漏认的来处 —— 对齐改在 `resolveTrackerHostSite` 里做，不许动那张表。
    expect(trackerFieldToHost("www.pandapt.net.")).toBe("pandapt.net");
  });

  it("空 / 缺省给空串，不抛（这一格压根没报的下载器真实存在）", () => {
    expect(trackerFieldToHost(undefined)).toBe("");
    expect(trackerFieldToHost("   ")).toBe("");
  });

  it("折出来的主机名能直接喂给反查（两步之间不许再各自补一次规整）", () => {
    const entries: [string, string][] = [["pandapt.net", "pandapt"]];
    expect(resolveTrackerHostSite(trackerFieldToHost("http://tracker.pandapt.net/announce"), entries)).toBe("pandapt");
  });
});
