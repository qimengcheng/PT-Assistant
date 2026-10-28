<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import type { TableColumnsType, TableRowSelection } from "@zboson/ui";
import {
  CloudUploadOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  EditOutlined,
  FilterOutlined,
  ImportOutlined,
  MinusOutlined,
  PlusOutlined,
  UnorderedListOutlined,
} from "@zboson/icons";
import { getBackupServerIcon } from "@ptd/backupServer";
import { hasBackupRetentionToApply } from "@ptd/backupServer/utils.ts";

import { useConfigStore } from "@/options/stores/config.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { formatDate } from "@/options/utils.ts";
import { BackupFields, type IBackupServerMetadata, type TBackupServerKey } from "@/shared/types.ts";
import { sendMessage } from "@/messages.ts";

import DeleteDialog from "@/options/components/DeleteDialog.vue";
import HoverTip from "@/options/components/HoverTip.vue";
import AddDialog from "./AddDialog.vue";
import BackupSettings from "./BackupSettings.vue";
import EditDialog from "./EditDialog.vue";
import LocalExportConfirmDialog from "./LocalExportConfirmDialog.vue";
import HistoryDialog from "./HistoryDialog.vue";
import RestoreDialog from "./RestoreDialog.vue";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const runtimeStore = useRuntimeStore();
const metadataStore = useMetadataStore();
const configStore = useConfigStore();

/**
 * 顶部那块「备份设置」的展开状态。
 *
 * 默认收起：这一页天天来的是那份服务器列表，密钥与总闸配一次就不动了。
 * 但从恢复流程跳进来时（`?panel=settings`，RestoreDialog 的「去配置密钥」）必须直接展开 ——
 * 那次跳转的目的就是改密钥，落地看到一条收起的标题等于没跳。
 */
const settingsActiveKey = ref<string[]>(route.query.panel === "settings" ? ["settings"] : []);

/**
 * 同一个 path 只变 query **不会重挂组件**，所以上面那个初始值只管第一次进来；
 * 人已经站在本页时再点一次「去配置密钥」要靠这里接住。
 *
 * 展开之后顺手把标记从地址栏抹掉，否则第二次点过来 query 还是那个值、watch 不触发，
 * 面板会静悄悄地不展开 —— 而这一次点击的意图明明就是「把密钥给我打开」。
 */
function applySettingsPanelQuery() {
  if (route.query.panel !== "settings") return;
  settingsActiveKey.value = ["settings"];
  void router.replace({ query: {} });
}
watch(() => route.query.panel, applySettingsPanelQuery);
onMounted(applySettingsPanelQuery);

/**
 * 折叠标题右侧那行状态。**就绪前不显示**：`configStore` 是异步水合的，
 * 冷启动那一刻读到的是初始值 `false`，照它渲染就是先给人看一句「自动备份：已关闭」，
 * 而用户其实开着 —— 与密钥输入框空着是同一个坑（见 BackupSettings.vue 顶部那段）。
 */
const configReady = ref<boolean>(false);
configStore.$onReady(() => {
  configReady.value = true;
});

const showAddDialog = ref<boolean>(false);
const showLocalExportConfirmDialog = ref<boolean>(false);
const showHistoryDialog = ref<boolean>(false);
const showEditDialog = ref<boolean>(false);
const showRestoreDialog = ref<boolean>(false);
const showDeleteDialog = ref<boolean>(false);

// antd 的列定义：title / dataIndex / key / align（不再用 vuetify 的 DataTableHeader）
// computed：title 里有 t()，setup 里一次性求值的话切语言不会重算
const fullTableHeader = computed<TableColumnsType<IBackupServerMetadata>>(() => [
  { title: t("common.type"), key: "type", dataIndex: "type", align: "center" },
  { title: t("common.name"), key: "name", dataIndex: "name", align: "start" },
  { title: t("SetBackup.table.backupFields"), key: "backupFields", dataIndex: "backupFields", align: "start" },
  { title: t("SetBackup.table.backupInterval"), key: "backupInterval", dataIndex: "backupInterval", align: "center" },
  { title: t("SetBackup.table.retention"), key: "retention", dataIndex: "retention", align: "center" },
  { title: t("SetBackup.table.lastBackupAt"), key: "lastBackupAt", dataIndex: "lastBackupAt", align: "end" },
  { title: t("common.enable"), key: "enabled", dataIndex: "enabled", align: "center" },
  // width：四颗 small 纯图标键（立即备份 / 历史 / 编辑 / 删除）→ 4×24 + a-space 缝 3×8 + 单元格内衬 8+8 = 136
  { title: t("common.action"), key: "action", align: "center", width: 136 },
]);

