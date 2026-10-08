<script setup lang="ts">
/**
 * 搜索方案管理页（antdv-next 平移）。
 * 自定义搜索方案的增删改、启用/设默、JSON 导入导出；表格首行为固定的「全部站点」自动生成方案。
 */
import { computed, ref, useTemplateRef } from "vue";
import { useI18n } from "vue-i18n";
import { cloneDeep, omit } from "es-toolkit";
import { saveAs } from "file-saver";
import { nanoid } from "nanoid";
import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  ExportOutlined,
  ImportOutlined,
  MinusOutlined,
  PlusOutlined,
  QuestionCircleOutlined,
  SearchOutlined,
  ThunderboltOutlined,
} from "@antdv-next/icons";

import { useMetadataStore } from "@/options/stores/metadata.ts";
import { usePromptInDialog } from "@/options/components/usePromptInDialog.ts";
import { useConfigStore } from "@/options/stores/config.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { formatDate } from "@/options/utils.ts";
import { isPageSizePicked, toPagination } from "@/options/components/tableSorters.ts";
import { useAutoFitPageSize } from "@/options/directives/useAutoFitPageSize.ts";
import type { ISearchSolutionMetadata, TSolutionKey } from "@/shared/types.ts";

import DeleteDialog from "@/options/components/DeleteDialog.vue";

import EditDialog from "./EditDialog.vue";
import SolutionLabel from "./SolutionLabel.vue";

const { t } = useI18n();
const configStore = useConfigStore();
const runtimeStore = useRuntimeStore();
const metadataStore = useMetadataStore();

const showEditDialog = ref(false);
const showDeleteDialog = ref(false);
const solutionId = ref<TSolutionKey>("");

const tableSelected = ref<TSolutionKey[]>([]);
const tableFilter = ref("");

function addSearchSolution() {
  editSearchSolution("");
}

function editSearchSolution(toEditSolutionId: TSolutionKey) {
  solutionId.value = toEditSolutionId;
  showEditDialog.value = true;
}

type IExportedSearchSolution = Omit<ISearchSolutionMetadata, "id" | "enabled" | "createdAt" | "isDefault" | "sort">;

/**
 * a-upload 的 beforeUpload 直接收到 File（原来是隐藏 input 的 @change，要从 e.target.files 里捞）。
 * 返回 false 表示不发请求；多选时每个文件回调一次，重复选同一文件由 a-upload 内部重置 input.value。
 */
function importSearchSolution(file: File) {
  const r = new FileReader();
  r.onload = (ev: any) => {
    try {
      const result = JSON.parse(ev.target.result) as IExportedSearchSolution[];
      for (const solution of result) {
        const importSolution = solution as ISearchSolutionMetadata;

        if (importSolution.solutions && importSolution.solutions.length > 0) {
          // 补全导出时移除的字段
          importSolution.id = nanoid();
          importSolution.enabled = false;
          importSolution.createdAt = +new Date();
          importSolution.isDefault = false;
          importSolution.sort = 1;

          metadataStore.addSearchSolution(importSolution);
        }
      }
    } catch {
      runtimeStore.showSnakebar("Invalid JSON format when import search solution", { color: "error" });
    }
  };
  r.onerror = () => {
    runtimeStore.showSnakebar("Invalid JSON format when load import file", { color: "error" });
  };
  r.readAsText(file);
  return false;
}

function exportSearchSolutions(solutionIds: TSolutionKey[]) {
  const exportedSolutions: IExportedSearchSolution[] = [];
  for (const id of solutionIds) {
    exportedSolutions.push(
      omit(metadataStore.solutions[id], ["id", "enabled", "createdAt", "isDefault", "sort"]),
    );
  }

  if (exportedSolutions.length > 0) {
    const exportedSolutionBlob = new Blob([JSON.stringify(exportedSolutions)], { type: "application/json" });
    saveAs(exportedSolutionBlob, `search-solutions-export-${formatDate(new Date(), "yyyyMMdd'T'HHmm")}.json`);
  } else {
    runtimeStore.showSnakebar("No solutions to export", { color: "error" });
  }
}

