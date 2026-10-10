<script setup lang="ts">
/**
 * 媒体服务器管理面板（原 `Settings/SetMediaServer/Index.vue` 那一整页，v0.37.0 起
 * 并进「媒体库」页，由页面上的「管理媒体服务器」按钮展开）。
 * 管理 EMBY / Jellyfin / Plex / fnOS 等媒体服务器连接，供本页的媒体库检索使用。
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
// 走深路径而不是 @ptd/site 根入口：那个 barrel 会把整片工具链（含 sizzle）拖进来，
// types/base.ts 自身零 import（AGENTS.md §3.2）
import { EResultParseStatus } from "@ptd/site/types/base.ts";
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

/**
 * 类型展示名。元数据里没有 name，只有 description（一句话介绍，如「媒体服务器 / 群晖…」）——
 * 表格这一列太窄放不下一句介绍，所以退回首字母大写的 type（emby → Emby）。
 * 目的是不把内部字面量直接摆上台面（AGENTS.md §3.5）。
 */
function typeDisplayName(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

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

async function openAddDialog() {
  isEditMode.value = false;
  editingId.value = null;
  // 必须 await：getMediaServerDefaultConfig 是 async（要动态 import 对应 entity 模块），
  // 原来没等就展开 → `{...Promise}` 得到空对象，于是「新增」这条路的默认值一个都没进来：
  // type 为空（认证字段区因此整块不渲染）、timeout 为空（存下去就没有请求超时，
  // 卡住的服务器会一直占着并发槽）。
  const defaultConfig = await getMediaServerDefaultConfig(entityList[0]);
  editingConfig.value = {
    ...defaultConfig,
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
    // ⚠️ 枚举里 success = 3、unknownError = 0，原来的 `!== 0` 把「成功」判成失败 ——
    // 测试连接功能整个反向，真连上反而报「连接失败」。用枚举而不是裸数字。
    if (result?.status !== EResultParseStatus.success) {
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
  <div class="server-manager">
    <div class="manager-head">
      <h3 class="manager-title">{{ t("SetMediaServer.index.title") }}</h3>
      <a-button type="primary" @click="openAddDialog">
        <template #icon><PlusOutlined /></template>
        <span>{{ t("SetMediaServer.add.title") }}</span>
      </a-button>
    </div>

    <a-alert class="manager-desc" type="info" show-icon :title="t('SetMediaServer.index.description')" />

    <a-table
      bordered
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
          <!-- 用元数据里的展示名（Emby / Jellyfin / Plex…）而不是内部 type 字面量 -->
          <a-tag color="purple">{{ typeDisplayName(record.type) }}</a-tag>
        </template>

        <template v-else-if="column.key === 'enabled'">
          <a-switch size="small" :checked="record.enabled" @change="(v: any) => toggleEnabled(record, !!v)" />
        </template>

        <template v-else-if="column.key === 'action'">
          <a-space>
            <a-tooltip :title="t('SetMediaServer.index.testTooltip')">
              <!-- 图标挂 #icon：挂默认插槽时 antd 的 loading 图标是插在按钮前面的、带宽度动画，
                   一测试连接这颗按钮就变宽，把整列/整张表的列宽重排（与 MyData 操作列同一毛病） -->
              <a-button size="small" :loading="testingIds[record.id]" @click="testConnection(record)">
                <template #icon><ApiOutlined /></template>
                {{ t("common.test") }}
              </a-button>
            </a-tooltip>
            <!-- 纯图标按钮必须挂 a-tooltip，否则悬停没有任何功能说明（与上面「测试」按钮一致） -->
            <a-tooltip :title="t('common.edit')">
              <a-button size="small" type="text" @click="openEditDialog(record)">
                <EditOutlined />
              </a-button>
            </a-tooltip>
            <a-tooltip :title="t('common.remove')">
              <a-button size="small" type="primary" danger @click="confirmDelete(record)">
                <DeleteOutlined />
              </a-button>
            </a-tooltip>
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
          <!-- 存的是毫秒（axios 直接吃这个值），界面按秒给，与 SetBase/SocialInformationWindow 同一做法。
               原来这里把毫秒值直接绑在标着「秒」的框里：用户照字面填 30 就变成 30 毫秒，
               每次请求必超时，而且失败提示看着像服务器坏了。 -->
          <a-input-number
            :value="(editingConfig.timeout ?? 5000) / 1000"
            :min="1"
            :max="600"
            :step="1"
            style="width: 160px"
            @change="(v: any) => (editingConfig.timeout = Math.round((v ?? 5) * 1000))"
          />
        </a-form-item>

        <a-form-item :label="t('common.enable')">
          <a-switch v-model:checked="editingConfig.enabled" size="small" />
        </a-form-item>

        <!-- 连通性测试：上游 Editor.vue 里由 ConnectCheckButton 承担，这里补回同一能力 -->
        <ConnectCheckButton :check-fn="checkConnect" :reset-timeout="3000" />
      </a-form>
    </a-modal>
  </div>
</template>

<style scoped>
.manager-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.manager-title {
  margin: 0;
  font-size: 14px;
}

.manager-desc {
  margin-bottom: 8px;
}

.mb-2 {
  margin-bottom: 8px;
}

.ms-name {
  font-weight: 600;
}
</style>
