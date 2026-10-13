<script setup lang="ts">
/**
 * 检查更新设置窗口：展示当前/最新版本与上次检查结果，提供手动检查与两个开关。
 *
 * 读缓存直连 storage（只读，没有竞态），但发请求一定交给 service worker —— 写
 * `updateCheck` 的上下文只能有一个，理由见 @/shared/updateCheck.ts 文件头。
 */
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { format } from "date-fns";
import { CloudDownloadOutlined, SyncOutlined } from "@antdv-next/icons";

import { useConfigStore } from "@/options/stores/config.ts";
import { sendMessage } from "@/messages.ts";
import type { IUpdateCheckState } from "@/shared/types.ts";
import { deriveUpdateStatus, emptyUpdateState, readUpdateState, type TUpdateStatus } from "@/shared/updateCheck.ts";

const { t } = useI18n();
const configStore = useConfigStore();

const currentVersion = browser.runtime.getManifest().version;

const state = ref<IUpdateCheckState>(emptyUpdateState());
const isChecking = ref(false);

const status = computed<TUpdateStatus>(() => deriveUpdateStatus(state.value, currentVersion));
const hasUpdate = computed(() => status.value === "updateAvailable");

const statusColor: Record<TUpdateStatus, string> = {
  never: "default",
  failed: "error",
  upToDate: "success",
  updateAvailable: "warning",
};

/** 只在真的拿得出链接时显示，且两个链接相同就别并列（一行里出现两个词指向同一处是新 bug） */
const showReleaseLink = computed(
  () => state.value.releaseUrl !== "" && state.value.downloadUrl !== state.value.releaseUrl,
);

/**
 * 「安装包」那一行的措辞。三个键按字面写死，不用 `t("前缀" + 状态)`：
 * 拼出来的键防线③看不见，写错一个状态名就是界面上多一条键路径（AGENTS §3.4）。
 */
const downloadTextKey = computed(() =>
  state.value.downloadState === "done"
    ? "SetUpdate.download.done"
    : state.value.downloadState === "downloading"
      ? "SetUpdate.download.downloading"
      : "SetUpdate.download.failed",
);

/**
 * 失败那行的补充说明。两个片段都可能没有，所以拼不出来就不给 description
 * （a-alert 少了 description 会退回单行标题的紧凑形状，不会留一条空缝）。
 */
const errorDetail = computed(() => {
  const parts: string[] = [];
  if (state.value.errorCode === "rateLimited" && state.value.rateLimitResetsAt > 0) {
    parts.push(t("SetUpdate.error.quotaResetsAt", { at: format(new Date(state.value.rateLimitResetsAt), "HH:mm") }));
  }
  // 键按字面写死三条，不用 `t("前缀" + 码)`：防线③看不见拼出来的键（AGENTS §3.4）
  if (state.value.fallbackOutcome === "noTag") {
    parts.push(t("SetUpdate.error.fallbackNoTag"));
  } else if (state.value.fallbackOutcome === "threw") {
    parts.push(t("SetUpdate.error.fallbackThrew"));
  }
  return parts.length > 0 ? parts.join("；") : undefined;
});

function fmtTime(ms: number): string {
  return ms === 0 ? t("SetUpdate.neverChecked") : format(new Date(ms), "yyyy-MM-dd HH:mm:ss");
}

function fmtPublished(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? format(new Date(ms), "yyyy-MM-dd HH:mm") : "-";
}

async function refresh() {
  state.value = await readUpdateState();
}

async function checkNow() {
  isChecking.value = true;
  try {
    state.value = await sendMessage("checkForUpdate", undefined);
  } catch (e) {
    console.debug("[PT-Assistant] 手动检查更新失败：", e);
    await refresh();
  } finally {
    isChecking.value = false;
  }
}

/** 在文件管理器里定位那个已下载的包；下载记录被清过就没什么可做的 */
function showDownloadedPackage() {
  if (!state.value.downloadId) return;
  try {
    browser.downloads?.show?.(state.value.downloadId);
  } catch (e) {
    console.debug("[PT-Assistant] 打开下载页失败：", e);
  }
}

onMounted(refresh);
</script>

