<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { ref, shallowRef } from "vue";
import { isEmpty } from "es-toolkit/compat";
import { jsZipBlobToBackupData } from "@ptd/backupServer/utils.ts";
import type { IBackupData } from "@ptd/backupServer";
import { useRouter } from "vue-router";
import { CloseCircleOutlined, ImportOutlined, LeftOutlined, RightOutlined, SyncOutlined, UploadOutlined } from "@antdv-next/icons";

import { useConfigStore } from "@/options/stores/config.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { sendMessage } from "@/messages.ts";
import { BackupFields, type TBackupFields, type IRestoreOptions } from "@/shared/types.ts";

const showDialog = defineModel<boolean>();
const { t } = useI18n();
const router = useRouter();

type TRestoreMetaData = { type: "file" } | { type: "remote"; server: string; path: string };

const { restoreMetadata = { type: "file" } } = defineProps<{
  restoreMetadata?: TRestoreMetaData;
}>();

const currentStep = ref<TRestoreMetaData["type"] | "restore">("file");
const decryptKey = ref<string>("");
const showDecryptKey = ref<boolean>(false);
const isDecryptKeyValid = ref<boolean>(true);

const restoreData = shallowRef<IBackupData>();
const restoreOptions = ref<IRestoreOptions>({
  fields: [],
  expandCookieMinutes: 0,
  keepExistUserInfo: true,
});

const configStore = useConfigStore();
const runtimeStore = useRuntimeStore();

function buildBackupOptions() {
  restoreOptions.value = {
    fields: [...Object.keys(restoreData.value?.manifest?.files ?? {})] as TBackupFields[],
    expandCookieMinutes: 0,
    keepExistUserInfo: true,
  };
  currentStep.value = "restore";
}

/**
 * 如果是本地的文件，我们直接在 options 中解析，如果是服务器的文件，我们则在 offscreen 中解析
 */

const backupFile = shallowRef<File>();
function loadLocalBackupFile() {
  jsZipBlobToBackupData(backupFile.value as Blob, decryptKey.value)
    .then((data) => {
      restoreData.value = data;
      isDecryptKeyValid.value = true;
      buildBackupOptions();
    })
    .catch((err) => {
      console.error(err);
      restoreData.value = undefined;
      isDecryptKeyValid.value = false;
      runtimeStore.showSnakebar(t("SetBackup.RestoreDialog.loadFailure", { error: err }), { color: "error" });
    });
}

const isLoadingRemoteBackupFile = ref<boolean>(false);
function loadRemoteBackupFile() {
  if (restoreMetadata.type === "remote") {
    isLoadingRemoteBackupFile.value = true;
    sendMessage("getRemoteBackupData", {
      backupServerId: restoreMetadata.server,
      path: restoreMetadata.path,
      decryptKey: decryptKey.value,
    })
      .then((data) => {
        restoreData.value = data;
        buildBackupOptions();
      })
      .catch((err) => {
        runtimeStore.showSnakebar(t("SetBackup.RestoreDialog.loadFailure", { error: err }), { color: "error" });
        console.error(err);
        isDecryptKeyValid.value = false;
      })
      .finally(() => {
        isLoadingRemoteBackupFile.value = false;
      });
  }
}

function extractVersion(str: string = "") {
  const regex = /v(\d+\.\d+\.\d+\.\d+)/;
  const match = str.match(regex);
  return match ? match[1] : null;
}

/**
 *
 * 比较两个版本号字符串
 *
 * inputV1 < inputV2 返回 -1
 * inputV1 = inputV2 返回 0
 * inputV1 > inputV2 返回 1
 *
 */
function compareVersion(inputV1?: string, inputV2?: string) {
  const v1 = extractVersion(inputV1);
  const v2 = extractVersion(inputV2);

  if (!v1 || !v2) return null;

  const parts1 = v1.split(".").map(Number);
  const parts2 = v2.split(".").map(Number);
  const maxLength = Math.max(parts1.length, parts2.length);

  for (let i = 0; i < maxLength; i++) {
    const num1 = parts1[i] || 0;
    const num2 = parts2[i] || 0;

    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }

  return 0;
}

const isDoingRestore = ref<boolean>(false);
function doRestore() {
  isDoingRestore.value = true;

  // 检查 version 字段
  if (!restoreData.value?.manifest?.version) {
    runtimeStore.showSnakebar(t("SetBackup.RestoreDialog.missingVersion"), { color: "error" });
    isDoingRestore.value = false;
    return;
  }

  const warnRestore = compareVersion(restoreData.value.manifest.version, __EXT_VERSION__) == 1;
  // ⚠️ 上游用原生 confirm()，但 MV3 扩展页面禁用原生对话框（静默返回 false）→ 点完成无任何反应。
  // 改为 snackbar 警告后继续恢复。
  if (warnRestore) {
    runtimeStore.showSnakebar(
      t("SetBackup.RestoreDialog.versionWarning") + " (backup: " + restoreData.value.manifest.version + ")",
      { color: "warning", timeout: 8000 },
    );
  }

  sendMessage("restoreBackupData", { restoreData: restoreData.value!, restoreOptions: restoreOptions.value })
    .then(() => {
      runtimeStore.showSnakebar(t("SetBackup.RestoreDialog.success"), { color: "success" });
      showDialog.value = false;
    })
    .catch((err) => {
      runtimeStore.showSnakebar(t("SetBackup.RestoreDialog.failure", { error: err }), { color: "error" });
      console.error(err);
    })
    .finally(() => {
      isDoingRestore.value = false;
    });
}

