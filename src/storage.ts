import { storage } from "wxt/utils/storage";
import { set } from "es-toolkit/compat";

import { sendMessage } from "@/messages.ts";
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
 * 扩展存储的唯一出口（wxt/storage）。键名与 @webext-core/storage 时代一致
 * （"local:config" → chrome.storage.local 的 "config"），老用户数据无需迁移。
 *
 * **按运行上下文自动二选一**：
 * - SW / options 页 / content script —— 直连本地 chrome.storage（这些上下文里 API 存在）；
 * - **offscreen document —— 不能直连**。Chrome 官方限制：offscreen 里唯一可用的扩展 API
 *   是 chrome.runtime（仅消息子集，连 getManifest 都没有），chrome.storage 根本不存在。
 *   直连 wxt/storage 会抛 "You must add the 'storage' permission to your manifest"
 *   —— v0.5.18 备份恢复失败（前端表现为 The message port closed before a response
 *   was received）的根因。此环境下 extStore 自动改走 SW 的 getExtStorage/setExtStorage/
 *   patchExtStorage 三条代理消息（handler 在 background/utils/base.ts），调用方无感知。
 *
 * ⚠️ 键命名空间与 options 页的 pinia 持久化（persistWebExt，key = store.$id）**是同一套**，
 * 都落在 chrome.storage.local 的裸 key（"config" / "metadata" / …）上。
 * 任何一处换成自己的前缀，都会做出「写进去但别处永远读不到」的静默 bug。
 */
const items = {
  config: storage.defineItem<IConfigPiniaStorageSchema | null>("local:config"),
  metadata: storage.defineItem<IMetadataPiniaStorageSchema | null>("local:metadata"),
  userInfo: storage.defineItem<TUserInfoStorageSchema | null>("local:userInfo"),
  searchResultSnapshot: storage.defineItem<TSearchResultSnapshotStorageSchema | null>("local:searchResultSnapshot"),
  keepUploadTask: storage.defineItem<TKeepUploadTaskStorageSchema | null>("local:keepUploadTask"),
};

/**
 * 按 key 串行的写队列。
 *
 * 为什么要它：`patchItem` 是「读整个 blob → 改一个路径 → 写回」，两个并发调用会互相覆盖；
 * 改 RPC 之前这件事由 background 的单写者顺带兜住，删了 RPC 就必须自己兜。
 *
 * 说清楚兜到什么程度：**这是每个上下文各自一份的互斥**（background / offscreen /
 * options / content 各一条队列），不跨上下文。跨上下文的写冲突在改造前同样存在 ——
 * options 页的 pinia 持久化从来不经 background。所以本次改动没有把一致性做差，
 * 只是把「谁在写」从隐式集中变成显式可见。真要跨上下文原子，得换成
 * 细粒度 key（一站点一 key）或 storage 事务，那是另一个决定。
 */
const writeQueues = new Map<TExtensionStorageKey, Promise<void>>();

function serialize<K extends TExtensionStorageKey>(key: K, task: () => Promise<unknown>): Promise<void> {
  const prev = writeQueues.get(key) ?? Promise.resolve();
  // 前一个写失败也要继续排队，否则一次抛错会永久卡死这个键
  const run = prev.then(task, task).then(() => undefined);
  writeQueues.set(
    key,
    run.catch(() => undefined),
  );
  return run;
}

/**
 * extStore 的对外形态。offscreen 里的远程实现与本地实现共用这一个接口，
 * 调用方（offscreen/utils/*、packages/site/utils/adapter.ts 等）无需感知自己在哪个上下文。
 */
export interface IExtStore {
  getItem<K extends TExtensionStorageKey>(key: K): Promise<IExtensionStorageSchema[K] | null>;
  setItem<K extends TExtensionStorageKey>(key: K, value: IExtensionStorageSchema[K]): Promise<void>;
  patchItem<K extends TExtensionStorageKey>(key: K, path: string, value: unknown): Promise<void>;
}

const localExtStore: IExtStore = {
  getItem<K extends TExtensionStorageKey>(key: K): Promise<IExtensionStorageSchema[K] | null> {
    return items[key].getValue() as Promise<IExtensionStorageSchema[K] | null>;
  },

  /**
   * 整键写入；与同键的 patchItem 排队互斥（本上下文内）
   */
  setItem<K extends TExtensionStorageKey>(key: K, value: IExtensionStorageSchema[K]): Promise<void> {
    return serialize(key, () => items[key].setValue(value as never));
  },

  /**
   * 按路径增量写入单个字段，例如 `patchItem("metadata", "sites.2efgpu.runtimeSettings.page", 3)`。
   *
   * 给站点 adapter 用：metadata blob 里装着 300+ 站点的 userConfig/runtimeSettings，
   * 「读全量 → 改一个字段 → 写回全量」既有 O(metadata) 的序列化开销，又会被并发写覆盖。
   */
  async patchItem<K extends TExtensionStorageKey>(key: K, path: string, value: unknown): Promise<void> {
    await serialize(key, async () => {
      const store = (await items[key].getValue()) as Record<string, any> | null;
      if (!store) {
        return;
      }
      set(store, path, value);
      // 与 setItem 同样的 `as never`：items[key] 在 K 未收窄时是 StorageItem 联合，
      // setValue 的入参被 TS 解析成各值类型的交集，直接传具体类型反而不通过
      await items[key].setValue(store as never);
    });
  },
};

/**
 * offscreen 专用：所有读写转成消息发给 SW 的代理 handler（background/utils/base.ts）。
 * 串行化由 SW 侧那唯一一份 localExtStore 的 writeQueues 兜底，这里不需要本地队列。
 */
function createRemoteExtStore(): IExtStore {
  return {
    getItem(key) {
      // 泛型协议在「键本身就是泛型参数」时返回值会退化成全字段联合，这里按 K 收窄
      return sendMessage("getExtStorage", key) as Promise<IExtensionStorageSchema[typeof key] | null>;
    },
    setItem(key, value) {
      return sendMessage("setExtStorage", { key, value });
    },
    patchItem(key, path, value) {
      return sendMessage("patchExtStorage", { key, path, value });
    },
  };
}

/**
 * 当前上下文是否能直接访问 chrome.storage。
 *
 * Chrome 的 offscreen document 是唯一拿不到的扩展上下文（只有 chrome.runtime，
 * 且 runtime.getManifest 都不存在）；SW / options / content script 都能直连。
 * 不按 entrypoint 名判断，直接探 API —— Firefox 的 background 是普通页面，
 * 未来其它受限上下文也能自动落到正确分支。
 */
function hasDirectStorageAccess(): boolean {
  const g = globalThis as { chrome?: { storage?: unknown }; browser?: { storage?: unknown } };
  return g.chrome?.storage != null || g.browser?.storage != null;
}

export const extStore: IExtStore = hasDirectStorageAccess() ? localExtStore : createRemoteExtStore();