const toDeleteIds = ref<TSolutionKey[]>([]);
function deleteSearchSolutions(ids: TSolutionKey[]) {
  toDeleteIds.value = ids;
  showDeleteDialog.value = true;
}

async function confirmDeleteSearchSolution(id: TSolutionKey) {
  return await metadataStore.removeSearchSolution(id);
}

function simplePatchSearchSolution(id: TSolutionKey, value: boolean) {
  metadataStore.solutions[id].enabled = value;
  metadataStore.$save();
}

function setDefaultSearchSolution(toDefault: boolean, id: TSolutionKey) {
  if (toDefault) {
    metadataStore.defaultSolutionId = id;
    for (const solutionKey of Object.keys(metadataStore.solutions)) {
      metadataStore.solutions[solutionKey].isDefault = solutionKey === id;
    }
  } else {
    metadataStore.defaultSolutionId = "default";
    metadataStore.solutions[id].isDefault = false;
  }

  metadataStore.$save();
}

const isAllSolutionDefault = computed(() => metadataStore.defaultSolutionId === "default");

async function copySearchSolution(id: TSolutionKey) {
  const toCopy = await metadataStore.getSearchSolution(id);
  if (!toCopy) return;

  const copied = cloneDeep(toCopy);
  // 重置部分字段
  copied.id = nanoid();
  copied.createdAt = Date.now();
  copied.isDefault = false;
  for (const solution1 of copied.solutions) {
    const oldId = solution1.id;
    if (oldId !== "default") {
      const newId = nanoid();
      solution1.id = newId;
      solution1.searchEntries[newId] = solution1.searchEntries[oldId];
      delete solution1.searchEntries[oldId];
    }
  }

  /**
 * MV3 扩展页面禁用原生对话框：prompt() 会**静默返回 null**，
 * 于是「复制搜索方案」点下去什么都没发生。改走 antdv App 上下文的 modal。
 */
const { promptInDialog } = usePromptInDialog();

const newSearchSolutionName = await promptInDialog(
    t("SetSearchSolution.newSolutionNamePrompt"),
    `Copy of ${copied.name ?? copied.id}`,
  );
  if (newSearchSolutionName) {
    copied.name = newSearchSolutionName;
    await metadataStore.addSearchSolution(copied);
  }
}

// ===== 表格 =====
const ALL_DEFAULT_ID = "__pt_all_default__";

interface IAllDefaultRow {
  id: typeof ALL_DEFAULT_ID;
  name: string;
  sort: number;
  enabled: boolean;
  isDefault: boolean;
  solutions: [];
  __allDefault: true;
}

const allDefaultRow = computed<IAllDefaultRow>(() => ({
  id: ALL_DEFAULT_ID,
  name: t("layout.header.searchPlan.all"),
  sort: 0,
  enabled: false,
  isDefault: isAllSolutionDefault.value,
  solutions: [],
  __allDefault: true,
}));

const tableData = computed<Array<ISearchSolutionMetadata | IAllDefaultRow>>(() => {
  const kw = tableFilter.value.trim().toLowerCase();
  const rows = metadataStore.getSearchSolutions
    .filter((s) => !kw || (s.name ?? "").toLowerCase().includes(kw))
    .sort((a, b) => Number(b.enabled) - Number(a.enabled) || b.sort - a.sort);
  return [allDefaultRow.value, ...rows];
});

// computed：title 里有 t()，setup 里一次性求值的话切语言不会重算
const columns = computed(() => [
  { title: "№", dataIndex: "sort", width: 80, align: "center" as const },
  { title: t("common.name"), dataIndex: "name", width: 150 },
  { title: t("SetSearchSolution.solution"), key: "solution" },
  { title: t("SetSearchSolution.table.enable"), key: "enabled", width: 100, align: "center" as const },
  { title: t("SetSearchSolution.table.default"), key: "isDefault", width: 100, align: "center" as const },
  { title: t("common.action"), key: "action", width: 180, align: "center" as const },
]);

