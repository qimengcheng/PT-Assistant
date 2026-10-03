import { storage } from "wxt/utils/storage";

import type {
  IConfigPiniaStorageSchema,
  IMetadataPiniaStorageSchema,
  TUserInfoStorageSchema,
  TSearchResultSnapshotStorageSchema,
  TKeepUploadTaskStorageSchema,
} from "@/shared/types.ts";

export interface IExtensionStorageSchema {
  // 既可以被 pinia 使用，也可以被其他地方使用
  config: IConfigPiniaStorageSchema;

  metadata: IMetadataPiniaStorageSchema;

  userInfo: TUserInfoStorageSchema; // 用于存储用户信息
  searchResultSnapshot: TSearchResultSnapshotStorageSchema; // 用于存储搜索结果快照
  keepUploadTask: TKeepUploadTaskStorageSchema; // 用于存储辅种任务
}

export type TExtensionStorageKey = keyof IExtensionStorageSchema;

/**
 * wxt/storage（WXT 官方推荐）实现。键名与 @webext-core/storage 时代一致
 * （"local:config" → chrome.storage.local 的 "config"），老用户数据无需迁移。
 *
 * 注意 extStore 不能在 offscreen 中使用，如果在 offscreen 中有需要，请使用 sw 提供的
 * sendMessage('getExtStorage' | 'setExtStorage')（与 PT-depiler 一致）。
 */
const items = {
  config: storage.defineItem<IConfigPiniaStorageSchema | null>("local:config"),
  metadata: storage.defineItem<IMetadataPiniaStorageSchema | null>("local:metadata"),
  userInfo: storage.defineItem<TUserInfoStorageSchema | null>("local:userInfo"),
  searchResultSnapshot: storage.defineItem<TSearchResultSnapshotStorageSchema | null>("local:searchResultSnapshot"),
  keepUploadTask: storage.defineItem<TKeepUploadTaskStorageSchema | null>("local:keepUploadTask"),
};

export const extStore = {
  getItem<K extends TExtensionStorageKey>(key: K): Promise<IExtensionStorageSchema[K] | null> {
    return items[key].getValue() as Promise<IExtensionStorageSchema[K] | null>;
  },
  setItem<K extends TExtensionStorageKey>(key: K, value: IExtensionStorageSchema[K]) {
    return items[key].setValue(value as never);
  },
};
