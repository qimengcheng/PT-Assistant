/**
 * chrome.cookies 相关消息处理，平移自 PT-depiler src/entries/background/utils/cookies.ts。
 *
 * ⚠️ 为什么必须在这里重建 details、而不是把 cookies.getAll() 的结果直接透传给 cookies.set：
 * chrome.cookies.Cookie 上带 hostOnly / session / storeId 等**只读**字段，
 * 而 cookies.set 的 SetDetails 只接受 name/value/domain/path/secure/httpOnly/sameSite/
 * expirationDate/storeId/partitionKey。原样透传会抛
 * `Error at parameter 'details': Unexpected property: 'hostOnly'`。
 * 数据备份恢复正是这条路径（offscreen/utils/backup.ts → sendMessage("setCookie", cookie)），
 * 一个站点几十个 cookie，第一个就会抛，await 冒泡直接把整个恢复打断。
 *
 * 另外 cookies.set 需要 url（或 domain + path）才能定位，这里由 domain/path 统一重建。
 */
import { add, differenceInDays } from "date-fns";

import { extStore } from "@/storage.ts";
import { onMessage, sendMessage } from "@/messages.ts";

/**
 * 计算cookie的剩余有效期（以天为单位）
 * @param expirationDate cookie的过期时间戳（秒）
 * @returns 剩余天数，如果是session cookie则返回Infinity
 */
export function calculateRemainingDays(expirationDate?: number): number {
  if (!expirationDate) {
    // Session cookie，没有过期时间
    return Infinity;
  }

  // 使用 date-fns 的 differenceInDays 函数计算剩余天数
  const expirationDateMs = expirationDate * 1000; // 转换为毫秒
  const remainingDays = differenceInDays(new Date(expirationDateMs), new Date());

  return Math.max(0, remainingDays); // 确保不返回负数
}

export function buildCookieUrl(secure: boolean, domain: string, path: string) {
  if (domain.startsWith(".")) {
    domain = domain.substring(1);
  }
  return `http${secure ? "s" : ""}://${domain}${path}`;
}

onMessage("getAllCookies", async ({ data }) => {
  return await chrome.cookies.getAll(data);
});

onMessage("getCookie", async ({ data: detail }) => {
  return await chrome.cookies.get(detail);
});

/**
 * 设置cookie
 * @param cookie cookie详细信息
 * @param force 是否强制设置，为true时跳过过期检查直接设置
 */
export async function setCookie(cookie: chrome.cookies.SetDetails, force: boolean = false): Promise<void> {
  let new_cookie = {} as chrome.cookies.SetDetails;

  (
    [
      "name",
      "value",
      "domain",
      "path",
      "secure",
      "httpOnly",
      "sameSite",
      "expirationDate",
    ] as (keyof chrome.cookies.SetDetails)[]
  ).forEach((key) => {
    if (key == "sameSite" && cookie[key] && cookie[key].toLowerCase() == "unspecified" && import.meta.env.FIREFOX) {
      // firefox 下 unspecified 会导致cookie无法设置
      // https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/cookies/SameSiteStatus
      new_cookie["sameSite"] = "no_restriction";
    } else {
      // @ts-ignore
      new_cookie[key] = cookie[key];
    }
  });

  new_cookie.url = buildCookieUrl(cookie.secure!, cookie.domain!, cookie.path!);

  let allowSet = false;
  const now = new Date().getTime() / 1000;

  if (force) {
    // 如果强制设置，直接允许
    allowSet = true;
  } else {
    // 尝试获取当前站点已存在的Cookie
    const exist_cookie = await chrome.cookies.get({ url: new_cookie.url, name: new_cookie.name! });
    if (exist_cookie === null) {
      // 如果当前站点没有这个Cookies，则允许设置
      allowSet = true;
    } else if ((exist_cookie.expirationDate ?? 0) < now) {
      // 如果站点存在这个Cookies，但已过期，允许设置
      allowSet = true;
    }
  }

  if (allowSet) {
    try {
      await chrome.cookies.set(new_cookie);
    } catch (error) {
      // 单个 cookie 失败不能中断整批恢复（一次恢复可能有上千个 cookie），
      // 只记日志继续，否则一个坏 cookie 会让整个导入失败。
      sendMessage("logger", {
        msg: `Failed to set cookie ${cookie.name} for url ${new_cookie.url}`,
        level: "error",
      }).catch();
    }
  }
}

