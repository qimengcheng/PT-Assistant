/**
 * 后台的「检查更新」：一条每日限速的定时任务 + 一条给设置页用的手动检查消息。
 *
 * 只在 service worker 里发请求、只由它写 `updateCheck` 这个键（理由见 @/shared/updateCheck.ts
 * 文件头）。这里额外负责的只有两件事：自动检查的限速闸门，和「发现新版本」的系统通知。
 */
import { defineJobScheduler } from "@webext-core/job-scheduler";

import { extStore } from "@/storage.ts";
import { onMessage, sendMessage } from "@/messages.ts";
import type { IUpdateCheckState } from "@/shared/types.ts";

import {
  AUTO_CHECK_MIN_INTERVAL_MS,
  AUTO_CHECK_TICK_MS,
  deriveUpdateStatus,
  readUpdateState,
  runUpdateCheck,
  writeUpdateState,
} from "@/shared/updateCheck.ts";

const JOB_ID = "checkForUpdate";

const jobs = defineJobScheduler();

function currentVersion(): string {
  return browser.runtime.getManifest().version;
}

/** 通知文案：SW 里拿不到 useI18n，按 config.lang 选一份（同 DownloadHistory 的 i18nLoadErrorText） */
function notifyText(lang: string | undefined, latestVersion: string): { title: string; message: string } {
  return lang === "zh_CN"
    ? { title: "PT Assistant 有新版本", message: `v${latestVersion} 已发布，点此前往下载页` }
    : { title: "PT Assistant update available", message: `v${latestVersion} is out. Click to open the download page.` };
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

  if (status === "updateAvailable" && config?.updateCheck?.notify !== false) {
    await markAcknowledged(next);
    const { title, message } = notifyText(config?.lang, next.latestVersion);
    chrome.notifications?.create(`update-${next.latestVersion}`, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icon/128.png"),
      title,
      message,
    });
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
  if (deriveUpdateStatus(next, currentVersion()) === "updateAvailable") {
    await markAcknowledged(next);
  }
  return next;
});

// 点通知：直接开那条 Release 里对应本浏览器的 zip（没有资产时是 Release 页）。
// 只认 https —— 这个 URL 来自远端接口，不能不加判据就交给 tabs.create。
chrome.notifications?.onClicked.addListener(async (notificationId) => {
  chrome.notifications?.clear(notificationId);
  const { downloadUrl } = await readUpdateState();
  if (downloadUrl.startsWith("https://")) {
    void chrome.tabs.create({ url: downloadUrl });
  }
});
