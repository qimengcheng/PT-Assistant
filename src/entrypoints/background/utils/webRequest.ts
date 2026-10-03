/**
 * DNR session 规则管理（平移自 PT-depiler background/utils/webRequest.ts）。
 * 站点下载所需的 unsafe header（如 M-Team 校验 Origin）通过 session 规则动态注入。
 */
import { onMessage, sendMessage } from "@/messages.ts";
import { DNR_ID_BASE } from "@/extends/axios/replaceUnsafeHeader.ts";

onMessage("updateDNRSessionRules", async ({ data: { rule, extOnly = true } }) => {
  // 将规则正向圈定到本扩展发起的请求，避免误改普通网页的请求头（见 #1465）。
  //
  // DNR 的 initiatorDomains 按「请求 initiator 的 host」匹配。两浏览器下扩展自身上下文
  // （background/offscreen/options 等）发起的请求，其 initiator host 均等于扩展自身 origin 的 host：
  // - Chrome：chrome-extension://<id>，host 即 chrome.runtime.id；
  // - Firefox：moz-extension://<uuid>，host 是扩展的 moz-extension UUID。而 chrome.runtime.id 返回
  //   manifest 声明的 gecko.id（本扩展为 ptdepiler.ptplugins@gmail.com），与 UUID 并不相同（也非合法
  //   domain），规则将永不命中，导致扩展发起的 unsafe header 请求在 Firefox 中全部失效（见 #1486）。
  //   因此 Firefox 侧取 new URL(chrome.runtime.getURL("")).host 作为匹配值（任何扩展上下文均可计算）。
  if (extOnly) {
    rule.condition.initiatorDomains = [
      __BROWSER__ === "firefox" ? new URL(chrome.runtime.getURL("")).host : chrome.runtime.id,
    ];
    delete rule.condition.excludedTabIds;
  }

  void sendMessage("logger", {
    msg: `Update DNR session rules ${rule.id} for url: ${rule.condition?.urlFilter}`,
    data: rule,
  });

  return await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [rule.id],
    addRules: [rule],
  });
});

onMessage("removeDNRSessionRuleById", async ({ data: ruleId }) => {
  void sendMessage("logger", { msg: `Remove DNR session rule by ID: ${ruleId}` });
  return await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [ruleId],
  });
});

/**
 * 启动时清理上一会话遗留的动态 session 规则。
 *
 * unsafe header 的规则是「一个请求一条、用完即删」的临时规则（见 replaceUnsafeHeader.ts）。
 * 一旦页面在请求完成前被关闭、或 SW 被回收，removeDNRSessionRuleById 就永远不会执行，
 * 规则会一直驻留在 declarativeNetRequest 里。累积到配额上限后
 * updateSessionRules 直接抛错 —— 该扩展之后**所有**需要 unsafe header 的请求全部失败。
 * 这里按 ID 号段前缀（DNR_ID_BASE，1e9）精确捞出这些僵尸规则清掉。
 */
export async function cleanupStaleDNRSessionRules(): Promise<void> {
  try {
    const rules = await chrome.declarativeNetRequest.getSessionRules();
    const stale = rules.map((rule) => rule.id).filter((id) => id >= DNR_ID_BASE);
    if (stale.length > 0) {
      await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: stale });
      void sendMessage("logger", { msg: `Cleaned ${stale.length} stale DNR session rules` });
    }
  } catch (e) {
    console.warn("[PTD] cleanup stale DNR session rules failed", e);
  }
}
