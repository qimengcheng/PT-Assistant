<script setup lang="ts">
/**
 * 备份设置：自动备份总闸 + 备份加密密钥 + PT-Plugin-Plus 旧数据导入入口。
 *
 * v0.121.0 从 `SetBase/BackupWindow.vue` 搬来，与同一页的备份服务器列表、恢复入口并在一处。
 * 起因是这三样在语义上是一件事却分了两个入口：密钥与总闸在「基础设置」里，服务器与恢复在
 * 左侧「数据备份」里 —— 而恢复失败最常见的原因就是密钥在 A 处、包在 B 处。
 */
import JSZip from "jszip";
import { nanoid } from "nanoid";
import { ref, shallowRef, watch } from "vue";
import { useThrottledRefHistory } from "@vueuse/core";
import { useI18n } from "vue-i18n";
import { message } from "@zboson/ui";
import { InboxOutlined, KeyOutlined, RollbackOutlined } from "@zboson/icons";

import { useConfigStore } from "@/options/stores/config.ts";
import type { IPtppDumpUserInfo } from "@/shared/types.ts";

import RestorePtppUserDataDialog from "./RestorePtppUserDataDialog.vue";

const { t } = useI18n();
const configStore = useConfigStore();

/**
 * ⚠️ configStore 是 persistWebExt 的 store，取数走 chrome.storage.local.get，
 * **异步水合**。在 setup 里同步读 configStore.backup.encryptionKey 拿到的是
 * 初始值（空串），不是用户真正的密钥 —— 这一块挂在 `a-collapse` 里，**必须**
 * 由调用方给 `force-render`，让内容在收起状态下也已挂载：面板懒渲染的话，
 * 下面那个 `$onReady` 回调要等用户展开才注册，而那时输入框已经带着空串画出来过一次了。
 *
 * 后果有两条：
 *  1. 输入框是空的，看着像「这个备份没有密钥」；
 *  2. 用户在这个空输入框点「随机密钥」，会生成一个新的 nanoid，
 *     而下面那条单向 watch 立刻把它写回 store —— **原有备份从此解不开**。
 *
 * 修法：等 $onReady 之后再回填本地 ref，水合前 watch 不回写、整组控件禁用并给加载提示
 * （$onReady 的仓库内正例见 entrypoints/options/main.ts:30、MediaServerEntity/Index.vue:65）。
 */
const encryptionKey = shallowRef<string>("");
const isKeyReady = ref<boolean>(false);
const { history, undo: undoEncryptionKey } = useThrottledRefHistory(encryptionKey, { throttle: 50 });

watch(encryptionKey, (newValue) => {
  // 水合前一律不回写：那时的值是空串，写回去就是抹掉用户真实的密钥
  if (!isKeyReady.value) return;
  configStore.backup.encryptionKey = newValue; // 将 encryptionKey 同步回 configStore
});

configStore.$onReady(() => {
  encryptionKey.value = configStore.backup.encryptionKey ?? "";
  isKeyReady.value = true;
});

function randomEncryptionKey() {
  encryptionKey.value = nanoid();
}

// ===== PT-Plugin-Plus 旧数据导入 =====
const showRestorePtppUserDataDialog = ref<boolean>(false);
const parsedPtppUserData = shallowRef<IPtppDumpUserInfo>();

async function loadPTPPBackupFile(file: File) {
  let ptppUserDataFileRawContent: string | undefined;
  if (file.name.match(/^PT-Plugin-Plus-Backup-.+\.zip$/)) {
    const zip = new JSZip();
    const zipContent = await zip.loadAsync(file);
    ptppUserDataFileRawContent = (await zipContent.file("userdatas.json")?.async("string")) || undefined;
  } else if (file.name === "userdatas.json") {
    ptppUserDataFileRawContent = await file.text();
  }

  try {
    if (!ptppUserDataFileRawContent || !ptppUserDataFileRawContent.startsWith("{")) {
      throw new Error("Invalid file format");
    }
    parsedPtppUserData.value = JSON.parse(ptppUserDataFileRawContent);
    showRestorePtppUserDataDialog.value = true;
  } catch {
    message.error(t("SetBackup.settings.invalidFileFormat"));
  }
}

/**
 * 导入的触发点。上游那份是 v-file-input 的 `@update:model-value="loadPTPPBackupFile"`，
 * antdv-next 的 a-upload 没有对应事件：beforeUpload 返回 false 时 rc-upload 不建条目，
 * change 事件里的 fileList 也就取不到 File（同仓 PushToDownloaderDialog.vue 记过同一件事），
 * 所以在这里直接把 File 接住。返回 false 表示不发任何上传请求。
 */
function pickPtppFile(file: File) {
  void loadPTPPBackupFile(file);
  return false;
}
</script>

