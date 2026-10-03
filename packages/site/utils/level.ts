// noinspection ES6PreferShortImport

import { intersection } from "es-toolkit";
import { includes, isEmpty } from "es-toolkit/compat";
import { intervalToDuration } from "date-fns";

import type { IImplicitUserInfo, ILevelRequirement, IUserInfo, TLevelGroupType, TLevelId } from "../types";
import { parseSizeString } from "./filesize";
import { convertIsoDurationToDate, type isoDuration } from "./datetime";

export const MinVipLevelId = 100;
export const MinManagerLevelId = 200;

export function cleanLevelName(levelName: string): string {
  return levelName.replace(/[\s _]+/g, "").toLowerCase();
}

const ratioCountMap = {
  ratio: ["uploaded", "downloaded"],
  trueRatio: ["trueUploaded", "trueDownloaded"],
} as const;

/**
 * bonus/bonusPerHour 协议上允许 "N/A" 等字符串占位（见 IImplicitUserInfo），
 * 数值比较前统一归一：数字原样返回，字符串 parseFloat，无法解析按 0 处理。
 */
const toNumeric = (v: number | string | undefined | null): number => {
  if (typeof v === "number") return v;
  if (typeof v === "string") return parseFloat(v) || 0;
  return 0;
};

export function fixRatio(userInfo: Partial<IUserInfo>, ratioKey: "ratio" | "trueRatio" = "ratio"): number {
  let ratio = -1;
  if (typeof userInfo[ratioKey] === "undefined") {
    const [uploadedKey, downloadedKey] = ratioCountMap[ratioKey];
    const { [uploadedKey]: uploaded = 0, [downloadedKey]: downloaded = 0 } = userInfo;

    if (downloaded == 0 && uploaded == 0) {
      return -Infinity;
    } else if (downloaded == 0 && uploaded > 0) {
      ratio = Infinity; // 没有下载量时设置分享率为无限
    } else if (downloaded > 0) {
      ratio = uploaded / downloaded;
    }
  } else {
    ratio = userInfo[ratioKey];
  }
  return ratio;
}

export function guessUserLevelGroupType(levelName: string): TLevelGroupType {
  let userLevel = levelName.toLowerCase();
  let specialNames: Record<"manager" | "vip", string[]> = {
    manager: [
      ["retiree", "养老", "退休"],
      ["uploader", "发布", "发种", "上传", "种子"],
      ["helper", "assistant", "助手", "助理"],
      ["seeder", "保种"],
      ["transferrer", "转载"],
      ["forum", "版主"],
      ["moderator", "admin", "管理"],
      ["sys", "coder", "开发"],
      ["staff", "主管"],
    ].flat(),
    vip: ["vip", "贵宾", "honor", "荣誉"],
  };
  let res = "user";
  for (const [k, levelNames] of Object.entries(specialNames)) {
    if (levelNames.some((n: string) => includes(userLevel, n))) {
      res = k;
      break;
    }
  }
  return res as TLevelGroupType;
}

