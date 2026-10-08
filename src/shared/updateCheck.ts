/**
 * 「检查更新」的唯一实现。
 *
 * 为什么网络请求只在 service worker 里发：写 `updateCheck` 这个键的应当只有一个上下文 ——
 * `extStore` 的写队列是**每个上下文各一份**、跨上下文不互斥的（见 storage.ts 里那段说明），
 * 两个上下文各自「读整块 → 改 → 写回整块」就会互相覆盖。所以选项页的「立即检查更新」走
 * `checkForUpdate` 消息交给 SW，读缓存才直连 storage。
 *
 * 为什么通道选 GitHub Releases 而不是 `chrome.runtime.requestUpdateCheck()`：后者只问 Chrome
 * 应用商店、而且不返回「最新版是哪个」，Firefox 用户和「从 Release 页下 zip 自己加载」的用户
 * 都拿不到结果。仓库的 Release 是三端共同的发布物（每个版本一个 tag + 三个 zip，见 AGENTS §2.4），
 * 一条公开接口全覆盖。
 */
import { REPO_API, REPO_URL } from "~/helper.ts";
import { extStore } from "@/storage.ts";
import type { IUpdateCheckState, TUpdateCheckError, TUpdateCheckFallback, TUpdateCheckVia } from "@/shared/types.ts";

const LATEST_RELEASE_API = `${REPO_API}/releases/latest`;

/** 备用通道：同一条「最新 Release」的网页版，靠 302 的 Location 带出 tag */
const LATEST_RELEASE_HTML = `${REPO_URL}/releases/latest`;

/** 一次请求的耐心上限：拿不到就算了，不占着 SW */
const FETCH_TIMEOUT_MS = 15_000;

/** 闹钟的滴答间隔：SW 可能被各种事件频繁唤醒，用一个比"每天"松、比"每次唤醒"紧的档位 */
export const AUTO_CHECK_TICK_MS = 6 * 60 * 60 * 1000;

/** 真正发起请求的最小间隔（自动检查的限速；手动检查不受此限） */
export const AUTO_CHECK_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * 有没有新版本**不存**进 storage：那是 latestVersion 跟当前 manifest 版本的比较结果，
 * 存下来就有两份真源 —— 用户升级到最新版之后、下一次检查之前，界面会拿着旧的
 * 「有新版本」继续提醒。所以每次现算。
 */
export type TUpdateStatus = "never" | "failed" | "upToDate" | "updateAvailable";

export function emptyUpdateState(): IUpdateCheckState {
  return {
    lastCheckAt: 0,
    latestVersion: "",
    releaseUrl: "",
    downloadUrl: "",
    publishedAt: "",
    errorCode: "",
    httpStatus: 0,
    notifiedFor: "",
    via: "",
    rateLimitResetsAt: 0,
    fallbackOutcome: "",
  };
}

/** `v0.42.0` / `0.42.0+abc123` → `0.42.0`；拿不出三段的一律返回空串（当作"不知道"）。 */
export function normalizeVersion(raw: unknown): string {
  const cleaned = String(raw ?? "")
    .trim()
    .replace(/^v/i, "")
    .split("+")[0]
    .split("-")[0];
  return /^\d+\.\d+\.\d+$/.test(cleaned) ? cleaned : "";
}

