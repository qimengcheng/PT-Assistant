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
import NavButton from "@/options/components/NavButton.vue";

const showDialog = defineModel<boolean>();
const { siteId } = defineProps<{
  siteId: TSiteID | null;
}>();
const { t } = useI18n();

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
}

const siteHistoryData = shallowRef<IShowUserInfo[]>([]);
const tableHeader = [
  { title: t("common.date"), key: "date", align: "center" },
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

/** 嵌套 key 取值 + 通用比较器（antd 受控排序必须有 compare，`sorter: true` 会被静默跳过） */
function getByPath(row: any, path: string): any {
  return path.split(".").reduce<any>((acc, k) => (acc == null ? acc : acc[k]), row);
}
function makeSorter(path: string) {
  return (a: IShowUserInfo, b: IShowUserInfo): number => {
    const ra = getByPath(a, path);
    const rb = getByPath(b, path);
    const na = typeof ra === "number" ? ra : Number.parseFloat(ra);
    const nb = typeof rb === "number" ? rb : Number.parseFloat(rb);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    return String(ra ?? "").localeCompare(String(rb ?? ""), "zh-CN");
  };
}

const tableColumns = computed<TableColumnsType<IShowUserInfo>>(() =>
  tableHeader.map((header) => ({
    key: header.key,
    dataIndex: header.key.split("."),
    align: header.align,
    width: header.width,
    sorter: header.sortable === false ? false : makeSorter(header.key),
    // 原 :sort-by="[{ key: 'date', order: 'desc' }]" 是初始排序，
    // 用 defaultSortOrder（非受控的 sortOrder）才能保持表头仍可点击切换
    defaultSortOrder: header.key === "date" ? ("descend" as const) : null,
  })),
);

// 对应 v-data-table 的 show-select + item-value="date"
const tableRowSelection = computed(() => ({
  selectedRowKeys: tableSelected.value,
  onChange: (keys: (string | number)[]) => {
    tableSelected.value = keys.map(String);
  },
  // 对应 v-data-table 的 item-selectable="_selectable"
  getCheckboxProps: (record: IShowUserInfo) => ({ disabled: !(record as any)._selectable }),
}));

function deleteSiteUserInfo(date: string[]) {
  if (confirm(t("MyData.HistoryDataView.deleteConfirm"))) {
    sendMessage("removeSiteUserInfo", {
      siteId: siteId!,
      date: date.filter((d) => d != currentDate), // 不允许移除当天的数据
    }).then(() => {
      loadSiteHistoryData(siteId!).then((data) => {
        siteHistoryData.value = data;
        tableSelected.value = [];
      });
    });
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
  <a-modal
    v-model:open="showDialog"
    :width="1200"
    :footer="null"
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
          <NavButton
            :disabled="tableSelected.length <= 0"
            :icon="DeleteOutlined"
            :text="t('common.remove')"
            @click="deleteSiteUserInfo(tableSelected)"
          />
          <NavButton :icon="ExportOutlined" :text="t('common.export')" @click="exportSiteHistoryData" />
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
