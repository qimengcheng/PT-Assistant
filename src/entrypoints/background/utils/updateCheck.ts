/**
 * 后台的「检查更新」：一条每日限速的定时任务 + 一条给设置页用的手动检查消息。
 *
 * 只在 service worker 里发请求、只由它写 `updateCheck` 这个键（理由见 @/shared/updateCheck.ts
 * 文件头）。这里额外负责的只有两件事：自动检查的限速闸门，和「发现新版本」的系统通知。
 */
import { defineJobScheduler } from "@webext-core/job-scheduler";

import { gatedLogger } from "@/shared/consoleLog.ts";

import { extStore } from "@/storage.ts";
import { onMessage, sendMessage } from "@/messages.ts";
import type {
  IConfigPiniaStorageSchema,
  IUpdateCheckState,
  TUpdateDownloadError,
  TUpdateDownloadState,
} from "@/shared/types.ts";

import {
  AUTO_CHECK_MIN_INTERVAL_MS,
  AUTO_CHECK_TICK_MS,
  deriveUpdateStatus,
  readUpdateState,
  runUpdateCheck,
  writeUpdateState,
} from "@/shared/updateCheck.ts";
import {
  UPDATE_PACKAGE_FETCH_TIMEOUT_MS,
  isReleaseAssetUrl,
  updatePackageCandidates,
  updateSourceLabel,
  verifyUpdatePackage,
} from "@/shared/updatePackage.ts";

const JOB_ID = "checkForUpdate";

const jobs = defineJobScheduler({ logger: gatedLogger });

function currentVersion(): string {
  return browser.runtime.getManifest().version;
}

/**
 * 通知文案：SW 里拿不到 useI18n，按 config.lang 选一份（同 DownloadHistory 的 i18nLoadErrorText）。
 *
 * 三种说法按**这一次真实的下载状态**给：`downloading` 说「正在下载」而不说「已下载」——
 * 通知是发起下载的同一刻弹的，几百 KB 到几十 MB 的包可能还没落地，写「已下载」是替浏览器说过头话。
 */
function notifyText(
  lang: string | undefined,
  latestVersion: string,
  download: TUpdateDownloadState,
): { title: string; message: string } {
  const zh = lang === "zh_CN";
  if (download === "done") {
    return zh
      ? { title: "PT Assistant 有新版本", message: `v${latestVersion} 的安装包已下载到浏览器下载目录，解压后替换原目录即可` }
      : {
          title: "PT Assistant update available",
          message: `The v${latestVersion} package is in your downloads folder. Unzip it over the old folder.`,
        };
  }
  if (download === "downloading") {
    return zh
      ? { title: "PT Assistant 有新版本", message: `v${latestVersion} 的安装包正在下载到浏览器下载目录` }
      : {
          title: "PT Assistant update available",
          message: `The v${latestVersion} package is being saved to your downloads folder.`,
        };
  }
  return zh
    ? { title: "PT Assistant 有新版本", message: `v${latestVersion} 已发布，点击前往下载页面` }
    : { title: "PT Assistant update available", message: `v${latestVersion} is out. Click to open the download page.` };
}

