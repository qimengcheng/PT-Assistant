import { isValid } from "date-fns";

import { fixRatio, type IUserInfo } from "@ptd/site";
import { deepToRaw, formatNumber } from "@/options/utils.ts";

export function fixUserInfo<T extends IUserInfo = IUserInfo>(userInfo: Partial<T>): Required<T> {
  userInfo = deepToRaw(userInfo);
  userInfo.ratio = fixRatio(userInfo);
  userInfo.trueRatio = fixRatio(userInfo, "trueRatio");
  userInfo.messageCount ??= 0;

  if (typeof userInfo.joinTime !== "number") {
    if (isValid(new Date(userInfo.joinTime!))) {
      userInfo.joinTime = new Date(userInfo.joinTime!).getTime();
    }
  }

  return userInfo as Required<T>;
}

export function realFormatRatio(ratio: number): string | "∞" | "" {
  if (ratio > 10000 || ratio === -1 || ratio === Infinity || ratio === null) {
    return "∞";
  }

  if (isNaN(ratio) || ratio === -Infinity) {
    return "-";
  }

  return ratio.toFixed(2);
}

export function formatRatio(
  userInfo: Partial<IUserInfo>,
  ratioKey: "ratio" | "trueRatio" = "ratio",
): string | "∞" | "" {
  const ratio = Number((userInfo[ratioKey] as string | number | undefined) ?? -1);
  return realFormatRatio(ratio);
}

/** 积分/做种积分/时魔值这一类数字：站点可能报数、报空串、报 undefined，也可能报个 NaN */
export type TBonusValue = { type: "number"; value: number } | { type: "text"; value: string };

/**
 * 把一条积分数归成「能当数算的」或「只能原样显示的文本」。
 * 判据只有这一份：`BonusFormatSpan` 的显示值、浮层里的完整值、「我的数据 → 积分」格子
 * 那个合并浮层都读它，两处各写一份就会分叉（界面上表现为浮层里的数和格子里对不上）。
 */
export function normalizeBonus(num: number | string | undefined): TBonusValue {
  if (typeof num === "number" && Number.isFinite(num)) return { type: "number", value: num };
  if (typeof num === "string") return { type: "text", value: num };
  if (num === undefined) return { type: "text", value: "-" };
  return { type: "text", value: "N/A" };
}

/** 展开成不带简化的完整数字（浮层里读的那一份） */
export function bonusFullText(num: number | string | undefined): string {
  const v = normalizeBonus(num);
  return v.type === "number" ? formatNumber(v.value) : v.value;
}
