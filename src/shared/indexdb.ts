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
 *
 * **必须懒开**（`ptdIndexDb()` 是函数，不是模块级 Promise）：
 * `openDB` 写在模块顶层就是「导入即开库」。background 只在跑一次性数据修复时才需要这个库，
 * 却会因为一条 import 边而在每次 SW 冷启动时开一个连接、并可能触发一次 upgrade ——
 * 这正是 AGENTS.md §3.2 记过的危险类别（SW 导入图里的顶层副作用会把 SW 打死，
 * 症状是消息层静默无响应）。v0.22.16 把按天存档搬进这个库、让 `fixer.ts` 顺带引到它，
 * 就被 `smoke-background.mjs` 以 `indexedDB is not defined` 当场拦下：导入 background.js
 * 本身就抛了。改成懒开之后，不碰库的上下文也就永远不会因为「碰巧 import 到」而替它买单。
 */
import { openDB, type IDBPDatabase } from "idb";
import type { IPtdDBSchema, IPtdDBSchemaV1, IPtdDBSchemaV2 } from "./types.ts";

let opening: Promise<IDBPDatabase<IPtdDBSchema>> | null = null;

function open(): Promise<IDBPDatabase<IPtdDBSchema>> {
  const pending = openDB<IPtdDBSchema>("ptd", 5, {
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
      if (oldVersion < 5) {
        // 站点用户信息按天存档（取代 chrome.storage.local 的 `userInfo` 键，见类型定义处注释）
        db.createObjectStore("user_info", { keyPath: ["site", "date"] });
      }
    },
  });

  opening = pending;
  // 开库失败不能被永久缓存：一次 VersionError 或配额错误若留在那个已拒绝的 promise 上，
  // 本上下文之后每次取库都拿到同一个 rejection，等于永久废掉 —— 所以清空，下次调用重试。
  // 这里挂 catch 只是为了让它「有人处理过」；pending 本身照常向每个 awaiter 抛出。
  pending.catch(() => {
    if (opening === pending) opening = null;
  });

  return pending;
}

/** 取共享库句柄。首次调用才真的开库，之后复用同一个 promise */
export function ptdIndexDb(): Promise<IDBPDatabase<IPtdDBSchema>> {
  return opening ?? open();
}
