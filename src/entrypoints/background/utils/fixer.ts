/**
 * 存储坏数据修复（平移自 PT-depiler background/utils/fixer.ts）。
 * 扩展升级后首次安装时（runtime.onInstalled）修复历史版本写入的字符串型
 * ratio / trueRatio / seeding / joinTime 字段。
 */
import { isValid } from "date-fns";

import type { IStoredUserInfo, TUserInfoStorageSchema } from "@/shared/types.ts";
import { readAllArchive, replaceArchive } from "@/shared/userInfoArchive.ts";

// 修复用户信息中的坏数据
function fixStoredUserInfo(userInfo: Partial<IStoredUserInfo>): { fixed: IStoredUserInfo; hasChanges: boolean } {
  const fixed = { ...userInfo } as IStoredUserInfo;
  let hasChanges = false;

  // 修复 ratio 和 trueRatio，如果是字符串则尝试转换为数字
  // noinspection SuspiciousTypeOfGuard
  if (typeof userInfo.ratio === "string") {
    const ratioNum = parseFloat(userInfo.ratio);
    if (!isNaN(ratioNum)) {
      fixed.ratio = Math.round(ratioNum * 100) / 100;
      hasChanges = true;
    }
  }

  // noinspection SuspiciousTypeOfGuard
  if (typeof userInfo.trueRatio === "string") {
    const trueRatioNum = parseFloat(userInfo.trueRatio);
    if (!isNaN(trueRatioNum)) {
      fixed.trueRatio = Math.round(trueRatioNum * 100) / 100;
      hasChanges = true;
    }
  }

  // 修复 seeding，如果是字符串则尝试转换为数字
  // noinspection SuspiciousTypeOfGuard
  if (typeof userInfo.seeding === "string") {
    const seedingNum = parseInt(userInfo.seeding);
    fixed.seeding = isNaN(seedingNum) ? 0 : seedingNum;
    hasChanges = true;
  }

  // 修复 joinTime
  // noinspection SuspiciousTypeOfGuard
  if (typeof userInfo.joinTime === "string") {
    const joinTime = new Date(userInfo.joinTime);
    if (isValid(joinTime)) {
      fixed.joinTime = +joinTime;
      hasChanges = true;
    }
  }

  return { fixed, hasChanges };
}

// 修复所有存储的用户信息数据
export async function fixAllStoredUserInfo(): Promise<void> {
  try {
    // 按天存档已从 chrome.storage.local 的 `userInfo` 键迁到 IndexedDB，读写统一走
    // @/shared/userInfoArchive —— 不能在这里另开一套直连 extStore 的实现，
    // 否则迁移后这条路径读到的是空对象，脏数据修复会静默变成空操作。
    const userInfoStore = await readAllArchive();

    let hasChanges = false;
    const fixedUserInfoData = {} as TUserInfoStorageSchema;

    for (const [siteId, siteUserInfo] of Object.entries(userInfoStore)) {
      fixedUserInfoData[siteId] = {};
      for (const [date, userInfo] of Object.entries(siteUserInfo)) {
        const result = fixStoredUserInfo(userInfo);

        // 检查是否有变化
        if (result.hasChanges) {
          hasChanges = true;
        }

        fixedUserInfoData[siteId][date] = result.fixed;
      }
    }

    // 只有当有变化时才更新存储
    if (hasChanges) {
      await replaceArchive(fixedUserInfoData);
      console.debug("[PTD] Fixed corrupted user info data");
    }
  } catch (error) {
    console.error("[PTD] Error fixing user info data:", error);
  }
}