/** 逐段比数值；短的那段缺位补 0。返回 a 相对 b：a 新为 1、相同 0、更旧 -1。 */
export function compareVersion(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

export async function readUpdateState(): Promise<IUpdateCheckState> {
  const stored = await extStore.getItem("updateCheck");
  // 老用户那儿的键还不存在；即便存在，早先写进去的也可能缺字段（这份结构以后加字段时同理），
  // 所以整块补齐一遍，调用方拿到的永远是完整形状。
  return stored ? { ...emptyUpdateState(), ...stored } : emptyUpdateState();
}

export function writeUpdateState(state: IUpdateCheckState): Promise<void> {
  return extStore.setItem("updateCheck", state);
}

/**
 * 界面与通知共用这一个判据。
 *
 * 「有 latestVersion 但这次失败了」要报 upToDate/updateAvailable 而不是 failed ——
 * 手里那份版本仍然是真的，只是这次没查到更新的；errorCode 只在界面上额外提一句。
 */
export function deriveUpdateStatus(state: IUpdateCheckState, currentVersion: string): TUpdateStatus {
  const current = normalizeVersion(currentVersion);
  if (!state.latestVersion || !current) {
    return state.errorCode ? "failed" : "never";
  }
  return compareVersion(state.latestVersion, current) > 0 ? "updateAvailable" : "upToDate";
}

interface IGithubReleaseAsset {
  name?: string;
  browser_download_url?: string;
}

interface IGithubReleaseResponse {
  tag_name?: string;
  html_url?: string;
  published_at?: string;
  assets?: IGithubReleaseAsset[];
}

/** 本浏览器那份产物：`PT-Assistant-<版本>-chrome.zip` / `-firefox.zip`；认不出就回落到 Release 页。 */
function pickAssetUrl(assets: IGithubReleaseAsset[] | undefined, releaseUrl: string): string {
  const suffix = `-${__BROWSER__}.zip`;
  const hit = (assets ?? []).find((asset) => String(asset.name ?? "").toLowerCase().endsWith(suffix));
  return hit?.browser_download_url || releaseUrl;
}

/**
 * 备用通道：向发布页要那条 302。
 *
 * 为什么需要它：GitHub 的匿名 REST 配额是**按出口 IP** 算的（每小时 60 次），而挂在共享代理出口
 * 后面的用户，那个 IP 上别人早就把配额用完了 —— 实测本机出口 103.167.135.21 走代理拿到的就是
 * 403「API rate limit exceeded」，同一时刻绕开代理直连是 200。这条网页跳转不占 REST 配额，
 * 302 的 Location 里就带着 tag 名，判「有没有新版本」够用。
 *
 * 代价要说清：这条路拿不到 published_at，也拿不到按浏览器分好的 zip 直链，
 * 所以 downloadUrl 就是 Release 页本身（点「前往下载页」会落到那一页，不假装是直链）。
 * 拿不出版本号时返回 `ok:false`（仓库一条 Release 都没有 → 那条跳转本来就停在 /releases/latest），
 * 请求自己失败（代理只放行 api 那台、断网、超时）则抛给调用方 ——
 * 两者要告诉用户的话不一样，不能都糊成「两条路都没拿到」，所以也不拿异常当控制流。
 */
async function fetchLatestViaHtml(
  signal: AbortSignal,
): Promise<{ ok: true; latest: string; releaseUrl: string } | { ok: false }> {
  const res = await fetch(LATEST_RELEASE_HTML, { method: "GET", redirect: "follow", signal, credentials: "omit" });
  const tag = /\/releases\/tag\/([^/?#]+)/.exec(res.url ?? "");
  const latest = normalizeVersion(tag ? decodeURIComponent(tag[1]) : "");
  if (!latest) {
    return { ok: false };
  }
  // 用服务器给的那条最终地址（去掉查询串），不自己拼 `v<版本>` —— tag 前缀不是我们该假设的
  return { ok: true, latest, releaseUrl: String(res.url).split(/[?#]/)[0] };
}

/**
 * 发一次请求并把结果整块写回 storage。**不抛异常**：失败也写成状态存起来（界面上要显示
 * 「上次检查失败」而不是什么都不变），返回值永远是写进去的那一份。
 */
export async function runUpdateCheck(): Promise<IUpdateCheckState> {
  const state = await readUpdateState();
  const now = Date.now();

  // 两条路共用这一份耐心上限：备用通道只在主路已经失败时才走，不该另起一个 15 秒
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let errorCode: TUpdateCheckError = "";
  let httpStatus = 0;
  let latest = "";
  let releaseUrl = "";
  let downloadUrl = "";
  let publishedAt = "";
  let via: TUpdateCheckVia = "";
  let fallbackOutcome: TUpdateCheckFallback = "";
  let rateLimitResetsAt = 0;

  try {
    const res = await fetch(LATEST_RELEASE_API, {
      method: "GET",
      headers: { Accept: "application/vnd.github+json" },
      signal: controller.signal,
      credentials: "omit",
    });
    if (!res.ok) {
      httpStatus = res.status;
      /**
       * 光看状态码分不开「仓库没发布过」和「这个出口 IP 配额用完了」—— 而这两件事要告诉用户的话
       * 完全不同（前者是仓库的事，后者他换个节点就好）。
       *
       * 判据用**两条**，因为原先只靠响应体那一条会误报：读体要等整条响应落地，超时/中断时
       * `.catch(() => "")` 交出空串，于是货真价实的限流 403 被判成 `http`，界面就说成
       * 「两条路都没能拿到版本号」（用户 2026-10-08 撞上的正是这句）。
       * 实测限流那趟的响应头就带着答案、而且跨源读得到（本机出口，浏览器网络栈）：
       *   403 + x-ratelimit-limit:60 / x-ratelimit-remaining:0 / x-ratelimit-used:60 /
       *        x-ratelimit-resource:core / x-ratelimit-reset:<unix 秒>
       * 所以头先判、体只当补充。**只在 403/429 上认 remaining:0** —— 404 也带这套头，
       * 配额恰好归零时按头判会把「仓库没发布过」误说成限流。
       */
      const remaining = res.headers.get("x-ratelimit-remaining");
      const isQuotaCode = res.status === 403 || res.status === 429;
      // 头先判（读得到、不等响应体落地）；体只当补充 —— 429 本身就是"请求过多"，不用再判
      let limited = isQuotaCode && (res.status === 429 || remaining === "0");
      if (isQuotaCode && !limited) {
        const body = await res.text().catch(() => "");
        limited = /rate limit/i.test(body);
      }
      if (limited) {
        errorCode = "rateLimited";
        const reset = Number(res.headers.get("x-ratelimit-reset"));
        rateLimitResetsAt = Number.isFinite(reset) && reset > 0 ? reset * 1000 : 0;
      } else {
        errorCode = "http";
      }
    } else {
      const json = (await res.json()) as IGithubReleaseResponse;
      latest = normalizeVersion(json?.tag_name);
      if (!latest) {
        errorCode = "badData";
      } else {
        releaseUrl = json.html_url || `${REPO_URL}/releases`;
        downloadUrl = pickAssetUrl(json.assets, releaseUrl);
        publishedAt = json.published_at ?? "";
        via = "api";
      }
    }

    if (errorCode) {
      try {
        const fallback = await fetchLatestViaHtml(controller.signal);
        if (fallback.ok) {
          latest = fallback.latest;
          releaseUrl = fallback.releaseUrl;
          downloadUrl = fallback.releaseUrl;
          publishedAt = "";
          via = "html";
          errorCode = "";
          httpStatus = 0;
        } else {
          fallbackOutcome = "noTag";
        }
      } catch {
        // 这一跳自己就没走通（代理只放行 api 那台 / 断网 / 15 秒耐心到）。留着主路那条错误码，
        // 它才是原因；但要把「第二条路试过、且是这么失败的」记下来，否则下次还是只能猜。
        fallbackOutcome = "threw";
      }
    }
  } catch {
    // fetch reject（断网 / DNS / CORS）与超时 abort 都是这里；错误原文是浏览器给的英文句子，
    // 不进界面（§3.5），只留一个码让界面按当前语言取文案。已经判出原因的不要去覆盖它。
    if (!errorCode) {
      errorCode = "network";
    }
  } finally {
    clearTimeout(timer);
  }

  const next: IUpdateCheckState = {
    ...state,
    lastCheckAt: now,
    errorCode,
    httpStatus,
    fallbackOutcome,
    rateLimitResetsAt,
    // 失败时保留上一次的 latestVersion / 链接 / 通道：那次确实是查到的，没必要当作不知道
    ...(errorCode ? {} : { latestVersion: latest, releaseUrl, downloadUrl, publishedAt, via }),
  };

  await writeUpdateState(next);
  return next;
}
