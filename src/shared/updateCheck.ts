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
import { UPDATE_PACKAGE_SOURCES } from "@/shared/updatePackage.ts";
import type {
  IUpdateCheckState,
  TUpdateCheckError,
  TUpdateCheckFallback,
  TUpdateCheckVia,
  TUpdateDigestSource,
} from "@/shared/types.ts";

const LATEST_RELEASE_API = `${REPO_API}/releases/latest`;

/** 备用通道：同一条「最新 Release」的网页版，靠 302 的 Location 带出 tag */
const LATEST_RELEASE_HTML = `${REPO_URL}/releases/latest`;

/**
 * 「版本号那一条链」的总耐心：原链 → 两条镜像 → 网页 302 串在一起共用这一份（原来的单请求上限
 * 是 15 s，链上只有两档时够用；现在多一档，得整条一起算）。
 *
 * 放宽到 30 s 是实测来的（2026-10-22 本机）：原链 0.9 s、gh-proxy.com 3.4 s、
 * ghproxy.net 那句 403 走了 11 s —— 按 15 s 掐表，第三档会在还能成的时候被掐死。
 */
const FETCH_API_CHAIN_TIMEOUT_MS = 30_000;

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
    downloadedFor: "",
    // 下面这几把是 v0.122.0 新加的。存量用户那儿它们压根不存在，readUpdateState 会补成这些初始值，
    // 于是第一次检查之前「没有可信摘要」= 不自动下载 —— 下一次检查成功就从 GitHub 把摘要补上。
    assetSize: 0,
    assetSha256: "",
    digestFrom: "",
    assetName: "",
    downloadSource: "",
    downloadBytes: 0,
    downloadFailCode: "",
    downloadId: 0,
    downloadState: "",
    downloadError: "",
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
  size?: number;
  /** GitHub 2025 年起在资产记录里给的那条 `sha256:<hex>`；老响应没有这一项 */
  digest?: string;
}

interface IGithubReleaseResponse {
  tag_name?: string;
  html_url?: string;
  published_at?: string;
  assets?: IGithubReleaseAsset[];
}

/** 一条 API 响应的提取物；`found` 为假时 `code` 说清它为什么不算 */
interface IReleaseApiHit {
  found: boolean;
  latest: string;
  releaseUrl: string;
  downloadUrl: string;
  publishedAt: string;
  assetSize: number;
  /** 小写 hex，已剥 `sha256:` 前缀；"" = 这条响应里没有摘要 */
  assetSha256: string;
  assetName: string;
  code: TUpdateCheckError;
  httpStatus: number;
  rateLimitResetsAt: number;
}

const API_MISS: IReleaseApiHit = {
  found: false,
  latest: "",
  releaseUrl: "",
  downloadUrl: "",
  publishedAt: "",
  assetSize: 0,
  assetSha256: "",
  assetName: "",
  code: "network",
  httpStatus: 0,
  rateLimitResetsAt: 0,
};

/** 本浏览器那份产物：`PT-Assistant-<版本>-chrome.zip` / `-firefox.zip`；认不出就回落到 Release 页。 */
function pickAsset(
  assets: IGithubReleaseAsset[] | undefined,
  releaseUrl: string,
): { url: string; size: number; sha256: string; name: string } {
  const suffix = `-${__BROWSER__}.zip`;
  const hit = (assets ?? []).find((asset) => String(asset.name ?? "").toLowerCase().endsWith(suffix));
  if (!hit) return { url: releaseUrl, size: 0, sha256: "", name: "" };
  const digest = String(hit.digest ?? "").trim().toLowerCase();
  return {
    url: hit.browser_download_url || releaseUrl,
    size: Number(hit.size) > 0 ? Number(hit.size) : 0,
    // 只认 `sha256:<hex>` 这一种写法；认不出就留空，让「没有可信摘要」那一档去挡下载，
    // 而不是拿一条来路不明的串去比字节。
    sha256: /^sha256:[0-9a-f]{64}$/.test(digest) ? digest.slice(7) : "",
    name: String(hit.name ?? ""),
  };
}

/**
 * 向一条「最新 Release」的 REST 接口要数据。`url` 可以是 GitHub 原链，也可以是加了镜像前缀的那一条。
 *
 * 限流那三条判据（**先认头、只在 403/429 上认 remaining:0、响应体只当补充**）是 v0.47.1 实测来的，
 * 留在这支里逐字没动：只靠响应体那条会误报 —— 读体要等整条响应落地，超时/中断时交出空串，
 * 于是货真价实的限流 403 被判成 `http`，界面就说成「两条路都没能拿到版本号」
 * （用户 2026-10-08 撞上的正是这句）。实测限流那趟的响应头跨源也读得到（本机出口，浏览器网络栈）：
 *   403 + x-ratelimit-limit:60 / x-ratelimit-remaining:0 / x-ratelimit-used:60 /
 *        x-ratelimit-resource:core / x-ratelimit-reset:<unix 秒>
 * 404 也带这套头，所以配额恰好归零时按头判会把「仓库没发布过」误说成限流 —— 那为什么不放宽到 404。
 */
