/**
 * 在 browser 环境中，我们有很多的 headers 是不能设置的，这里为 axios 提供一个方法来替换掉这些 headers
 */
import type { AxiosInstance } from "axios";
import { sendMessage } from "@/messages.ts";

/**
 * 动态 session 规则的 ID 号段与自增计数器。
 *
 * 用固定前缀（而不是随机数）是为了和 background/utils/webRequest.ts 的业务规则号段隔离，
 * 也让 background 能在启动时按号段前缀批量清理上次会话遗留的僵尸规则。
 */
export const DNR_ID_BASE = 1_000_000_000;
let dnrRuleSeq = 0;

function nextDnrRuleId(): number {
  dnrRuleSeq = (dnrRuleSeq + 1) % 1_000_000;
  return DNR_ID_BASE + dnrRuleSeq;
}

export const unsafeHeaders: { [key: string]: boolean } = {
  "user-agent": true,
  cookie: true,
  "accept-charset": true,
  "accept-encoding": true,
  "access-control-request-headers": true,
  "access-control-request-method": true,
  connection: true,
  "content-length": true,
  date: true,
  dnt: true,
  expect: true,
  "feature-policy": true,
  host: true,
  "keep-alive": true,
  origin: true,
  referer: true,
  te: true,
  trailer: true,
  "transfer-encoding": true,
  upgrade: true,
  via: true,
};

interface AxiosAllowUnsafeHeaderInstance extends AxiosInstance {
  // 防重标志位挂在实例对象上而非 defaults：
  // axios.create() 会通过 mergeConfig 继承 defaults，挂在 defaults 会让新实例一出生就带上标志位，
  // 被守卫跳过导致拦截器不注册；实例自身的属性不会被 create() 继承。
  allowUnsafeHeader?: boolean;
}

export function setupReplaceUnsafeHeader(axios: AxiosInstance): AxiosAllowUnsafeHeaderInstance {
  const axiosAllowUnsafeHeaderInstance = axios as AxiosAllowUnsafeHeaderInstance;

  if (axiosAllowUnsafeHeaderInstance.allowUnsafeHeader) {
    console.debug("setupReplaceUnsafeHeader() should be called only once");
    return axiosAllowUnsafeHeaderInstance;
  }
  axiosAllowUnsafeHeaderInstance.allowUnsafeHeader = true;

  // Add a request interceptor
  axiosAllowUnsafeHeaderInstance.interceptors.request.use(async function (config) {
    if (config.headers) {
      // 准备扔给 chrome.declarativeNetRequest 的请求头
      const requestHeaders = [] as chrome.declarativeNetRequest.ModifyHeaderInfo[];

      for (const [key, value] of config.headers) {
        const lowerKey = key.toLowerCase();
        if (unsafeHeaders[lowerKey] || lowerKey.startsWith("sec-") || lowerKey.startsWith("proxy-")) {
          // 值为假值（null/undefined/空字符串）时视为"移除该请求头"（如 qBittorrent 绕过 CSRF 校验需要移除 Origin），
          // 而不是设置一个空值。注意不能用 null 作哨兵：AxiosHeaders 在构造/合并阶段就会丢弃 null 值，
          // 拦截器里看不到，空字符串可以存活到拦截器。
          requestHeaders.push(
            !value
              ? {
                  header: key,
                  operation: "remove" as chrome.declarativeNetRequest.HeaderOperation.REMOVE,
                }
              : {
                  header: key,
                  operation: "set" as chrome.declarativeNetRequest.HeaderOperation.SET,
                  value: String(value),
                },
          );
          config.headers.delete(key);
        }
      }

      if (requestHeaders.length > 0) {
        // 单调递增的请求 ID，与 chrome.declarativeNetRequest 匹配。
        // 原来用 Math.random()*1e7：并发数百个请求时生日碰撞概率约 1%，
        // 一旦撞上，updateSessionRules 的 removeRuleIds+addRules 会覆盖另一条在途请求的规则，
        // 那条请求就会拿到错误的请求头（比如 M-Team 的 Origin 被换成别的站点的）。
        // 统一加 DNR_ID_BASE 前缀，与 webRequest.ts 的业务规则号段隔离。
        const dummyHeaderRequestId = nextDnrRuleId();
        (config as any).dummyHeaderRequestId = dummyHeaderRequestId;

        const requestUrl = axios.getUri({ baseURL: config.baseURL, url: config.url });

        const rule = {
          id: dummyHeaderRequestId,
          priority: 1,
          action: {
            type: "modifyHeaders",
            requestHeaders,
          },
          condition: {
            urlFilter: requestUrl,
            resourceTypes: ["xmlhttprequest" as chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST],
            requestMethods: [(config.method || "GET").toLowerCase() as chrome.declarativeNetRequest.RequestMethod],
          },
        } as chrome.declarativeNetRequest.Rule;

        await sendMessage("updateDNRSessionRules", { rule });
      }
    }

    return config;
  });

  async function removeDummyHeaderRequestId(config: any) {
    const ruleId = config?.config?.dummyHeaderRequestId;
    if (ruleId === undefined || ruleId === null) {
      return;
    }
    try {
      await sendMessage("removeDNRSessionRuleById", ruleId);
    } catch (e) {
      // 不能静默：规则删不掉会一直驻留在 declarativeNetRequest 里，
      // 累积到上限后 updateSessionRules 直接抛错，该扩展之后所有需要 unsafe header 的请求全部失败。
      console.warn("[DNR] failed to remove session rule", ruleId, e);
    }
  }

  // 请求完成后，根据 dummyHeaderRequestId 自动删除 DNR 规则
  axiosAllowUnsafeHeaderInstance.interceptors.response.use(
    function (response) {
      removeDummyHeaderRequestId(response);
      return response;
    },
    function (error) {
      removeDummyHeaderRequestId(error);
      return Promise.reject(error);
    },
  );

  return axiosAllowUnsafeHeaderInstance;
}
