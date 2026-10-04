<script setup lang="ts">
/**
 * 平移自 PT-depiler 的同名对话框，控件层由 Vuetify 换为 antdv-next。
 * 与 SearchEntity 版共用 src/options/components/AdvanceFilter 下的零件：
 * 关键词输入、三态复选区、区间滑块、底栏。
 */
import { useI18n } from "vue-i18n";

import { formatDate } from "@/options/utils.ts";
import { tableCustomFilter } from "./utils.ts";
import { setDateRangeByDatePicker, getThisDateUnitRange } from "@/options/directives/useAdvanceFilter.ts";

import SiteName from "@/options/components/SiteName.vue";
import SiteFavicon from "@/options/components/SiteFavicon/Index.vue";
import DownloaderLabel from "@/options/components/DownloaderLabel.vue";
import FilterKeywordsSection from "@/options/components/AdvanceFilter/FilterKeywordsSection.vue";
import FilterCheckboxSection from "@/options/components/AdvanceFilter/FilterCheckboxSection.vue";
import FilterRangeSlider from "@/options/components/AdvanceFilter/FilterRangeSlider.vue";
import AdvanceFilterFooter from "@/options/components/AdvanceFilter/AdvanceFilterFooter.vue";

const showDialog = defineModel<boolean>();

const { t } = useI18n();

const {
  advanceItemPropsRef,
  advanceFilterDictRef,
  reBuildFilterCountRef,
  toggleKeywordStateFn,
  reBuildAdvanceFilter,
  updateTableFilterValueFn,
} = tableCustomFilter;

const dateUnits = ["day", "week", "month", "quarter", "year"] as const;

function updateTableFilter() {
  updateTableFilterValueFn();
  showDialog.value = false;
}

function enterDialog() {
  reBuildAdvanceFilter();
}
</script>

<template>
  <a-modal
    v-model:open="showDialog"
    :title="t('common.AdvanceFilterGenerateDialog.title')"
    :width="800"
    :after-open-change="(open: boolean) => open && enterDialog()"
  >

    <div class="filter-body">
      <div class="section-title">{{ t("common.AdvanceFilterGenerateDialog.keywords") }}</div>
      <FilterKeywordsSection v-model="advanceFilterDictRef.text" />

      <div class="section-title">{{ t("common.AdvanceFilterGenerateDialog.site") }}</div>
      <FilterCheckboxSection
        v-model:required="advanceFilterDictRef.siteId.required"
        :items="(advanceItemPropsRef.siteId as string[])"
        :excluded="advanceFilterDictRef.siteId.exclude ?? []"
        :rebuild-key="reBuildFilterCountRef"
        :span="6"
        @toggle="(v) => toggleKeywordStateFn('siteId', String(v))"
      >
        <template #item="{ item }: { item: string }">
          <span class="site-label">
            <SiteFavicon :site-id="item" :size="16" />
            <SiteName :class="['text-decoration-none']" :site-id="item" tag="span" />
          </span>
        </template>
      </FilterCheckboxSection>

      <div class="section-title">{{ t("DownloadHistory.AdvanceFilterGenerateDialog.downloader") }}</div>
      <FilterCheckboxSection
        v-model:required="advanceFilterDictRef.downloaderId.required"
        :items="(advanceItemPropsRef.downloaderId as string[])"
        :excluded="advanceFilterDictRef.downloaderId.exclude ?? []"
        :rebuild-key="reBuildFilterCountRef"
        :span="12"
        @toggle="(v) => toggleKeywordStateFn('downloaderId', String(v))"
      >
        <template #item="{ item }: { item: string }">
          <DownloaderLabel :downloader="item" />
        </template>
      </FilterCheckboxSection>

      <div class="section-title-row">
        <span>{{ t("common.AdvanceFilterGenerateDialog.date") }}</span>
        <div class="section-title-spacer" />
        <a-tag
          v-for="dateUnit in dateUnits"
          :key="dateUnit"
          class="date-unit-tag"
          @click="
            () =>
              (advanceFilterDictRef.downloadAt = getThisDateUnitRange(
                dateUnit,
                advanceItemPropsRef.downloadAt.range,
              ))
          "
        >
          {{ t(`common.AdvanceFilterGenerateDialog.dateUnit.${dateUnit}`) }}
        </a-tag>
        <a-popover trigger="click" placement="top">
          <template #content>
            <a-range-picker
              size="small"
              :show-time="false"
              @change="(v: unknown) => (advanceFilterDictRef.downloadAt = setDateRangeByDatePicker(v as unknown[]))"
            />
          </template>
          <a-tag class="date-unit-tag">{{ t("common.AdvanceFilterGenerateDialog.dateUnit.custom") }}</a-tag>
        </a-popover>
      </div>

      <FilterRangeSlider
        v-model="advanceFilterDictRef.downloadAt"
        :min="advanceItemPropsRef.downloadAt.range[0]"
        :max="advanceItemPropsRef.downloadAt.range[1]"
        :step="60 * 1000"
        :formatter="(value?: number) => formatDate(value ?? 0, 'yyyy-MM-dd HH:mm')"
      />
    </div>

    <template #footer>
      <AdvanceFilterFooter
        @reset="reBuildAdvanceFilter(true)"
        @cancel="showDialog = false"
        @generate="updateTableFilter"
      />
    </template>
  </a-modal>
</template>

<style scoped lang="scss">
.filter-body {
  max-height: 60vh;
  overflow-y: auto;
}

.section-title {
  margin: 12px 0 4px;
  font-weight: 600;
}

.section-title-row {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 16px 0 4px;
  font-weight: 600;
}

.section-title-spacer {
  flex: 1 1 0;
}

.date-unit-tag {
  cursor: pointer;
}

.site-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
</style>
