<script setup lang="ts">
/**
 * 原生通信桥设置窗口（对齐旧版 SetBase/NativeBridgeWindow.vue）：
 * 1. nativeMessaging 是 optional_permissions，这里引导用户动态授权/撤销；
 * 2. 授权后可开关桥、查看连接状态、手动重连测试；
 * 3. 未连接时给出 ptd CLI 注册命令（含本扩展 id）。
 */
import { computed, onMounted, ref, shallowRef } from "vue";
import { useI18n } from "vue-i18n";
import { ApiOutlined } from "@antdv-next/icons";

import { sendMessage } from "@/messages.ts";
import type { BridgeState, BridgeStatus } from "@/shared/types.ts";

const { t } = useI18n();

const extensionId = chrome.runtime.id;

function detectBrowserFamily(): string {
  if (__BROWSER__ === "firefox") return "firefox";
  const ua = navigator.userAgent;
  if (ua.includes("Edg/")) return "edge";
  if (ua.includes("Chromium/")) return "chromium";
  return "chrome";
}

const browserFamily = detectBrowserFamily();
const setupCommand = computed(() => {
  if (browserFamily === "firefox") {
    return "ptd install --browser firefox";
  }
  return `ptd install --browser ${browserFamily} --extension-id ${extensionId}`;
});

const status = shallowRef<BridgeStatus>({
  permissionGranted: false,
  enabled: true,
  state: "no-permission",
  connected: false,
});

const loading = ref(false);
const testLoading = ref(false);
const permissionLoading = ref(false);

async function refreshStatus() {
  try {
    status.value = await sendMessage("nativeBridgeGetStatus", undefined);
  } catch (e: any) {
    console.debug("[PTD] Failed to get bridge status:", e);
  }
}

async function grantPermission() {
  permissionLoading.value = true;
  try {
    // chrome.permissions.request 必须在用户手势中调用
    const granted = await chrome.permissions.request({ permissions: ["nativeMessaging"] });
    if (granted) {
      await refreshStatus();
    } else {
      console.debug("[PTD]", t("SetNativeBridge.permission.grantFailed"));
    }
  } catch (e: any) {
    console.debug("[PTD] Permission request error:", e);
  } finally {
    permissionLoading.value = false;
  }
}

async function revokePermission() {
  permissionLoading.value = true;
  try {
    await chrome.permissions.remove({ permissions: ["nativeMessaging"] });
    await refreshStatus();
  } catch (e: any) {
    console.debug("[PTD] Permission revoke error:", e);
  } finally {
    permissionLoading.value = false;
  }
}

async function toggleEnabled(newValue: boolean) {
  loading.value = true;
  try {
    status.value = await sendMessage("nativeBridgeSetEnabled", newValue);
  } catch (e: any) {
    console.debug("[PTD] Failed to set enabled:", e);
  } finally {
    loading.value = false;
  }
}

// a-switch change 事件签名是 boolean | string | number，收窄后转发
function onSwitchChange(checked: boolean | string | number) {
  void toggleEnabled(checked === true);
}

async function waitForSettledState(maxMs = 5000, intervalMs = 500) {
  const transientStates: BridgeState[] = ["connecting", "retrying"];
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    await new Promise((r) => setTimeout(r, intervalMs));
    await refreshStatus();
    if (!transientStates.includes(status.value.state)) {
      return;
    }
  }
}

async function testConnection() {
  testLoading.value = true;
  try {
    status.value = await sendMessage("nativeBridgeReconnect", undefined);
    if (status.value.state === "connecting") {
      await waitForSettledState();
    }
  } catch (e: any) {
    console.debug("[PTD] Reconnect failed:", e);
  } finally {
    testLoading.value = false;
  }
}

const stateColor: Record<BridgeState, string> = {
  "no-permission": "default",
  disabled: "default",
  connecting: "orange",
  connected: "green",
  retrying: "orange",
  error: "red",
};

// 已授权、已启用但未连上（且不在连接中）时提示 CLI 注册命令
const showSetupHint = computed(
  () =>
    status.value.permissionGranted &&
    status.value.enabled &&
    status.value.state !== "connected" &&
    status.value.state !== "connecting",
);

