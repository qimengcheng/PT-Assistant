/**
 * 控制台日志的总闸，顺带把日志前缀统一成 `[PT-Assistant]`。
 *
 * 为什么拦在 console 这一层，而不是逐个调用点包一层 logger：
 *  - 用户报的噪声里有一条**压根不是我们打的** —— `Restoring state for key: config from
 *    storage: local` 来自 pinia 的持久化插件，逐个调用点包办不到它；
 *  - `packages/**` 是从上游平移过来的那一片，那 7 处旧前缀不改（改了下次与上游对不上），所以
 *    「所有日志的前缀都统一」这件事只能落在下面这一道出口改写里。我方源码里的字面量
 *    已经改成新前缀，改写只兜住上游那一份。
 *
 * `console.error` **不在闸门之内**：报错是「真坏了」唯一的现场信号，我方 93 处 error 全部
 * 落在 catch 分支里。默认关的是 log / info / debug / warn 四档。
 *
 * 三条边界，别再改回去：
 *  1. 安装必须显式调用（每个入口的 main 里），不能写成模块顶层副作用 —— 那等于
 *     「谁 import 谁读存储」，正是 AGENTS §3.2 里 MV3 SW 崩过的那一类。
 *  2. 开闸要等一次异步读存储，所以**刚装上那一瞬的日志会被吞掉**（默认就是关，吞掉是对的）；
 *     反过来「打开开关后想追启动日志」要重开一次页面才看得全。
 *  3. offscreen 文档拿不到 `chrome.storage`（只有 `chrome.runtime`），所以它这一路只有首屏
 *     那一次读；`storage.onChanged` 在那里根本不存在，取之前要先探。
 *
 * 这个模块**刻意没有任何静态 import**：`@/storage.ts` 只在 syncFlag 里动态取。两个理由到现在都成立 ——
 * 一是「导入即读存储」正是 AGENTS §3.2 拦的那一类，二是判据文件因此能在任何环境里被直接 import
 * （行为断言在 `tests/shared/consoleLog.test.ts`，与 `shared/levelProgress.ts` 不 import
 * `@ptd/site` 是同一个理由）。
 */

/** 被这一档管住的级别。error 故意不在里面，理由见文件头 */
const GATED_LEVELS = ["log", "info", "debug", "warn"] as const;
type TGatedLevel = (typeof GATED_LEVELS)[number];
type TConsoleFn = (...args: unknown[]) => void;

/**
 * 旧前缀写成拼接，不写成字面量：这一轮改前缀用的是一次「按字面量全局替换」，
 * 第一版被它连自己那行一起改掉（要匹配的旧值变成了新值，改写判据当场变成自己认自己，
 * 不报错、只是再也不会生效）。拼起来的那两段各自都不再是那个字面量，就扫不到了。
 */
const FORMER_PREFIX = "[PT" + "D]";
const PREFIX = "[PT-Assistant]";

let enabled = false;
let wrapped = false;

/** 只改写在最前面的那一段，其余参数原样交给原生 console */
export function renameLogPrefix(args: unknown[]): unknown[] {
  const first = args[0];
  if (typeof first !== "string" || !first.startsWith(FORMER_PREFIX)) return args;
  return [PREFIX + first.slice(FORMER_PREFIX.length), ...args.slice(1)];
}

export function setConsoleLogEnabled(next: boolean): void {
  enabled = next;
}

export function isConsoleLogEnabled(): boolean {
  return enabled;
}

/**
 * 把四档 console 方法各包一层。幂等：已经包过的不再包 —— 第二次装会把第一层的
 * 「关着时直接 return」当成原生实现套在里面，于是打开开关也打不出来，那是最难查的一种坏法。
 */
export function wrapConsoleLevels(): void {
  if (wrapped) return;
  wrapped = true;
  const target = console as unknown as Record<TGatedLevel, TConsoleFn>;
  for (const level of GATED_LEVELS) {
    const original = target[level];
    if (typeof original !== "function") continue;
    target[level] = (...args: unknown[]) => {
      if (!enabled) return;
      original.apply(console, renameLogPrefix(args));
    };
  }
}

/** 读不到配置就按默认（关）。这里不能 console 报一句 —— 那正是本模块要吞掉的东西 */
async function syncFlag(): Promise<void> {
  try {
    const { extStore } = await import("@/storage.ts");
    const config = await extStore.getItem("config");
    setConsoleLogEnabled(config?.consoleLog === true);
  } catch {
    setConsoleLogEnabled(false);
  }
}

interface IStorageChange {
  newValue?: unknown;
}

/** `storage.onChanged` 在 offscreen 里不存在，所以整条都是可选的 */
function watchFlag(): void {
  const holder = globalThis as {
    browser?: {
      storage?: { onChanged?: { addListener: (cb: (changes: Record<string, IStorageChange>) => void) => void } };
    };
  };
  holder.browser?.storage?.onChanged?.addListener((changes) => {
    if (!("config" in changes)) return;
    const next = changes.config?.newValue as { consoleLog?: unknown } | undefined;
    if (typeof next?.consoleLog === "boolean") {
      setConsoleLogEnabled(next.consoleLog);
      return;
    }
    void syncFlag();
  });
}

/** 装上总闸，并把当前设置读进来；之后跟着 storage 的变更走 */
export function installConsoleLogGate(): void {
  wrapConsoleLevels();
  watchFlag();
  void syncFlag();
}
