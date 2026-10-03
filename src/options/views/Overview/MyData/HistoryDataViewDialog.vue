<script setup lang="ts">
import { ref, shallowRef, computed } from "vue";
import { useI18n } from "vue-i18n";
import { saveAs } from "file-saver";
import { EResultParseStatus, type IUserInfo, type TSiteID } from "@ptd/site";
import type { TableColumnsType } from "antdv-next";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  CloseOutlined,
  DeleteOutlined,
  ExportOutlined,
  EyeOutlined,
} from "@antdv-next/icons";

import { sendMessage } from "@/messages.ts";
import { formatNumber, formatSize, formatDate } from "@/options/utils.ts";
import { formatRatio } from "./utils/format.ts";
import { loadSiteHistoryData } from "./utils/lastUserData.ts";

import SiteName from "@/options/components/SiteName.vue";
import { useConfirmDanger } from "@/options/components/useConfirmDanger.ts";
import { toTableColumns } from "@/options/components/tableSorters.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";

const showDialog = defineModel<boolean>();
const { siteId } = defineProps<{
  siteId: TSiteID | null;
}>();
const { t } = useI18n();
const runtimeStore = useRuntimeStore();

const currentDate = formatDate(+new Date(), "yyyy-MM-dd");
const jsonData = ref<any>({});

interface IShowUserInfo extends IUserInfo {
  date: string;
}

/** v-data-table DataTableHeader 的本地替身（Vuetify 已移除） */
interface ITableHeader {
  title: string;
  key: string;
  align?: "start" | "end" | "center";
  width?: number | string;
  sortable?: boolean;
  /** 非受控初始排序（仅此弹窗的 date 列用） */
  defaultSortOrder?: "ascend" | "descend";
}

const siteHistoryData = shallowRef<IShowUserInfo[]>([]);
const tableHeader = [
  {
    title: t("common.date"),
    key: "date",
    align: "center",
    // 原 :sort-by="[{ key: 'date', order: 'desc' }]" 是初始排序，
    // 用 defaultSortOrder（非受控的 sortOrder）才能保持表头仍可点击切换
    defaultSortOrder: "descend",
  },
  { title: t("common.username"), key: "name", align: "center", sortable: false },
  { title: t("MyData.table.levelName"), key: "levelName", align: "start", sortable: false },
  { title: t("MyData.table.userData"), key: "uploaded", align: "end", sortable: false },
  { title: t("levelRequirement.ratio"), key: "ratio", align: "end", sortable: false },
  { title: t("levelRequirement.seeding"), key: "seeding", align: "end", sortable: false },
  { title: t("levelRequirement.seedingSize"), key: "seedingSize", align: "end", sortable: false },
  { title: t("levelRequirement.bonus"), key: "bonus", align: "end", sortable: false },
  { title: t("common.action"), key: "action", align: "center", width: 90, sortable: false },
] as ITableHeader[];
const tableSelected = ref<string[]>([]);

/** 列生成走公共 toTableColumns（不传 sortOrderMap，保持 date 列的非受控初始排序） */
const tableColumns = computed<TableColumnsType<IShowUserInfo>>(() =>
  toTableColumns<IShowUserInfo>(tableHeader),
);

// 对应 v-data-table 的 show-select + item-value="date"
const tableRowSelection = computed(() => ({
  selectedRowKeys: tableSelected.value,
  onChange: (keys: (string | number)[]) => {
    tableSelected.value = keys.map(String);
  },
}));

/**
 * MV3 扩展页面禁用原生 confirm()（静默返回 false），
 * 所以这里必须走 App 上下文的 modal，否则「删除」按钮点了没有任何反应也不会报错。
 */
const { confirmDanger } = useConfirmDanger();

async function deleteSiteUserInfo(date: string[]) {
  if (!(await confirmDanger(t("MyData.HistoryDataView.deleteConfirm")))) {
    return;
  }

  try {
    await sendMessage("removeSiteUserInfo", {
      siteId: siteId!,
      date: date.filter((d) => d != currentDate), // 不允许移除当天的数据
    });
    siteHistoryData.value = await loadSiteHistoryData(siteId!);
    tableSelected.value = [];
  } catch (e) {
    console.error("[MyData] remove site user info failed", e);
    runtimeStore.showSnakebar(t("MyData.HistoryDataView.deleteConfirm"), { color: "error" });
  }
}

const showStoreDataDialog = ref<boolean>(false);
function viewStoreData(data: IShowUserInfo) {
  jsonData.value = data;
  showStoreDataDialog.value = true;
}

function exportSiteHistoryData() {
  let exportData = siteHistoryData.value;
  if (tableSelected.value.length > 0) {
    exportData = siteHistoryData.value.filter((item) => tableSelected.value.includes(item.date));
  }

  const exportedSolutionBlob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
  saveAs(exportedSolutionBlob, `site-history-data-${siteId}.json`); // FIXME filename
}

function afterEnter() {
  if (siteId) {
    loadSiteHistoryData(siteId!).then((data) => {
      siteHistoryData.value = data;
      tableSelected.value = [];
    });
  }
}
</script>

