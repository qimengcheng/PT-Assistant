<script setup lang="ts">
/**
 * 媒体服务器管理页（antdv-next 实现）。
 * 管理 EMBY / Jellyfin / Plex / fnOS 等媒体服务器连接，供搜索页联动媒体库检索。
 * 业务包 @ptd/mediaServer（v0.2.0 平移）、消息协议 getMediaServerSearchResult（v0.3.0 注册）。
 */
import { computed, ref } from "vue";
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
  getMediaServerDefaultConfig,
  getMediaServerMetaData,
  type IMediaServerMetadata as PkgMediaServerMetadata,
} from "@ptd/mediaServer";
import { nanoid } from "nanoid";

import { useMetadataStore } from "@/options/stores/metadata.ts";
import type { IMediaServerMetadata, TMediaServerKey } from "@/shared/types.ts";
import { sendMessage } from "@/messages.ts";

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
    message.warning("请填写媒体服务器名称");
    return;
  }
  if (!config.address?.trim()) {
    message.warning("请填写媒体服务器地址");
    return;
  }
  // auth 必填字段校验
  for (const rawField of currentAuthFields.value) {
    const field = normalizeAuthField(rawField);
    if (field.required && !config.auth?.[field.name]?.trim()) {
      message.warning(`请填写认证字段「${field.name}」`);
      return;
    }
  }

  if (isEditMode.value && editingId.value) {
    metadataStore.mediaServers[editingId.value] = { ...metadataStore.mediaServers[editingId.value], ...config };
  } else {
    metadataStore.mediaServers[config.id!] = { ...config } as IMediaServerMetadata;
  }
  await metadataStore.$save();
  message.success(isEditMode.value ? "媒体服务器配置已更新" : "媒体服务器已添加");
  showEditDialog.value = false;
}

function confirmDelete(row: IMediaServerMetadata) {
  Modal.confirm({
    title: "删除媒体服务器",
    content: `确定删除「${row.name}」吗？该操作不可恢复。`,
    okType: "danger",
    okText: "删除",
    cancelText: "取消",
    onOk: async () => {
      delete metadataStore.mediaServers[row.id];
      await metadataStore.$save();
      message.success("已删除");
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
      throw new Error(result?.errorMessage ?? "媒体库检索失败");
    }
    message.success(`连接成功，媒体库检索返回 ${result.items?.length ?? 0} 条`);
  } catch (err: any) {
    message.error(`连接失败：${err?.message ?? err}`);
  } finally {
    testingIds.value[row.id] = false;
  }
}

async function toggleEnabled(row: IMediaServerMetadata, enabled: boolean) {
  row.enabled = enabled;
  await metadataStore.$save();
}

const columns = [
  { title: "名称", key: "name", dataIndex: "name" },
  { title: "类型", key: "type", dataIndex: "type" },
  { title: "地址", key: "address", dataIndex: "address", ellipsis: true },
  { title: "启用", key: "enabled", width: "80px" },
  { title: "操作", key: "action", width: "160px" },
];
</script>

<template>
  <div class="set-media-server">
    <div class="page-header">
      <h2>媒体服务器</h2>
      <a-button type="primary" @click="openAddDialog">
        <PlusOutlined /> 添加媒体服务器
      </a-button>
    </div>

    <a-alert class="mb-3" type="info" show-icon
      message="媒体服务器用于在搜索结果中联动检索媒体库（如 Emby / Jellyfin / Plex / fnOS），确认片库中是否已有对应影片。" />

    <a-table
      :columns="columns"
      :data-source="mediaServers"
      :row-key="(r: any) => r.id"
      :pagination="false"
      :locale="{ emptyText: '还没有添加媒体服务器，点击右上角「添加媒体服务器」开始' }"
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
            <a-tooltip title="测试连接（检索一次媒体库）">
              <a-button size="small" :loading="testingIds[record.id]" @click="testConnection(record)">
                <ApiOutlined /> 测试
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
      :title="isEditMode ? '编辑媒体服务器' : '添加媒体服务器'"
      width="640px"
      ok-text="保存"
      cancel-text="取消"
      @ok="saveConfig"
    >
      <a-form layout="vertical" class="ms-form">
        <a-form-item label="服务器类型">
          <a-select
            v-model:value="editingConfig.type"
            :options="typeOptions"
            :disabled="isEditMode"
            placeholder="选择媒体服务器类型"
          />
        </a-form-item>

        <a-alert
          v-for="(w, i) in currentWarnings"
          :key="i"
          class="mb-2"
          type="warning"
          show-icon
          :message="w"
        />

        <a-form-item label="名称">
          <a-input v-model:value="editingConfig.name" placeholder="用于辨识的名称，如 家庭 NAS Emby" />
        </a-form-item>

        <a-form-item label="地址">
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
            :placeholder="normalizeAuthField(rawField).name.toLowerCase().includes('key') ? 'API Key' : '用户凭据'"
            autocomplete="new-password"
          />
        </a-form-item>

        <a-form-item label="请求超时（秒）">
          <a-input-number v-model:value="editingConfig.timeout" :min="1" :max="600" style="width: 160px" />
        </a-form-item>

        <a-form-item label="启用">
          <a-switch v-model:checked="editingConfig.enabled" />
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
