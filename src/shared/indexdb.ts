/**
 * 扩展共享的 IndexedDB（库名 `ptd`）。
 *
 * 原先这个句法定义在 `src/entrypoints/offscreen/adapter/indexdb.ts` 里，只有 offscreen 用。
 * 现在 options 页也要**只读**其中的 `favicon` 表（图标抓过一次就不必再绕 offscreen），
 * 而同一个库的 `openDB` 定义**必须只有一份**：
 *
 * - 若 options 自己再写一个 `openDB("ptd", 4)` 但不带 upgrade，在库还不存在时（全新安装、
 *   offscreen 尚未启动）会把库建成「版本 4、零 object store」，此后 offscreen 那份带
 *   `oldVersion < N` 的 upgrade 永远不会再跑 —— 所有 store 永久缺失，且现象是静默读不到数据。
 * - 若两处版本号漂移，后打开的一方会 VersionError 卡死。
 *
 * 所以这里作为唯一定义，offscreen 的旧路径改为再导出一份，5 个既有 import 点零改动。
 *
 * 跨上下文可见性：扩展的所有页面（options / offscreen / popup / background）同属
 * `chrome-extension://<id>/` 这一个 origin，共用同一个库实例。content script 不在此列
 * （它在被注入网页的 origin 下），需要图标仍走 sendMessage。
 */
import { openDB, type IDBPDatabase } from "idb";
import type { IPtdDBSchema, IPtdDBSchemaV1, IPtdDBSchemaV2 } from "./types.ts";

export const ptdIndexDb = openDB<IPtdDBSchema>("ptd", 4, {
  upgrade(db, oldVersion) {
    if (oldVersion < 1) {
      const dbV1 = db as unknown as IDBPDatabase<IPtdDBSchemaV1>;
      dbV1.createObjectStore("social_information");
    }
    if (oldVersion < 2) {
      const dbV2 = db as unknown as IDBPDatabase<IPtdDBSchemaV2>;
      dbV2.createObjectStore("download_history", { keyPath: "id", autoIncrement: true });
    }
    if (oldVersion < 3) {
      db.createObjectStore("favicon");
    }
    if (oldVersion < 4) {
      db.createObjectStore("local_fingerprint");
    }
  },
});
