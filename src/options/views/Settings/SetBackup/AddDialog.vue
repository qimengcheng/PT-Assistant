<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { ref } from "vue";
import { computedAsync } from "@vueuse/core";
import { nanoid } from "nanoid";
import { CheckCircleOutlined, CloseCircleOutlined, LeftOutlined, QuestionCircleOutlined, RightOutlined } from "@antdv-next/icons";

import { BackupFields, type IBackupServerMetadata } from "@/shared/types.ts";
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
  <a-modal
    v-model:open="showDialog"
    :title="t('SetBackup.AddDialog.title')"
    :width="800"
    :after-close="resetDialog"
  >
    <!-- wiki 入口原先挂在 #title 插槽里（.dialog-title 的 space-between 把它推到最右，
         正好压在 antd 绝对定位的关闭按钮上 —— 就是截图里问号与 X 重叠的成因），移到内容区顶部 -->
    <div class="d-flex justify-end">
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

    <!--
      原来是 <v-window> 步骤流：没有标签页标题，currentStep 直接决定显示哪一块。
      a-tabs 需要字符串 key 且必须显示导航栏才能切换，这里用 v-show 保持
      「currentStep 单一数据源 + 面板常驻挂载」的原有语义。
    -->
    <div v-show="currentStep === 0">
      <a-select
        v-model:value="selectedBackupServerType"
        :placeholder="t('SetBackup.AddDialog.selectTypePlaceholder')"
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
      <a-flex align="center" gap="small">
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

        <!-- 新增服务器链接靠左、取消/上一步/下一步/确定靠右。右侧这组用 flex="auto"
             自己吃掉剩余宽度再右对齐，而不是外层 justify="space-between"：
             步骤 2 时左侧按钮 v-show 隐藏，space-between 剩一个子元素会贴到左边跑位。 -->
        <a-flex flex="auto" justify="flex-end" align="center" gap="small">
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
        </a-flex>
      </a-flex>
    </template>
  </a-modal>
</template>

<style scoped lang="scss">
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