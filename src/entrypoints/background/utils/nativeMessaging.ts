/// <reference types="chrome" />
import { onMessage, sendMessage, type ProtocolMap } from "@/messages.ts";
import { whenOffscreenReady } from "./offscreen.ts";
import { errorText } from "@/shared/errorText.ts";
import type { BridgeState, BridgeStatus } from "@/shared/types.ts";

/**
 * 原生通信桥：本机安装的 ptd CLI 通过 native messaging（com.ptd.native）与扩展通信。
 *
 * 权限模型：nativeMessaging 是 optional_permissions，未授权时桥不启动（state=no-permission），
 * 用户在 SetBase「原生通信桥」窗口里 chrome.permissions.request 动态授权。
 *
 * SW 约束：
 * 1. setTimeout 重连由浏览器唤醒跟踪，alarm 场景下 SW 可能被回收——重连仍在进行中时
 *    connect() 失败会再次调度；最多 MAX_RECONNECT_ATTEMPTS 次后放弃。
 * 2. 桥只代理 ALLOWED_METHODS 白名单内的消息（转发给 offscreen / 其它处理器），
 *    其余一律 METHOD_NOT_ALLOWED，避免本机进程调用任意内部协议。
 */

const NATIVE_HOST_NAME = "com.ptd.native";
const INSTANCE_ID_KEY = "ptd_native_instance_id";
const ENABLED_KEY = "ptd_native_bridge_enabled";
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const MAX_RECONNECT_ATTEMPTS = 10;

/** Errors that indicate the native host is not installed — no point retrying. */
const FATAL_ERRORS = [
  "Specified native messaging host not found.",
  "Access to the specified native messaging host is forbidden.",
];

/**
 * Methods the bridge will proxy to sendMessage(). Everything else is rejected.
 *
 * 键名写成 `keyof ProtocolMap`：拼错一个名字当场编译报错 —— 原先那是裸的字符串 Set，
 * 拼错只表现为「这条方法在桥上一律 METHOD_NOT_ALLOWED」，界面上查不出原因。
 */
const ALLOWED_METHOD_NAMES: (keyof ProtocolMap)[] = [
  // Site config
  "getSiteList",
  "getSiteUserConfig",
  "getSiteFavicon",
  "clearSiteFaviconCache",
  // Search
  "getSiteSearchResult",
  "getMediaServerSearchResult",
  // Download and downloader
  "getDownloaderList",
  "getDownloaderConfig",
  "getDownloaderVersion",
  "getDownloaderStatus",
  "getTorrentDownloadLink",
  "getTorrentInfoForVerification",
  "downloadTorrent",
  "getDownloadHistory",
  "getDownloadHistoryById",
  "deleteDownloadHistoryById",
  "clearDownloadHistory",
  // User info
  "getSiteUserInfoResult",
  "cancelUserInfoQueue",
  "getSiteUserInfo",
  "removeSiteUserInfo",
  // Keep-upload
  "getKeepUploadTasks",
  "getKeepUploadTaskById",
  "createKeepUploadTask",
  "updateKeepUploadTask",
  "deleteKeepUploadTask",
  "clearKeepUploadTasks",
];

const ALLOWED_METHODS = new Set<string>(ALLOWED_METHOD_NAMES);

// ── Module-scoped state ──────────────────────────────────────────────

let port: chrome.runtime.Port | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
let enabled = true;
let state: BridgeState = "no-permission";
let lastError: string | undefined;
let intentionalDisconnect = false;

// ── Helpers ──────────────────────────────────────────────────────────

async function getOrCreateInstanceId(): Promise<string> {
  const stored = await chrome.storage.local.get(INSTANCE_ID_KEY);
  const storedInstanceId = stored[INSTANCE_ID_KEY];

  if (typeof storedInstanceId === "string" && storedInstanceId.length > 0) {
    return storedInstanceId;
  }
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ [INSTANCE_ID_KEY]: id });
  return id;
}

async function checkPermission(): Promise<boolean> {
  try {
    return await chrome.permissions.contains({ permissions: ["nativeMessaging"] });
  } catch {
    return false;
  }
}

async function getStatus(): Promise<BridgeStatus> {
  const permissionGranted = await checkPermission();
  return {
    permissionGranted,
    enabled,
    state,
    connected: port !== null && state === "connected",
    lastError,
  };
}