onMessage("setCookie", async ({ data }) => {
  // force 是我们自己的控制字段（见 messages.ts 的说明），不能透传给 chrome.cookies.set
  const { force = false, ...details } = data;
  return await setCookie(details as chrome.cookies.SetDetails, force);
});

onMessage("removeCookie", async ({ data }) => {
  const removeCookie = {} as chrome.cookies.CookieDetails;

  removeCookie.name = data.name!;
  removeCookie.storeId = data.storeId ?? "0";

  if (typeof data.url === "undefined") {
    const setDetails = data as chrome.cookies.SetDetails;
    removeCookie.url = buildCookieUrl(setDetails.secure ?? true, setDetails.domain!, setDetails.path!);
  } else {
    removeCookie.url = data.url;
  }

  return await chrome.cookies.remove(removeCookie);
});

/**
 * 检查并延长指定域名的cookies
 * @param url 域名
 * @param siteId 站点 id，只用来给「最近续期时间」记键（见 shared/types/storages/other.ts）
 */
export async function checkAndExtendCookies({ url, siteId }: { url: string; siteId?: string }) {
  try {
    const config = (await extStore.getItem("config"))?.autoExtendCookies ?? { enabled: false };

    if (!config.enabled) {
      return;
    }

    // 获取指定URL下的所有cookies
    const cookies = await chrome.cookies.getAll({ url });

    const thresholdDays = config.triggerThreshold * 7; // 转换为天数

    let extendedCount = 0;

    for (const cookie of cookies) {
      try {
        const remainingDays = calculateRemainingDays(cookie.expirationDate);

        // 跳过session cookies（没有过期时间）
        if (remainingDays === Infinity) {
          continue;
        }

        // 只延长指定名称的cookie
        const shouldExtendCookie = cookie.name.startsWith("c_secure_") || cookie.name.startsWith("remember_web_");

        // 如果剩余时间少于阈值，且是目标cookie，则延长cookie
        if (remainingDays < thresholdDays && shouldExtendCookie) {
          // 使用 date-fns 的 add 函数来计算新的过期时间
          const newExpirationDate = Math.floor(add(new Date(), { months: config.extensionDuration }).getTime() / 1000);

          const cookieDetails: chrome.cookies.SetDetails = {
            name: cookie.name,
            value: cookie.value,
            domain: cookie.domain,
            path: cookie.path,
            secure: cookie.secure,
            httpOnly: cookie.httpOnly,
            sameSite: cookie.sameSite,
            expirationDate: newExpirationDate,
            url: buildCookieUrl(cookie.secure, cookie.domain, cookie.path),
          };

          // 使用force=true强制设置cookie，即使原cookie未过期
          await setCookie(cookieDetails, true);
          extendedCount++;
        }
      } catch (error) {
        // 静默处理单个cookie的错误，继续处理其他cookies
        sendMessage("logger", { msg: `Failed to extend cookie ${cookie.name} for url ${url}`, level: "debug" }).catch();
      }
    }

    // 真的动过 cookie 才记时间，否则「最近续期」会把"检查过但没到阈值"也显示成续期过
    if (extendedCount > 0) {
      const renewals = (await extStore.getItem("cookieRenewals")) ?? {};
      renewals[siteId ?? url] = Date.now();
      await extStore.setItem("cookieRenewals", renewals);
    }
  } catch (error) {
    // 静默处理整体错误，不影响调用方
    sendMessage("logger", { msg: `Failed to check and extend cookies for url ${url}`, level: "debug" }).catch();
  }
}

onMessage("checkAndExtendCookies", async ({ data }) => {
  return await checkAndExtendCookies(data);
});