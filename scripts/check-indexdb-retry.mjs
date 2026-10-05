/**
 * ptdIndexDb() 开库语义的自检。
 *
 * 为什么需要：v0.22.21 把共享库从「模块级 Promise（导入即开库）」改成「懒开的函数」，
 * 随之确立了两条不变量，而它们都**没有任何静态守卫能覆盖**：
 *
 *   1. 开库失败不能被缓存 —— 否则一次 VersionError / 配额错误会让本上下文之后每次取库
 *      都拿到同一个已拒绝的 promise，等于永久废掉，且现象是静默读不到数据。
 *   2. 开库成功必须复用 —— 否则「修重试」的正确姿势会变成「每次调用都重开一个连接」，
 *      那在 SW 里就是连接泄漏。
 *
 * 这两条只能靠行为断言钉。第 1 条尤其脆：它的实现是一行 `if (opening === pending) opening = null`，
 * 挂在 catch 里，看着像可以省掉的样板。之前它写成一条游离的 `.catch()`，被当成死代码删掉的
 * 概率更高，所以先把它挪进了控制流，再补上这个测试。
 *
 * 不引 fake-indexeddb：只需要让 idb 的 openDB 走通「失败 → 重试 → 复用」这三步，
 * 一个手写的最小桩就够，代价是必须知道 idb 内部引用了哪些裸全局（见下）。
 *
 * 用法：`node scripts/check-indexdb-retry.mjs`（不需要构建产物）
 */

// idb 的 wrap() / getIdbProxyableTypes() 直接引用这些裸全局标识符（Node 里没有），
// 且是**懒**求值 —— 所以只要在第一次开库之前挂上就行。哪天 idb 多引用一个，这里会当场报错，
// 不会静默漏过。
class IDBRequest {}
class IDBDatabase {}
class IDBObjectStore {}
class IDBIndex {}
class IDBCursor {}
class IDBTransaction {}
Object.assign(globalThis, { IDBRequest, IDBDatabase, IDBObjectStore, IDBIndex, IDBCursor, IDBTransaction });

let openCount = 0;
let nextOpenFails = true;

class FakeOpenRequest extends IDBRequest {
  constructor() {
    super();
    this.listeners = {};
    this.result = undefined;
    this.error = undefined;
    const fail = nextOpenFails;
    // 真实 IDB 也是异步派事件的；同步派会让「并发调用只开一次库」这条断言失真。
    setTimeout(() => {
      if (fail) {
        this.error = new Error("mock: VersionError");
        (this.listeners.error ?? []).forEach((fn) => fn());
      } else {
        this.result = new IDBDatabase();
        (this.listeners.success ?? []).forEach((fn) => fn());
      }
    }, 0);
  }
  addEventListener(type, fn) {
    (this.listeners[type] ??= []).push(fn);
  }
  removeEventListener(type, fn) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== fn);
  }
}

globalThis.indexedDB = {
  open() {
    openCount++;
    return new FakeOpenRequest();
  },
};

let failed = 0;
let passed = 0;
const ok = (msg) => {
  passed++;
  console.log(`  ok   ${msg}`);
};
const bad = (msg) => {
  failed++;
  console.error(`  BAD  ${msg}`);
};
const eq = (msg, got, want) => (got === want ? ok(msg) : bad(`${msg}：得到 ${String(got)}，期望 ${String(want)}`));

/**
 * 把「抛错」变成数据。不变量破掉时那条 rejection 往往是**缓存下来的**，
 * 谁 await 谁炸；不兜住的话测试会以 unhandled rejection 崩成一段栈回溯，
 * 看的人只会以为是桩写坏了，看不出真正坏的是哪条不变量。
 */
async function attempt(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, error };
  }
}

const { ptdIndexDb } = await import("../src/shared/indexdb.ts");

// ── 1. 失败：必须抛出，且并发调用只开一次库 ──────────────────────────────────
nextOpenFails = true;
const beforeConcurrent = openCount;
const settled = await Promise.allSettled([ptdIndexDb(), ptdIndexDb()]);
eq("开库失败时两个并发调用都 reject", settled.map((r) => r.status).join(","), "rejected,rejected");
eq("reject 的原因是桩抛的那个错", settled[0].reason?.message, "mock: VersionError");
eq("并发只开一次库（复用同一次在途开库）", openCount - beforeConcurrent, 1);

// ── 2. 失败之后必须重试，而不是把 rejection 缓存下来 ─────────────────────────
nextOpenFails = false;
const second = await attempt(() => ptdIndexDb());
if (second.ok) {
  ok("失败后的下一次调用重试并成功");
  eq("重试确实又去开了一次库", openCount - beforeConcurrent, 2);
} else {
  bad(`失败后的下一次调用仍被拒（rejection 被缓存了）：${second.error?.message}`);
}

// ── 3. 成功之后必须复用，不能每次重开连接 ────────────────────────────────────
const beforeReuse = openCount;
const third = await attempt(() => ptdIndexDb());
eq("成功之后不再开库", openCount - beforeReuse, 0);
if (!third.ok) bad(`第三步取库被拒：${third.error?.message}`);
else eq("成功之后拿到的是同一个句柄", third.value, second.value);

console.log(`\n${failed ? `FAIL：${failed} 项` : "PASS"}（通过 ${passed} 项 / 失败 ${failed} 项）`);
process.exit(failed ? 1 : 0);
