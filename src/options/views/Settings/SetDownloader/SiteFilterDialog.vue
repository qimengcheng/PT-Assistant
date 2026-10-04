<script setup lang="ts">
/**
 * 下载器站点过滤对话框（antdv-next 平移）。
 * 勾选 = 排除该站点：被排除的站点页面不再展示此下载器（聚合搜索页不生效）。
 */
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { EyeInvisibleOutlined, EyeOutlined } from "@antdv-next/icons";

import { useMetadataStore } from "@/options/stores/metadata.ts";
import { useConfigStore } from "@/options/stores/config.ts";
import type { IDownloaderMetadata, TDownloaderKey } from "@/shared/types.ts";

import SiteFavicon from "@/options/components/SiteFavicon/Index.vue";

const showDialog = defineModel<boolean>();
const { clientId } = defineProps<{
  clientId: TDownloaderKey;
}>();

const { t } = useI18n();
const metadataStore = useMetadataStore();
const configStore = useConfigStore();

const clientConfig = ref<IDownloaderMetadata>();
const excludedSites = ref<string[]>([]);

const addedSites = computed(() =>
  Object.entries(metadataStore.sites)
    .filter(([, site]) => (configStore.contentScript.allowExceptionSites ? (site.allowContentScript ?? true) : true))
    .map(([id]) => ({ id, name: metadataStore.siteNameMap[id] ?? id }))
    .sort((a, b) => a.name.localeCompare(b.name)),
);

const allSiteIds = computed(() => addedSites.value.map((s) => s.id));

// 每次弹窗打开时重新载入，避免展示上一次编辑的残留状态
watch(showDialog, (visible) => {
  if (visible && clientId) {
    clientConfig.value = { excludedSites: [], ...metadataStore.downloaders[clientId] };
    excludedSites.value = [...(clientConfig.value.excludedSites ?? [])];
  }
});

const allChecked = computed<boolean>({
  get: () => allSiteIds.value.length > 0 && excludedSites.value.length === allSiteIds.value.length,
  set: (checked) => {
    excludedSites.value = checked ? [...allSiteIds.value] : [];
  },
});

const indeterminate = computed(
  () => excludedSites.value.length > 0 && excludedSites.value.length < allSiteIds.value.length,
);

function toggleSite(siteId: string, checked: boolean) {
  if (checked) {
    if (!excludedSites.value.includes(siteId)) excludedSites.value.push(siteId);
  } else {
    excludedSites.value = excludedSites.value.filter((id) => id !== siteId);
  }
}

function save() {
  metadataStore.simplePatch("downloaders", clientId, "excludedSites", excludedSites.value);
  showDialog.value = false;
}
</script>

<template>
  <a-modal
    :open="showDialog"
    :title="t('SetDownloader.siteFilter.title', [clientConfig?.name ?? clientId])"
    :width="1000"
    :ok-text="t('common.dialog.ok')"
    :cancel-text="t('common.dialog.cancel')"
    @update:open="(v: boolean) => (showDialog = v)"
    @ok="save"
  >
    <a-alert type="info" show-icon :title="t('SetDownloader.siteFilter.excludedSitesHint')" style="margin-bottom: 12px">
      <template #action>
        <a-checkbox v-model:checked="allChecked" :indeterminate="indeterminate">
          {{ t("SetDownloader.siteFilter.excludedSites") }}
        </a-checkbox>
      </template>
    </a-alert>

    <a-empty v-if="addedSites.length === 0" :description="t('SetDownloader.siteFilter.noSites')" />

    <a-row v-else :gutter="[8, 8]">
      <a-col v-for="site in addedSites" :key="site.id" :xs="24" :sm="12" :md="8">
        <div class="site-card" :class="{ excluded: excludedSites.includes(site.id) }">
          <SiteFavicon :site-id="site.id" :size="24" flush-on-click />
          <div class="site-meta">
            <div class="site-name"><b>{{ site.name }}</b></div>
            <a-tag :color="excludedSites.includes(site.id) ? 'red' : 'default'" class="site-id-tag">
              {{ site.id }}
            </a-tag>
          </div>
          <a-tooltip :title="t('SetDownloader.index.table.action.setSiteFilter')">
            <a-checkbox
              :checked="excludedSites.includes(site.id)"
              class="site-check"
              @change="(e: any) => toggleSite(site.id, e.target.checked)"
            >
              <component :is="excludedSites.includes(site.id) ? EyeInvisibleOutlined : EyeOutlined" />
            </a-checkbox>
          </a-tooltip>
        </div>
      </a-col>
    </a-row>
  </a-modal>
</template>

<style scoped>
.site-card {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid #f0f0f0;
  border-radius: 6px;
  background: #fafafa;
}
.site-card.excluded {
  border-color: #ffccc7;
  background: #fff2f0;
}
.site-meta {
  flex: 1;
  min-width: 0;
}
.site-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.site-id-tag {
  margin-top: 2px;
  margin-inline-end: 0;
  transform: scale(0.85);
  transform-origin: left center;
}
.site-check {
  margin-inline-start: 0;
}
</style>