async function fetchReleaseApi(url: string, signal: AbortSignal): Promise<IReleaseApiHit> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/vnd.github+json" },
      signal,
      credentials: "omit",
    });
  } catch {
    return { ...API_MISS, code: "network" };
  }
  if (!res.ok) {
    const httpStatus = res.status;
    const remaining = res.headers.get("x-ratelimit-remaining");
    const isQuotaCode = httpStatus === 403 || httpStatus === 429;
    let limited = isQuotaCode && (httpStatus === 429 || remaining === "0");
    if (isQuotaCode && !limited) {
      limited = /rate limit/i.test(await res.text().catch(() => ""));
    }
    if (limited) {
      const reset = Number(res.headers.get("x-ratelimit-reset"));
      return {
        ...API_MISS,
        code: "rateLimited",
        httpStatus,
        rateLimitResetsAt: Number.isFinite(reset) && reset > 0 ? reset * 1000 : 0,
      };
    }
    return { ...API_MISS, code: "http", httpStatus };
  }
  let json: IGithubReleaseResponse | undefined;
  try {
    json = (await res.json()) as IGithubReleaseResponse;
  } catch {
    return { ...API_MISS, code: "badData", httpStatus: res.status };
  }
  const latest = normalizeVersion(json?.tag_name);
  if (!latest) return { ...API_MISS, code: "badData", httpStatus: res.status };
  const releaseUrl = json!.html_url || `${REPO_URL}/releases`;
  const asset = pickAsset(json!.assets, releaseUrl);
  return {
    found: true,
    latest,
    releaseUrl,
    downloadUrl: asset.url,
    publishedAt: json!.published_at ?? "",
    assetSize: asset.size,
    assetSha256: asset.sha256,
    assetName: asset.name,
    code: "",
    httpStatus: 0,
    rateLimitResetsAt: 0,
  };
}

/**
 * 备用通道：向发布页要那条 302。
 *
 * 为什么需要它：GitHub 的匿名 REST 配额是**按出口 IP** 算的（每小时 60 次），而挂在共享代理出口
 * 后面的用户，那个 IP 上别人早就把配额用完了 —— 实测本机出口 103.167.135.21 走代理拿到的就是
 * 403「API rate limit exceeded」，同一时刻绕开代理直连是 200。这条网页跳转不占 REST 配额，
 * 302 的 Location 里就带着 tag 名，判「有没有新版本」够用。
 *
 * 发布时间也从这一页拿：tag 页上那一枚 `<relative-time datetime="…">` 就是 Release 的发布时间，
 * 实测 v0.46.0 / v0.47.2 两个页面上的值与 REST 的 `published_at` 逐字符相同（页面各只有一枚，
 * 不存在挑错哪一枚的问题）。所以这条路唯一还拿不到的是**按浏览器分好的 zip 直链** ——
 * downloadUrl 只能是 Release 页本身（点「前往下载页」会落到那一页，不假装是直链）。
 *
 * 拿不出版本号时返回 `ok:false`（仓库一条 Release 都没有 → 那条跳转本来就停在 /releases/latest），
 * 请求自己失败（代理只放行 api 那台、断网、超时）则抛给调用方 ——
 * 两者要告诉用户的话不一样，不能都糊成「两条路都没拿到」，所以也不拿异常当控制流。
 */
