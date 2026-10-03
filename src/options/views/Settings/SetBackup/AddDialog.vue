<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { ref } from "vue";
import { computedAsync } from "@vueuse/core";
import { nanoid } from "nanoid";
import { CheckCircleOutlined, CloseCircleOutlined, LeftOutlined, QuestionCircleOutlined, RightOutlined } from "@antdv-next/icons";

import { BackupFields, IBackupServerMetadata } from "@/shared/types.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import {
  entityList,
  getBackupServerDefaultConfig,
  getBackupServerIcon,
  getBackupServerMetaData,
  type IBackupMetadata,
} from "@ptd/backupServer";
import { REPO_URL } from "~/helper.ts";

import Editor from "./Editor.vue";

const showDialog = defineModel<boolean>();

const { t } = useI18n();
const metadataStore = useMetadataStore();

const currentStep = ref<0 | 1>(0);
const selectedBackupServerType = ref<IBackupServerMetadata["type"] | null>(null);
const storedBackupServerConfig = ref<IBackupServerMetadata>({} as IBackupServerMetadata);
const isBackupServerConfigValid = ref<boolean>(false);

const allBackupServerMetaData = computedAsync(async () => {
  const clientMetaData: Record<string, IBackupMetadata<any> & { type: string }> = {};
  for (const type of entityList) {
    clientMetaData[type] = { type, ...(await getBackupServerMetaData(type)) };
  }
  return clientMetaData;
}, {});

async function updateStoredDownloaderConfigByDefault(type: IBackupServerMetadata["type"]) {
  storedBackupServerConfig.value = {
    ...(await getBackupServerDefaultConfig(type)),
    enabled: true,
    id: nanoid(),
    backupFields: [...BackupFields],
  } as IBackupServerMetadata;
  console.log("storedBackupServerConfig", storedBackupServerConfig.value);
}

async function saveStoredBackupServerConfig() {
  await metadataStore.addBackupServer(storedBackupServerConfig.value as IBackupServerMetadata);
  showDialog.value = false;
}

function resetDialog() {
  currentStep.value = 0;
  selectedBackupServerType.value = null;
  storedBackupServerConfig.value = {} as IBackupServerMetadata;
  isBackupServerConfigValid.value = false;
}
</script>

<template>
  <a-modal v-model:open="showDialog" :width="800" @after-close="resetDialog">
    <!-- 标题栏右侧的 wiki 链接（原来放在 v-toolbar 的 #append 上，antd 标题插槽需自行排版） -->
    <template #title>
      <div class="dialog-title">
        <span>{{ t("SetBackup.AddDialog.title") }}</span>
        <a-button
          type="text"
          color="green"
          :title="t('layout.header.wiki')"
          :href="`${REPO_URL}/wiki/config-backup-server`"
          rel="noopener noreferrer nofollow"
          target="_blank"
        >
          <template #icon>
            <QuestionCircleOutlined />
          </template>
        </a-button>
      </div>
    </template>

    <!--
      原来是 <v-window> 步骤流：没有标签页标题，currentStep 直接决定显示哪一块。
      a-tabs 需要字符串 key 且必须显示导航栏才能切换，这里用 v-show 保持
      「currentStep 单一数据源 + 面板常驻挂载」的原有语义。
    -->
    <div v-show="currentStep === 0">
      <a-select
        v-model:value="selectedBackupServerType"
        placeholder="请选择备份服务器类型"
        @change="(v: IBackupServerMetadata['type']) => updateStoredDownloaderConfigByDefault(v)"
      >
        <a-select-option v-for="meta in Object.values(allBackupServerMetaData)" :key="meta.type" :value="meta.type">
          <div class="backup-type-option">
            <img class="backup-type-option__icon" :src="getBackupServerIcon(meta.type)" :alt="meta.type" />
            <span>{{ meta.type }}</span>
          </div>
        </a-select-option>
      </a-select>

      <!-- v-autocomplete 的 persistent-hint -->
      <div class="select-hint">
        {{
          allBackupServerMetaData[selectedBackupServerType!]?.description ?? t("SetDownloader.add.NoneSelectNotice")
        }}
      </div>
    </div>

    <div v-show="currentStep === 1">
      <Editor
        v-if="storedBackupServerConfig.type"
        v-model="storedBackupServerConfig"
        @update:config-valid="(v) => (isBackupServerConfigValid = v)"
      />
    </div>

    <template #footer>
      <div class="dialog-footer">
        <a-button
          v-show="currentStep === 0"
          :href="`${REPO_URL}/tree/master/src/packages/backupServer`"
          color="default"
          variant="solid"
          rel="noopener noreferrer nofollow"
          target="_blank"
        >
          <template #icon>
            <QuestionCircleOutlined />
          </template>
          <span>{{ t("SetDownloader.add.newType") }}</span>
        </a-button>

        <div style="flex: 1" />

        <a-button color="danger" variant="text" @click="showDialog = false">
          <template #icon>
            <CloseCircleOutlined />
          </template>
          {{ t("common.dialog.cancel") }}
        </a-button>
        <a-button
          v-if="currentStep === 1"
          color="blue"
          variant="text"
          icon-placement="start"
          @click="currentStep--"
        >
          <template #icon>
            <LeftOutlined />
          </template>
          {{ t("common.dialog.prev") }}
        </a-button>
        <a-button
          v-if="currentStep === 0"
          :disabled="selectedBackupServerType == null"
          color="blue"
          variant="text"
          icon-placement="end"
          @click="currentStep++"
        >
          <template #icon>
            <RightOutlined />
          </template>
          {{ t("common.dialog.next") }}
        </a-button>
        <a-button
          v-if="currentStep === 1"
          :disabled="!isBackupServerConfigValid"
          color="green"
          variant="text"
          @click="saveStoredBackupServerConfig"
        >
          <template #icon>
            <CheckCircleOutlined />
          </template>
          {{ t("common.dialog.ok") }}
        </a-button>
      </div>
    </template>
  </a-modal>
</template>

<style scoped lang="scss">
.dialog-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

/* 底部操作按钮：新增服务器链接靠左，取消/上一步/下一步/确定靠右 */
.dialog-footer {
  display: flex;
  align-items: center;
  gap: 8px;
}

.select-hint {
  margin-top: 4px;
  color: rgba(0, 0, 0, 0.45);
  font-size: 12px;
}

.backup-type-option {
  display: flex;
  align-items: center;
  gap: 8px;
}

.backup-type-option__icon {
  width: 20px;
  height: 20px;
}
</style>