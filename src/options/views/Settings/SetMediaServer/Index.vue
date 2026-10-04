<script setup lang="ts">
/**
 * 媒体服务器管理页（antdv-next 实现）。
 * 管理 EMBY / Jellyfin / Plex / fnOS 等媒体服务器连接，供搜索页联动媒体库检索。
 * 业务包 @ptd/mediaServer（v0.2.0 平移）、消息协议 getMediaServerSearchResult（v0.3.0 注册）。
 */
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { message, Modal } from "antdv-next";
import {
  ApiOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
} from "@antdv-next/icons";
import { computedAsync } from "@vueuse/core";
import {
  entityList,
  getMediaServer,
  getMediaServerDefaultConfig,
  getMediaServerMetaData,
  type IMediaServerMetadata as PkgMediaServerMetadata,
} from "@ptd/mediaServer";
import { nanoid } from "nanoid";

import { useMetadataStore } from "@/options/stores/metadata.ts";
import type { IMediaServerMetadata, TMediaServerKey } from "@/shared/types.ts";
import { sendMessage } from "@/messages.ts";
import ConnectCheckButton from "@/options/components/ConnectCheckButton.vue";

const { t } = useI18n();
const metadataStore = useMetadataStore();

const mediaServers = computed<IMediaServerMetadata[]>(() => metadataStore.getMediaServers);

// ===== 类型元数据缓存（auth_field / description 等） =====
const typeMetaMap = ref<Record<string, PkgMediaServerMetadata>>({});
const typeOptions = computedAsync(async () => {
  const options: Array<{ value: string; label: string }> = [];
  for (const type of entityList) {
    const meta = await getMediaServerMetaData(type);
    typeMetaMap.value[type] = meta;
    options.push({ value: type, label: meta.description ?? type });
  }
  return options;
}, []);

// ===== 添加 / 编辑 =====
const showEditDialog = ref<boolean>(false);
const isEditMode = ref<boolean>(false);
const editingId = ref<TMediaServerKey | null>(null);
const editingConfig = ref<IMediaServerMetadata>({} as IMediaServerMetadata);

const currentAuthFields = computed(() => typeMetaMap.value[editingConfig.value.type]?.auth_field ?? []);
const currentWarnings = computed(() => typeMetaMap.value[editingConfig.value.type]?.warning ?? []);

function normalizeAuthField(field: string | { name: string; required?: boolean; message?: string }) {
  return typeof field === "string" ? { name: field, required: true } : { required: true, ...field };
}

/**
 * 连通性测试（上游 Editor.vue 的 ConnectCheckButton）。
 * 只在「必填项都填了」时才真的发请求，否则直接判失败，避免拿半截配置去 ping。
 */
async function checkConnect(): Promise<boolean> {
  const config = editingConfig.value;
  if (!config.type || !config.name?.trim() || !config.address?.trim()) return false;
  for (const rawField of currentAuthFields.value) {
    const field = normalizeAuthField(rawField);
    if (field.required && !config.auth?.[field.name]?.trim()) return false;
  }
  try {
    const client = await getMediaServer(config);
    return await client.ping();
  } catch {
    return false;
  }
}

function openAddDialog() {
  isEditMode.value = false;
  editingId.value = null;
  const defaultConfig = getMediaServerDefaultConfig(entityList[0]);
  editingConfig.value = {
    ...(defaultConfig as any),
    id: nanoid(),
    name: "",
    enabled: true,
    auth: {},
  };
  showEditDialog.value = true;
}

function openEditDialog(row: IMediaServerMetadata) {
  isEditMode.value = true;
  editingId.value = row.id;
  editingConfig.value = JSON.parse(JSON.stringify(row));
  showEditDialog.value = true;
}

async function saveConfig() {
  const config = editingConfig.value;
  if (!config.name?.trim()) {
    message.warning(t("SetMediaServer.index.needName"));
    return;
  }
  if (!config.address?.trim()) {
    message.warning(t("SetMediaServer.index.needAddress"));
    return;
  }
  // auth 必填字段校验
  for (const rawField of currentAuthFields.value) {
    const field = normalizeAuthField(rawField);
    if (field.required && !config.auth?.[field.name]?.trim()) {
      message.warning(t("SetMediaServer.index.needAuthField", [field.name]));
      return;
    }
  }

  if (isEditMode.value && editingId.value) {
    metadataStore.mediaServers[editingId.value] = { ...metadataStore.mediaServers[editingId.value], ...config };
  } else {
    metadataStore.mediaServers[config.id!] = { ...config } as IMediaServerMetadata;
  }
  await metadataStore.$save();
  message.success(isEditMode.value ? t("SetMediaServer.index.updated") : t("SetMediaServer.index.added"));
  showEditDialog.value = false;
}

function confirmDelete(row: IMediaServerMetadata) {
  Modal.confirm({
    title: t("SetMediaServer.index.deleteTitle"),
    content: t("SetMediaServer.index.deleteConfirm", [row.name]),
    okType: "danger",
    okText: t("common.remove"),
    cancelText: t("common.dialog.cancel"),
    onOk: async () => {
      delete metadataStore.mediaServers[row.id];
      await metadataStore.$save();
      message.success(t("SetMediaServer.index.deleted"));
    },
  });
}