onMounted(() => {
  refreshStatus();
});
</script>

<template>
  <div class="native-bridge-window">
    <!-- ===== 权限 ===== -->
    <div class="group">
      <div class="group-title">{{ t("SetNativeBridge.permission.title") }}</div>
      <a-space>
        <a-tag :color="status.permissionGranted ? 'green' : 'default'">
          {{
            status.permissionGranted
              ? t("SetNativeBridge.permission.granted")
              : t("SetNativeBridge.permission.notGranted")
          }}
        </a-tag>
        <a-button
          v-if="!status.permissionGranted"
          type="primary"
          size="small"
          :loading="permissionLoading"
          @click="grantPermission"
        >
          {{ t("SetNativeBridge.permission.grant") }}
        </a-button>
        <a-button v-else danger size="small" :loading="permissionLoading" @click="revokePermission">
          {{ t("SetNativeBridge.permission.revoke") }}
        </a-button>
      </a-space>
    </div>

    <!-- ===== 通信桥控制 ===== -->
    <div class="group">
      <div class="group-title">{{ t("SetNativeBridge.bridge.title") }}</div>

      <div class="bridge-switch">
        <a-switch
          :checked="status.enabled"
          :loading="loading"
          :disabled="!status.permissionGranted"
          @change="onSwitchChange"
        />
        <span class="switch-label">{{ t("SetNativeBridge.bridge.enabled") }}</span>
      </div>

      <a-space class="bridge-actions">
        <a-tag :color="stateColor[status.state]">
          {{ t(`SetNativeBridge.bridge.status.${status.state}`) }}
        </a-tag>
        <a-button
          size="small"
          :loading="testLoading"
          :disabled="!status.permissionGranted || !status.enabled"
          @click="testConnection"
        >
          <template #icon><ApiOutlined /></template>
          {{ t("SetNativeBridge.bridge.testConnection") }}
        </a-button>
      </a-space>

      <a-alert v-if="status.lastError" type="error" show-icon class="bridge-alert">
        <template #message>{{ status.lastError }}</template>
      </a-alert>

      <a-alert
        v-if="showSetupHint"
        type="warning"
        show-icon
        class="bridge-alert"
        :title="t('SetNativeBridge.info.setupCommand')"
      >
        <code class="setup-command">{{ setupCommand }}</code>
        <div class="setup-hint">{{ t("SetNativeBridge.info.setupHint") }}</div>
      </a-alert>
    </div>

    <!-- ===== 说明 ===== -->
    <div class="group">
      <div class="group-title">{{ t("SetNativeBridge.info.title") }}</div>
      <a-alert type="info" show-icon :title="t('SetNativeBridge.info.description')">
        <i18n-t keypath="SetNativeBridge.info.cliRequired" tag="p" class="cli-required">
          <template #0>
            <a href="https://github.com/pt-plugins/ptd-cli" target="_blank" rel="noopener">
              {{ t("SetNativeBridge.info.cliLink") }}
            </a>
          </template>
        </i18n-t>
      </a-alert>
      <a-alert
        type="warning"
        show-icon
        class="bridge-alert"
        :title="t('SetNativeBridge.info.privacy')"
      />
    </div>
  </div>
</template>

<style scoped>
.native-bridge-window {
  max-width: 720px;
}

.bridge-switch {
  display: flex;
  align-items: center;
  gap: 8px;
}

.bridge-switch .switch-label {
  font-size: 13px;
}

.bridge-actions {
  margin-top: 12px;
}

.bridge-alert {
  margin-top: 12px;
}

.setup-command {
  display: block;
  margin: 8px 0;
  padding: 8px 10px;
  background: rgba(0, 0, 0, 0.04);
  border-radius: 4px;
  font-size: 12px;
  word-break: break-all;
  user-select: all;
}

.setup-hint {
  font-size: 12px;
}

.cli-required {
  margin: 8px 0 0;
  font-weight: 600;
}
</style>
