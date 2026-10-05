/**
 * offscreen 文档生命周期管理，平移自 PT-depiler background/utils/offscreen.ts。
 *
 * 设计要点（曾经的坑）：
 * 1. 并发去重靠「共享同一个创建 promise」，但这个 promise 绝不能被缓存成 rejected 状态。
 *    旧实现 `creating = null` 只写在 else 分支的成功路径上，一旦 createDocument reject
 *    （Only a single offscreen document / SW 被回收中途 / getContexts 与 create 之间的
 *    TOCTOU），creating 就永久持有一个 rejected promise，之后每次调用都 await 它立刻 reject，
 *    再也不会尝试创建 —— 自动刷新/自动备份/原生桥全部静默失效直到 SW 重启。
 *    现在 settle（无论成败）立即清空缓存，失败可自愈。
 * 2. createDocument 失败时浏览器可能已建了一半上下文，必须显式 closeDocument 回滚，
 *    否则下次 getContexts 会误判「已存在」而永远不再创建。
 */
import { sendMessage } from "@/messages.ts";

const offscreenPath = "/offscreen.html";

// 仅在「本次创建尝试进行中」非空，用于并发去重；settle 后立即置回 null
let creating: Promise<void> | null = null;

// 就绪门缓存：SW 生命周期内 offscreen 一旦确认就绪就不必每次 ping
let readyPromise: Promise<void> | null = null;

const READY_TIMEOUT_MS = 10_000;
const READY_POLL_INTERVAL_MS = 100;

async function doSetupOffscreenDocument(): Promise<void> {
  const offscreenUrl = chrome.runtime.getURL(offscreenPath);
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [offscreenUrl],
  });

  if (existingContexts.length > 0) {
    return;
  }

  try {
    await chrome.offscreen.createDocument({
      url: offscreenUrl,
      reasons: [chrome.offscreen.Reason.DOM_PARSER],
      // ⚠️ justification 里提的 CLIPBOARD / BLOBS 与上面实际声明的 reasons 不一致：
      // 本仓 offscreen 侧没有任何 clipboard 调用，createObjectURL 只出现在 backup.ts。
      // Chrome 商店审核会同时看这两项，文案别写没申请的理由。
      justification: "Allow DOM_PARSER in background.",
    });
  } catch (e) {
    await chrome.offscreen.closeDocument().catch(() => {});
    throw e;
  }
}

/**
 * 幂等地确保 offscreen 文档存在。并发调用共享同一次创建尝试。
 */
export function setupOffscreenDocument(): Promise<void> {
  if (!creating) {
    creating = doSetupOffscreenDocument().finally(() => {
      // 成功或失败都要清空，否则失败尝试会被永久缓存（见文件头说明）
      creating = null;
    });
  }
  return creating;
}

/**
 * 确保 offscreen 文档存在 **且全部消息处理器已注册完成**。
 *
 * 业务侧（alarms / nativeMessaging 等）必须 await 本函数，而不是裸调
 * setupOffscreenDocument：createDocument 的 promise resolve 只代表 DOM 上下文建好，
 * offscreen main.ts 里十几个业务模块的 onMessage 还在 import 注册途中，
 * 这个窗口内发出的消息会被静默丢弃、调用方拿到 undefined。
 *
 * 已就绪时在本次 SW 生命周期内缓存 promise，不重复 ping；探测失败则清空缓存，
 * 允许后续调用重新等待。
 */
export function whenOffscreenReady(): Promise<void> {
  if (!readyPromise) {
    readyPromise = waitForOffscreenReady().catch((e) => {
      readyPromise = null;
      throw e;
    });
  }
  return readyPromise;
}

async function waitForOffscreenReady(): Promise<void> {
  await setupOffscreenDocument();

  // 无 handler 时 webext messaging 可能 reject，也可能 resolve undefined，
  // 两种都当作「还没就绪」继续轮询，只有收到字面量 "pong" 才算完成
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      if ((await sendMessage("offscreenPing", undefined)) === "pong") {
        return;
      }
    } catch (e) {
      lastErr = e;
    }
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_INTERVAL_MS));
  }
  throw new Error("[PTD] offscreen document did not become ready in time", { cause: lastErr });
}

/**
 * fire-and-forget 版本：带有限次退避重试。
 * background 的 main() 不能 await（会阻塞消息监听器注册），所以启动时先乐观拉起 offscreen，
 * 失败则退避重试若干次，避免单次偶发失败导致本次 SW 生命周期内所有 offscreen 能力长期不可用。
 */
export function setupOffscreenDocumentSafe(retries = 3): void {
  void (async () => {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        await setupOffscreenDocument();
        return;
      } catch (e) {
        console.error(`[PTD] setupOffscreenDocument failed (${attempt + 1}/${retries + 1})`, e);
        if (attempt === retries) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
      }
    }
  })();
}