const tableSelected = ref<TBackupServerKey[]>([]);

/** 工具栏搜索：按名称 / 类型过滤备份服务器（原来输入框没绑任何东西，是死控件） */
const searchKey = ref<string>("");
const filteredBackupServers = computed<IBackupServerMetadata[]>(() => {
  const kw = searchKey.value.trim().toLowerCase();
  if (!kw) return metadataStore.getBackupServers;
  return metadataStore.getBackupServers.filter(
    (server) =>
      (server.name ?? "").toLowerCase().includes(kw) || (server.type ?? "").toLowerCase().includes(kw),
  );
});
/** a-table 没有 v-model:selectedRowKeys，行选择要显式给 row-selection */
const rowSelection = computed<TableRowSelection<IBackupServerMetadata>>(() => ({
  selectedRowKeys: tableSelected.value,
  onChange: (keys) => {
    tableSelected.value = keys.map(String);
  },
}));

/** 自动备份间隔（小时），支持小数以表达不足 1 小时的间隔 */
function formatBackupInterval(serverConfig: IBackupServerMetadata): string {
  const interval = serverConfig.backupInterval ?? 0;
  if (!(interval > 0)) {
    return "";
  }
  return t("SetBackup.table.everyNHour", { n: Number(interval.toFixed(2)) });
}

const localBackup = Symbol("localBackup");
const doBackupStatus = ref<Record<TBackupServerKey | symbol, boolean>>({});
async function doBackup(backupServerId: TBackupServerKey | symbol) {
  doBackupStatus.value[backupServerId] = true;

  // ⚠️ 必须 try/catch/finally：
  // exportBackupData 抛错（网络不可达 / 备份服务器鉴权失败 / S3 配置错误）时，
  // 原来没有任何 catch，异常直接逃出去，结尾的复位语句永远不会执行 ——
  // 那个备份服务器的按钮会永远转圈，用户只能刷新页面。
  try {
    await runBackup(backupServerId);
  } catch (e) {
    console.error("[SetBackup] 执行备份失败", backupServerId, e);
    runtimeStore.showSnakebar(t("SetBackup.snackbar.failure"), { color: "error" });
  } finally {
    doBackupStatus.value[backupServerId] = false;
  }
}

async function runBackup(backupServerId: TBackupServerKey | symbol) {
  if (typeof backupServerId == "string") {
    const serverConfig = metadataStore.backupServers[backupServerId];
    const backupFields = serverConfig.backupFields ?? [...BackupFields];
    const backupStatus = await sendMessage("exportBackupData", { backupFields, backupServerId });
    if (backupStatus) {
      // 备份成功后的保留策略清理由 exportBackupData 内部完成，此处仅对启用了保留策略的服务器加以提示
      const hasRetention = hasBackupRetentionToApply(serverConfig?.retention);
      runtimeStore.showSnakebar(
        t(hasRetention ? "SetBackup.snackbar.successWithRetention" : "SetBackup.snackbar.success"),
        {
          color: "success",
        },
      );
    } else {
      runtimeStore.showSnakebar(t("SetBackup.snackbar.failure"), { color: "error" });
    }
  } else if (backupServerId == localBackup) {
    showLocalExportConfirmDialog.value = true;
  }
}

const toEditBackupServerId = ref<TBackupServerKey | null>(null);
function editBackupServer(id: TBackupServerKey) {
  toEditBackupServerId.value = id;
  showEditDialog.value = true;
}

const toShowHistoryBackupServerId = ref<TBackupServerKey | null>(null);
function showHistory(id: TBackupServerKey) {
  toShowHistoryBackupServerId.value = id;
  showHistoryDialog.value = true;
}

const toDeleteIds = ref<TBackupServerKey[]>([]);
function deleteBackupServer(ids: TBackupServerKey[]) {
  toDeleteIds.value = ids;
  showDeleteDialog.value = true;
}