// ===== 连接测试：直接调媒体搜索（返回条目即视为连通） =====
const testingIds = ref<Record<string, boolean>>({});
async function testConnection(row: IMediaServerMetadata) {
  testingIds.value[row.id] = true;
  try {
    const result = await sendMessage("getMediaServerSearchResult", {
      mediaServerId: row.id,
      keywords: "test",
      options: {},
    });
    if (result?.status !== 0) {
      throw new Error(result?.errorMessage ?? t("SetMediaServer.index.mediaSearchFailed"));
    }
    message.success(t("SetMediaServer.index.connectSuccess", [result.items?.length ?? 0]));
  } catch (err: any) {
    message.error(t("SetMediaServer.index.connectFailed", [err?.message ?? err]));
  } finally {
    testingIds.value[row.id] = false;
  }
}

async function toggleEnabled(row: IMediaServerMetadata, enabled: boolean) {
  row.enabled = enabled;
  await metadataStore.$save();
}

const columns = computed(() => [
  { title: t("common.name"), key: "name", dataIndex: "name" },
  { title: t("common.type"), key: "type", dataIndex: "type" },
  { title: t("SetMediaServer.index.address"), key: "address", dataIndex: "address", ellipsis: true },
  { title: t("common.enable"), key: "enabled", width: "80px" },
  { title: t("common.action"), key: "action", width: "160px" },
]);
</script>

<template>
  <div class="set-media-server">
    <div class="page-header">
      <h2>{{ t("SetMediaServer.index.title") }}</h2>
      <a-button type="primary" @click="openAddDialog">
        <PlusOutlined /> {{ t("SetMediaServer.add.title") }}
      </a-button>
    </div>

    <a-alert class="mb-3" type="info" show-icon
      :title="t('SetMediaServer.index.description')" />

    <a-table
      :columns="columns"
      :data-source="mediaServers"
      :row-key="(r: any) => r.id"
      :pagination="false"
      :locale="{ emptyText: t('SetMediaServer.index.emptyTable') }"
      size="small"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'name'">
          <span class="ms-name">{{ record.name }}</span>
        </template>

        <template v-else-if="column.key === 'type'">
          <a-tag color="purple">{{ record.type }}</a-tag>
        </template>

        <template v-else-if="column.key === 'enabled'">
          <a-switch size="small" :checked="record.enabled" @change="(v: any) => toggleEnabled(record, !!v)" />
        </template>

        <template v-else-if="column.key === 'action'">
          <a-space>
            <a-tooltip :title="t('SetMediaServer.index.testTooltip')">
              <a-button size="small" :loading="testingIds[record.id]" @click="testConnection(record)">
                <ApiOutlined /> {{ t("common.test") }}
              </a-button>
            </a-tooltip>
            <a-button size="small" type="text" @click="openEditDialog(record)">
              <EditOutlined />
            </a-button>
            <a-button size="small" type="text" danger @click="confirmDelete(record)">
              <DeleteOutlined />
            </a-button>
          </a-space>
        </template>
      </template>
    </a-table>

    <a-modal
      v-model:open="showEditDialog"
      :title="isEditMode ? t('SetMediaServer.index.editTitle') : t('SetMediaServer.add.title')"
      width="640px"
      :ok-text="t('common.save')"
      :cancel-text="t('common.dialog.cancel')"
      @ok="saveConfig"
    >
      <a-form layout="vertical" class="ms-form">
        <a-form-item :label="t('SetMediaServer.index.serverType')">
          <a-select
            v-model:value="editingConfig.type"
            :options="typeOptions"
            :disabled="isEditMode"
            :placeholder="t('SetMediaServer.index.typePlaceholder')"
          />
        </a-form-item>

        <a-alert
          v-for="(w, i) in currentWarnings"
          :key="i"
          class="mb-2"
          type="warning"
          show-icon
          :title="w"
        />

        <a-form-item :label="t('common.name')">
          <a-input v-model:value="editingConfig.name" :placeholder="t('SetMediaServer.index.namePlaceholder')" />
        </a-form-item>

        <a-form-item :label="t('SetMediaServer.index.address')">
          <a-input v-model:value="editingConfig.address" placeholder="http://ip:port/" />
        </a-form-item>

        <a-form-item
          v-for="rawField in currentAuthFields"
          :key="normalizeAuthField(rawField).name"
          :label="normalizeAuthField(rawField).name"
          :required="normalizeAuthField(rawField).required"
          :extra="normalizeAuthField(rawField).message"
        >
          <a-input
            v-model:value="editingConfig.auth[normalizeAuthField(rawField).name]"
            :placeholder="normalizeAuthField(rawField).name.toLowerCase().includes('key') ? 'API Key' : t('SetMediaServer.index.credentialPlaceholder')"
            autocomplete="new-password"
          />
        </a-form-item>

        <a-form-item :label="t('SetMediaServer.index.timeout')">
          <a-input-number v-model:value="editingConfig.timeout" :min="1" :max="600" style="width: 160px" />
        </a-form-item>

        <a-form-item :label="t('common.enable')">
          <a-switch v-model:checked="editingConfig.enabled" />
        </a-form-item>

        <!-- 连通性测试：上游 Editor.vue 里由 ConnectCheckButton 承担，这里补回同一能力 -->
        <ConnectCheckButton :check-fn="checkConnect" :reset-timeout="3000" />

        <a-form-item v-if="isEditMode && editingConfig.id" :label="t('SetMediaServer.index.configId')">
          <span class="text-body-small">{{ editingConfig.id }}</span>
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<style scoped>
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.page-header h2 {
  margin: 0;
  font-size: 16px;
}

.ms-name {
  font-weight: 600;
}

.mb-3 {
  margin-bottom: 12px;
}

.mb-2 {
  margin-bottom: 8px;
}
</style>
