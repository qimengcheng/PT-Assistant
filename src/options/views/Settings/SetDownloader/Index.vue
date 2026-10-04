<script setup lang="ts">
import { computed, h, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { countBy } from "es-toolkit";
import { Switch as aSwitch } from "antdv-next";
import {
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  FilterOutlined,
  FolderOutlined,
  InfoCircleOutlined,
  MinusOutlined,
  PlusOutlined,
  PushpinFilled,
  SearchOutlined,
} from "@antdv-next/icons";

import { useMetadataStore } from "@/options/stores/metadata.ts";
import { useConfigStore } from "@/options/stores/config.ts";
import { useTableBehavior } from "@/options/directives/useTableBehavior.ts";
import type { TDownloaderKey } from "@/shared/types.ts";
import { getDownloaderIcon } from "@ptd/downloader";

import DeleteDialog from "@/options/components/DeleteDialog.vue";

import AddDialog from "./AddDialog.vue";
import EditDialog from "./EditDialog.vue";
import DefaultDownloaderEditDialog from "./DefaultDownloaderEditDialog.vue";
import SiteFilterDialog from "./SiteFilterDialog.vue";
import PathAndTagSuggestDialog from "./PathAndTagSuggestDialog.vue";

const { t } = useI18n();
const router = useRouter();
const metadataStore = useMetadataStore();
const configStore = useConfigStore();

const showAddDialog = ref(false);
const showEditDialog = ref(false);
const showDefaultDownloaderEditDialog = ref(false);
const showSiteFilterDialog = ref(false);
const showPathAndTagSuggestDialog = ref(false);
const showDeleteDialog = ref(false);

const downloaderTypeCount = computed(() => countBy(metadataStore.getDownloaders, (x) => x.type));

const tableSelected = ref<TDownloaderKey[]>([]);

const toEditDownloaderId = ref<TDownloaderKey | null>(null);
function editDownloader(downloaderId: TDownloaderKey) {
  toEditDownloaderId.value = downloaderId;
  showEditDialog.value = true;
}

function manageDownloader(downloaderId: TDownloaderKey) {
  void router.push({ path: "/my-client", query: { downloader: downloaderId } });
}

function editDownloaderPathAndTag(downloaderId: TDownloaderKey) {
  toEditDownloaderId.value = downloaderId;
  showPathAndTagSuggestDialog.value = true;
}

function editDownloaderSiteFilter(downloaderId: TDownloaderKey) {
  toEditDownloaderId.value = downloaderId;
  showSiteFilterDialog.value = true;
}

const toDeleteIds = ref<TDownloaderKey[]>([]);
function deleteDownloader(downloaderIds: TDownloaderKey[]) {
  toDeleteIds.value = downloaderIds.filter((i) => i !== metadataStore.defaultDownloader?.id);
  showDeleteDialog.value = true;
}

async function confirmDeleteDownloader(downloaderId: TDownloaderKey) {
  return await metadataStore.removeDownloader(downloaderId);
}

// 搜索与筛选
const searchText = ref("");
const filterEnabled = ref<boolean | undefined>();
const filterAutoStart = ref<boolean | undefined>();
const filterType = ref<string[]>([]);

const filteredDownloaders = computed(() => {
  return metadataStore.getDownloaders.filter((d) => {
    if (searchText.value) {
      const kw = searchText.value.toLowerCase();
      const hay = `${d.name} ${d.address} ${d.type}`.toLowerCase();
      if (!hay.includes(kw)) return false;
    }
    if (filterEnabled.value !== undefined && d.enabled !== filterEnabled.value) return false;
    if (filterAutoStart.value !== undefined && d.feature?.DefaultAutoStart !== filterAutoStart.value) return false;
    if (filterType.value.length > 0 && !filterType.value.includes(d.type)) return false;
    return true;
  });
});

const { itemsPerPage, handleTableChange: onTableChange } = useTableBehavior("SetDownloader", {
  defaultPageSize: 10,
});

const pagination = computed(() => ({
  // ⚠️ 不要写 current:1 —— antd 的 current 是受控值，写死后翻到第 2 页也会被立刻弹回第 1 页。
  // 页码交给 a-table 内部非受控管理，这里只持久化 pageSize。
  pageSize: itemsPerPage.value,
  showSizeChanger: true,
  showTotal: (total: number) => t("common.totalItems", { total }),
}));

// 列渲染回调的键名是 render(value, record, index)：antdv-next 没有 ant-design-vue 那个
// customRender({ text, record })，写成 customRender 会被整列静默忽略、退化成原始值。
const columns = [
  { title: "№", dataIndex: "sortIndex", width: 70, align: "right" as const },
  {
    title: t("common.type"),
    dataIndex: "type",
    width: 90,
    align: "center" as const,
    render: (_value: any, record: any) =>
      h("img", { src: getDownloaderIcon(record.type), alt: record.type, style: "width:24px;height:24px" }),
  },
  {
    title: t("SetDownloader.common.name"),
    dataIndex: "name",
    render: (_value: any, record: any) => {
      const isDefault = record.id === metadataStore.defaultDownloader?.id;
      return h("div", { style: "display:flex;align-items:center;gap:6px" }, [
        isDefault ? h(PushpinFilled, { style: "color:#1677ff;transform:rotate(45deg)" }) : null,
        h("span", { style: isDefault ? "font-weight:600;color:#1677ff" : "" }, record.name),
      ]);
    },
  },
  {
    title: t("SetDownloader.common.address"),
    dataIndex: "address",
    render: (_value: any, record: any) =>
      h("a", { href: record.address, target: "_blank", rel: "noopener noreferrer" }, record.address),
  },
  { title: t("common.username"), dataIndex: "username" },
  {
    title: t("SetDownloader.index.table.enabled"),
    dataIndex: "enabled",
    width: 80,
    align: "center" as const,
    render: (_value: any, record: any) =>
      h(aSwitch, {
        checked: record.enabled,
        disabled: record.id === metadataStore.defaultDownloader?.id,
        "onUpdate:checked": (v: any) =>
          metadataStore.simplePatch("downloaders", record.id, "enabled", Boolean(v)),
      }),
  },
  {
    title: t("SetDownloader.index.table.autodl"),
    dataIndex: "feature.DefaultAutoStart",
    width: 80,
    align: "center" as const,
    render: (_value: any, record: any) =>
      h(aSwitch, {
        checked: !!record.feature?.DefaultAutoStart,
        size: "small",
        "onUpdate:checked": (v: any) =>
          metadataStore.simplePatch("downloaders", record.id, "feature.DefaultAutoStart", Boolean(v)),
      }),
  },
  {
    title: t("common.action"),
    key: "action",
    width: 230,
    align: "center" as const,
  },
];
</script>

<template>
  <div class="set-downloader">
    <a-alert :title="t('route.Settings.SetDownloader')" type="info" show-icon style="margin-bottom: 12px" />

    <a-card>
      <div class="toolbar">
        <a-button type="primary" @click="showAddDialog = true"><template #icon><PlusOutlined /></template><span>{{ t('common.btn.add') }}</span></a-button>

        <a-button danger :disabled="tableSelected.length === 0" @click="deleteDownloader(tableSelected)"><template #icon><MinusOutlined /></template><span>{{ t('common.remove') }}</span></a-button>

        <a-divider type="vertical" />

        <a-button :disabled="metadataStore.getDownloaders.length === 0" @click="showDefaultDownloaderEditDialog = true"><template #icon><DownloadOutlined /></template><span>{{ t('SetDownloader.index.editDefaultDownloaderBtn') }}</span></a-button>

        <div class="toolbar-right">
          <a-input
            v-model:value="searchText"
            :placeholder="t('common.search')"
            allow-clear
            style="width: 240px"
          >
            <template #prefix><SearchOutlined /></template>
          </a-input>

          <a-dropdown>
            <a-button style="margin-left: 8px">
              <template #icon><FilterOutlined /></template>
            </a-button>
            <template #popupRender>
              <a-menu style="min-width: 200px">
                <a-menu-item key="enabled">
                  <a-checkbox
                    :checked="filterEnabled === true"
                    @change="(e: any) => (filterEnabled = e.target.checked ? true : filterEnabled === true ? undefined : false)"
                  >
                    {{ t("SetDownloader.index.table.enabled") }}
                  </a-checkbox>
                </a-menu-item>
                <a-menu-item key="autodl">
                  <a-checkbox
                    :checked="filterAutoStart === true"
                    @change="(e: any) => (filterAutoStart = e.target.checked ? true : filterAutoStart === true ? undefined : false)"
                  >
                    {{ t("SetDownloader.index.table.autodl") }}
                  </a-checkbox>
                </a-menu-item>
                <a-menu-divider />
                <a-menu-item-group :title="t('SetDownloader.index.table.downloaderCategory')">
                  <a-menu-item v-for="(count, type) in downloaderTypeCount" :key="type">
                    <a-checkbox
                      :checked="filterType.includes(type)"
                      @change="(e: any) => {
                        filterType = e.target.checked ? [...filterType, type] : filterType.filter((x) => x !== type);
                      }"
                    >
                      {{ type }} ({{ count }})
                    </a-checkbox>
                  </a-menu-item>
                </a-menu-item-group>
              </a-menu>
            </template>
          </a-dropdown>
        </div>
      </div>

      <a-table
        :columns="columns"
        :data-source="filteredDownloaders"
        :pagination="pagination"
        :row-selection="{ selectedRowKeys: tableSelected, onChange: (keys: any[]) => (tableSelected = keys as TDownloaderKey[]) }"
        row-key="id"
        @change="onTableChange"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'action'">
            <a-space size="small">
              <a-tooltip :title="t('SetDownloader.index.table.action.status')">
                <a-button
                  type="text"
                  size="small"
                  :disabled="!record.enabled"
                  @click="manageDownloader(record.id)"
                >
                  <template #icon><InfoCircleOutlined /></template>
                </a-button>
              </a-tooltip>
              <a-tooltip :title="t('common.edit')">
                <a-button type="text" size="small" @click="editDownloader(record.id)">
                  <template #icon><EditOutlined /></template>
                </a-button>
              </a-tooltip>
              <a-tooltip :title="t('SetDownloader.index.table.action.setPathAndTag')">
                <a-button type="text" size="small" @click="editDownloaderPathAndTag(record.id)">
                  <template #icon><FolderOutlined /></template>
                </a-button>
              </a-tooltip>
              <a-tooltip v-if="configStore.download.allowDownloaderFilterForSite" :title="t('SetDownloader.index.table.action.setSiteFilter')">
                <a-button type="text" size="small" :disabled="!record.enabled" @click="editDownloaderSiteFilter(record.id)">
                  <template #icon><FilterOutlined /></template>
                </a-button>
              </a-tooltip>
              <a-tooltip :title="t('common.remove')">
                <a-button
                  type="text"
                  danger
                  size="small"
                  :disabled="record.id === metadataStore.defaultDownloader?.id"
                  @click="deleteDownloader([record.id])"
                >
                  <template #icon><DeleteOutlined /></template>
                </a-button>
              </a-tooltip>
            </a-space>
          </template>
        </template>
      </a-table>
    </a-card>

    <AddDialog v-model="showAddDialog" />
    <EditDialog v-model="showEditDialog" :client-id="toEditDownloaderId!" />
    <DefaultDownloaderEditDialog v-model="showDefaultDownloaderEditDialog" />
    <SiteFilterDialog v-model="showSiteFilterDialog" :client-id="toEditDownloaderId!" />
    <PathAndTagSuggestDialog v-model="showPathAndTagSuggestDialog" :client-id="toEditDownloaderId!" />
    <DeleteDialog v-model="showDeleteDialog" :to-delete-ids="toDeleteIds" :confirm-delete="confirmDeleteDownloader" />
  </div>
</template>

<style scoped>
.set-downloader {
  padding: 16px;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.toolbar-right {
  margin-left: auto;
  display: flex;
  align-items: center;
}
</style>