async function confirmDeleteBackupServer(id: TBackupServerKey) {
  return await metadataStore.removeBackupServer(id);
}
</script>

<template>
  <!-- 顶部那条 a-alert 只是页标题（左侧导航已经标出当前页），去掉了。
       骨架见 style.css 的 .page / .page-bar / .page-bar-extra / .page-panel。 -->
  <div class="page">
    <a-flex align="center" gap="small" wrap justify="space-between" class="page-bar">
      <a-flex align="center" gap="small" wrap>
        <a-button type="primary" @click="showAddDialog = true"><template #icon><PlusOutlined /></template><span>{{ t('common.btn.add') }}</span></a-button>
        <a-button type="primary" danger :disabled="tableSelected.length === 0" @click="deleteBackupServer(tableSelected)"><template #icon><MinusOutlined /></template><span>{{ t('common.remove') }}</span></a-button>

        <div class="toolbar-divider" />

        <a-button :loading="doBackupStatus[localBackup]" @click="doBackup(localBackup)"><template #icon><DatabaseOutlined /></template><span>{{ t('SetBackup.localExport') }}</span></a-button>
        <a-button @click="() => (showRestoreDialog = true)"><template #icon><ImportOutlined /></template><span>{{ t('SetBackup.localImport') }}</span></a-button>
      </a-flex>

      <a-input
        v-model:value="searchKey"
        allow-clear
        :placeholder="t('common.search')"
        class="page-bar-extra"
        style="width: 320px; max-width: 500px"
      />
    </a-flex>

    <div class="page-panel">
    <!-- 备份设置（自动备份总闸 / 加密密钥 / 旧数据导入）与下面那份服务器列表是同一条链上的：
         配服务器 → 设间隔 → 到点发送 → 出事时用密钥恢复。v0.121.0 之前密钥那一块在
         「基础设置」里，而恢复失败最常见的原因就是「密钥在那边、包在这边」，所以并到同一屏。
         收起是默认态：这一页天天来的是列表，这一块配一次就不动了。
         `force-render` 不能去掉：面板懒渲染的话，BackupSettings 里那条 `$onReady` 水合修复
         要等用户展开才注册，而输入框已经带着空串画出来过一次了（原注释见该文件顶部）。 -->
    <a-collapse v-model:active-key="settingsActiveKey" ghost class="settings-collapse">
      <a-collapse-panel key="settings" :header="t('SetBackup.settingsTitle')" force-render>
        <template #extra>
          <span v-if="configReady" class="settings-summary">
            {{
              configStore.backup.enabledAutoBackup
                ? t("SetBackup.settingsSummaryOn")
                : t("SetBackup.settingsSummaryOff")
            }}
          </span>
        </template>
        <BackupSettings />
      </a-collapse-panel>
    </a-collapse>

    <div class="server-list-title">{{ t("SetBackup.serverListTitle") }}</div>

    <!-- 全站口径是「列表页的 a-table 一律带 bordered」（AGENTS.md §3.4，用户 2026-10-06 定的）。
         v0.96.1 曾把这张的 bordered 删掉，那是**删错了对象**：用户 2026-10-13 那张截图点的是
         「添加备份服务器」弹窗（`Editor.vue`，里面是 a-form + 5 处 a-divider，压根没有 a-table），
         不是弹窗后面这张列表。这里按他 2026-10-13 的「把不该删的删回去」恢复。 -->
    <a-table
      bordered
      :columns="fullTableHeader"
      :data-source="filteredBackupServers"
      :row-key="(record: IBackupServerMetadata) => record.id"
      :row-selection="rowSelection"
      :pagination="false"
      class="table-header-no-wrap"
      size="small"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'type'">
          <HoverTip :text="record.type">
            <img class="server-type-icon" :src="getBackupServerIcon(record.type)" :alt="record.type" />
          </HoverTip>
        </template>

        <template v-else-if="column.key === 'backupFields'">
          <a-tag v-for="backupField in record.backupFields" :key="backupField" class="mr-1 mb-1">
            {{ t(`SetBackup.fields.${backupField}`) }}
          </a-tag>
        </template>

        <template v-else-if="column.key === 'backupInterval'">
          <span v-if="record.backupInterval && record.backupInterval > 0" class="text-no-wrap">
            {{ formatBackupInterval(record) }}
          </span>
          <span v-else class="text-disabled">—</span>
        </template>

        <template v-else-if="column.key === 'retention'">
          <HoverTip
            :text="
              hasBackupRetentionToApply(record.retention)
                ? t('SetBackup.table.retentionEnabled')
                : t('SetBackup.table.retentionDisabled')
            "
          >
            <FilterOutlined
              class="retention-icon"
              :style="{ color: hasBackupRetentionToApply(record.retention) ? '#429e15' : undefined }"
            />
          </HoverTip>
        </template>

        <template v-else-if="column.key === 'lastBackupAt'">
          {{ record.lastBackupAt ? formatDate(record.lastBackupAt) : t("SetBackup.table.notBackup") }}
        </template>

        <template v-else-if="column.key === 'enabled'">
          <a-switch
            size="small"
            class="table-switch-btn"
            :checked="record.enabled"
            @change="(v: any) => metadataStore.simplePatch('backupServers', record.id, 'enabled', !!v)"
          />
        </template>

        <template v-else-if="column.key === 'action'">
          <a-space>
            <a-tooltip :title="t('SetBackup.table.action.backupNow')">
              <a-button
                type="text"
                color="green"
                size="small"
                :loading="doBackupStatus[record.id]"
                @click="doBackup(record.id)"
              >
                <template #icon>
                  <CloudUploadOutlined />
                </template>
              </a-button>
            </a-tooltip>

            <a-tooltip :title="t('SetBackup.table.action.viewHistoryBackup')">
              <a-button
                type="text"
                color="blue"
                size="small"
                @click="showHistory(record.id)"
              >
                <template #icon>
                  <UnorderedListOutlined />
                </template>
              </a-button>
            </a-tooltip>

            <a-tooltip :title="t('common.edit')">
              <a-button
                type="text"
                color="blue"
                size="small"
                @click="editBackupServer(record.id)"
              >
                <template #icon>
                  <EditOutlined />
                </template>
              </a-button>
            </a-tooltip>

            <a-tooltip :title="t('common.remove')">
              <a-button
                type="text"
                color="danger"
                size="small"
                @click="deleteBackupServer([record.id])"
              >
                <template #icon>
                  <DeleteOutlined />
                </template>
              </a-button>
            </a-tooltip>
          </a-space>
        </template>
      </template>
    </a-table>
    </div>
  </div>

  <AddDialog v-model="showAddDialog" />
  <EditDialog v-model="showEditDialog" :client-id="toEditBackupServerId!" />
  <DeleteDialog v-model="showDeleteDialog" :to-delete-ids="toDeleteIds" :confirm-delete="confirmDeleteBackupServer" />
  <HistoryDialog v-model="showHistoryDialog" :backup-server-id="toShowHistoryBackupServerId!" />
  <LocalExportConfirmDialog v-model="showLocalExportConfirmDialog" />
  <RestoreDialog v-model="showRestoreDialog" :restore-metadata="{ type: 'file' }" />
</template>

<style scoped lang="scss">
/* 顶部那块「备份设置」：一条下分隔线与服务器列表断开，收起时只占一行标题 */
.settings-collapse {
  margin-bottom: 6px;
  border-bottom: 1px solid var(--pt-color-border-light);
}

.settings-collapse :deep(.ant-collapse-header) {
  padding-inline: 4px;
}

/* 折叠标题右侧那行状态：只有「自动备份开着还是关着」一位信息，够判断要不要展开 */
.settings-summary {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
}

/* 列表小标题：上面多了一块设置之后，不给这张表起个名字就分不清上半屏下半屏各是什么 */
.server-list-title {
  margin: 4px 0 8px;
  font-size: 13px;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.88);
}

/* 竖向分隔线（原来是 <v-divider inset vertical>） */
.toolbar-divider {
  width: 1px;
  height: 24px;
  margin: 0 4px;
  background: rgba(0, 0, 0, 0.15);
}

.server-type-icon {
  width: 24px;
  height: 24px;
}

.retention-icon {
  font-size: 16px;
  color: rgba(0, 0, 0, 0.25);
}
</style>