/**
 * 存放一些不需要持久化（丢失没有关系的）的结构性数据，包括：
 * 1. 种子列表页面的多媒体数据
 * 2. 种子下载记录
 */

import type { DBSchema } from "idb";
import type { ISocialInformation } from "@ptd/social";
import type { TSiteID as TSiteKey } from "@ptd/site";

import type { ITorrentDownloadMetadata, TTorrentDownloadKey } from "../common/download.ts";
import type { ILocalFingerprintIndex } from "../../fingerprint/index.ts";
import type { IStoredUserInfo } from "./metadata.ts";

export interface IPtdDBSchemaV1 extends DBSchema {
  social_information: {
    key: string;
    value: ISocialInformation;
  };
}

export interface IPtdDBSchemaV2 extends IPtdDBSchemaV1 {
  download_history: {
    key: TTorrentDownloadKey;
    value: ITorrentDownloadMetadata;
  };
}

export interface IPtdDBSchema extends IPtdDBSchemaV2 {
  favicon: {
    key: TSiteKey;
    value: string;
  };
  /**
   * 本地种子指纹索引（key = 下载器 id）。
   *
   * 重建一次要按种子数发 O(n) 次 `/torrents/files`，所以必须缓存；
   * 丢了的唯一后果是下次重算，不影响正确性。
   */
  local_fingerprint: {
    key: string;
    value: ILocalFingerprintIndex;
  };
  /**
   * 站点用户信息的**按天存档**，取代 chrome.storage.local 的 `userInfo` 键。
   *
   * 为什么必须走 IndexedDB 而不是继续留在 chrome.storage：
   * 那份数据是「每天 × 每站点」只增不减的时序，而 chrome.storage 没有记录粒度 ——
   * 想改一条就得「读整块 → 改 → 写回整块」（旧实现在 offscreen/utils/userInfo.ts）。
   * 刷完 23 个站点就是 23 次全量读写，且**成本随使用年限线性上涨**：用得越久，
   * 每次刷新越慢。改成复合主键 [site, date] 后，写入是 O(1) 的 put，
   * 取某站点全部历史是主键前缀范围查询，都不碰其他站点。
   *
   * 不需要额外 index：复合主键本身按 site 再按 date 排序，
   * `IDBKeyRange.bound([site, ""], [site, "\\uffff"])` 就是「该站点全部日期」。
   */
  user_info: {
    key: [TSiteKey, string];
    value: IStoredUserInfo & { date: string };
  };
}