/**
 * 发现新版本时把那个安装包取到浏览器下载目录 —— **先验字节，再落盘**。
 *
 * 为什么要过内存：MV3 的 `chrome.downloads` 没有「把下载完的文件读回来」的口子（`path()` 只给路径，
 * 而 Downloads 目录扩展也读不了）。所以「下完再验」这条路结构上不存在，只能自己 fetch 进内存、
 * 验过再交给下载管理器。代价明说：6.8 MB 整包进 SW，实测 gh-proxy.com 那一趟要 79 s。
 *
 * 六道闸，缺一不下：
 * 1. 开关开着（`autoDownload` 缺省即开，存量用户没落盘过这一项）；
 * 2. 那条 URL 是**真资产直链**（走备用通道时它是 Release 网页，存下来会是个名字像 zip 的
 *    HTML —— 比不下载更坏）；
 * 3. 这个版本还没下过（每天查一次就每天下一个是刷屏；下失败也记成「下过」，
 *    不自动重试 —— 界面上有手动那颗按钮，重试该由人决定）；
 * 4. 手里有一条 **GitHub 原链给的** sha256 摘要（`digestFrom === "github"`）。
 *    经镜像代理的 API 拿到的摘要不算数：用它去验同一个镜像送来的字节，「换包的镜像 + 假摘要」
 *    检不出来，那种校验只是给人一个「已经验过了」的错觉 —— 比不验更坏，所以宁可不下。
 * 5. 每一档来源取回的字节都要过 `verifyUpdatePackage`（字节数 → 是不是 zip → 摘要逐字相等），
 *    不合就换下一档，**三档全不合就报失败**，绝不把没验过的字节交给下载管理器；
 * 6. 交给下载管理器之后仍然要盯 `onChanged`：排上 ≠ 落地。
 *
 * 档序（`ghproxy.net` → `gh-proxy.com` → GitHub 原链）是用户 2026-10-22 定的。
 *
 * 返回值就是写进 storage 的那一份，调用方拿它去决定通知怎么写。
 */
async function autoDownloadIfNeeded(state: IUpdateCheckState, autoDownloadOn: boolean): Promise<IUpdateCheckState> {
  const skip = (code: TUpdateDownloadError): IUpdateCheckState => ({
    ...state,
    downloadedFor: state.latestVersion,
    downloadId: 0,
    downloadState: "failed",
    downloadFailCode: code,
    downloadError: "",
    downloadSource: "",
    downloadBytes: 0,
  });

  if (!autoDownloadOn) return state;
  if (!isReleaseAssetUrl(state.downloadUrl)) return state;
  if (state.downloadedFor === state.latestVersion) return state;
  if (!state.assetSha256) return await writeAndLog(skip("noDigest"));
  if (state.digestFrom !== "github") return await writeAndLog(skip("untrustedDigest"));

  const candidates = updatePackageCandidates(state.downloadUrl);
  let lastCode: TUpdateDownloadError = "allSourcesFailed";
  let verified: { bytes: Uint8Array; source: string } | null = null;

  for (const url of candidates) {
    // 每一档自己一份耐心：整条链最坏 3 × 180 s，但一次只拿一条，前一条卡住不影响后一条起表
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPDATE_PACKAGE_FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal, redirect: "follow", credentials: "omit" });
      if (!res.ok) {
        lastCode = "allSourcesFailed";
        continue;
      }
      const buffer = new Uint8Array(await res.arrayBuffer());
      const outcome = verifyUpdatePackage(
        { size: state.assetSize, sha256: state.assetSha256, from: state.digestFrom },
        { bytes: buffer.byteLength, head: buffer.subarray(0, 4), sha256: await sha256Hex(buffer) },
      );
      if (outcome !== "ok") {
        // 校验层的码原样留档（noDigest / untrustedDigest 那两档在上面已经挡过，这里到不了）
        lastCode = outcome;
        continue;
      }
      verified = { bytes: buffer, source: updateSourceLabel(url) };
      break;
    } catch {
      lastCode = "allSourcesFailed";
    } finally {
      clearTimeout(timer);
    }
  }

  if (!verified) {
    // 三档里各报不同的码时留哪一个：留**最后一条**。前面那档的失败已经被「换一档重试」消化过了，
    // 只有最后一条是他现在要处理的那件事。（否则界面会说一件已经过去了的事。）
    return await writeAndLog(skip(lastCode));
  }

  const hit = verified;
  let next: IUpdateCheckState;
  try {
    // 校验过的字节只能由我们自己给个名字 —— 用的还是 GitHub 记录里那条 asset name，
    // 不自己按版本号拼（发布物实际叫什么是它那边定的）。
    const objectUrl = URL.createObjectURL(new Blob([hit.bytes as BlobPart], { type: "application/zip" }));
    pendingBlobUrl = objectUrl;
    const id = await chrome.downloads.download({
      url: objectUrl,
      filename: state.assetName || undefined,
      conflictAction: "uniquify",
    });
    next = {
      ...state,
      downloadedFor: state.latestVersion,
      downloadId: typeof id === "number" ? id : 0,
      downloadState: "downloading",
      downloadFailCode: "",
      downloadError: "",
      downloadSource: hit.source,
      downloadBytes: hit.bytes.byteLength,
    };
  } catch (e) {
    // 包是验过的，坏在「没能写进下载目录」这一句上 —— 分开报，别让它读成「校验没过」
    next = {
      ...skip("saveFailed"),
      downloadSource: hit.source,
      downloadBytes: hit.bytes.byteLength,
      downloadError: e instanceof Error ? e.message : String(e),
    };
  }

  await writeUpdateState(next);
  void sendMessage("logger", {
    msg: `检查更新：自动下载 v${next.latestVersion} ${next.downloadState}（${next.downloadFailCode || next.downloadError || "正常"}，来源 ${next.downloadSource || "-"}）`,
  });
  return next;
}

