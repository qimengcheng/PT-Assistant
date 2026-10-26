<script setup lang="ts">
/**
 * 图床设置：给「转种」用的一批图片托管服务。
 *
 * 为什么单独一页而不是塞进基础设置：这一页是**连接信息**（地址 + 凭证 + 长尾参数），
 * 与备份服务器 / 下载器同一族，都要能加多个、单独启用停用、单独测试连通性。
 * 基础设置那一页只管界面偏好，混进去会把两件事搅在一起。
 */
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { TableColumnsType } from "@zboson/ui";
import { DeleteOutlined, EditOutlined, MinusOutlined, PlusOutlined, ThunderboltOutlined } from "@zboson/icons";

import type { IImageHostMetadata } from "@/shared/imageHost/types.ts";
import { getImageHostPreset } from "@/shared/imageHost/providers.ts";
import { sendMessage } from "@/messages.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";

import DeleteDialog from "@/options/components/DeleteDialog.vue";
import EditorDialog from "./EditorDialog.vue";

const { t } = useI18n();
const metadataStore = useMetadataStore();

const showEditor = ref(false);
const editingId = ref<string | null>(null);
const showDelete = ref(false);
const toDeleteIds = ref<string[]>([]);
const searchKey = ref("");
const selectedIds = ref<string[]>([]);

/** 每行的测试状态：`id` → 正在测 / 上次结论 */
const testingId = ref<string>("");
const testResults = ref<Record<string, { ok: boolean; text: string; url?: string }>>({});

/** 表格行 = 配置本身 + 这一行要显示的状态文案（测试结论优先，其次上次失败原因） */
interface IHostRow extends IImageHostMetadata {
  status?: { ok: boolean; text: string; url?: string };
}

const columns = computed<TableColumnsType<IHostRow>>(() => [
  { title: t("common.type"), key: "type", dataIndex: "type", align: "center", width: 150 },
  { title: t("common.name"), key: "name", dataIndex: "name", align: "start" },
  { title: t("SetImageHost.column.endpoint"), key: "endpoint", dataIndex: "endpoint", align: "start" },
  { title: t("common.enable"), key: "enabled", dataIndex: "enabled", align: "center", width: 80 },
  { title: t("common.action"), key: "action", align: "center", width: 136 },
]);

const hosts = computed<IImageHostMetadata[]>(() => {
  const keyword = searchKey.value.trim().toLowerCase();
  const all = metadataStore.getImageHosts;
  if (keyword === "") return all;
  return all.filter(
    (host) => host.name.toLowerCase().includes(keyword) || host.type.toLowerCase().includes(keyword),
  );
});

/**
 * 状态在表格外算好再塞进行里。
 *
 * 模板里现算会变成「同一个 id 在四处各查一遍 + 三处非空断言」，
 * 而 `record.status!` 这种写法在模板类型检查下最容易出问题（也是死代码的温床）。
 */
const rows = computed<IHostRow[]>(() =>
  hosts.value.map((host) => {
    const tested = testResults.value[host.id];
    if (tested) return { ...host, status: tested };
    if (host.lastError) return { ...host, status: { ok: false, text: host.lastError } };
    return { ...host };
  }),
);

const rowSelection = computed(() => ({
  selectedRowKeys: selectedIds.value,
  onChange: (keys: (string | number)[]) => {
    selectedIds.value = keys.map(String);
  },
}));

function typeName(type: string): string {
  return getImageHostPreset(type as IImageHostMetadata["type"])?.name ?? type;
}

function endpointOf(host: IImageHostMetadata): string {
  const preset = getImageHostPreset(host.type);
  if (preset?.needEndpoint) return host.endpoint || t("SetImageHost.notSet");
  return t("SetImageHost.builtinEndpoint");
}

function openAdd() {
  editingId.value = null;
  showEditor.value = true;
}

function openEdit(id: string) {
  editingId.value = id;
  showEditor.value = true;
}