function clearReconnectTimer() {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

// ── Lifecycle ────────────────────────────────────────────────────────

function disconnect(intentional: boolean) {
  intentionalDisconnect = intentional;
  clearReconnectTimer();
  reconnectAttempt = 0;

  if (port) {
    try {
      port.disconnect();
    } catch {
      // Already disconnected — ignore
    }
    port = null;
  }
}

function scheduleReconnect() {
  clearReconnectTimer();
  reconnectAttempt++;

  if (reconnectAttempt > MAX_RECONNECT_ATTEMPTS) {
    state = "error";
    lastError = `Gave up after ${MAX_RECONNECT_ATTEMPTS} reconnect attempts`;
    console.debug("[PT-Assistant] Native bridge exceeded max reconnect attempts, giving up.");
    return;
  }

  const delay = Math.min(RECONNECT_BASE_MS * 2 ** reconnectAttempt, RECONNECT_MAX_MS);
  state = "retrying";
  console.debug(
    `[PT-Assistant] Native bridge reconnecting in ${delay}ms (attempt ${reconnectAttempt}/${MAX_RECONNECT_ATTEMPTS})...`,
  );
  reconnectTimer = setTimeout(connect, delay);
}

function connect() {
  if (!enabled) {
    return;
  }

  clearReconnectTimer();
  state = "connecting";
  lastError = undefined;
  intentionalDisconnect = false;

  let currentPort: chrome.runtime.Port;
  try {
    currentPort = chrome.runtime.connectNative(NATIVE_HOST_NAME);
    port = currentPort;
  } catch (e) {
    state = "error";
    lastError = errorText(e);
    console.debug("[PT-Assistant] Native messaging host not available:", lastError);
    return;
  }

  // Send hello handshake — mark connected after successful send.
  // The native host does not send an ack, so a successful postMessage
  // is our best signal. If the host is absent, onDisconnect fires.
  getOrCreateInstanceId()
    .then((instanceId) => {
      if (port !== currentPort) return;

      try {
        currentPort.postMessage({
          type: "hello",
          instanceId,
          browser: __BROWSER__,
          extensionId: chrome.runtime.id,
          version: __EXT_VERSION__,
          capabilities: ["bridge-v1"],
        });
      } catch (e) {
        state = "error";
        lastError = errorText(e);
        console.debug("[PT-Assistant] Failed to send native hello message:", lastError);
        return;
      }

      state = "connected";
      reconnectAttempt = 0;
    })
    .catch((e) => {
      if (port !== currentPort) return;
      state = "error";
      lastError = errorText(e);
      console.debug("[PT-Assistant] Failed to get or create native instance id:", lastError);
      try {
        currentPort.disconnect();
      } catch {
        // ignore
      }
    });

  currentPort.onMessage.addListener(async (raw: unknown) => {
    // 宿主递进来的每一条都按这个形状读；不合规的仍旧静丢掉（与原先一致，不回 error）
    const msg = raw as { type?: unknown; id?: unknown; method?: unknown; params?: unknown } | undefined;
    if (msg?.type !== "request" || !msg.id || !msg.method) {
      return;
    }

    const { id, method, params } = msg;

    if (typeof method !== "string" || !ALLOWED_METHODS.has(method)) {
      currentPort.postMessage({
        type: "response",
        id,
        error: { code: "METHOD_NOT_ALLOWED", message: `Method '${String(method)}' is not allowed` },
      });
      return;
    }

    try {
      await whenOffscreenReady();
      // 名字上面已按白名单筛过；参数在这一层只能是「一个运行期才知道键名的转发」——
      // ProtocolMap 每个键的 data 类型各不相同，TS 没法按变量键去索引它，
      // 所以沿用仓库里既有的 `as never` 写法（见 storage.ts 的 setItem），
      // 而不是原先那条把整次调用判成 any 的 `method as any`。
      const result = await sendMessage(method as keyof ProtocolMap, params as never);
      if (port === currentPort) {
        currentPort.postMessage({ type: "response", id, result });
      }
    } catch (e) {
      if (port === currentPort) {
        currentPort.postMessage({
          type: "response",
          id,
          error: { code: "EXTENSION_ERROR", message: errorText(e) },
        });
      }
    }
  });

  currentPort.onDisconnect.addListener(() => {
    const err = chrome.runtime.lastError;
    const errMsg = err?.message ?? "";

    // Stale port — a new connection has already replaced this one
    if (port !== currentPort) return;

    port = null;

    if (intentionalDisconnect) {
      return;
    }

    if (err) {
      console.debug("[PT-Assistant] Native messaging disconnected:", errMsg);
    }

    if (FATAL_ERRORS.some((e) => errMsg.includes(e))) {
      state = "error";
      lastError = errMsg;
      console.debug("[PT-Assistant] Native host not available, CLI bridge disabled.");
      return;
    }

    lastError = errMsg || "Connection lost";
    scheduleReconnect();
  });
}

async function init() {
  const permissionGranted = await checkPermission();

  // Refresh enabled flag
  const stored = await chrome.storage.local.get(ENABLED_KEY);
  enabled = stored[ENABLED_KEY] !== false; // default true

  if (!permissionGranted) {
    disconnect(true);
    state = "no-permission";
    lastError = undefined;
    return;
  }

  if (!enabled) {
    disconnect(true);
    state = "disabled";
    lastError = undefined;
    return;
  }

  connect();
}

// ── Runtime permission listeners ─────────────────────────────────────

chrome.permissions.onAdded?.addListener((permissions) => {
  if (permissions.permissions?.includes("nativeMessaging")) {
    init();
  }
});

chrome.permissions.onRemoved?.addListener((permissions) => {
  if (permissions.permissions?.includes("nativeMessaging")) {
    init();
  }
});

// ── Message handlers ─────────────────────────────────────────────────

onMessage("nativeBridgeGetStatus", async () => {
  return getStatus();
});

onMessage("nativeBridgeSetEnabled", async ({ data }) => {
  if (typeof data !== "boolean") {
    return getStatus();
  }
  await chrome.storage.local.set({ [ENABLED_KEY]: data });
  await init();
  if (state === "connecting") {
    await new Promise((r) => setTimeout(r, 200));
  }
  return getStatus();
});

onMessage("nativeBridgeReconnect", async () => {
  const permissionGranted = await checkPermission();
  if (!permissionGranted) {
    lastError = "Permission not granted — cannot reconnect";
    return getStatus();
  }
  if (!enabled) {
    lastError = "Bridge is disabled — cannot reconnect";
    return getStatus();
  }

  disconnect(true);
  connect();
  return getStatus();
});

// ── Startup ──────────────────────────────────────────────────────────

void init();
