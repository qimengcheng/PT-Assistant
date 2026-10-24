/**
 * 请求头对照：只观测 `userdetails.php` / `mybonus.php` 这两类页面的**最终请求头**，
 * 记下来给「为什么同一会话里 XHR 被拦、导航能过」这个问题当证据。
 *
 * 为什么需要它：PTzone 2026-10-24 的现场里，XHR 换 Referer / Origin / Sec-Fetch / 请求体
 * 六种形状全返回同一张 137 字节的 nginx 403 页，而真开一个标签页导航就能拿到 196 个 td 的
 * 完整页；用户又确认 MV3 的 PT-depiler 不靠标签页也能取到。也就是说两边**实际发出去的头**
 * 一定有一处不同，而 `declarativeNetRequest` 是否真的改到了 `sec-fetch-*` 也只能从这里看出来。
 *
 * 口径（隐私，§3.5 的另一半）：
 *  - **Cookie 只记条数，不记任何值**；
 *  - `Origin` 若是扩展来源，只留 `chrome-extension://…`；
 *  - `Referer` 只留 protocol + host + path，query 与 hash 一律丢掉；
 *  - 其余只收与 `Sec-Fetch-*` / 缓存 / 优先级 / 内容协商有关的白名单头。
 * 观测本身不改请求（`onBeforeSendHeaders` 在 MV3 里只能看、不能改），读不到也不影响取数。
 */
import { onMessage, type IHeaderTraceRecord } from "@/messages.ts";

const MAX_RECORDS = 16;
const records: IHeaderTraceRecord[] = [];

const KEEP_HEADERS = new Set([
  "accept",
  "cache-control",
  "content-type",
  "origin",
  "priority",
  "referer",
  "sec-ch-ua",
  "sec-ch-ua-mobile",
  "sec-ch-ua-platform",
  "sec-fetch-dest",
  "sec-fetch-mode",
  "sec-fetch-site",
  "sec-fetch-user",
  "upgrade-insecure-requests",
  "user-agent",
]);

function maskHeaderValue(name: string, value: string): string {
  if (name === "cookie") {
    return `${value.split(";").filter((item) => item.trim().length > 0).length} 项`;
  }
  if (name === "origin" && value.startsWith("chrome-extension://")) {
    return "chrome-extension://…";
  }
  if (name === "referer") {
    try {
      const parsed = new URL(value);
      return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
    } catch {
      return "?";
    }
  }
  return value;
}

function recordHeaders(details: chrome.webRequest.OnBeforeSendHeadersDetails): undefined {
  let hostPath: string;
  try {
    const parsed = new URL(details.url);
    hostPath = `${parsed.host}${parsed.pathname}`;
  } catch {
    return;
  }

  const headers: Record<string, string> = {};
  for (const header of details.requestHeaders ?? []) {
    const name = header.name.toLowerCase();
    if (name === "cookie" || KEEP_HEADERS.has(name)) {
      headers[name] = maskHeaderValue(name, header.value ?? "");
    }
  }

  records.push({
    type: details.type,
    method: details.method,
    hostPath,
    tabId: details.tabId,
    headers,
    at: Date.now(),
  });
  if (records.length > MAX_RECORDS) {
    records.shift();
  }
}

try {
  chrome.webRequest.onBeforeSendHeaders.addListener(
    recordHeaders,
    // 只挂这两类页面的 URL：其余请求不进这个监听器，别让观测影响日常浏览
    { urls: ["*://*/userdetails.php*", "*://*/mybonus.php*"] },
    ["requestHeaders", "extraHeaders"],
  );
} catch {
  // Firefox 等不接受 extraHeaders 的环境：少一份对照读数，绝不影响取数
}

onMessage("getHeaderTrace", async () => {
  // 读一次就清空：每一轮日志只对应「这一轮实际发出的那几次」。
  // 三分钟之外的一律丢掉 —— 那是上一轮甚至上一次浏览留下的，混进来会把对照带偏。
  const cutoff = Date.now() - 180_000;
  return records.splice(0, records.length).filter((record) => record.at >= cutoff);
});