async function fetchLatestViaHtml(
  signal: AbortSignal,
): Promise<{ ok: true; latest: string; releaseUrl: string; publishedAt: string } | { ok: false }> {
  const res = await fetch(LATEST_RELEASE_HTML, { method: "GET", redirect: "follow", signal, credentials: "omit" });
  const tag = /\/releases\/tag\/([^/?#]+)/.exec(res.url ?? "");
  const latest = normalizeVersion(tag ? decodeURIComponent(tag[1]) : "");
  if (!latest) {
    return { ok: false };
  }
  // 正文只为这一枚时间戳去读；读不到（页面改版 / 这一跳被裁）就留空，不影响版本号已经拿到这件事
  const publishedAt = await res
    .text()
    .then((html) => /<relative-time[^>]*\bdatetime="([^"]+)"/.exec(html)?.[1] ?? "")
    .catch(() => "");

  // 用服务器给的那条最终地址（去掉查询串），不自己拼 `v<版本>` —— tag 前缀不是我们该假设的
  return { ok: true, latest, releaseUrl: String(res.url).split(/[?#]/)[0], publishedAt };
}

/**
 * 发一次请求并把结果整块写回 storage。**不抛异常**：失败也写成状态存起来（界面上要显示
 * 「上次检查失败」而不是什么都不变），返回值永远是写进去的那一份。
 *
 * 版本号这一路的档序（v0.122.0 起）：**GitHub 原链 API → 镜像代理 API → Release 页那条 302**。
 * 多出来的那一档只为「拿到版本号」服务，**不改变摘要的可信等级**：只有原链 API 给的那条 sha256
 * 才当校验锚（`digestFrom:"github"`）；经镜像拿到的摘要记成 `"mirror"`，调用方据此不自动下载 ——
 * 拿镜像给的摘要去验同一个镜像送来的字节，「换包的镜像 + 假的摘要」这条结构上就检不出来。
 * 宁可不下，也不能假装验过。
 */
export async function runUpdateCheck(): Promise<IUpdateCheckState> {
  const state = await readUpdateState();
  const now = Date.now();

  // 整条链共用这一份耐心上限：后面的档只在前面已经失败时才走，不该另起一个计时器。
  // 从 15s 放宽到 30s 是实测来的：原链 0.9 s / gh-proxy.com 3.4 s / ghproxy.net 那条 403 走了 11 s，
  // 三档 API 再串一条网页跳转，15 秒会把还能试的档掐在半路。
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_API_CHAIN_TIMEOUT_MS);

  let data: IReleaseApiHit = API_MISS;
  let via: TUpdateCheckVia = "";
  let digestFrom: TUpdateDigestSource = "";
  let errorCode: TUpdateCheckError = "";
  let httpStatus = 0;
  let rateLimitResetsAt = 0;
  let fallbackOutcome: TUpdateCheckFallback = "";
  let latest = "";
  let releaseUrl = "";
  let downloadUrl = "";
  let publishedAt = "";

  try {
    // ① 原链：唯一能把摘要升格成校验锚的一档
    const direct = await fetchReleaseApi(LATEST_RELEASE_API, controller.signal);
    if (direct.found) {
      data = direct;
      via = "api";
      digestFrom = "github";
    } else {
      // 留着原链那条错误码当「这次为什么没成」的主原因：它才是他要处理的那件事（限流要换出口、
      // 404 是仓库的事）。镜像档成没成只影响下面版本号拿没拿到，不该把原因覆盖掉。
      errorCode = direct.code;
      httpStatus = direct.httpStatus;
      rateLimitResetsAt = direct.rateLimitResetsAt;

      // ② 镜像代理的 API —— 给得出版本号，给不出可信摘要
      for (const prefix of UPDATE_PACKAGE_SOURCES) {
        if (controller.signal.aborted) break;
        const mirror = await fetchReleaseApi(prefix + LATEST_RELEASE_API, controller.signal);
        if (mirror.found) {
          data = mirror;
          via = "api";
          digestFrom = "mirror";
          break;
        }
      }

      // ③ 网页那条 302：只给得出版本号，既没有摘要也没有按浏览器分好的直链
      if (!data.found && !controller.signal.aborted) {
        try {
          const fallback = await fetchLatestViaHtml(controller.signal);
          if (fallback.ok) {
            via = "html";
            digestFrom = "html";
            latest = fallback.latest;
            releaseUrl = fallback.releaseUrl;
            downloadUrl = fallback.releaseUrl;
            publishedAt = fallback.publishedAt;
            errorCode = "";
            httpStatus = 0;
          } else {
            fallbackOutcome = "noTag";
          }
        } catch {
          // 这一跳自己就没走通（代理只放行 api 那台 / 断网 / 耐心到）。留着前面那条错误码，
          // 它才是原因；但要把「第二条路试过、且是这么失败的」记下来，否则下次还是只能猜。
          fallbackOutcome = "threw";
        }
      }
    }

    if (data.found) {
      latest = data.latest;
      releaseUrl = data.releaseUrl;
      downloadUrl = data.downloadUrl;
      publishedAt = data.publishedAt;
      errorCode = "";
      httpStatus = 0;
      rateLimitResetsAt = 0;
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
    // 失败时保留上一次的 latestVersion / 链接 / 通道：那次确实是查到的，没必要当作不知道。
    // 摘要与字节数跟着**同一次成功**一起落地：换了版本却留着旧包的 sha256，下一趟必然判成
    // digestMismatch，而界面会把它说成「包与记录不符」—— 那是我们自己造成的假警报。
    ...(errorCode
      ? {}
      : {
          latestVersion: latest,
          releaseUrl,
          downloadUrl,
          publishedAt,
          via,
          digestFrom,
          assetSize: data.found ? data.assetSize : 0,
          assetSha256: data.found ? data.assetSha256 : "",
          assetName: data.found ? data.assetName : "",
        }),
  };

  await writeUpdateState(next);
  return next;
}