function convertIsoDurationToMinutes(duration: string): number {
  const regex = /P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?/;
  const match = duration.match(regex);

  if (!match) {
    throw new Error(`Invalid ISO 8601 duration format: ${duration}`);
  }

  const [, years, months, weeks, days, hours, minutes, seconds] = match;

  // 转换各时间单位为分钟
  const minutesFromYears = years ? parseInt(years, 10) * 365 * 24 * 60 : 0;
  const minutesFromMonths = months ? parseInt(months, 10) * 30 * 24 * 60 : 0; // 近似值，每月按30天计算
  const minutesFromWeeks = weeks ? parseInt(weeks, 10) * 7 * 24 * 60 : 0;
  const minutesFromDays = days ? parseInt(days, 10) * 24 * 60 : 0;
  const minutesFromHours = hours ? parseInt(hours, 10) * 60 : 0;
  const minutesFromMinutes = minutes ? parseInt(minutes, 10) : 0;
  const minutesFromSeconds = seconds ? parseInt(seconds, 10) / 60 : 0;

  // 计算总分钟数
  return (
    minutesFromYears +
    minutesFromMonths +
    minutesFromWeeks +
    minutesFromDays +
    minutesFromHours +
    minutesFromMinutes +
    minutesFromSeconds
  );
}

function resetDialog() {
  currentStep.value = restoreMetadata.type;
  decryptKey.value = configStore.backup.encryptionKey ?? "";

  restoreData.value = undefined;
  if (restoreMetadata.type === "file") {
    backupFile.value = undefined;
  } else if (restoreMetadata.type == "remote") {
    loadRemoteBackupFile();
  }
}

function goToPtppImport() {
  router.push({ name: "SetBaseBackup" });
  showDialog.value = false;
}

/** 快捷时长按钮：ISO-8601 时长 → 分钟 */
const quickDurations = ["PT30M", "PT1H", "PT12H", "P1D", "P1W", "P1M", "P6M", "P1Y"];
</script>

