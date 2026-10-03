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
}
