/**
 * background（MV3 service worker）产物冒烟测试。
 *
 * 干什么：在 Node 里用 WXT 自带的 fake-browser 顶掉 `chrome` 全局，然后**真的 import
 * 构建产物** `.output/chrome-mv3/background.js`，断言两件事：
 *
 *  1. 模块能加载完成，不抛错。
 *     这一条是为了钉死 v0.4.x 那次事故：WXT 默认把 background 编成 classic SW
 *     （IIFE + inlineDynamicImports），340 个站点定义连同 sizzle 被内联进来，
 *     而 sizzle 的 UMD 工厂在模块顶层访问 `window` → MV3 SW 无 window →
 *     SW 启动即崩、消息监听器根本没注册，前端表现为「消息永远无响应」，
 *     排查时只看得见 popup 卡在「连接 background 中…」。
 *  2. 消息层真的挂上了监听器（`runtime.onMessage`）——「加载没抛错」不等于「活着」，
 *     监听器没注册的症状和崩溃完全一样：消息发出去没人接、静默丢弃。
 *
 * 为什么要跑产物而不是跑源码：那个崩溃发生在打包形态上
 * （classic SW / inlineDynamicImports / 顶层 window），vue-tsc 与源码单测都看不见，
 * 只有加载 dist 里的 background.js 才算数。
 *
 * 日志里的「假失败」：fake-browser 只给 API 形状，`declarativeNetRequest.getSessionRules`、
 * `runtime.getContexts` 这些方法仍是未实现桩，于是能看到
 * `cleanup stale DNR session rules failed` / `setupOffscreenDocument failed (1/4)` 之类的输出。
 * 那是测试替身的缺口（真浏览器里有这些 API），产品代码本来就把它们当可失败路径处理，不是回归；
 * 判定只看最后的 PASS/FAIL 与退出码。
 *
 * 用法：`pnpm build && node scripts/smoke-background.mjs`（CI 里跟在构建之后）
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const TARGET = process.argv[2] || ".output/chrome-mv3/background.js";
const abs = path.resolve(ROOT, TARGET);

const fail = (msg, err) => {
  console.error(`FAIL：${msg}`);
  if (err) console.error(err);
  process.exit(1);
};

if (!existsSync(abs)) fail(`找不到产物 ${TARGET}，先跑 pnpm build。`);

const { fakeBrowser } = await import("wxt/testing/fake-browser");

/**
 * fake-browser 的若干事件是「未实现」的桩，调用 addListener 直接抛
 * MockNotImplementedError（实测 contextMenus.onClicked 就是这样），
 * 而真浏览器里这些 API 都存在 —— 所以这属于测试替身的缺口，不是产品 bug。
 *
 * 这里递归把所有 `addListener` 包一层：始终先记账（供下面的断言用），
 * 再尝试调用原实现，替身没实现的就吞掉。这样不必手工维护「哪些 API 要补桩」，
 * background 以后新增别的事件也自动兜住。
 */
const listenerRegistry = new Map();
const recorded = (key) => (listenerRegistry.get(key) ?? []).length;
const wrapEvents = (node, fullKey, depth = 0) => {
  if (!node || typeof node !== "object" || depth > 5) return;
  // addListener 常挂在事件对象的原型上，所以直接探测属性本身而不是 Object.entries 的键
  if (typeof node.addListener === "function") {
    const original = node.addListener.bind(node);
    node.addListener = (...args) => {
      const bucket = listenerRegistry.get(fullKey) ?? [];
      bucket.push(args[0]);
      listenerRegistry.set(fullKey, bucket);
      try {
        original(...args);
      } catch (err) {
        // 注意：V8 堆栈头打的是构造函数名，实例的 err.name 仍是 "Error"，
        // 所以按 constructor.name 判断；拿 err.name 比会判不出来，直接当产品错误抛出去。
        const isMockGap =
          err?.constructor?.name === "MockNotImplementedError" || /not implemented/i.test(String(err?.message));
        if (!isMockGap) throw err;
      }
    };
    node.hasListeners = () => recorded(fullKey) > 0;
  }
  for (const [key, value] of Object.entries(node)) {
    if (value && typeof value === "object") wrapEvents(value, fullKey ? `${fullKey}.${key}` : key, depth + 1);
  }
};
wrapEvents(fakeBrowser, "", 0);

// 只给 chrome，绝不给 window：SW 里没有 window，谁在顶层摸 window 就该在这里炸出来
globalThis.chrome = fakeBrowser;
if (typeof globalThis.window !== "undefined") {
  fail("测试环境里存在 window，测不出 SW 顶层访问 window 的问题。");
}

try {
  await import(pathToFileURL(abs).href);
} catch (err) {
  fail("background 产物加载即抛错 —— SW 起不来，消息层不会有任何响应。", err);
}

if (recorded("runtime.onMessage") === 0) {
  fail(
    "background 加载成功，但 runtime.onMessage 上没有任何监听器。" +
      "消息会被静默丢弃，症状与 SW 崩溃相同。",
  );
}

console.log(
  `PASS：${TARGET} 以 module SW 形态加载完成；` +
    `runtime.onMessage 监听器 ${recorded("runtime.onMessage")} 个，` +
    `共记录事件注册 ${[...listenerRegistry.keys()].join(", ")}。`,
);
// job-scheduler / alarms 会在事件循环里留定时器，冒烟测完直接退出，不挂着不放
process.exit(0);
