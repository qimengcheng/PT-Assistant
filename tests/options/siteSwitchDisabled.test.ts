/**
 * 站点列表那几颗布尔开关的「哪颗该按住」（`src/options/views/Settings/SetSite/siteSwitchDisabled.ts`）。
 *
 * 为什么要单独一份断言：这条判据在模板里，vue-tsc / check-dead-props / ESLint 全都看不见它，
 * 而它坏一次的形状是**单向锁** —— 用户把某个站点标成「已离线」之后那一行三颗开关（开了内容
 * 脚本例外时四颗）全部按住，包括「已离线」自己，而站点编辑器里根本没有这颗开关，界面上就再也
 * 关不回去了（v0.8.0 平移带出、用户 2026-10-13 报）。所以「控制 X 的那一颗不许被 X 按住」要能
 * 当场跑，而不是靠下一次点开浏览器想起来试。
 */
import { describe, expect, it } from "vitest";

import { siteSwitchDisabled } from "@/options/views/Settings/SetSite/siteSwitchDisabled.ts";

const OFFLINE = "userConfig.isOffline";
const SEARCH = "userConfig.allowSearch";
const USERINFO = "userConfig.allowQueryUserInfo";
const CONTENT_SCRIPT = "userConfig.allowContentScript";

/** 一条普通的活站点：定义里搜索、用户信息两节都在，没标死，也没标离线 */
function site(over?: { isDead?: true; isOffline?: boolean; hasSearch?: boolean; hasUserInfo?: boolean }) {
  const metadata: { isDead?: true } & Record<string, unknown> = { name: "库非" };
  if (over?.isDead) metadata.isDead = true;
  if (over?.hasSearch !== false) metadata.search = {};
  if (over?.hasUserInfo !== false) metadata.userInfo = {};
  return { metadata, userConfig: { isOffline: over?.isOffline ?? false } };
}

describe("「已离线」自己那颗不许被离线按住（这把锁必须是双向的）", () => {
  it("站点已被标成离线：「已离线」那颗仍可点，否则用户关不回来", () => {
    expect(siteSwitchDisabled(OFFLINE, site({ isOffline: true }))).toBe(false);
  });

  it("同一行其余那颗（允许搜索）在离线时按住 —— 两列判据不同源，不是整行一起放倒", () => {
    expect(siteSwitchDisabled(SEARCH, site({ isOffline: true }))).toBe(true);
    expect(siteSwitchDisabled(USERINFO, site({ isOffline: true }))).toBe(true);
    expect(siteSwitchDisabled(CONTENT_SCRIPT, site({ isOffline: true }))).toBe(true);
  });

  it("站点定义标了 isDead 时才连「已离线」一起按住（那不是用户能改的状态）", () => {
    expect(siteSwitchDisabled(OFFLINE, site({ isDead: true }))).toBe(true);
  });
});

describe("未离线时按站点定义的能力位分档", () => {
  it("定义里没有 search 那一节 → 「允许搜索」按住；有 → 放开", () => {
    expect(siteSwitchDisabled(SEARCH, site({ hasSearch: false }))).toBe(true);
    expect(siteSwitchDisabled(SEARCH, site())).toBe(false);
  });

  it("定义里没有 userInfo 那一节 → 「获取个人信息」按住；有 → 放开", () => {
    expect(siteSwitchDisabled(USERINFO, site({ hasUserInfo: false }))).toBe(true);
    expect(siteSwitchDisabled(USERINFO, site())).toBe(false);
  });

  it("「已离线」与「内容脚本例外」没有能力位这一档，未离线时永远可点", () => {
    for (const key of [OFFLINE, CONTENT_SCRIPT]) {
      expect(siteSwitchDisabled(key, site({ hasSearch: false, hasUserInfo: false }))).toBe(false);
    }
  });
});

describe("反空转：判据真的按列分档，不是无条件放行也不是无条件按住", () => {
  it("同一份「离线 + 两节都在 + 没标死」的行上，离线那颗与另外那颗结论相反", () => {
    const row = site({ isOffline: true });
    expect(siteSwitchDisabled(OFFLINE, row)).not.toBe(siteSwitchDisabled(SEARCH, row));
  });

  it("能力位缺失只影响对应那一列，别的列不受牵连", () => {
    const row = site({ hasSearch: false });
    expect(siteSwitchDisabled(SEARCH, row)).toBe(true);
    expect(siteSwitchDisabled(USERINFO, row)).toBe(false);
    expect(siteSwitchDisabled(OFFLINE, row)).toBe(false);
  });
});
