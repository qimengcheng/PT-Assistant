import { toRaw, isRef, isReactive, isProxy } from "vue";
// Note: filesize library changed type name from FileSizeOptions to FilesizeOptions in v11.0+
import { filesize, type FilesizeOptions } from "filesize";
import {
  differenceInDays,
  differenceInHours,
  differenceInMonths,
  differenceInWeeks,
  differenceInYears,
  differenceInMinutes,
  format as dateFormat,
} from "date-fns";
import { i18n } from "@/options/plugins/i18n.ts";
import { toSizeBytes } from "@/shared/torrentSize.ts";

export function deepToRaw<T>(sourceObj: T): T {
  const objectIterator = (input: unknown): unknown => {
    if (Array.isArray(input)) {
      return input.map((item) => objectIterator(item));
    }
    if (isRef(input) || isReactive(input) || isProxy(input)) {
      return objectIterator(toRaw(input));
    }
    if (input && typeof input === "object") {
      const source = input as Record<string, unknown>;
      return Object.keys(source).reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = objectIterator(source[key]);
        return acc;
      }, {});
    }
    return input;
  };

  return objectIterator(sourceObj) as T;
}

/**
 * 表单校验规则：`(args) => (value) => true | 错误文案`。
 *
 * 值这一侧收成 unknown 是有原因的 —— 调用方传进来的就是界面原值（输入框可能给出
 * number / null / undefined），而 `RegExp.test` 与 `!!` 本来做的就是同一套强制转换，
 * 这里显式 String() 不改变判据。
 */
export const formValidateRules: Record<string, (args?: string) => (v: unknown) => boolean | string> = {
  require: (args: string = "Item is required") => {
    return (v: unknown) => !!v || args;
  },
  url: (args: string = "Not url") => {
    return (v: unknown) => /^(https?):\/\/[-A-Za-z0-9+&@#/%?=~_|!:,.;[\]]+[-A-Za-z0-9+&@#/%=~_|]$/.test(String(v)) || args;
  },
};

export const formatSize = (size: number | string, options?: FilesizeOptions) => {
  try {
    return filesize(size, { base: 2, round: 2, pad: true, ...(options ?? {}) });
  } catch (e) {
    return size;
  }
};

/**
 * 种子大小那一格的文字：判不出处给 `-`，不写 `0 B`。
 *
 * 「什么算判不出」不在这里重写一遍，用的是 `@/shared/torrentSize` 的 `toSizeBytes` ——
 * 解析层读不懂页面文本时回的是 0（`@ptd/site` 的 `parseSizeString`：文本不匹配 `sizePattern`
 * 就 `return 0`，它把「读不懂」折成了「零字节」），而 0 字节不是任何一份真实内容。
 * 照着 `formatSize(x ?? 0)` 画出来就是「这个站说这份种子是 0 字节」—— 1PTBar 那一行（用户
 * 2026-10-15 报的）。同一口径先用在人数列（`@/shared/torrentCount` 的 `countText`）与进度（`toPercent`）。
 */
export const sizeText = (size: unknown): string => {
  const bytes = toSizeBytes(size);
  // formatSize 的返回类型是 `string | number`（它 catch 分支原样回吐入参），这里统一成字符串
  return bytes === null ? "-" : String(formatSize(bytes));
};

export const formatDate = (date: Date | number | string, format: string = "yyyy-MM-dd HH:mm:ss") => {
  try {
    return dateFormat(date, format);
  } catch (e) {
    return date as string;
  }
};

interface formatTimeAgoOptions {
  weekOnly?: boolean; // 是否只显示周数（即小于一周的显示为“不到一周”）
  spacer?: string; // 年月日等单位之间的分隔符，默认为一个空格
}

export const formatTimeAgo = (sourceDate: Date | number | string, options: formatTimeAgoOptions = {}): string => {
  const nowDate = new Date();

  const { weekOnly = false, spacer = " " } = options;

  if (weekOnly) {
    const weeks = differenceInWeeks(nowDate, sourceDate);
    if (weeks < 1) {
      return i18n.t("common.time.lessThanAWeek");
    }
    return `${weeks}${spacer}${i18n.t("common.time.week")}` + i18n.t("common.time.ago");
  }

  const years = differenceInYears(nowDate, sourceDate);
  const months = differenceInMonths(nowDate, sourceDate) % 12;
  const days = differenceInDays(nowDate, sourceDate) % 30;
  const hours = differenceInHours(nowDate, sourceDate) % 24;
  const mins = differenceInMinutes(nowDate, sourceDate) % 60;

  let result;
  if (years > 0) {
    result = `${years}${spacer}${i18n.t("common.time.year")}${spacer}${months}${spacer}${i18n.t("common.time.month")}`;
  } else if (months > 0) {
    result = `${months}${spacer}${i18n.t("common.time.month")}${spacer}${days}${spacer}${i18n.t("common.time.day")}`;
  } else if (days > 0) {
    result = `${days}${spacer}${i18n.t("common.time.day")}${spacer}${hours}${spacer}${i18n.t("common.time.hour")}`;
  } else if (hours > 0) {
    result = `${hours}${spacer}${i18n.t("common.time.hour")}${spacer}${mins}${spacer}${i18n.t("common.time.minute")}`;
  } else if (mins > 0) {
    result = `${mins}${spacer}${i18n.t("common.time.minute")}`;
  } else {
    result = `< 1${spacer}${i18n.t("common.time.minute")}`;
  }
  return result + i18n.t("common.time.ago");
};

export const formatNumber = (num: number, options: Intl.NumberFormatOptions = {}) =>
  Number(num).toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2, ...options });

// 定义单位和对应的阈值
const simplifyNumberUnits = [
  { threshold: 1000000000000, suffix: "T" },
  { threshold: 1000000000, suffix: "B" },
  { threshold: 1000000, suffix: "M" },
  { threshold: 1000, suffix: "K" },
];

// 数字简化函数，将大数字转换为带单位的简化形式（用于bonus相关数字）
export const simplifyNumber = (num: number | string, spacer: string = ""): string => {
  const numValue = typeof num === "string" ? parseFloat(num) : num;

  if (isNaN(numValue)) {
    return "-";
  }

  const absNum = Math.abs(numValue);

  // 找到合适的单位
  for (const { threshold, suffix } of simplifyNumberUnits) {
    if (absNum >= threshold) {
      const value = numValue / threshold;
      // 如果是整数，不显示小数点
      return value.toFixed(2) + spacer + suffix;
    }
  }

  // 小于1000的数字直接返回
  return numValue.toFixed(2);
};