// 每页条数按面板实高算（用户 2026-10-08：「既不能出现滚动条又要把页面铺满」）
const pagePanel = useTemplateRef<HTMLDivElement>("pagePanel");
/** 他挑过一档之后，实测条数就不再管这一页 */
const pickedSize = computed(() => {
  const behavior = configStore.tableBehavior.SetSearchSolution;
  return isPageSizePicked(behavior?.itemsPerPage, 10, (behavior as any)?.pageSizePicked);
});
const { fitted: fitPageSize } = useAutoFitPageSize({
  container: () => pagePanel.value,
  rows: () => tableData.value,
  enabled: () => !pickedSize.value,
});

const pagination = computed(() =>
  // 走 toPagination 拿 -1/0 兜底：旧版 Vuetify 用 -1 表示「不分页」，这个约定被搬进了
  // config 默认值，而 antd Table 是前端分页，pageSize=-1 会让 slice(0,-1) 吃掉最后一行、
  // 页数算成负数（SetSite 已经踩过同一个坑）。
  // 另外不能写 current:1 —— 受控值写死会锁死在第 1 页，页码交给 a-table 内部管理。
  toPagination(configStore.tableBehavior.SetSearchSolution.itemsPerPage, 10, {
    showTotal: (total: number) => t("common.totalItems", { total }),
    // 一页放得下就不出分页条（用户 2026-10-07：条数少的时候不要启用分页）
    totalRows: tableData.value.length,
    fitSize: fitPageSize.value,
    picked: pickedSize.value,
  }),
);

function onTableChange(pag: any) {
  // 只有「报回来的档 ≠ 界面上正在显示的那一档」才算他改了尺寸：翻页与排序也带着当前档回来
  const displayed = pagination.value === false ? 0 : pagination.value?.pageSize ?? 0;
  if (pag.pageSize && displayed && pag.pageSize !== displayed) {
    configStore.updateTableBehavior("SetSearchSolution", "itemsPerPage", pag.pageSize);
    // 挑档 = 明确意图，从此不再被实测条数盖掉
    configStore.updateTableBehavior("SetSearchSolution", "pageSizePicked", true);
  }
}

function isAllDefaultRow(record: any): record is IAllDefaultRow {
  return record?.__allDefault === true;
}
</script>

