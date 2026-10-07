<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { countBy } from "es-toolkit";
import {
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  FilterOutlined,
  FolderOutlined,
  InfoCircleOutlined,
  MinusOutlined,
  PlusOutlined,
  SearchOutlined,
} from "@antdv-next/icons";

import { useMetadataStore } from "@/options/stores/metadata.ts";
import { useConfigStore } from "@/options/stores/config.ts";
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

const selectedIds = ref<TDownloaderKey[]>([]);
function toggleSelected(downloaderId: TDownloaderKey, checked: boolean) {
  selectedIds.value = checked
    ? [...selectedIds.value, downloaderId]
    : selectedIds.value.filter((id) => id !== downloaderId);
}

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

/**
 * 按「是否启用」分成两组。空组不出标题（「未启用 (0)」那一行没有任何信息量）。
 * title 走 computed 而不是常量：切语言时它要跟着重算（AGENTS §3.4 那条）。
 */
const downloaderGroups = computed(() => {
  const on = filteredDownloaders.value.filter((d) => d.enabled);
  const off = filteredDownloaders.value.filter((d) => !d.enabled);
  return [
    { key: "enabled", title: t("SetDownloader.index.groupEnabled"), items: on },
    { key: "disabled", title: t("SetDownloader.index.groupDisabled"), items: off },
  ].filter((group) => group.items.length > 0);
});

function isDefaultDownloader(downloaderId: TDownloaderKey) {
  return downloaderId === metadataStore.defaultDownloader?.id;
}
</script>

