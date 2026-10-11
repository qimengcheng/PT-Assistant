/**
 * 后台的「检查更新」：一条每日限速的定时任务 + 一条给设置页用的手动检查消息。
 *
 * 只在 service worker 里发请求、只由它写 `updateCheck` 这个键（理由见 @/shared/updateCheck.ts
 * 文件头）。这里额外负责的只有两件事：自动检查的限速闸门，和「发现新版本」的系统通知。
 */
import { defineJobScheduler } from "@webext-core/job-scheduler";

import { extStore } from "@/storage.ts";
import { onMessage, sendMessage } from "@/messages.ts";
import type { IConfigPiniaStorageSchema, IUpdateCheckState, TUpdateDownloadState } from "@/shared/types.ts";

import {
  AUTO_CHECK_MIN_INTERVAL_MS,
  AUTO_CHECK_TICK_MS,
  deriveUpdateStatus,
  isReleaseAssetUrl,
  readUpdateState,
  runUpdateCheck,
  writeUpdateState,
} from "@/shared/updateCheck.ts";

const JOB_ID = "checkForUpdate";

const jobs = defineJobScheduler();

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
 * 发现新版本时把那个安装包取到浏览器下载目录。
 *
 * 三道闸，缺一不下：
 * 1. 开关开着（`autoDownload` 缺省即开，存量用户没落盘过这一项）；
 * 2. 那条 URL 是**真资产直链**（走备用通道时它是 Release 网页，存下来会是个名字像 zip 的
 *    HTML —— 比不下载更坏）；
 * 3. 这个版本还没下过（每天查一次就每天下一个是刷屏；下失败也记成「下过」，
 *    不自动重试 —— 界面上有手动那颗按钮，重试该由人决定）。
 *
 * 返回值就是写进 storage 的那一份，调用方拿它去决定通知怎么写。
 */
async function autoDownloadIfNeeded(state: IUpdateCheckState, autoDownloadOn: boolean): Promise<IUpdateCheckState> {
  if (!autoDownloadOn) return state;
  if (!isReleaseAssetUrl(state.downloadUrl)) return state;
  if (state.downloadedFor === state.latestVersion) return state;

  let next: IUpdateCheckState;
  try {
    // 不自己拼文件名：让 Chrome 用服务器给的名字（`PT-Assistant-<版本>-<浏览器>.zip`），
    // 我们猜的那个和发布物实际叫什么是两回事。同名时 uniquify，不覆盖用户手上下过的那份。
    const id = await chrome.downloads.download({ url: state.downloadUrl, conflictAction: "uniquify" });
    next = {
      ...state,
      downloadedFor: state.latestVersion,
      downloadId: typeof id === "number" ? id : 0,
      downloadState: "downloading",
      downloadError: "",
    };
  } catch (e) {
    next = {
      ...state,
      downloadedFor: state.latestVersion,
      downloadId: 0,
      downloadState: "failed",
      downloadError: e instanceof Error ? e.message : String(e),
    };
  }

  await writeUpdateState(next);
  void sendMessage("logger", {
    msg: `Update check: auto-download v${next.latestVersion} ${next.downloadState} (${next.downloadError || "ok"})`,
  });
  return next;
}

/**
 * 下载是异步的，`download()` 回来只代表「排上了」。真正的成败从 onChanged 落回来 ——
 * 不接它的话，界面上那条会永远停在「正在下载」。
 */
chrome.downloads?.onChanged.addListener((delta) => {
  void (async () => {
    const state = await readUpdateState();
    if (!state.downloadId || delta.id !== state.downloadId) return;

    const to = delta.state?.current;
    if (to === "complete") {
      await writeUpdateState({ ...state, downloadState: "done", downloadError: "" });
    } else if (to === "interrupted") {
      await writeUpdateState({ ...state, downloadState: "failed", downloadError: delta.error?.current ?? "" });
    }
  })().catch((e) => {
    void sendMessage("logger", { msg: `Update check: 下载状态回写失败 (${e instanceof Error ? e.message : e})` });
  });
});

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
      msg: `Update check failed (${next.errorCode}${next.httpStatus ? `, HTTP ${next.httpStatus}` : ""})`,
    });
    return;
  }

  const status = deriveUpdateStatus(next, currentVersion());
  void sendMessage("logger", {
    msg: `Update check finished: latest v${next.latestVersion}, current v${currentVersion()} (${status})`,
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