<template>
  <a-modal
    v-model:open="showDialog"
    :title="t('SetBackup.RestoreDialog.title')"
    :width="800"
    :mask-closable="!isDoingRestore"
    :keyboard="!isDoingRestore"
    :closable="!isDoingRestore"
    destroy-on-hidden
    :after-open-change="(open: boolean) => open && resetDialog()"
  >
    <a-alert class="mb-3" type="info">
      <!-- a-alert 不渲染默认插槽，正文要放 #message / #title -->
      <template #message>
        {{ t("SetBackup.RestoreDialog.ptppPrompt") }}
      </template>
      <!-- v-alert 的 #append → a-alert 的 #action -->
      <template #action>
        <a-button color="primary" variant="outlined" size="small" @click="goToPtppImport">
          <template #icon>
            <ImportOutlined />
          </template>
          {{ t("SetBackup.RestoreDialog.ptppImport") }}
        </a-button>
      </template>
    </a-alert>

    <!--
      原来是 <v-window> 步骤流：没有标签页标题，currentStep 直接决定显示哪一块。
      a-tabs 需要字符串 key 且依赖导航栏切换，这里用 v-show 保持
      「currentStep 单一数据源 + 面板常驻挂载」的原有语义。
    -->
    <div v-show="currentStep === 'file'" class="step-panel">
      <div class="section-label">{{ t("SetBackup.RestoreDialog.selectFile") }}</div>
      <a-upload
        accept="application/zip"
        :max-count="1"
        :show-upload-list="true"
        :before-upload="
          (file: File) => {
            backupFile = file;
            loadLocalBackupFile();
            return false;
          }
        "
      >
        <a-button>
          <template #icon>
            <UploadOutlined />
          </template>
          {{ t("SetBackup.RestoreDialog.selectFile") }}
        </a-button>
      </a-upload>

      <div class="section-label mt-3">{{ t("SetBackup.RestoreDialog.decryptKey") }}</div>
      <!-- v-text-field 的 append-icon 点击切换 → a-input-password 内置的可见性切换 -->
      <a-input-password v-model:value="decryptKey" v-model:icon-visible="showDecryptKey" />

      <a-button
        v-if="!isDecryptKeyValid"
        :disabled="!backupFile"
        block
        color="gold"
        variant="solid"
        style="margin-top: 12px"
        @click="loadLocalBackupFile"
      >
        <template #icon>
          <SyncOutlined />
        </template>
        {{ t("SetBackup.RestoreDialog.retry") }}
      </a-button>
    </div>

    <div v-show="currentStep === 'remote'" class="step-panel">
      <div class="section-label">{{ t("SetBackup.RestoreDialog.decryptKey") }}</div>
      <a-input-password v-model:value="decryptKey" v-model:icon-visible="showDecryptKey" />

      <a-button
        v-if="!isDecryptKeyValid"
        :loading="isLoadingRemoteBackupFile"
        block
        color="gold"
        variant="solid"
        style="margin-top: 12px"
        @click="loadRemoteBackupFile"
      >
        <template #icon>
          <SyncOutlined />
        </template>
        {{ t("SetBackup.RestoreDialog.retry") }}
      </a-button>
    </div>

    <div v-show="currentStep === 'restore'" class="step-panel">
      <div class="section-label">{{ t("SetBackup.RestoreDialog.restoreOptions") }}</div>

      <!-- v-switch + 数组 v-model + :value 是复选语义，对应 a-checkbox-group -->
      <a-checkbox-group v-model:value="restoreOptions.fields">
        <a-row :gutter="[16, 8]">
          <a-col v-for="backupField in BackupFields" :key="backupField" :span="12" :md="8">
            <!-- 备份里不存在的字段不能勾选 -->
            <a-checkbox :value="backupField" :disabled="!restoreData?.manifest?.files?.[backupField]">
              {{ t(`SetBackup.fields.${backupField}`) }}
            </a-checkbox>
          </a-col>
        </a-row>
      </a-checkbox-group>

      <div class="section-label mt-3">{{ t("SetBackup.RestoreDialog.expandCookieMinutes") }}</div>
      <a-input-number
        :value="restoreOptions.expandCookieMinutes"
        :disabled="!restoreOptions.fields?.includes('cookies')"
        :min="0"
        :step="1"
        style="width: 160px"
        @update:value="(v: any) => (restoreOptions.expandCookieMinutes = v ?? undefined)"
      />

      <!-- v-number-input 的 #details 快捷时长 chip -->
      <div class="duration-tags">
        <a-tag
          v-for="minutes in quickDurations"
          :key="minutes"
          class="duration-tag"
          @click="() => (restoreOptions.expandCookieMinutes = convertIsoDurationToMinutes(minutes))"
        >
          {{ t(`SetBackup.RestoreDialog.quickDuration.${minutes}`) }}
        </a-tag>
      </div>

      <div class="mt-3">
        <a-switch
          :checked="restoreOptions.keepExistUserInfo"
          @change="(v: any) => (restoreOptions.keepExistUserInfo = !!v)"
        />
        <span class="switch-label">{{ t("SetBackup.RestoreDialog.keepExistUserInfo") }}</span>
      </div>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <div style="flex: 1" />

        <a-button :disabled="isDoingRestore" color="danger" variant="text" @click="showDialog = false">
          <template #icon>
            <CloseCircleOutlined />
          </template>
          {{ t("common.dialog.cancel") }}
        </a-button>
        <a-button
          v-if="currentStep == 'restore'"
          color="blue"
          variant="text"
          icon-placement="start"
          @click="currentStep = restoreMetadata.type"
        >
          <template #icon>
            <LeftOutlined />
          </template>
          {{ t("common.dialog.prev") }}
        </a-button>
        <a-button
          v-if="currentStep != 'restore'"
          :disabled="isEmpty(restoreData)"
          color="blue"
          variant="text"
          icon-placement="end"
          @click="currentStep = 'restore'"
        >
          <template #icon>
            <RightOutlined />
          </template>
          {{ t("common.dialog.next") }}
        </a-button>
        <a-button
          v-if="currentStep == 'restore'"
          :loading="isDoingRestore"
          color="green"
          variant="text"
          @click="doRestore"
        >
          <template #icon>
            <ImportOutlined />
          </template>
          {{ t("common.dialog.ok") }}
        </a-button>
      </div>
    </template>
  </a-modal>
</template>

<style scoped lang="scss">
.section-label {
  margin-bottom: 4px;
  font-size: 14px;
  font-weight: 500;
  color: rgba(0, 0, 0, 0.6);
}

.step-panel {
  /* 对应原先 v-dialog 的 scrollable：内容过长时对话框内部滚动 */
  max-height: 55vh;
  overflow-y: auto;
  /* a-row 的 :gutter 会给行加左右各 -8px 负外边距，在滚动容器里表现为恒定 16px 的横向溢出，
     即一条永远存在的横向滚动条（加宽弹窗也消不掉）。这里横向不需要滚动，直接裁掉。 */
  overflow-x: hidden;
}

.duration-tags {
  margin-top: 8px;
}

.duration-tag {
  margin-bottom: 4px;
  cursor: pointer;
}

.switch-label {
  margin-left: 8px;
}

.dialog-footer {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>