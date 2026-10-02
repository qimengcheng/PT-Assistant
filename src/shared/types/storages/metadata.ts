import type { ISiteUserConfig, TSiteID } from "@ptd/site";

/**
 * metadata 存储 schema 的骨架版（对应 PT-depiler shared/types/storages/metadata.ts）。
 * 骨架阶段只展开 sites 字段（site 包 adapter.ts 的 store/retrieve 依赖它），
 * solutions / downloaders / backupServers 等随功能平移逐步补充。
 */
export interface IMetadataPiniaStorageSchema {
  // 站点配置（用户配置）
  sites: Record<TSiteID, ISiteUserConfig & { [key: string]: any }>;

  // 其他配置项
  [key: string]: any;
}