/** 提前退出那几档也要落盘 + 留日志，否则界面上「为什么没下」永远是一句空白 */
async function writeAndLog(state: IUpdateCheckState): Promise<IUpdateCheckState> {
  await writeUpdateState(state);
  void sendMessage("logger", {
    msg: `检查更新：没有自动下载 v${state.latestVersion}（${state.downloadFailCode}）`,
  });
  return state;
}

/**
 * SW 里创建的那个 blob URL 什么时候回收。
 *
 * 不能下载一排上就 revoke —— 下载器要在真正打开时才解引用它；只能在 `onChanged` 落到
 * complete / interrupted 之后收。SW 被回收时这块内存连着 URL 一起没了，不会漏到磁盘上，
 * 所以「下一轮开始前沿用上一轮的残留」这种形状不存在，不额外加清理表。
 */
let pendingBlobUrl = "";

/** 校验一个包要的那条 hex 摘要：WebCrypto 在 MV3 SW 里可用，不进判据本体（那一份要能在 Node 里断言） */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * 下载是异步的，`download()` 回来只代表「排上了」。真正的成败从 onChanged 落回来 ——
 * 不接它的话，界面上那条会永远停在「正在下载」。
 *
 * 顺带回收那个 blob URL：它必须在字节真进下载器**之后**才许撤（提前 revoke 等于把正在写的
 * 那条抽掉来源），所以收尾挂在这里，而不是发起下载的下一行。
 */
chrome.downloads?.onChanged.addListener((delta) => {
  void (async () => {
    const state = await readUpdateState();
    if (!state.downloadId || delta.id !== state.downloadId) return;

    const to = delta.state?.current;
    if (to === "complete") {
      revokePendingBlob();
      await writeUpdateState({ ...state, downloadState: "done", downloadError: "" });
    } else if (to === "interrupted") {
      revokePendingBlob();
      await writeUpdateState({ ...state, downloadState: "failed", downloadError: delta.error?.current ?? "" });
    }
  })().catch((e) => {
    void sendMessage("logger", { msg: `检查更新：下载状态回写失败 (${e instanceof Error ? e.message : e})` });
  });
});

function revokePendingBlob(): void {
  if (!pendingBlobUrl) return;
  const url = pendingBlobUrl;
  pendingBlobUrl = "";
  try {
    URL.revokeObjectURL(url);
  } catch {
    // 已经没了 / 这个上下文不认：它只是块内存，不影响那次下载的结论
  }
}

/**
 * 同一个版本只提醒一次：`notifiedFor` 存进缓存，之后查到同一个版本就跳过。
 * 用户在设置页手动查到新版本时也算「已经知道了」（见下面的 checkForUpdate handler），
 * 不会再为同一个版本弹一遍。
 */
async function markAcknowledged(state: IUpdateCheckState): Promise<void> {
  if (state.notifiedFor === state.latestVersion) return;
  await writeUpdateState({ ...state, notifiedFor: state.latestVersion });
}