export function levelRequirementUnMet(
  userInfo: IUserInfo,
  levelRequirement: ILevelRequirement | IImplicitUserInfo,
): Partial<Omit<ILevelRequirement, "id" | "name" | "groupType" | "privilege">> {
  const unmetRequirement: Partial<Omit<ILevelRequirement, "id" | "name" | "groupType" | "privilege">> = {};

  // 如果未定义站点等级要求，直接返回
  if (!levelRequirement) {
    return unmetRequirement;
  }

  const currentTime = +new Date();
  // Object.keys 天生返回 string[]，这里与下面各白名单数组交叉使用，统一收窄为协议键
  const levelRequirementKeys = Object.keys(levelRequirement) as (keyof ILevelRequirement)[];

  // 比较加入时间
  if (levelRequirement.interval) {
    const baseTimeInfo = userInfo.joinTime ?? currentTime;
    const passTime = convertIsoDurationToDate(levelRequirement.interval, baseTimeInfo);
    if (passTime > currentTime) {
      // 计算通过时间与当前时间的时间差
      const leftDuration = intervalToDuration({ start: currentTime, end: passTime });
      let interval = "P";
      if (leftDuration.years) interval += `${leftDuration.years}Y`;
      if (leftDuration.months) interval += `${leftDuration.months}M`;
      if (leftDuration.days) interval += `${leftDuration.days}D`;
      unmetRequirement.interval = interval as isoDuration; // 只保留日期部分
      unmetRequirement.passTime = +passTime; // 附带绝对达标时间，供前端渲染日期时直接使用（#1140）
    }
  }

  // 比较 totalTraffic, downloaded, trueDownloaded, uploaded, trueUploaded, seedingSize 等体积类字段需求
  const sizeKeys = [
    "totalTraffic",
    "downloaded",
    "trueDownloaded",
    "uploaded",
    "trueUploaded",
    "seedingSize",
    "specialSeedingSize",
  ] as const;
  for (const currentSizeElement of intersection(
    sizeKeys as readonly string[],
    levelRequirementKeys,
  ) as (typeof sizeKeys)[number][]) {
    // 需求侧：字符串体积描述（如 "1.5TB"）先解析成 Byte
    const rawSizeRequirement = levelRequirement[currentSizeElement];
    const currentSizeRequirement =
      typeof rawSizeRequirement === "string" ? parseSizeString(rawSizeRequirement) : (rawSizeRequirement ?? 0);

    // 用户侧：specialSeedingSize 等字段协议上允许 string|number，同样兜底解析
    const rawBaseSize = userInfo[currentSizeElement] ?? 0;
    const baseSizeInfo = typeof rawBaseSize === "string" ? parseSizeString(rawBaseSize) : rawBaseSize;

    if (baseSizeInfo < currentSizeRequirement) {
      unmetRequirement[currentSizeElement] = currentSizeRequirement - baseSizeInfo;
    }
  }

  for (const ratioKey of intersection(["ratio", "trueRatio"], levelRequirementKeys) as ("ratio" | "trueRatio")[]) {
    // 计算并设置 ratio 或 trueRatio
    userInfo[ratioKey] = fixRatio(userInfo, ratioKey);

    const requireRatio = levelRequirement[ratioKey];

    let minRequireRatio: number | undefined;
    let maxRequireRatio: number | undefined;

    // [number, number]，分享率限制模式
    if (Array.isArray(requireRatio) && requireRatio.length === 2 && requireRatio.every((x) => typeof x === "number")) {
      [minRequireRatio, maxRequireRatio] = requireRatio.sort((a, b) => a - b);
      // number 格式 直接赋值
    } else if (typeof requireRatio === "number") {
      minRequireRatio = requireRatio;
    } else {
      // string格式输入的容错处理
      minRequireRatio = parseFloat(String(requireRatio));
    }

    const [uploadedKey, downloadedKey] = ratioCountMap[ratioKey];

    // 获取当前数值
    const {
      [uploadedKey]: baseUploaded = 0,
      [downloadedKey]: baseDownloaded = 0,
      [ratioKey]: baseRatio = -1,
    } = userInfo;

    const requiredDownloaded =
      typeof levelRequirement[downloadedKey] === "string"
        ? parseSizeString(levelRequirement[downloadedKey])
        : (levelRequirement[downloadedKey] ?? 0);

    const requiredUploaded =
      typeof levelRequirement[uploadedKey] === "string"
        ? parseSizeString(levelRequirement[uploadedKey])
        : (levelRequirement[uploadedKey] ?? 0);

    // 检查最小 ratio 限制
    if (minRequireRatio) {
      if (baseRatio < minRequireRatio) {
        unmetRequirement[ratioKey] = minRequireRatio;
      }

      // 只有上传和ratio要求，没有下载要求的情况
      if (requiredUploaded > 0 && requiredDownloaded === 0) {
        // 计算满足ratio要求所允许的最大下载量
        const maxAllowedDownload = requiredUploaded / minRequireRatio;

        // 如果当前下载量已经超过这个允许值，那么需要增加上传量
        if (baseDownloaded > maxAllowedDownload) {
          const neededUpload = baseDownloaded * minRequireRatio;
          // unmet 里存的始终是 Byte 差值；类型上 uploaded 允许 TSize，narrow 掉字符串形态
          const prevUploadedUnmet = unmetRequirement[uploadedKey];
          unmetRequirement[uploadedKey] = Math.max(
            typeof prevUploadedUnmet === "number" ? prevUploadedUnmet : 0,
            neededUpload - baseUploaded,
          );
        }
      } else {
        // 使用当前下载量和要求下载量中的较大值作为基准
        const targetDownload = Math.max(baseDownloaded, requiredDownloaded);
        const neededUpload = targetDownload * minRequireRatio;

        // 即使上传量已经超过了基本上传要求，也可能因为下载量大而导致 ratio 不足
        // 此时需要额外上传以满足 ratio 要求
        if (baseUploaded < neededUpload) {
          const prevUploadedUnmet = unmetRequirement[uploadedKey];
          unmetRequirement[uploadedKey] = Math.max(
            typeof prevUploadedUnmet === "number" ? prevUploadedUnmet : 0,
            neededUpload - baseUploaded,
          );
        }
      }
    }

    // 检查最大 ratio 限制
    if (maxRequireRatio) {
      if (baseRatio > maxRequireRatio) {
        unmetRequirement[ratioKey] = maxRequireRatio;
      }

      const neededDownload = baseUploaded / maxRequireRatio;

      if (baseDownloaded < neededDownload) {
        const prevDownloadedUnmet = unmetRequirement[downloadedKey];
        unmetRequirement[downloadedKey] = Math.max(
          typeof prevDownloadedUnmet === "number" ? prevDownloadedUnmet : 0,
          neededDownload - baseDownloaded,
        );
      }
    }
  }

  // 比较 seedingTime, averageSeedingTime 等时间长度类字段需求
  const durationKeys = ["seedingTime", "averageSeedingTime"] as const;
  for (const currentDurationElement of intersection(
    durationKeys as readonly string[],
    levelRequirementKeys,
  ) as (typeof durationKeys)[number][]) {
    let currentDurationRequirement = levelRequirement[currentDurationElement];

    if (typeof currentDurationRequirement === "string") {
      // 将 isoDuration 转为 秒！！！
      currentDurationRequirement =
        (convertIsoDurationToDate(currentDurationRequirement as isoDuration, currentTime) - currentTime) / 1e3;
    }

    // 用户侧协议类型是 number | isoDuration，抓取后约定为秒数，这里对字符串形态做同样的归一
    const rawBaseDuration = userInfo[currentDurationElement] ?? 0;
    const baseDurationInfo =
      typeof rawBaseDuration === "string"
        ? (convertIsoDurationToDate(rawBaseDuration, currentTime) - currentTime) / 1e3
        : rawBaseDuration;
    if (baseDurationInfo < (currentDurationRequirement ?? 0)) {
      unmetRequirement[currentDurationElement] = (currentDurationRequirement ?? 0) - baseDurationInfo;
    }
  }

  // 比较 bonus, bonusPerHour, seedingBonus, uploads, leeching, snatches, posts 等应该大于的字段
  const gtKeys = [
    "bonus",
    "bonusPerHour",
    "seedingBonus",
    "uploads",
    "leeching",
    "snatches",
    "posts",
    "perfectFlacs",
    "groups",
  ] as const;
  for (const currentGtElement of intersection(
    gtKeys as readonly string[],
    levelRequirementKeys,
  ) as (typeof gtKeys)[number][]) {
    // bonus/bonusPerHour 可能是 "N/A" 字符串，两侧都归一成数字再比较
    const currentGtRequirement = toNumeric(levelRequirement[currentGtElement] as number | string | undefined);
    const baseGtInfo = toNumeric(userInfo[currentGtElement] as number | string | undefined);

    if (baseGtInfo < currentGtRequirement) {
      unmetRequirement[currentGtElement] = currentGtRequirement - baseGtInfo;
    }
  }

  // 额外计算 增加到达下一级魔力所需时间 （#7）
  for (const bonusKey of ["bonus", "seedingBonus"] as const) {
    const perHourKey = `${bonusKey}PerHour` as "bonusPerHour" | "seedingBonusPerHour";
    const perHourValue = toNumeric(userInfo[perHourKey] ?? userInfo.bonusPerHour); // issue#681
    if (unmetRequirement[bonusKey] && toNumeric(levelRequirement[bonusKey]) && perHourValue > 0) {
      // 如果未满足 bonus 条件，且获取到了 bonusPerHour
      const currentBonus = toNumeric(userInfo[bonusKey]);
      const leftBonus = toNumeric(levelRequirement[bonusKey]) - currentBonus; // Fixed by #676
      if (leftBonus > 0) {
        const leftTime = leftBonus / parseFloat(String(perHourValue));
        const neededIntervalKey = `${bonusKey}NeededInterval` as
          | "bonusNeededInterval"
          | "seedingBonusNeededInterval";
        unmetRequirement[neededIntervalKey] = `${Math.floor(leftTime)}H`;
      }
    }
  }

  // 比较 hnrUnsatisfied 等应该小于等于的字段
  for (const currentLtElement of intersection(["hnrUnsatisfied"], levelRequirementKeys) as "hnrUnsatisfied"[]) {
    const currentLtRequirement = levelRequirement[currentLtElement] ?? 0;
    const baseLtInfo = userInfo[currentLtElement] ?? 0;

    if (baseLtInfo > currentLtRequirement) {
      unmetRequirement[currentLtElement] = baseLtInfo - currentLtRequirement;
    }
  }

  // 比较可选项，可选项中只要有一个满足即可。
  // alternative 只声明在 ILevelRequirement 上，而本函数参数允许纯 IImplicitUserInfo，用 in 收窄。
  const alternatives = "alternative" in levelRequirement ? levelRequirement.alternative : undefined;
  if (alternatives) {
    let alternativeUnMet: ReturnType<typeof levelRequirementUnMet>[] = [];

    for (const alternative of alternatives) {
      alternativeUnMet.push(levelRequirementUnMet(userInfo, alternative));
    }

    alternativeUnMet = alternativeUnMet.filter((x) => !isEmpty(x));

    // 如果有至少一个满足则返回 false
    if (alternativeUnMet.length == alternatives.length) {
      unmetRequirement.alternative = alternativeUnMet;
    }
  }

  return unmetRequirement;
}