<template>
  <div class="backup-window">
    <a-form layout="vertical" class="compact-form">
      <div class="group">
        <div class="group-title">{{ t("SetBackup.settings.groupEncryption") }}</div>
        <a-form-item
          :label="t('SetBackup.settings.encryptionKey')"
          :extra="t('SetBackup.settings.encryptionKeyHint')"
        >
          <!-- 水合回来之前整组不可用：此刻输入框是空的（不是「没设密钥」），
               点「随机密钥」会生成新密钥盖掉真实密钥，已有备份就再也解不开了。 -->
          <a-alert v-if="!isKeyReady" type="info" show-icon class="mb-2">
            <template #message>{{ t("SetBackup.settings.loadingKey") }}</template>
          </a-alert>
          <a-space-compact>
            <a-input-password
              v-model:value="encryptionKey"
              class="key-input"
              :placeholder="t('SetBackup.settings.encryptionKeyPlaceholder')"
              autocomplete="new-password"
              :disabled="!isKeyReady"
            />
            <a-tooltip :title="t('SetBackup.settings.randomKeyTooltip')">
              <a-button :disabled="!isKeyReady" @click="randomEncryptionKey">
                <template #icon>
                  <KeyOutlined />
                </template>
                {{ t("SetBackup.settings.randomKey") }}
              </a-button>
            </a-tooltip>
            <a-tooltip v-if="history.length > 1" :title="t('SetBackup.settings.undoKeyTooltip')">
              <a-button @click="undoEncryptionKey">
                <template #icon>
                  <RollbackOutlined />
                </template>
                {{ t("SetBackup.settings.undo") }}
              </a-button>
            </a-tooltip>
          </a-space-compact>
        </a-form-item>
      </div>

      <div class="group">
        <div class="group-title">{{ t("SetBackup.settings.groupAutoBackup") }}</div>
        <!-- 这是自动备份的总闸（v0.106.13 起）：关上之后后台那一轮定时检查直接不干活，
             每台服务器自己的 enabled + backupInterval 只在它开着时才起作用。 -->
        <div class="switch-item">
          <a-switch v-model:checked="configStore.backup.enabledAutoBackup" size="small" />
          <span class="label">{{ t("SetBackup.settings.enabledAutoBackup") }}</span>
        </div>
        <div class="auto-backup-hint">{{ t("SetBackup.settings.enabledAutoBackupHint") }}</div>
      </div>

      <div class="group">
        <div class="group-title">{{ t("SetBackup.settings.groupImportPtpp") }}</div>
        <a-alert class="import-alert" type="info" show-icon>
          <template #message>{{ t("SetBackup.settings.importPtppMessage") }}</template>
          <template #description>
            <div class="steps-lead">{{ t("SetBackup.settings.importPtppStepsLead") }}</div>
            <ol class="import-steps">
              <li>{{ t("SetBackup.settings.importPtppStep1") }}</li>
              <li>{{ t("SetBackup.settings.importPtppStep2") }}</li>
              <li>{{ t("SetBackup.settings.importPtppStep3") }}</li>
            </ol>
          </template>
        </a-alert>
        <a-upload-dragger
          class="ptpp-dragger"
          accept="application/zip, application/json"
          :max-count="1"
          :show-upload-list="false"
          :before-upload="pickPtppFile"
        >
          <p class="drop-icon">
            <InboxOutlined />
          </p>
          <p class="drop-title">{{ t("SetBackup.settings.dropTitle") }}</p>
          <p class="drop-hint">{{ t("SetBackup.settings.dropHint") }}</p>
        </a-upload-dragger>
      </div>
    </a-form>

    <RestorePtppUserDataDialog v-model="showRestorePtppUserDataDialog" :ptpp-user-data="parsedPtppUserData!" />
  </div>
</template>

<style scoped>
/* 分组标题与开关行这一族原先不用在这里写：`SetBase/Index.vue` 的样式块**不带 scoped**，
   里面那几条 `.set-base .group` / `.set-base .group-title` / `.set-base .switch-item`
   会伸进各窗口内部。搬出那一页之后它们全都够不着了（选择器带 `.set-base` 前缀），
   所以在本组件的 scoped 块里重写一份。写在这里而不是往宿主再挂一条全局规则：
   这份样式的归属就是这个组件，别让它继续依赖「必须先加载过 SetBase 那个 chunk」。 */
.group {
  margin-bottom: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--pt-color-border-light);
}

/* 折叠面板的正文第一行不再需要那条上分隔线 —— 面板 header 下面已经有一条了 */
.group:first-child {
  padding-top: 0;
  border-top: none;
}

.group-title {
  font-weight: 600;
  font-size: 13px;
  margin-bottom: 12px;
  color: rgba(0, 0, 0, 0.88);
}

.switch-item {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

/* 标签允许换行：截断一个设置名比让它占两行严重（AGENTS §3.5） */
.switch-item .label {
  margin-left: 0;
  font-size: 13px;
}

.key-input {
  flex: 1 1 auto;
  min-width: 0;
}

.import-alert {
  margin-bottom: 12px;
}

.auto-backup-hint {
  margin-top: 8px;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
}

.steps-lead {
  margin: 6px 0 2px;
}

/* 编号交给 ol：文案里手写「1.」的话，条目换行时编号会和文字一起缩进，对不齐 */
.import-steps {
  margin: 0;
  padding-inline-start: 20px;
}

.import-steps li {
  margin-block-end: 4px;
}

.ptpp-dragger .drop-icon {
  margin: 0 0 8px;
  font-size: 32px;
  line-height: 1;
}

.drop-title {
  margin: 0 0 4px;
}

.drop-hint {
  margin: 0;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
}
</style>
