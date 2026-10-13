/**
 * 站点等级提升的判据与措辞（`src/shared/levelUp.ts`）—— v0.95.0 那条「升级要放烟花祝贺」的地基。
 *
 * 为什么这份用例必须存在：祝贺是**替用户判定一件事成功了**，误报比漏报贵 ——
 * 一次「把没解析出等级说成升了级」会让用户以为自己在往上走。所以下面每一条都在钉
 * 「什么情况下不许吭声」，而不是钉文案好不好看。
 *
 * 措辞那几条按**整句**比，不比对 substring：界面卡片和系统通知吃的是同一份函数，
 * 句子改了一个字要在这里看得见（v0.79.0 那条「只有一条任务时文案必须与原来那句一字不差」同判据）。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  LEVEL_UP_DETAIL_MAX,
  NON_USER_LEVEL_ID,
  detectLevelUp,
  levelUpDetailLines,
  levelUpLead,
  levelUpNoticeMessage,
  levelUpTitle,
  type ILevelUpItem,
} from "@/shared/levelUp.ts";

const item = (siteName: string, levelName?: string): ILevelUpItem => ({ siteName, levelName });

describe("detectLevelUp：三条都得成立才算升级", () => {
  it("普通用户档内往上 = 升", () => {
    expect(detectLevelUp(3, 4)).toBe(true);
    expect(detectLevelUp(0, 1)).toBe(true);
  });

  it("同档重刷、降级都不算", () => {
    expect(detectLevelUp(4, 4)).toBe(false);
    expect(detectLevelUp(5, 3)).toBe(false);
  });

  it("上下任意一份拿不出数字等级 ID 就不吭声", () => {
    expect(detectLevelUp(undefined, 4)).toBe(false);
    expect(detectLevelUp(3, undefined)).toBe(false);
    expect(detectLevelUp(NaN, 4)).toBe(false);
    expect(detectLevelUp(3, Number.POSITIVE_INFINITY)).toBe(false);
  });

  it("-1 那个哨兵不许被当成「第 -1 级」—— 否则「没解析出来」会说成「从 -1 升到 3，恭喜」", () => {
    expect(detectLevelUp(-1, 3)).toBe(false);
    expect(detectLevelUp(-1, -1)).toBe(false);
  });

  it("跨进贵宾 / 管理组那一档不算逐级升级（身份变化，不是又升一级）", () => {
    expect(detectLevelUp(3, NON_USER_LEVEL_ID)).toBe(false);
    expect(detectLevelUp(NON_USER_LEVEL_ID - 1, NON_USER_LEVEL_ID)).toBe(false);
    expect(detectLevelUp(NON_USER_LEVEL_ID, NON_USER_LEVEL_ID + 1)).toBe(false);
  });

  it("普通用户档内到顶那一级仍然算", () => {
    expect(detectLevelUp(NON_USER_LEVEL_ID - 2, NON_USER_LEVEL_ID - 1)).toBe(true);
  });

  it("档位常量与包内那份同值（真源在 packages，这里按字面量对齐，不许各写一套）", () => {
    const src = readFileSync(resolve(process.cwd(), "packages/site/types/userinfo.ts"), "utf8");
    const matched = /MinNonUserLevelId\s*=\s*(\d+)/.exec(src);
    expect(matched, "packages 里那条 MinNonUserLevelId 读不到了").not.toBeNull();
    expect(NON_USER_LEVEL_ID).toBe(Number(matched?.[1]));
  });
});

describe("措辞：卡片与系统通知同一份", () => {
  it("标题两种语言各一句", () => {
    expect(levelUpTitle("zh_CN")).toBe("恭喜，站点等级提升");
    expect(levelUpTitle("en")).toBe("Congratulations on a level-up");
  });

  it("只有一条：正文说清是哪个站、升到哪一级", () => {
    expect(levelUpLead([item("hdhome", "资深会员")], "zh_CN")).toBe("你在「hdhome」升到「资深会员」");
    expect(levelUpLead([item("hdhome")], "zh_CN")).toBe("你在「hdhome」的等级提升了");
    expect(levelUpLead([item("hdhome", "Veteran")], "en")).toBe('You reached "Veteran" on hdhome');
    expect(levelUpLead([item("hdhome")], "en")).toBe("You reached a new level on hdhome");
  });

  it("只有一条时**没有**明细行 —— 正文已经写完这件事，多一行重复是噪声", () => {
    expect(levelUpDetailLines([item("hdhome", "资深会员")], "zh_CN")).toEqual([]);
  });

  it("多条：正文说条数，明细最多 3 条，剩下并成一句", () => {
    const four = [item("hdhome", "资深会员"), item("pter", "精英用户"), item("u2", "POWERUSER"), item("kpss", "KpSSer")];
    expect(levelUpLead(four, "zh_CN")).toBe("有 4 个站点的等级升到了下一级");
    const lines = levelUpDetailLines(four, "zh_CN");
    // 3 行明细 + 1 行汇总 = 4 行；上限管的是**点名**几站，那句「另有」不算点名
    expect(lines).toHaveLength(LEVEL_UP_DETAIL_MAX + 1);
    expect(lines).toEqual(["hdhome → 资深会员", "pter → 精英用户", "u2 → POWERUSER", "另有 1 个站点"]);
  });

  it("拿不出等级名时明细只写站点名，不编一个名字出来", () => {
    expect(levelUpDetailLines([item("hdhome"), item("pter")], "zh_CN")).toEqual(["hdhome", "pter"]);
  });

  it("空批次不炸（正文退成通用那句，明细为空）", () => {
    expect(levelUpLead([], "zh_CN")).toBe("站点等级提升");
    expect(levelUpDetailLines([], "zh_CN")).toEqual([]);
  });

  it("系统通知那条 = 正文 + 明细，按行拼（通知栏不渲染 HTML，只能一串）", () => {
    const three = [item("hdhome", "资深会员"), item("pter", "精英用户"), item("u2", "POWERUSER")];
    expect(levelUpNoticeMessage(three, "zh_CN")).toBe(
      "有 3 个站点的等级升到了下一级\nhdhome → 资深会员\npter → 精英用户\nu2 → POWERUSER",
    );
    expect(levelUpNoticeMessage([item("hdhome", "资深会员")], "zh_CN")).toBe("你在「hdhome」升到「资深会员」");
  });
});
