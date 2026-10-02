<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  AimOutlined,
  DeleteOutlined,
  EditOutlined,
  ExportOutlined,
  FilterOutlined,
  MinusOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  ToolOutlined,
} from "@antdv-next/icons";
import type { TableColumnsType, TablePaginationConfig, TableSorterResult } from "antdv-next";

import type { TSiteID } from "@ptd/site";

import { sendMessage } from "@/messages.ts";
import { useConfigStore } from "@/options/stores/config.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { useTableCustomFilter } from "@/options/directives/useAdvanceFilter.ts";

import AddDialog from "./AddDialog.vue";
import EditDialog from "./EditDialog.vue";
import EditSearchEntryList from "./EditSearchEntryList.vue";
import OneClickImportDialog from "./OneClickImportDialog.vue";
import RebuildMapDialog from "./RebuildMapDialog.vue";
import SiteFavicon from "@/options/components/SiteFavicon/Index.vue";
import DeleteDialog from "@/options/components/DeleteDialog.vue";
import NavButton from "@/options/components/NavButton.vue";

// 数据来源
import { allAddedSiteInfo, type ISiteTableItem } from "./utils.ts";

const { t } = useI18n();

const configStore = useConfigStore();
const runtimeStore = useRuntimeStore();
const metadataStore = useMetadataStore();

const showAddDialog = ref<boolean>(false);
const showEditDialog = ref<boolean>(false);
const showDeleteDialog = ref<boolean>(false);
const showOneClickImportDialog = ref<boolean>(false);
const showRebuildMapDialog = ref<boolean>(false);

const booleanUserConfigKeywords = ["isOffline", "allowSearch", "allowQueryUserInfo"];

const {
  tableWaitFilterRef,
  tableFilterRef,
  tableFilterFn,
  advanceFilterDictRef,
  toggleKeywordStateFn,
  buildFilterDictFn,
  updateTableFilterValueFn,
} = useTableCustomFilter<ISiteTableItem>({
  parseOptions: {
    keywords: ["id", ...booleanUserConfigKeywords.map((x) => `userConfig.${x}`), "userConfig.groups"],
  },
  titleFields: ["metadata.name", "metadata.urls", "userConfig.merge.name", "userConfig.url"],
  format: {
    ...Object.fromEntries(booleanUserConfigKeywords.map((x) => [`userConfig.${x}`, "boolean"])),
  },
});

const persistedSort = computed(() => configStore.tableBehavior.SetSite?.sortBy?.[0]);
function orderOf(key: string): "ascend" | "descend" | null {
  const s = persistedSort.value;
  if (!s || s.key !== key) return null;
  return s.order === "asc" ? "ascend" : "descend";
}

const columns = computed<TableColumnsType<ISiteTableItem>>(() => {
  const base: TableColumnsType<ISiteTableItem> = [
    {
      title: "№",
      key: "userConfig.sortIndex",
      align: "center",
      width: 72,
      sorter: (a, b) => (a.userConfig.sortIndex ?? 0) - (b.userConfig.sortIndex ?? 0),
      sortOrder: orderOf("userConfig.sortIndex"),
    },
    { title: t("SetSite.common.name"), key: "name", align: "left" },
    { title: t("SetSite.common.groups"), key: "groups", align: "left", width: 160 },
    { title: t("SetSite.common.url"), key: "url", align: "left" },
    {
      title: t("SetSite.common.isOffline"),
      key: "userConfig.isOffline",
      align: "center",
      width: 90,
      sorter: (a, b) => Number(!!a.userConfig.isOffline) - Number(!!b.userConfig.isOffline),
      sortOrder: orderOf("userConfig.isOffline"),
    },
    {
      title: t("SetSite.common.allowSearch"),
      key: "userConfig.allowSearch",
      align: "center",
      width: 90,
      sorter: (a, b) => Number(!!a.userConfig.allowSearch) - Number(!!b.userConfig.allowSearch),
      sortOrder: orderOf("userConfig.allowSearch"),
    },
    {
      title: t("SetSite.common.allowQueryUserInfo"),
      key: "userConfig.allowQueryUserInfo",
      align: "center",
      width: 110,
      sorter: (a, b) => Number(!!a.userConfig.allowQueryUserInfo) - Number(!!b.userConfig.allowQueryUserInfo),
      sortOrder: orderOf("userConfig.allowQueryUserInfo"),
    },
  ];

  if (configStore.contentScript.enabled && configStore.contentScript.allowExceptionSites) {
    base.push({
      title: t("SetSite.common.allowContentScript"),
      key: "userConfig.allowContentScript",
      align: "center",
      width: 110,
    });
  }

  base.push({ title: t("common.action"), key: "action", align: "center", width: 170 });
  return base;
});