<template>
  <!-- 顶部那条 a-alert 只是页标题（左侧导航已经标出当前页），去掉了。
       外壳也不再是 a-card：卡片头的垂直 padding 实测是 0，size="small" 下头高只有 38px，
       按钮整条贴到窗口顶。现在用 .page 骨架：48px 工具条一行 + 白底面板一行（见 style.css）。 -->
  <div class="page">
    <a-flex align="center" gap="small" wrap justify="space-between" class="page-bar">
      <a-flex align="center" gap="small" wrap>
        <a-button type="primary" @click="addSearchSolution"><template #icon><PlusOutlined /></template><span>{{ t('common.btn.add') }}</span></a-button>

        <a-button type="primary" danger :disabled="tableSelected.length === 0" @click="deleteSearchSolutions(tableSelected)"><template #icon><MinusOutlined /></template><span>{{ t('common.remove') }}</span></a-button>

        <a-upload accept="application/json" multiple :show-upload-list="false" :before-upload="importSearchSolution">
          <a-button><template #icon><ImportOutlined /></template><span>{{ t('common.import') }}</span></a-button>
        </a-upload>
        <a-button :disabled="tableSelected.length === 0" @click="() => exportSearchSolutions(tableSelected)"><template #icon><ExportOutlined /></template><span>{{ t('common.export') }}</span></a-button>

        <a-button disabled><template #icon><QuestionCircleOutlined /></template><span>{{ t('common.howToUse') }}</span></a-button>
      </a-flex>

      <!-- 搜索框靠右：.page-bar-extra 负责 margin-left:auto，
           原来是 .toolbar > .toolbar-right 两层 flex 容器靠 margin-left:auto 推到最右。 -->
      <a-input
        v-model:value="tableFilter"
        allow-clear
        :placeholder="t('common.search')"
        class="page-bar-extra"
        style="width: 240px"
      >
        <template #prefix><SearchOutlined /></template>
      </a-input>
    </a-flex>

    <!-- 面板只负责给表格一块白底表面并接管内部滚动 -->
    <div ref="pagePanel" class="page-panel">
      <a-table
        bordered
        :columns="columns"
        :data-source="tableData"
        :pagination="pagination"
        :row-selection="{
          selectedRowKeys: tableSelected,
          onChange: (keys: any[]) => (tableSelected = keys as TSolutionKey[]),
          getCheckboxProps: (record: any) => ({ disabled: isAllDefaultRow(record) }),
        }"
        row-key="id"
        @change="onTableChange"
      >
        <template #bodyCell="{ column, record }">
          <!-- 固定的「全部站点」自动生成方案行 -->
          <template v-if="isAllDefaultRow(record)">
            <template v-if="column.key === 'solution'">
              <a-tag color="blue">
                <ThunderboltOutlined />
                {{ t("SetSearchSolution.table.autoGenerate") }}
              </a-tag>
            </template>
            <template v-else-if="column.key === 'enabled'">
              <a-switch disabled :checked="false" size="small" />
            </template>
            <template v-else-if="column.key === 'isDefault'">
              <a-switch disabled :checked="isAllSolutionDefault" size="small" />
            </template>
            <template v-else-if="column.key === 'action'">
              <a-tooltip :title="t('SetSearchSolution.copy')">
                <a-button type="text" size="small" @click="copySearchSolution('default')">
                  <template #icon><CopyOutlined /></template>
                </a-button>
              </a-tooltip>
            </template>
          </template>

          <!-- 普通自定义方案行 -->
          <template v-else>
            <template v-if="column.key === 'solution'">
              <SolutionLabel :closable="false" :solutions="record.solutions" />
            </template>
            <template v-else-if="column.key === 'enabled'">
              <a-switch
                :checked="record.enabled"
                size="small"
                @update:checked="(v: any) => simplePatchSearchSolution(record.id, Boolean(v))"
              />
            </template>
            <template v-else-if="column.key === 'isDefault'">
              <a-switch
                :checked="record.isDefault"
                size="small"
                @update:checked="(v: any) => setDefaultSearchSolution(Boolean(v), record.id)"
              />
            </template>
            <template v-else-if="column.key === 'action'">
              <a-space size="small">
                <a-tooltip :title="t('SetSearchSolution.copy')">
                  <a-button type="text" size="small" @click="copySearchSolution(record.id)">
                    <template #icon><CopyOutlined /></template>
                  </a-button>
                </a-tooltip>
                <a-tooltip :title="t('common.edit')">
                  <a-button type="text" size="small" @click="editSearchSolution(record.id)">
                    <template #icon><EditOutlined /></template>
                  </a-button>
                </a-tooltip>
                <a-tooltip :title="t('common.export')">
                  <a-button type="text" size="small" @click="exportSearchSolutions([record.id])">
                    <template #icon><ExportOutlined /></template>
                  </a-button>
                </a-tooltip>
                <a-tooltip :title="t('common.remove')">
                  <a-button type="primary" danger size="small" @click="deleteSearchSolutions([record.id])">
                    <template #icon><DeleteOutlined /></template>
                  </a-button>
                </a-tooltip>
              </a-space>
            </template>
          </template>
        </template>
      </a-table>
    </div>
  </div>

  <!-- 弹窗是 .page 的根级兄弟：a-modal 会 teleport 到 body，不占网格行 -->
  <EditDialog v-model="showEditDialog" :solution-id="solutionId" />
  <DeleteDialog
    v-model="showDeleteDialog"
    :to-delete-ids="toDeleteIds"
    :confirm-delete="confirmDeleteSearchSolution"
  />
</template>
