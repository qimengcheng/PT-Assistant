<script setup lang="ts">
/**
 * 平移自 PT-depiler 的同名对话框，控件层由 Vuetify 换为 antdv-next。
 *
 * 关于三态复选：原实现把 `indeterminate` 当静态属性写死，配合 Vuetify 的数组 v-model
 * 只是近似表达「未参与筛选」这一中性态。这里改为按 required/exclude 归属显式计算，
 * 语义与 useAdvanceFilter 里 toggleKeywordStateFn 的 indeterminate -> checked <-> unchecked
 * 循环一致（见该文件头部注释）。
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { addDays, startOfDay } from "date-fns";

import { formatDate } from "@/options/utils.ts";
import { tableCustomFilter } from "./utils.ts";
import { setDateRangeByDatePicker, getThisDateUnitRange } from "@/options/directives/useAdvanceFilter.ts";

import SiteName from "@/options/components/SiteName.vue";
import SiteFavicon from "@/options/components/SiteFavicon/Index.vue";
import DownloaderLabel from "@/options/components/DownloaderLabel.vue";

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

function isChecked(field: "siteId" | "downloaderId", keyword: string) {
  return (advanceFilterDictRef.value[field].required ?? []).includes(keyword);
}

function isExcluded(field: "siteId" | "downloaderId", keyword: string) {
  return (advanceFilterDictRef.value[field].exclude ?? []).includes(keyword);
}

/** 既不在 required 也不在 exclude == 中性态 */
function isIndeterminate(field: "siteId" | "downloaderId", keyword: string) {
  return !isChecked(field, keyword) && !isExcluded(field, keyword);
}

const downloadAtRange = computed<[number, number]>(() => advanceItemPropsRef.value.downloadAt.range);

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
    :width="800"
    @after-open-change="(open: boolean) => open && enterDialog()"
  >
    <template #title>{{ t("common.AdvanceFilterGenerateDialog.title") }}</template>

    <div class="filter-body">
      <div class="section-title">{{ t("common.AdvanceFilterGenerateDialog.keywords") }}</div>
      <a-row :gutter="12">
        <a-col :span="12">
          <a-select
            v-model:value="advanceFilterDictRef.text.required"
            :mode="'tags'"
            :placeholder="t('common.AdvanceFilterGenerateDialog.required')"
            :token-separators="[',']"
            size="small"
            style="width: 100%"
            :options="[]"
          />
        </a-col>
        <a-col :span="12">
          <a-select
            v-model:value="advanceFilterDictRef.text.exclude"
            :mode="'tags'"
            :placeholder="t('common.AdvanceFilterGenerateDialog.exclude')"
            :token-separators="[',']"
            size="small"
            style="width: 100%"
            :options="[]"
          />
        </a-col>
      </a-row>

      <div class="section-title">{{ t("common.AdvanceFilterGenerateDialog.site") }}</div>
      <a-row :gutter="8">
        <a-col v-for="site in advanceItemPropsRef.siteId" :key="`${reBuildFilterCountRef}_${site}`" :span="6">
          <a-checkbox
            :checked="isChecked('siteId', site)"
            :indeterminate="isIndeterminate('siteId', site)"
            @click.stop="() => toggleKeywordStateFn('siteId', site)"
          >
            <span class="site-label">
              <SiteFavicon :site-id="site" :size="16" />
              <SiteName :class="['text-decoration-none']" :site-id="site" tag="span" />
            </span>
          </a-checkbox>
        </a-col>
      </a-row>

      <div class="section-title">{{ t("DownloadHistory.AdvanceFilterGenerateDialog.downloader") }}</div>
      <a-row :gutter="8">
        <a-col v-for="downloader in advanceItemPropsRef.downloaderId" :key="`${reBuildFilterCountRef}_${downloader}`" :span="12">
          <a-checkbox
            :checked="isChecked('downloaderId', downloader)"
            :indeterminate="isIndeterminate('downloaderId', downloader)"
            @click.stop="() => toggleKeywordStateFn('downloaderId', downloader)"
          >
            <DownloaderLabel :downloader="downloader" />
          </a-checkbox>
        </a-col>
      </a-row>

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

      <a-slider
        v-model:value="advanceFilterDictRef.downloadAt"
        range
        :min="downloadAtRange[0]"
        :max="downloadAtRange[1]"
        :step="60 * 1000"
        :tooltip="{
          open: true,
          formatter: (value?: number) => formatDate(value ?? 0, 'yyyy-MM-dd HH:mm'),
        }"
      />
    </div>

    <template #footer>
      <a-button size="small" type="text" @click="() => reBuildAdvanceFilter(true)">
        {{ t("common.AdvanceFilterGenerateDialog.reset") }}
      </a-button>
      <div class="footer-spacer" />
      <a-button size="small" type="text" danger @click="showDialog = false">
        {{ t("common.dialog.cancel") }}
      </a-button>
      <a-button size="small" type="primary" @click="updateTableFilter">
        {{ t("common.AdvanceFilterGenerateDialog.generate") }}
      </a-button>
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

.section-title-spacer,
.footer-spacer {
  flex: 1 1 0;
}

:deep(.ant-modal-footer) {
  display: flex;
  align-items: center;
  gap: 8px;
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