/**
 * 旧实现交给 Vuetify 的 custom-filter；tableFilterFn 内部读 item.raw，
 * 这里在调用点适配（与 DownloadHistory 同一做法，不改共享的 useAdvanceFilter）。
 */
const filteredItems = computed(() => {
  const list = (allAddedSiteInfo.value ?? []) as ISiteTableItem[];
  if (!tableFilterRef.value.trim()) return list;
  return list.filter((item) => tableFilterFn(item.id, tableFilterRef.value, { raw: item }));
});

const tableSelected = ref<TSiteID[]>([]);

const pagination = computed<TablePaginationConfig>(() => ({
  pageSize: configStore.tableBehavior.SetSite?.itemsPerPage ?? 10,
  showSizeChanger: true,
  size: "small",
}));

function handleTableChange(
  page: TablePaginationConfig,
  _filters: unknown,
  sorter: TableSorterResult | TableSorterResult[],
) {
  if (page.pageSize) {
    configStore.updateTableBehavior("SetSite", "itemsPerPage", page.pageSize);
  }
  const single = Array.isArray(sorter) ? sorter[0] : sorter;
  if (single?.order && single.columnKey) {
    configStore.updateTableBehavior("SetSite", "sortBy", [
      { key: String(single.columnKey), order: single.order === "ascend" ? "asc" : "desc" },
    ]);
  }
}

const toEditId = ref<TSiteID | null>("");
function editSite(siteId: TSiteID) {
  toEditId.value = siteId;
  showEditDialog.value = true;
}

const toDeleteIds = ref<TSiteID[]>([]);
function deleteSite(siteId: TSiteID[]) {
  toDeleteIds.value = siteId;
  showDeleteDialog.value = true;
}

async function confirmDeleteSite(siteId: TSiteID) {
  tableSelected.value = tableSelected.value.filter((id) => id !== siteId);
  return await metadataStore.removeSite(siteId);
}

const isFaviconFlushing = ref(false);
async function flushSiteFavicon(siteId: TSiteID | TSiteID[]) {
  isFaviconFlushing.value = true;
  try {
    const siteIds = Array.isArray(siteId) ? siteId : [siteId];
    for (const id of siteIds) {
      await sendMessage("getSiteFavicon", { site: id, flush: true });
    }
    runtimeStore.showSnakebar(t("SetSite.index.flushFaviconFinish"), { color: "success" });
  } finally {
    isFaviconFlushing.value = false;
  }
}

function toggleUserConfigFilter(keyword: string, checked: boolean) {
  toggleKeywordStateFn(`userConfig.${keyword}`, checked ? "1" : "");
  updateTableFilterValueFn();
}

function toggleGroupFilter(group: string, checked: boolean) {
  toggleKeywordStateFn("userConfig.groups", checked ? group : "");
  updateTableFilterValueFn();
}

function groupChecked(group: string) {
  return (advanceFilterDictRef.value["userConfig.groups"]?.required ?? []).includes(group);
}

function keywordChecked(keyword: string) {
  return (advanceFilterDictRef.value[`userConfig.${keyword}`]?.required ?? []).includes("1");
}
</script>