<template>
  <!-- footer prop 传 null 会连 #footer slot 一起吞掉（antdv-next: footer: d !== null && ...），底部按钮全消失，故不设 footer -->
  <a-modal
    v-model:open="showDialog"
    :width="1200"
    :after-close="() => (siteHistoryData = [])"
    @after-open-change="(open: boolean) => open && afterEnter()"
  >
    <template #title>
      <div class="d-flex align-center">
        <span class="flex-1-1-0">
          {{ t("MyData.HistoryDataView.title") }} @ <SiteName :site-id="siteId!" class="" tag="span" />
        </span>
        <a-button type="text" size="small" :title="t('common.dialog.close')" @click="showDialog = false">
          <CloseOutlined />
        </a-button>
      </div>
    </template>

    <a-divider class="ma-0" />

    <a-table
      :columns="tableColumns"
      :data-source="siteHistoryData"
      :row-key="(r: any) => r.date"
      :row-selection="tableRowSelection"
      :pagination="{ pageSize: 10 }"
      :scroll="{ x: 'max-content' }"
      class="table-stripe table-header-no-wrap"
      size="small"
    >
      <!-- -->
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'date'">
          <span class="text-no-wrap">{{ record.date }}</span>
        </template>

        <!-- 用户名，用户ID -->
        <template v-else-if="column.key === 'name'">
          <span :title="record.id as string" class="text-no-wrap">{{ record.name ?? "-" }}</span>
        </template>

        <!-- 等级 -->
        <template v-else-if="column.key === 'levelName'">
          <span class="text-no-wrap">{{ record.levelName ?? "-" }}</span>
        </template>

        <!-- 上传、下载 -->
        <template v-else-if="column.key === 'uploaded'">
          <div class="d-flex flex-column align-end">
            <div class="d-flex justify-end flex-nowrap">
              <span class="text-no-wrap">
                {{ typeof record.uploaded !== "undefined" ? formatSize(record.uploaded) : "-" }}
              </span>
              <ArrowUpOutlined class="cell-icon cell-icon--green" />
            </div>
            <div class="d-flex justify-end flex-nowrap">
              <span class="text-no-wrap">
                {{ typeof record.downloaded !== "undefined" ? formatSize(record.downloaded) : "-" }}
              </span>
              <ArrowDownOutlined class="cell-icon cell-icon--red" />
            </div>
          </div>
        </template>

        <!-- 分享率 -->
        <template v-else-if="column.key === 'ratio'">
          <span class="text-no-wrap">{{ formatRatio(record) }}</span>
        </template>

        <!-- 发布数 -->
        <template v-else-if="column.key === 'uploads'">
          <span class="text-no-wrap">{{ record.uploads ?? "-" }}</span>
        </template>

        <!-- 做种数 -->
        <template v-else-if="column.key === 'seeding'">
          <span class="text-no-wrap">{{ record.seeding ?? "-" }}</span>
        </template>

        <!-- 做种量 -->
        <template v-else-if="column.key === 'seedingSize'">
          <span class="text-no-wrap">
            {{ typeof record.seedingSize !== "undefined" ? formatSize(record.seedingSize) : "-" }}
          </span>
        </template>

        <!-- 魔力/积分 -->
        <template v-else-if="column.key === 'bonus'">
          <div class="d-flex flex-column align-end">
            <div class="d-flex align-center justify-end">
              <span class="text-no-wrap">{{ record.bonus ? formatNumber(record.bonus) : "-" }}</span>
            </div>
            <div class="d-flex align-center justify-end">
              <span class="text-no-wrap">{{ record.seedingBonus ? formatNumber(record.seedingBonus) : "-" }}</span>
            </div>
          </div>
        </template>

        <!-- 操作 -->
        <template v-else-if="column.key === 'action'">
          <div class="table-action">
            <!-- 查看原始记录 -->
            <a-button type="text" size="small" :title="t('MyData.HistoryDataView.action.viewRaw')" @click="viewStoreData(record)">
              <EyeOutlined />
            </a-button>

            <!-- 删除 -->
            <a-button
              type="text"
              size="small"
              danger
              :disabled="record.status == EResultParseStatus.success && record.date == currentDate"
              :title="t('common.remove')"
              @click="deleteSiteUserInfo([record.date])"
            >
              <DeleteOutlined />
            </a-button>
          </div>
        </template>
      </template>

      <template #footer>
        <div class="d-flex align-center">
          <a-button type="primary" :disabled="tableSelected.length <= 0" @click="deleteSiteUserInfo(tableSelected)"><template #icon><DeleteOutlined /></template><span class="ml-1">{{ t('common.remove') }}</span></a-button>
          <a-button type="primary" @click="exportSiteHistoryData"><template #icon><ExportOutlined /></template><span class="ml-1">{{ t('common.export') }}</span></a-button>
          <div class="flex-1-1-0" />
        </div>
      </template>
    </a-table>

    <a-modal v-model:open="showStoreDataDialog" :width="800" :footer="null">
      <pre>{{ JSON.stringify(jsonData, null, 2) }}</pre>
    </a-modal>
  </a-modal>
</template>

<style scoped lang="scss">
.cell-icon {
  font-size: 14px; /* 原 <v-icon small> */
}
.cell-icon--green {
  color: #388e3c; /* Vuetify green-darken-4 */
}
.cell-icon--red {
  color: #c62828; /* Vuetify red-darken-4 */
}
</style>
