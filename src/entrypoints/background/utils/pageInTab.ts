/**
 * 「真开一个标签页把页面取回来」—— 只给「XHR 被站点当成爬虫拦掉」那一档兜底用。
 *
 * 为什么需要这一条（PTzone 2026-10-24 的现场）：
 *   · 带登录态请求 `/userdetails.php?id=…`、`/mybonus.php`，拿回 **HTTP 200 + 137 字节**的
 *     nginx 403 默认页（`td 0 个`），站点把状态码改写成了 200；
 *   · 换 Referer / 去 Origin / 补 Sec-Fetch / 去掉 GET 上的 JSON body / 先访问一次首页 ——
 *     六种形状一字不差；
 *   · 同一个会话请求 `/index.php` 却是 196 个 td 的完整页（43274 字符）。
 * 也就是说拦截认的不是某个头，而是「这次请求是不是顶层导航」这个上下文。XHR 侧没有这个上下文，
 * 只有真的开一个标签页让浏览器自己去导航。
 *
 * 边界（都很重要）：
 *  - 只在调用方判出「拦截外壳页」时兜底，**不是普通取数通道**；
 *  - 标签页 `active: false`（不抢焦点），读完立刻关；
 *  - 不读 Cookie / 请求头，也不把 HTML 写日志 —— 只把 HTML 交回调用方，形状读数仍由
 *    `@/shared/userInfoShape` 按隐私口径折；
 *  - 任何失败都回 `{ error }`，绝不向调用方抛。
 */
import { onMessage } from "@/messages.ts";
import { looksLikeBlockText } from "@/shared/userInfoShape.ts";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 等标签页加载完成；超时 / 标签页被关掉都回 false（不抛） */
function waitForTabComplete(tabId: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      resolve(ok);
    };
    const listener = (updatedTabId: number, info: chrome.tabs.OnUpdatedInfo) => {
      if (updatedTabId === tabId && info.status === "complete") finish(true);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
    // 监听器挂上之前可能已经 complete 了（页面从缓存恢复时尤其快）
    chrome.tabs
      .get(tabId)
      .then((tab) => {
        if (tab.status === "complete") finish(true);
      })
      .catch(() => finish(false));
  });
}

interface ITabSnapshot {
  html: string;
  finalUrl: string;
  title: string;
}

async function readSnapshot(tabId: number): Promise<ITabSnapshot | undefined> {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({
      html: document.documentElement?.outerHTML ?? "",
      finalUrl: location.href,
      title: document.title ?? "",
    }),
  });
  const result = injection?.result as ITabSnapshot | undefined;
  return result && typeof result.html === "string" ? result : undefined;
}

/**
 * Cloudflare 的挑战页常常先 `complete` 一次、自己再刷新一次；第一张如果明显还是拦截页，
 * 就再等一拍重读。判据与「什么算拦截页」共用 `looksLikeBlockText`，不另写一份关键字。
 */
function shouldWaitForRetry(snapshot: ITabSnapshot | undefined): boolean {
  if (!snapshot) return false;
  // 正常用户页（几十 KB）不用等；只有小页才可能是挑战页 / 拦截页
  if (snapshot.html.length > 5000) return false;
  return looksLikeBlockText(snapshot.title) || looksLikeBlockText(snapshot.html.slice(0, 2000));
}

onMessage("probePageInTab", async ({ data }) => {
  const timeoutMs = Math.min(Math.max(data.timeoutMs ?? 20000, 5000), 60000);
  let tabId: number | undefined;

  try {
    const tab = await chrome.tabs.create({ url: data.url, active: false });
    tabId = tab.id;
    if (tabId === undefined) {
      return { error: "chrome.tabs.create 没有返回 tabId" };
    }

    if (!(await waitForTabComplete(tabId, timeoutMs))) {
      return { error: `标签页 ${timeoutMs}ms 内没有加载完成` };
    }

    let snapshot = await readSnapshot(tabId);
    if (shouldWaitForRetry(snapshot)) {
      await sleep(4000);
      snapshot = (await readSnapshot(tabId)) ?? snapshot;
    }

    return snapshot
      ? { html: snapshot.html, finalUrl: snapshot.finalUrl, title: snapshot.title }
      : { error: "标签页加载完了，但读不到 DOM" };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  } finally {
    if (tabId !== undefined) {
      // 关不掉不该反过来影响这次取数；遗留标签页最多让用户手动关一次
      chrome.tabs.remove(tabId).catch(() => {});
    }
  }
});