export function isLevelRequirementMet(userInfo: IUserInfo, levelRequirement: ILevelRequirement): boolean {
  return isEmpty(levelRequirementUnMet(userInfo, levelRequirement));
}

export function getMaxUserLevelId(levelRequirements: ILevelRequirement[]): TLevelId {
  return levelRequirements
    .map((x) => ({ ...x, groupType: x.groupType ?? "user" }))
    .filter((x) => x.groupType === "user")
    .reduce((max, current) => (current.id > max ? current.id : max), 0);
}

export function getNextLevelUnMet(
  userInfo: IUserInfo,
  levelRequirements: ILevelRequirement[],
): Partial<IImplicitUserInfo & { level?: ILevelRequirement }> {
  let nextLevelUnMet: Partial<IImplicitUserInfo & { level?: ILevelRequirement }> = {};

  const currentLevelId = userInfo.levelId ?? -1;
  if (currentLevelId < getMaxUserLevelId(levelRequirements)) {
    const nextLevelRequirement = levelRequirements.find((level) => level.id > currentLevelId);
    nextLevelUnMet = { ...levelRequirementUnMet(userInfo, nextLevelRequirement!), level: nextLevelRequirement };
  }

  return nextLevelUnMet;
}

export function guessUserLevelId(userInfo: IUserInfo, levelRequirements: ILevelRequirement[]): TLevelId {
  // 首先尝试 levelName 的直接匹配，站点levelRequirements中配置的 name 一定要等于或包含 获取到的 levelName 中才会匹配成功
  let level = levelRequirements.find((level) => {
    const cleanedUserLevelName = cleanLevelName(userInfo.levelName!);
    return [level.name, ...(level.nameAka ?? [])]
      .map(cleanLevelName)
      .some((name) => name.includes(cleanedUserLevelName));
  });
  if (level) {
    return level.id;
  }

  // 再尝试判断 groupType
  let groupType = guessUserLevelGroupType(userInfo.levelName!);
  if (groupType !== "user") {
    level = levelRequirements.find((level) => level.groupType === groupType);
    if (level) {
      return level.id;
    } else {
      // 如果没有找到，这个人也应该是 vip 或者 manager，则返回一个默认值
      return groupType == "vip" ? MinVipLevelId : MinManagerLevelId;
    }
  }

  // 如果还是没有找到，说明应当是 user 类别的某一个，则尝试通过 userInfo 和 levelRequirements 的具体项匹配
  let testLevel = getMaxUserLevelId(levelRequirements);
  for (const levelIndex in levelRequirements ?? []) {
    const testLevelRequirement = levelRequirements[levelIndex];
    if (!isLevelRequirementMet(userInfo, testLevelRequirement)) {
      // 这个 level 对应的条件没有满足，返回上一个 level 的 id
      const prevLevelIndex = parseInt(levelIndex) - 1;
      if (prevLevelIndex >= 0) {
        testLevel = levelRequirements[prevLevelIndex].id;
      } else {
        // 如果没有上一个 level，比如部分NPHP从 PU 开始定义的
        testLevel = -1;
      }

      break;
    }
  }

  return testLevel;
}