<template>
  <a-alert class="mb-2" type="info" show-icon :message="t('route.Settings.SetSite')" />

  <a-card size="small">
    <template #title>
      <div class="toolbar">
        <NavButton :icon="PlusOutlined" :text="t('common.btn.add')" @click="showAddDialog = true" />

        <NavButton
          :disabled="tableSelected.length === 0"
          danger
          :icon="MinusOutlined"
          :text="t('common.remove')"
          @click="deleteSite(tableSelected)"
        />

        <a-divider type="vertical" class="mx-2" />

        <NavButton :icon="AimOutlined" :text="t('SetSite.index.oneClickImport')" @click="showOneClickImportDialog = true" />

        <a-divider type="vertical" class="mx-2" />

        <a-button
          :disabled="tableSelected.length === 0"
          :loading="isFaviconFlushing"
          size="small"
          :title="t('SetSite.index.table.flushFavicon')"
          @click="() => flushSiteFavicon(tableSelected)"
        >
          <template #icon>
            <ReloadOutlined />
          </template>
          <span class="ml-1">{{ t("SetSite.index.table.flushFavicon") }}</span>
        </a-button>

        <NavButton :icon="ToolOutlined" :text="t('SetSite.index.reBuildMap')" @click="showRebuildMapDialog = true" />

        <div class="toolbar-spacer" />

        <a-input
          v-model:value="tableWaitFilterRef"
          allow-clear
          size="small"
          class="toolbar-filter"
        >
          <template #prefix>
            <a-popover trigger="click" placement="bottomLeft" :overlay-style="{ width: '240px' }">
              <template #content>
                <div class="filter-panel">
                  <label
                    v-for="keyword in booleanUserConfigKeywords"
                    :key="keyword"
                    class="filter-row"
                  >
                    <a-checkbox
                      :checked="keywordChecked(keyword)"
                      @change="
                        (e: any) => {
                          toggleUserConfigFilter(keyword, e.target.checked);
                        }
                      "
                    >
                      {{ t(`SetSite.common.${keyword}`) }}
                    </a-checkbox>
                  </label>

                  <a-divider class="filter-divider" />

                  <div class="filter-subtitle">{{ t("SetSite.common.groups") }}</div>
                  <label v-for="(sites, group) in metadataStore.getSitesGroupData" :key="group" class="filter-row">
                    <a-checkbox
                      :checked="groupChecked(String(group))"
                      @change="
                        (e: any) => {
                          toggleGroupFilter(String(group), e.target.checked);
                        }
                      "
                    >
                      {{ group }} ({{ sites.length }})
                    </a-checkbox>
                  </label>
                </div>
              </template>
              <FilterOutlined class="filter-trigger" @click="buildFilterDictFn('')" />
            </a-popover>
          </template>
          <template #suffix>
            <SearchOutlined />
          </template>
        </a-input>
      </div>
    </template>

    <a-table
      :columns="columns"
      :data-source="filteredItems"
      :pagination="pagination"
      :row-selection="{
        selectedRowKeys: tableSelected,
        onChange: (keys: (string | number)[]) => (tableSelected = keys as TSiteID[]),
      }"
      row-key="id"
      size="small"
      :scroll="{ y: 'calc(100vh - 300px)' }"
      @change="handleTableChange"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'userConfig.sortIndex'">
          <SiteFavicon :site-id="record.id" />
        </template>

        <template v-else-if="column.key === 'name'">
          <a-tooltip v-if="record.metadata.description" placement="top">
            <template #title>
              <span v-if="typeof record.metadata.description === 'string'">{{ record.metadata.description }}</span>
              <ul v-else class="desc-list">
                <li v-for="(text, index) in record.metadata.description" :key="index">{{ text }}</li>
              </ul>
            </template>
            <span>{{ record.userConfig?.merge?.name ?? record.metadata?.name }}</span>
          </a-tooltip>
          <span v-else>{{ record.userConfig?.merge?.name ?? record.metadata?.name }}</span>
        </template>

        <template v-else-if="column.key === 'groups'">
          {{ (record.userConfig.groups ?? []).join(", ") }}
        </template>

        <template v-else-if="column.key === 'url'">
          <a
            :href="record.userConfig?.url ?? record.metadata?.urls?.[0]"
            class="url-link"
            rel="noopener noreferrer nofollow"
            target="_blank"
          >
            {{ record.userConfig?.url ?? record.metadata?.urls?.[0] }}
            <ExportOutlined class="url-link-icon" />
          </a>
        </template>

        <template v-else-if="String(column.key).startsWith('userConfig.')">
          <a-switch
            size="small"
            :checked="Boolean(record.userConfig[String(column.key).replace('userConfig.', '')])"
            :disabled="
              record.metadata.isDead ||
              record.userConfig.isOffline ||
              (column.key === 'userConfig.allowSearch' && !Object.hasOwn(record.metadata, 'search')) ||
              (column.key === 'userConfig.allowQueryUserInfo' && !Object.hasOwn(record.metadata, 'userInfo'))
            "
            @change="
              (checked: boolean | string | number) =>
                metadataStore.simplePatch(
                  'sites',
                  record.id,
                  String(column.key).replace('userConfig.', ''),
                  !!checked,
                )
            "
          />
        </template>

        <template v-else-if="column.key === 'action'">
          <a-space :size="0">
            <a-tooltip :title="t('common.edit')">
              <a-button :disabled="record.metadata.isDead" size="small" type="text" @click="() => editSite(record.id)">
                <template #icon>
                  <EditOutlined />
                </template>
              </a-button>
            </a-tooltip>

            <!-- 默认站点搜索入口编辑（只有配置了 searchEntry 的站点才支持） -->
            <a-dropdown :trigger="['click']" placement="bottomRight">
              <a-tooltip :title="t('SetSite.index.table.searchEntries')">
                <a-button
                  :disabled="record.metadata.isDead || !record.metadata.searchEntry"
                  size="small"
                  type="text"
                >
                  <template #icon>
                    <SearchOutlined />
                  </template>
                </a-button>
              </a-tooltip>
              <template #overlay>
                <EditSearchEntryList :item="record" />
              </template>
            </a-dropdown>

            <a-tooltip :title="t('SetSite.index.table.flushFavicon')">
              <a-button
                :disabled="record.metadata.isDead"
                :loading="isFaviconFlushing"
                size="small"
                type="text"
                @click="() => flushSiteFavicon(record.id)"
              >
                <template #icon>
                  <ReloadOutlined />
                </template>
              </a-button>
            </a-tooltip>

            <a-tooltip :title="t('common.remove')">
              <a-button danger size="small" type="text" @click="() => deleteSite([record.id])">
                <template #icon>
                  <DeleteOutlined />
                </template>
              </a-button>
            </a-tooltip>
          </a-space>
        </template>
      </template>
    </a-table>
  </a-card>

  <AddDialog v-model="showAddDialog" />
  <DeleteDialog v-model="showDeleteDialog" :to-delete-ids="toDeleteIds" :confirm-delete="confirmDeleteSite" />
  <EditDialog v-model="showEditDialog" :site-id="toEditId!" />
  <OneClickImportDialog v-model="showOneClickImportDialog" />
  <RebuildMapDialog v-model="showRebuildMapDialog" />
</template>

<style scoped lang="scss">
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toolbar-spacer {
  flex: 1 1 0;
}

.toolbar-filter {
  max-width: 320px;
}

.filter-trigger {
  cursor: pointer;
}

.url-link {
  font-weight: 500;
  text-decoration: underline;
}

.url-link-icon {
  margin-left: 4px;
  font-size: 11px;
}

.desc-list {
  margin: 0;
  padding-left: 16px;
}

.filter-panel {
  max-height: 320px;
  overflow-y: auto;
}

.filter-row {
  display: block;
  padding: 2px 0;
}

.filter-subtitle {
  padding: 2px 0;
  color: rgba(0, 0, 0, 0.45);
  font-size: 12px;
}

.filter-divider {
  margin: 8px 0;
}
</style>