/**
 * 查到新版本之后的两步：先按开关把安装包下到浏览器下载目录，再按开关弹通知。
 *
 * 顺序要紧 —— 通知要说的是「已下到下载目录」还是「点此前往下载页」，取决于刚刚那一次
 * 到底下没下，所以下载在前、通知在后。
 * 手动点「立即检查更新」走的是同一条：他 2026-10-08 定的口径就是「手动查到也算已提醒」，
 * 两条路的差别只在限速闸门，不该在「会不会把包下下来」上分叉。
 */
async function handleUpdateAvailable(
  next: IUpdateCheckState,
  config: IConfigPiniaStorageSchema | null | undefined,
): Promise<IUpdateCheckState> {
  const after = await autoDownloadIfNeeded(next, config?.updateCheck?.autoDownload !== false);
  await markAcknowledged(after);

  if (config?.updateCheck?.notify !== false) {
    const { title, message } = notifyText(config?.lang, after.latestVersion, after.downloadState);
    chrome.notifications?.create(`update-${after.latestVersion}`, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icon/128.png"),
      title,
      message,
    });
  }
  return after;
}

async function autoCheck() {
  const config = await extStore.getItem("config");
  // 存量配置里没有 updateCheck 这一片时按默认值（开）走：persistWebExt 只用 storage 里存在
  // 的键覆盖，所以 undefined 是「还没落盘」而不是「用户关掉了」。
  if (config?.updateCheck?.enabled === false) return;

  const state = await readUpdateState();
  if (state.lastCheckAt !== 0 && Date.now() - state.lastCheckAt < AUTO_CHECK_MIN_INTERVAL_MS) return;

  const next = await runUpdateCheck();
  if (next.errorCode) {
    void sendMessage("logger", {
      msg: `检查更新失败（${next.errorCode}${next.httpStatus ? `，HTTP ${next.httpStatus}` : ""}）`,
    });
    return;
  }

  const status = deriveUpdateStatus(next, currentVersion());
  void sendMessage("logger", {
    msg: `检查更新完成：最新 v${next.latestVersion}，当前 v${currentVersion()}（${status}）`,
  });

  if (status === "updateAvailable") {
    await handleUpdateAvailable(next, config);
  }
}

// noinspection JSIgnoredPromiseFromCall
jobs.scheduleJob({
  id: JOB_ID,
  type: "interval",
  duration: AUTO_CHECK_TICK_MS, // 每 6 小时醒一次，真正的每天一次由 autoCheck 里的闸门判
  immediate: true,
  execute: autoCheck,
});

onMessage("checkForUpdate", async () => {
  const next = await runUpdateCheck();
  if (deriveUpdateStatus(next, currentVersion()) !== "updateAvailable") return next;
  return await handleUpdateAvailable(next, await extStore.getItem("config"));
});

/**
 * 点通知：包已经下好了就在下载目录里把它显示出来（再开一次网页会往下载目录扔第二份），
 * 否则开那条 Release 里对应本浏览器的 zip（没有资产时是 Release 页）。
 * 只认 https —— 这个 URL 来自远端接口，不能不加判据就交给 tabs.create。
 */
chrome.notifications?.onClicked.addListener(async (notificationId) => {
  /**
   * 只认自己那条（`update-<版本号>`）。`notifications.onClicked` 是**全局事件**，
   * 不看 id 的话场上任何一条通知（辅种进展、目录不一致）点下去都会跑到这里来，
   * 用户看到的就是「点辅种完成的通知，跳去了 GitHub 下载页」（2026-10-12 报的）。
   */
  if (!notificationId.startsWith("update-")) return;
  chrome.notifications?.clear(notificationId);
  const state = await readUpdateState();
  if (state.downloadState === "done" && state.downloadId) {
    try {
      chrome.downloads.show(state.downloadId);
      return;
    } catch {
      // 那次下载记录已经不在了（用户清过下载历史）：退回开链接，别什么都不做
    }
  }
  if (state.downloadUrl.startsWith("https://")) {
    void chrome.tabs.create({ url: state.downloadUrl });
  }
});
