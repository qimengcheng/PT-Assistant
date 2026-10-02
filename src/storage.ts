import type { IMetadataPiniaStorageSchema } from "@/shared/types/storages/metadata.ts";

/**
 * 扩展本地存储（browser.storage.local）的顶层 schema。
 * 骨架阶段只保留 config / metadata 两个键，后续随功能扩展补充
 * （userInfo / searchResultSnapshot / keepUploadTask 等，见 PT-depiler entries/storage.ts）。
 */
export interface IExtensionStorageSchema {
  config: Record<string, any>;
  metadata: IMetadataPiniaStorageSchema;
}

export type TExtensionStorageKey = keyof IExtensionStorageSchema;