<template>
  <!-- 顶部那条 a-alert 只是页标题（左侧导航已经标出当前页），去掉了。
       外壳也不再是 a-card：卡片头的垂直 padding 实测是 0，size="small" 下头高只有 38px，
       按钮整条贴到窗口顶。现在用 .page 骨架：48px 工具条一行 + 白底面板一行（见 style.css）。 -->
  <div class="page">
    <a-flex align="center" gap="small" wrap justify="space-between" class="page-bar">
      <a-flex align="center" gap="small" wrap>
        <a-button type="primary" @click="showAddDialog = true"><template #icon><PlusOutlined /></template><span>{{ t('common.btn.add') }}</span></a-button>

        <a-button type="primary" danger :disabled="selectedIds.length === 0" @click="deleteDownloader(selectedIds)"><template #icon><MinusOutlined /></template><span>{{ t('common.remove') }}</span></a-button>

        <a-button :disabled="metadataStore.getDownloaders.length === 0" @click="showDefaultDownloaderEditDialog = true"><template #icon><DownloadOutlined /></template><span>{{ t('SetDownloader.index.editDefaultDownloaderBtn') }}</span></a-button>
      </a-flex>

      <!-- 搜索框与筛选下拉靠右：.page-bar-extra 负责 margin-left:auto，
           原来是 .toolbar > .toolbar-right 两层 flex 容器靠 justify-content 推到最右。 -->
      <a-flex align="center" gap="small" wrap class="page-bar-extra">
          <a-input
            v-model:value="searchText"
            :placeholder="t('common.search')"
            allow-clear
            style="width: 240px"
          >
            <template #prefix><SearchOutlined /></template>
          </a-input>

          <a-dropdown>
            <a-tooltip :title="t('common.filter')">
              <a-button>
                <template #icon><FilterOutlined /></template>
              </a-button>
            </a-tooltip>
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
      </a-flex>
    </a-flex>

    <!-- 一台下载服务器一张卡片，按是否启用分两组；面板继续当滚动宿主（.page > .page-panel
         才有 overscroll-behavior: contain，见 style.css 那条注释）。
         表格那 8 列在这里各自落位：№ 到卡头右端、类型图标到卡头、名称/地址/用户名到字段区、
         两个开关和 5 颗操作按钮到卡底。分页去掉了 —— 下载器数量是个位数，卡片铺开比翻页直观。 -->
    <div class="page-panel">
      <section v-for="group in downloaderGroups" :key="group.key" class="dl-group">
        <header class="dl-group-head">
          <span class="dl-group-title">{{ group.title }}</span>
          <span class="dl-group-count">({{ group.items.length }})</span>
        </header>

        <div class="dl-grid">
          <article v-for="downloader in group.items" :key="downloader.id" class="dl-card">
            <div class="dl-card-head">
              <a-checkbox
                :checked="selectedIds.includes(downloader.id)"
                @change="(e: any) => toggleSelected(downloader.id, e.target.checked)"
              />
              <img class="dl-card-icon" :src="getDownloaderIcon(downloader.type)" :alt="downloader.type" />
              <!-- 名称整段铺开（不截断），所以这里不需要全文揭示的浮层 -->
              <span class="dl-card-name">{{ downloader.name }}</span>
              <a-tag v-if="isDefaultDownloader(downloader.id)" color="blue">{{ t("common.default") }}</a-tag>
            </div>

            <dl class="dl-card-fields">
              <dt>{{ t("SetDownloader.common.address") }}</dt>
              <dd>
                <a :href="downloader.address" rel="noopener noreferrer nofollow" target="_blank">{{
                  downloader.address
                }}</a>
              </dd>
              <dt>{{ t("common.username") }}</dt>
              <dd>{{ downloader.username || "-" }}</dd>
              <!-- 表格里那列标题写的是「№」，它在编辑器里的真名其实是「优先级」（common.sortIndex），
                   卡片上按真名标出来，免得只剩一个没人认得的编号 -->
              <dt>{{ t("common.sortIndex") }}</dt>
              <dd>{{ downloader.sortIndex }}</dd>
            </dl>

            <div class="dl-card-foot">
              <span class="dl-switch">
                <a-switch
                  size="small"
                  :checked="!!downloader.enabled"
                  :disabled="isDefaultDownloader(downloader.id)"
                  @update:checked="
                    (v: any) => metadataStore.simplePatch('downloaders', downloader.id, 'enabled', Boolean(v))
                  "
                />
                <span>{{ t("SetDownloader.index.switchEnabled") }}</span>
              </span>

              <span class="dl-switch">
                <a-switch
                  size="small"
                  :checked="!!downloader.feature?.DefaultAutoStart"
                  @update:checked="
                    (v: any) =>
                      metadataStore.simplePatch('downloaders', downloader.id, 'feature.DefaultAutoStart', Boolean(v))
                  "
                />
                <span>{{ t("SetDownloader.index.switchAutoStart") }}</span>
              </span>

              <span class="dl-card-actions">
                <a-tooltip :title="t('SetDownloader.index.table.action.status')">
                  <a-button
                    type="text"
                    size="small"
                    :disabled="!downloader.enabled"
                    @click="manageDownloader(downloader.id)"
                  >
                    <template #icon><InfoCircleOutlined /></template>
                  </a-button>
                </a-tooltip>
                <a-tooltip :title="t('common.edit')">
                  <a-button type="text" size="small" @click="editDownloader(downloader.id)">
                    <template #icon><EditOutlined /></template>
                  </a-button>
                </a-tooltip>
                <a-tooltip :title="t('SetDownloader.index.table.action.setPathAndTag')">
                  <a-button type="text" size="small" @click="editDownloaderPathAndTag(downloader.id)">
                    <template #icon><FolderOutlined /></template>
                  </a-button>
                </a-tooltip>
                <a-tooltip
                  v-if="configStore.download.allowDownloaderFilterForSite"
                  :title="t('SetDownloader.index.table.action.setSiteFilter')"
                >
                  <a-button
                    type="text"
                    size="small"
                    :disabled="!downloader.enabled"
                    @click="editDownloaderSiteFilter(downloader.id)"
                  >
                    <template #icon><FilterOutlined /></template>
                  </a-button>
                </a-tooltip>
                <a-tooltip :title="t('common.remove')">
                  <a-button
                    type="primary"
                    danger
                    size="small"
                    :disabled="isDefaultDownloader(downloader.id)"
                    @click="deleteDownloader([downloader.id])"
                  >
                    <template #icon><DeleteOutlined /></template>
                  </a-button>
                </a-tooltip>
              </span>
            </div>
          </article>
        </div>
      </section>

      <!-- 两组都空：一台下载服务器都没有时给的是「先去添加」那句话，
           有下载器但被搜索/筛选挡光时给的是通用的「无数据」。 -->
      <a-empty
        v-if="downloaderGroups.length === 0"
        class="dl-empty"
        :description="
          metadataStore.getDownloaders.length === 0
            ? t('SetDownloader.index.emptyNotice')
            : t('common.noData')
        "
      />
    </div>
  </div>

  <!-- 弹窗一律是 .page 的根级兄弟：a-modal 会 teleport 到 body，不占网格行 -->
  <AddDialog v-model="showAddDialog" />
  <EditDialog v-model="showEditDialog" :client-id="toEditDownloaderId!" />
  <DefaultDownloaderEditDialog v-model="showDefaultDownloaderEditDialog" />
  <SiteFilterDialog v-model="showSiteFilterDialog" :client-id="toEditDownloaderId!" />
  <PathAndTagSuggestDialog v-model="showPathAndTagSuggestDialog" :client-id="toEditDownloaderId!" />
  <DeleteDialog v-model="showDeleteDialog" :to-delete-ids="toDeleteIds" :confirm-delete="confirmDeleteDownloader" />
