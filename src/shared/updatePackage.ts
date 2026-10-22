/**
 * 「更新包从哪一档取、取回来凭什么算数」的判据本体。
 *
 * 单独成文件（而不是留在 `updateCheck.ts` 里）的理由：那一份 import 了 storage 与 `~/helper.ts`，
 * Node 里 import 不动；而这一份只 import **一个类型**（`import type` 会被整条擦掉，运行时不拉模块图），
 * vitest 能直接跑真源码（同 `reseedScanPlan.ts` 直接 import `./types/storages/reseedScan.ts` 的先例）。
 * 判错的代价是「把没验过的字节交给下载管理器」，那一档必须测得到。
 */
import type { TUpdateDigestSource } from "./types/storages/other.ts";

/**
 * 取安装包字节的回退链前缀（用户 2026-10-22 定的先后），最后一档是不加前缀的 GitHub 原链。
 *
 * 本机实测（2026-10-22，`.tmp-build/probe-update-mirrors*.mjs`）：资产 6.8 MB ——
 * `ghproxy.net` 60 s 与 120 s 各一次都超时取不到；`gh-proxy.com` 200、整包字节数与 GitHub
 * 记录逐字相等、sha256 与 API 的 digest 一致（用时 37~79 s）；GitHub 原链一次超时一次
 * `fetch failed`。所以这一串里真正在干活的是第二档，第一档留着不亏 —— 回退链的语义就是一档不通就换。
 */
export const UPDATE_PACKAGE_SOURCES = ["https://ghproxy.net/", "https://gh-proxy.com/"] as const;

/** 每档的显示名（界面要说「经 gh-proxy.com 取包」而不是「第二档」）；域名不是文案，不进 i18n */
export function updateSourceLabel(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * 一条 Release 资产直链 → 逐档试的地址表：镜像在前、原链殿后。
 *
 * 不是资产直链就原样返回一条（调用方自己会挡 —— 走备用通道时那个 `downloadUrl` 是 Release **网页**，
 * 把网页交给下载管理器会存下一个名字像 zip、内容是 HTML 的文件，那比不下载更糟）。
 */
export function updatePackageCandidates(assetUrl: string): string[] {
  if (!isReleaseAssetUrl(assetUrl)) return [assetUrl];
  return [...UPDATE_PACKAGE_SOURCES.map((prefix) => prefix + assetUrl), assetUrl];
}

/**
 * 那条 URL 是不是真的 Release 资产直链。两种形状都算：
 * - GitHub 原链 `https://github.com/<owner>/<repo>/releases/download/<tag>/<file>.zip`
 * - 镜像前缀式 `https://gh-proxy.com/` + 上面那一条
 *
 * 前缀式那一条的内层**必须仍是原链逐字** —— 放宽成「任何以 .zip 结尾的两段路径」就等于放进了任意串。
 * 只认原链的话更坏：加上镜像之后这一判会把每一条候选都挡掉，自动下载整条静默失效（不报错、不进构建）。
 *
 * 两条正则分开写、不拼 `.source`：把一个带 `^` 的模式嵌进另一个中间，那个 `^` 就成了
 * 「永远匹配不到」的行首锚 —— 拼出来的那条从头就没通过过任何串。
 */
const GITHUB_ASSET = /^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/download\/[^?#]+\.zip$/i;
const MIRROR_ASSET = /^https:\/\/[^/]+\/https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/download\/[^?#]+\.zip$/i;

export function isReleaseAssetUrl(url: string): boolean {
  return GITHUB_ASSET.test(url) || MIRROR_ASSET.test(url);
}

/** 校验一个包要吃的三样，凑不齐就压根不该开始下 */
export interface IUpdatePackageExpectation {
  /** GitHub 记录里的字节数；0 = 不知道 */
  size: number;
  /** GitHub 记录里的 sha256（小写 hex）；"" = 没有可信摘要 */
  sha256: string;
  /** 那份摘要这次是从哪条路拿到的 —— 镜像给的不能当锚（见 `untrustedDigest`） */
  from: TUpdateDigestSource;
}

/** 校验结论：`ok` 之外每一档都要能单独说清「停在哪」 */
export type TUpdateVerifyOutcome = "ok" | "noDigest" | "untrustedDigest" | "sizeMismatch" | "digestMismatch" | "notZip";

/**
 * 落地之前把字节验一遍：有没有摘要 → 摘要可不可信 → 字节数 → 文件头是不是 zip → 摘要逐字相等。
 *
 * 前两档排在最前面是刻意的：**没有可信摘要就压根不比对**。因为「只比字节数 + 文件头」
 * 挡不住一个存心换包的镜像，那种状态下校验只是给人一个「已经验过了」的错觉 —— 比不验更坏。
 * 宁可不下，也不能假装验过。
 *
 * `notZip` 排在摘要比对**之前**：它要抓的是「HTTP 200 但送的不是包」那一族（实测 `ghproxy.net`
 * 代理 API 回的是 403 + 14 B 的 `Invalid input.`，网关改写时会给 200 的 HTML）。放在摘要之后
 * 它就永远轮不到 —— 那种字节的 sha256 必然也对不上，界面就会把「镜像没在传包」说成「包被换过」，
 * 而这两件事他要做的反应不一样。
 *
 * ⚠️ 「是不是 zip」判的是**文件头那几个字节**（`head`），不是算出来的摘要串。
 * 第一版在这里写错过：拿 sha256 的十六进制去比 `504b` —— 摘要是哈希，跟文件内容长什么样没关系，
 * 那样每一条真包都会被判成「不是 zip」，功能整体静默失效（不报错、不进构建，只有装机才发现）。
 * 是「字节数与摘要全对上 → 放行」那条用例用真摘要（`844b…` 开头）把它顶出来的。
 */
export function verifyUpdatePackage(
  exp: IUpdatePackageExpectation,
  actual: { bytes: number; head: Uint8Array; sha256: string },
): TUpdateVerifyOutcome {
  if (!exp.sha256) return "noDigest";
  if (exp.from !== "github") return "untrustedDigest";
  if (exp.size > 0 && actual.bytes !== exp.size) return "sizeMismatch";
  // zip 的固定开头 `PK\x03\x04`（有文件）/ `PK\x05\x06`（空包）
  if (!(actual.head.length >= 4 && actual.head[0] === 0x50 && actual.head[1] === 0x4b && (actual.head[2] === 0x03 || actual.head[2] === 0x05))) {
    return "notZip";
  }
  return actual.sha256.toLowerCase() === exp.sha256.toLowerCase() ? "ok" : "digestMismatch";
}

/**
 * 取整包的耐心：实测 gh-proxy.com 送 6.8 MB 用了 79 s（约 90 KB/s），
 * 沿用版本号那一路的 15 s 会把唯一在干活的一档判成失败。
 * 整包要过内存才能校验，所以这个数只能放宽、不能缩。
 */
export const UPDATE_PACKAGE_FETCH_TIMEOUT_MS = 180_000;
