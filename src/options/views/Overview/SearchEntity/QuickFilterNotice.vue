<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useBreakpoint } from "antdv-next";
import { CheckCircleFilled, GlobalOutlined, HddOutlined } from "@antdv-next/icons";

import { useConfigStore } from "@/options/stores/config.ts";
import { formatSize } from "@/options/utils.ts";
import type { ISearchResultTorrent } from "@/shared/types/storages/runtime.ts";

import { tableCustomFilter } from "./utils/filter.ts";

import SiteName from "@/options/components/SiteName.vue";
import SiteFavicon from "@/options/components/SiteFavicon/Index.vue";

const { selectedTorrents } = defineProps<{
  selectedTorrents: ISearchResultTorrent[];
}>();

const { t } = useI18n();
const configStore = useConfigStore();

/**
 * useBreakpoint() 返回的是**单个 Ref**，其 .value 上挂着 { xs, sm, md, lg, xl, ... }。
 * Vuetify 的 display.smAndDown 表示「比 lg 窄」，这里用 !lg 近似同一断点。
 */
const screens = useBreakpoint();
const smAndDown = computed(() => !screens.value?.lg);

const { advanceFilterDictRef, advanceItemPropsRef, updateTableFilterValueFn } = tableCustomFilter;

const selectedSite = ref<string>("");

// 优化后的选中种子信息计算：直接基于选中对象计算
const selectedTorrentsInfo = computed(() => {
  const selectedObjects = selectedTorrents;
  const count = selectedObjects.length;

  // 如果没有选中任何项，直接返回
  if (count === 0) {
    return { count: 0, totalSize: 0 };
  }

  // 直接计算选中对象的总大小，避免遍历查找
  const totalSize = selectedObjects.reduce((sum, torrent) => sum + (torrent.size || 0), 0);

  return {
    count,
    totalSize,
  };
});

function clearSiteFilter() {
  selectedSite.value = ""; // 清除站点过滤器
  advanceFilterDictRef.value.site.required = [];
  advanceFilterDictRef.value.site.exclude = [];
  updateTableFilterValueFn();
}

function updateQuickSiteFilter() {
  advanceFilterDictRef.value.site.required = [selectedSite.value];
  advanceFilterDictRef.value.site.exclude = [];
  updateTableFilterValueFn();
}

/**
 * v-chip-group(filter + mandatory) 在 antd 里没有等价物（a-checkable-tag-group 只能吃
 * options 数组、渲染不了站点图标 + 站点名），改为可横向滚动的 a-tag 行：
 * 选中项用实心 tag 表示，点任意一个站点即快速筛选该站点。
 */
function selectSite(siteId: string) {
  selectedSite.value = siteId;
  updateQuickSiteFilter();
}
</script>

<template>
  <a-alert type="info" class="px-2 py-1 mb-0">
    <template #message>
      <div class="d-flex align-center">
        <!-- 站点筛选器 -->
        <template v-if="configStore.searchEntity.quickSiteFilter">
          <!-- "全部"选项 -->
          <a-tag
            class="chip_limit_width"
            :class="{ chip_content_hidden_fix: smAndDown }"
            @click.stop="clearSiteFilter"
          >
            <template #icon><GlobalOutlined /></template>
            {{ smAndDown ? "" : t("SearchEntity.siteFilter.all") }}
          </a-tag>

          <!-- 分站点选项（可横向滚动，对应 v-chip-group 的 scroll-to-active + show-arrows） -->
          <div class="site-filter-scroll d-flex flex-nowrap align-center">
            <a-tag
              v-for="siteId in advanceItemPropsRef.site"
              :key="siteId"
              :color="siteId === selectedSite ? 'blue' : undefined"
              :variant="siteId === selectedSite ? 'solid' : 'outlined'"
              class="mr-1 mb-1"
              @click.stop="selectSite(siteId)"
            >
              <SiteFavicon :site-id="siteId" :size="14" class="mr-1" />
              <SiteName :site-id="siteId" tag="span" />
            </a-tag>
          </div>
        </template>

        <div class="flex-1-1-0" />

        <!-- 选中种子信息条 -->
        <a-divider orientation="vertical" class="mx-2" />
        <!-- 这里原本给 a-tag 传了 `bordered` 属性，antdv-next 1.5.6 下 true/false 都渲染 filled（死属性），
             已删；确实要描边请写 variant="outlined" -->
        <a-tag class="my-2 chip_limit_width" color="blue">
          <CheckCircleFilled class="mr-1" />
          {{
            smAndDown
              ? selectedTorrentsInfo.count
              : t("SearchEntity.index.selectedTorrents", [selectedTorrentsInfo.count])
          }}
          <a-divider orientation="vertical" class="mx-2" />
          <HddOutlined class="mr-1" />
          {{ formatSize(selectedTorrentsInfo.totalSize) }}
        </a-tag>
      </div>
    </template>
  </a-alert>
</template>

<style lang="scss" scoped>
.chip_limit_width {
  min-width: fit-content;
}

.site-filter-scroll {
  overflow-x: auto;
  scrollbar-width: thin;
}

/**
 * 在窄屏下，「全部站点」这一项的文字内容被隐藏（见模板中的 smAndDown），
 * 由于改用了 tag 的 icon 插槽，这里用 hack css 把它压紧，避免图标两侧留白过大。
 */
.chip_content_hidden_fix {
  padding: 0 5px !important;

  :deep(.ant-tag-icon) {
    margin: 0;
  }
}

/**
 * a-alert 的内容统一渲染在 .ant-alert-title 里（默认字重 500），
 * 而这里原本是 v-alert 的默认插槽（常规字重），还原成常规字重。
 */
:deep(.ant-alert-title) {
  font-weight: 400;
}
</style>