<template>
  <div class="update-window">
    <div class="group">
      <div class="group-title">{{ t("SetUpdate.groupStatus") }}</div>

      <a-descriptions :column="1" size="small">
        <a-descriptions-item :label="t('SetUpdate.labelCurrent')">
          <a-tag color="default">v{{ currentVersion }}</a-tag>
        </a-descriptions-item>
        <a-descriptions-item :label="t('SetUpdate.labelLatest')">
          <a-tag :color="hasUpdate ? 'warning' : 'default'">
            {{ state.latestVersion === "" ? "-" : `v${state.latestVersion}` }}
          </a-tag>
        </a-descriptions-item>
        <a-descriptions-item :label="t('SetUpdate.labelStatus')">
          <a-tag :color="statusColor[status]">{{ t(`SetUpdate.status.${status}`) }}</a-tag>
        </a-descriptions-item>
        <a-descriptions-item :label="t('SetUpdate.labelLastCheck')">
          <span class="plain-text">{{ fmtTime(state.lastCheckAt) }}</span>
        </a-descriptions-item>
        <a-descriptions-item v-if="state.latestVersion" :label="t('SetUpdate.labelPublished')">
          <span class="plain-text">{{ fmtPublished(state.publishedAt) }}</span>
        </a-descriptions-item>
        <!-- 只在真的动手下载过之后才出现这一行：没开开关、或那次走的是备用通道（没有直链）时，
             摆一行「没下过」是凭空多出来的噪声。
             说明与那颗按钮包在一层 div 里：a-descriptions 非 bordered 时把同一格里多个子节点
             当横排摆，会挤在一起（AGENTS §3.4 那条「一格只放一个子节点」）。 -->
        <a-descriptions-item v-if="state.downloadedFor" :label="t('SetUpdate.labelPackage')">
          <div class="package-line">
            <span class="plain-text">{{ t(downloadTextKey) }}</span>
            <a-button v-if="state.downloadState === 'done'" type="link" size="small" @click="showDownloadedPackage">
              {{ t("SetUpdate.download.showInFolder") }}
            </a-button>
          </div>
        </a-descriptions-item>
      </a-descriptions>

      <a-alert
        v-if="state.errorCode"
        type="error"
        show-icon
        class="group-alert"
        :title="t(`SetUpdate.error.${state.errorCode}`, { status: state.httpStatus })"
        :description="errorDetail"
      />

      <!-- 走备用通道时"成功"了，但少给两样东西（发布时间、zip 直链）。不解释的话看着像数据坏了。 -->
      <a-alert
        v-else-if="state.via === 'html'"
        type="info"
        show-icon
        class="group-alert"
        :title="t('SetUpdate.viaFallback')"
      />

      <div class="update-actions">
        <a-button type="primary" :loading="isChecking" @click="checkNow">
          <template #icon><SyncOutlined /></template>
          {{ t("SetUpdate.checkNow") }}
        </a-button>
        <a-button v-if="state.downloadUrl" :href="state.downloadUrl" target="_blank">
          <template #icon><CloudDownloadOutlined /></template>
          {{ t("SetUpdate.gotoRelease") }}
        </a-button>
        <a
          v-if="showReleaseLink"
          class="release-note-link"
          :href="state.releaseUrl"
          target="_blank"
          rel="noopener noreferrer"
          >{{ t("SetUpdate.gotoReleaseNote") }}</a>
      </div>
    </div>

    <div class="group">
      <div class="group-title">{{ t("SetUpdate.groupSettings") }}</div>
      <div class="switch-grid">
        <div class="switch-item">
          <a-switch v-model:checked="configStore.updateCheck.enabled" size="small" />
          <span class="label">{{ t("SetUpdate.autoCheck") }}</span>
        </div>
        <div class="switch-item">
          <a-switch
            v-model:checked="configStore.updateCheck.notify"
            size="small"
            :disabled="!configStore.updateCheck.enabled"
          />
          <span class="label">{{ t("SetUpdate.notify") }}</span>
        </div>
        <!-- 自动下载不依赖「每天自动检查」：手动点一次查出新版本，也照这条走（同一处判据不拆两份） -->
        <div class="switch-item">
          <a-switch v-model:checked="configStore.updateCheck.autoDownload" size="small" />
          <span class="label">{{ t("SetUpdate.autoDownload") }}</span>
        </div>
      </div>
    </div>

    <div class="group">
      <div class="group-title">{{ t("SetUpdate.groupInfo") }}</div>
      <a-alert type="info" show-icon :title="t('SetUpdate.info.description')" />
      <a-alert type="warning" show-icon class="group-alert" :title="t('SetUpdate.info.privacy')" />
    </div>
  </div>
</template>

<style scoped>
/* 原先这一节自己收在 720 并由 Index.vue 居中；并成长页后与其余各节同宽，不再单开一档 */

.plain-text {
  font-size: 13px;
}

.group-alert {
  margin-top: 12px;
}

.update-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
}

.release-note-link {
  font-size: 12px;
}

/* 「安装包」那一格：说明 + 那颗「在目录里显示」。同一格里多个子节点必须自己包一层 flex，
   否则非 bordered 的 descriptions 会把它们横排且零间距贴边（AGENTS §3.4）。 */
.package-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
</style>