async function testHost(host: IHostRow) {
  testingId.value = host.id;
  try {
    const result = await sendMessage("testImageHost", host.id);
    testResults.value[host.id] = { ok: result.ok, text: result.message, url: result.url };
    // 上次的失败原因留在配置里，设置页一进就能看到上次为什么没成。
    // 落盘前必须把行上的 `status` 摘掉 —— 它是渲染用的派生字段，写进存档会变成脏数据。
    const { status: _status, ...config } = host;
    await metadataStore.saveImageHost({
      ...config,
      lastUploadAt: result.ok ? Date.now() : config.lastUploadAt,
      lastError: result.ok ? undefined : result.message,
    });
  } catch (e) {
    testResults.value[host.id] = { ok: false, text: e instanceof Error ? e.message : String(e) };
  } finally {
    testingId.value = "";
  }
}

function askDelete(ids: string[]) {
  toDeleteIds.value = ids;
  showDelete.value = true;
}

async function confirmDelete(id: string) {
  await metadataStore.removeImageHost(id);
}
</script>

<template>
  <div class="page">
    <a-flex align="center" gap="small" wrap justify="space-between" class="page-bar">
      <a-flex align="center" gap="small" wrap>
        <a-button type="primary" @click="openAdd">
          <template #icon><PlusOutlined /></template>
          <span>{{ t("common.btn.add") }}</span>
        </a-button>
        <a-button type="primary" danger :disabled="selectedIds.length === 0" @click="askDelete(selectedIds)">
          <template #icon><MinusOutlined /></template>
          <span>{{ t("common.remove") }}</span>
        </a-button>
      </a-flex>

      <a-input
        v-model:value="searchKey"
        allow-clear
        :placeholder="t('common.search')"
        class="page-bar-extra"
        style="width: 320px; max-width: 500px"
      />
    </a-flex>

    <a-alert type="info" show-icon class="form-hint" :message="t('SetImageHost.pageHint')" />

    <div class="page-panel">
      <a-table
        bordered
        size="small"
        :columns="columns"
        :data-source="rows"
        :row-key="(record: IHostRow) => record.id"
        :row-selection="rowSelection"
        :pagination="false"
        :locale="{ emptyText: t('SetImageHost.empty') }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'type'">
            <a-tag>{{ typeName(record.type) }}</a-tag>
          </template>

          <template v-else-if="column.key === 'name'">
            <div class="host-name">{{ record.name }}</div>
            <div v-if="record.status" class="host-test" :class="{ 'is-error': !record.status.ok }">
              <a v-if="record.status.url" :href="record.status.url" target="_blank" rel="noreferrer">
                {{ record.status.text }}
              </a>
              <span v-else>{{ record.status.text }}</span>
            </div>
          </template>

          <template v-else-if="column.key === 'endpoint'">
            <span class="text-break">{{ endpointOf(record) }}</span>
          </template>

          <template v-else-if="column.key === 'enabled'">
            <a-switch
              size="small"
              class="table-switch-btn"
              :checked="record.enabled"
              @change="(v: boolean) => metadataStore.simplePatch('imageHosts', record.id, 'enabled', !!v)"
            />
          </template>

          <template v-else-if="column.key === 'action'">
            <a-space>
              <a-tooltip :title="t('SetImageHost.action.test')">
                <a-button
                  type="text"
                  color="green"
                  size="small"
                  :loading="testingId === record.id"
                  @click="testHost(record)"
                >
                  <template #icon><ThunderboltOutlined /></template>
                </a-button>
              </a-tooltip>
              <a-tooltip :title="t('common.edit')">
                <a-button type="text" color="blue" size="small" @click="openEdit(record.id)">
                  <template #icon><EditOutlined /></template>
                </a-button>
              </a-tooltip>
              <a-tooltip :title="t('common.remove')">
                <a-button type="text" color="danger" size="small" @click="askDelete([record.id])">
                  <template #icon><DeleteOutlined /></template>
                </a-button>
              </a-tooltip>
            </a-space>
          </template>
        </template>
      </a-table>
    </div>
  </div>

  <EditorDialog v-model="showEditor" :host-id="editingId" />
  <DeleteDialog v-model="showDelete" :to-delete-ids="toDeleteIds" :confirm-delete="confirmDelete" />
</template>

<style scoped lang="scss">
.form-hint {
  margin-bottom: 12px;
}

.host-name {
  font-weight: 500;
}

.host-test {
  margin-top: 2px;
  font-size: 12px;
  color: #52c41a;
  word-break: break-all;
}

.host-test.is-error {
  color: #ff4d4f;
}

.text-break {
  word-break: break-all;
}
</style>