</template>

<style scoped>
.dl-group + .dl-group {
  margin-top: 16px;
}
.dl-group-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}
.dl-group-title {
  font-size: 14px;
  font-weight: 600;
}
.dl-group-count {
  font-size: 12px;
  color: var(--pt-color-text-secondary);
  font-variant-numeric: tabular-nums;
}

/* 卡片网格：min() 那一手是必须的 —— 写死 minmax(360px,1fr) 时，面板比 360px 还窄
   （窄窗口 / 侧栏展开）第一列仍然要 360px，于是整块把面板顶出横向滚动条。
   auto-fill 而不是 auto-fit：只有一台服务器时 auto-fit 会把那张卡拉满整行。
   行高对齐交给 grid 默认的 stretch + 下面那条 foot{margin-top:auto}：名字长短不一时，
   同一行卡片底边齐、开关与操作那一排也齐，不会各自一截。 */
.dl-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(360px, 100%), 1fr));
  gap: 8px;
}

.dl-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  background: #fff;
  border: 1px solid var(--pt-color-border-light);
  border-radius: 10px;
}
.dl-card:hover {
  border-color: var(--pt-color-border);
}

.dl-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.dl-card-icon {
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
  object-fit: contain;
}
.dl-card-name {
  min-width: 0;
  font-weight: 600;
  overflow-wrap: anywhere;
}

/* 两列网格：标签列取两张标签里较宽的那个（max-content），值列吃剩余宽度并允许断行。
   用 flex + 固定标签宽度的话，英文那侧 "Server Address" 比 "Username" 长出一截会被挤。 */
.dl-card-fields {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 4px 8px;
  margin: 0;
}
.dl-card-fields dt {
  color: var(--pt-color-text-secondary);
}
.dl-card-fields dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.dl-card-foot {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: auto;
  padding-top: 8px;
  border-top: 1px solid var(--pt-color-border-light);
}
.dl-switch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.dl-card-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}

/* 空态在面板里居中，与 style.css 那条「空表撑满面板」同一口径（用户 2026-10-07）。
   min-height:100% 量的是面板内容盒 —— 面板高由 .page 网格 1fr 给定，是确定值，
   所以这里不再需要把面板改成 flex。 */
.dl-empty {
  display: grid;
  place-content: center;
  min-height: 100%;
}
</style>
