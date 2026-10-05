/**
 * 关于 logger 方法记录
 * 在 background 等其他页面中， 请使用 sendMessage("logger", {}).catch();
 * 在 offscreen 中， 请使用 logger({}) 直接调用
 */
import { nanoid } from "nanoid";
import { useSessionStorage } from "@vueuse/core";

import { onMessage } from "@/messages.ts";
import type { ILoggerItem } from "@/shared/types.ts";

const MAX_LOGGER_LENGTH = 500;

/**
 * 日志环形缓冲放在内存里，按节流落盘。
 *
 * 原实现直接 push 进 useSessionStorage：那是 deep watch，每次 push 都会把整个
 * 500 条数组 JSON.stringify 一遍再同步 setItem（阻塞主线程）。而调用点密度很高且
 * payload 很大（site.ts 每条都带整个站点用户配置，userInfo.ts 带完整 IUserInfo），
 * 「批量复制 50 个种子链接」这种操作能一次产生上百条日志 = 上百次全量序列化。
 */
const ring: ILoggerItem[] = [];

export const loggerStorage = useSessionStorage<ILoggerItem[]>("logger", [], {
  // 环形缓冲由下面手动落盘，这里不能再让插件深度 watch 整个数组
  deep: false,
  listenToStorageChanges: false,
});

let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** 把内存缓冲一次性写入 sessionStorage；节流窗口内的多次调用合并成一次写 */
function scheduleFlush() {
  if (flushTimer !== null) {
    return;
  }
  flushTimer = setTimeout(() => {
    flushTimer = null;
    try {
      loggerStorage.value = [...ring];
    } catch (e) {
      console.error("[PTD] logger flush failed:", e);
    }
  }, 500);
}

export function logger(data: ILoggerItem) {
  try {
    data.id ??= nanoid();
    data.time ??= new Date().getTime();
    data.msg = data.msg?.trim();

    ring.push(data);
    if (ring.length > MAX_LOGGER_LENGTH) {
      ring.splice(0, ring.length - MAX_LOGGER_LENGTH);
    }
    scheduleFlush();
  } catch (e) {
    // 日志记录失败不应影响主流程（如传入不可序列化数据、sessionStorage 写入异常等）
    console.error("[PTD] logger failed:", e);
  }
}

/**
 * 把内存里那一批日志立刻写出去。
 *
 * ⚠️ 原注释写「页面卸载 / offscreen 即将销毁时调用」——**没有任何地方这么调**。
 * 全仓只有 getLogger 处理器（本文件末尾 onMessage("getLogger")）一处调用，offscreen 目录里
 * pagehide / beforeunload / visibilitychange 一个都没注册。
 * 后果：日志靠 scheduleFlush 的 500ms 定时器落盘，offscreen 被销毁时定时器随之丢弃，
 * 末批要等到用户**去查日志页**时才被补写。别以为「卸载瞬间那批已经落盘」。
 */
export function flushLogger() {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  try {
    loggerStorage.value = [...ring];
  } catch (e) {
    console.error("[PTD] logger flush failed:", e);
  }
}

onMessage("logger", ({ data }) => logger(data));
onMessage("getLogger", async () => {
  flushLogger();
  return loggerStorage.value;
});
onMessage("clearLogger", async () => {
  ring.length = 0;
  loggerStorage.value = [];
});