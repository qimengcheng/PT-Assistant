<script setup lang="ts">
/**
 * 因为 Vuetify 的限制，无法实现  indeterminate -> checked -> unchecked -> indeterminate 的循环切换，
 * 只能由 indeterminate -> checked <-> unchecked 之间切换，当 checked 是为 required，unchecked 时为 exclude，
 * 如果需要忽略，目前只能重置过滤词。
 * refs: https://github.com/vuetifyjs/vuetify/blob/0ca7e93ad011b358591da646fdbd6ebe83625d25/packages/vuetify/src/components/VCheckbox/VCheckboxBtn.tsx#L49-L53
 */
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { addDays, startOfDay } from "date-fns";
import { ETorrentStatus, preDefinedTorrentTagNameSet, sortTorrentTags } from "@ptd/site";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  CheckOutlined,
  DisconnectOutlined,
  PushpinOutlined,
  QuestionCircleOutlined,
} from "@antdv-next/icons";

import { formatDate, formatSize } from "@/options/utils.ts";
import { useConfigStore } from "@/options/stores/config.ts";
import { tableCustomFilter } from "@/options/views/Overview/SearchEntity/utils/filter.ts";
import { setDateRangeByDatePicker, getThisDateUnitRange } from "@/options/directives/useAdvanceFilter.ts";

import SiteName from "@/options/components/SiteName.vue";
import SiteFavicon from "@/options/components/SiteFavicon/Index.vue";

const showDialog = defineModel<boolean>();

const { t } = useI18n();
const configStore = useConfigStore();

const {
  advanceItemPropsRef,
  advanceFilterDictRef,
  reBuildFilterCountRef,
  toggleKeywordStateFn,
  reBuildAdvanceFilter,
  updateTableFilterValueFn,
} = tableCustomFilter;

// 种子状态选项 - 使用 i18n 支持
// icon / color 改为 antd 图标组件与真实色值（Vuetify 的 mdi 字符串 + 语义色名不再适用）
const statusOptions = [
  {
    value: ETorrentStatus.unknown,
    label: t("torrent.status.unknown"),
    icon: QuestionCircleOutlined,
    color: "#8c8c8c",
  },
  {
    value: ETorrentStatus.downloading,
    label: t("torrent.status.downloading"),
    icon: ArrowDownOutlined,
    color: "#1677ff",
  },
  {
    value: ETorrentStatus.seeding,
    label: t("torrent.status.seeding"),
    icon: ArrowUpOutlined,
    color: "#52c41a",
  },
  {
    value: ETorrentStatus.inactive,
    label: t("torrent.status.inactive"),
    icon: DisconnectOutlined,
    color: "#8c8c8c",
  },
  {
    value: ETorrentStatus.completed,
    label: t("torrent.status.completed"),
    icon: CheckOutlined,
    color: "#8c8c8c",
  },
];

const torrentTags = computed(() => sortTorrentTags(advanceItemPropsRef.value.tags));

const showHiddenTags = ref(false);

const filteredTorrentTags = computed(() => {
  const hiddenNames = configStore.searchEntifyControl.hiddenTagNames || [];
  return torrentTags.value.filter((tag) => showHiddenTags.value || !hiddenNames.includes(tag.name));
});

function updateTableFilter() {
  updateTableFilterValueFn();
  showDialog.value = false;
}

function enterDialog() {
  reBuildAdvanceFilter();
}

/** a-modal 的 @after-open-change（对应原 v-dialog 的 @after-enter） */
function onAfterOpenChange(open: boolean) {
  if (open) enterDialog();
}

/** 站点/标签/状态三组勾选框的「排除」态 —— Vuetify 里是写死 indeterminate，这里按数据实际状态呈现 */
function isExcluded(field: string, value: string): boolean {
  return (advanceFilterDictRef.value[field]?.exclude ?? []).includes(value);
}

/** 自定义日期区间：a-range-picker 给的是 dayjs，setDateRangeByDatePicker 要的是 Date[] */
function onCustomDateRangeChange(dates: unknown) {
  if (!dates || !Array.isArray(dates) || dates.length === 0) return;
  const range = dates as { toDate: () => Date }[];
  advanceFilterDictRef.value.time = setDateRangeByDatePicker(range.map((d) => d.toDate()));
}

/** a-range-picker 只能禁用「天」，按天粒度复刻 v-date-picker 的 min / max */
function disabledDate(current: { valueOf: () => number }): boolean {
  const [min, max] = advanceItemPropsRef.value.time.range as [number, number];
  const ts = current.valueOf();
  return ts < startOfDay(new Date(min)).getTime() || ts > addDays(new Date(max), 1).getTime();
}

/** v-range-slider 的 ticks（原始数值数组）→ a-slider 的 marks（Record<number, any>） */
function toMarks(ticks: number[]): Record<number, null> {
  const marks: Record<number, null> = {};
  for (const tick of ticks ?? []) marks[tick] = null;
  return marks;
}

/** v-range-slider 的 #thumb-label → a-slider 的 tooltip.formatter */
function formatTimeTooltip(value?: number) {
  return formatDate(value ?? 0, "yyyy-MM-dd HH:mm") as string;
}

function formatSizeTooltip(value?: number) {
  return formatSize(value ?? 0) as string;
}
</script>

<template>
  <a-modal v-model:open="showDialog" :width="800" @after-open-change="onAfterOpenChange">
    <template #title>
      {{ t("common.AdvanceFilterGenerateDialog.title") }}
    </template>

    <div class="pa-0">
      <a-row :gutter="0">
        <a-col :span="24" class="text-label-large">{{ t("common.AdvanceFilterGenerateDialog.keywords") }}</a-col>
      </a-row>
      <a-row :gutter="0">
        <a-col :xs="24" :md="12">
          <a-select
            v-model:value="advanceFilterDictRef.text.required"
            mode="tags"
            size="small"
            :token-separators="[',']"
            :placeholder="t('common.AdvanceFilterGenerateDialog.required')"
          />
        </a-col>
        <a-col :xs="24" :md="12">
          <a-select
            v-model:value="advanceFilterDictRef.text.exclude"
            mode="tags"
            size="small"
            :token-separators="[',']"
            :placeholder="t('common.AdvanceFilterGenerateDialog.exclude')"
          />
        </a-col>
      </a-row>

      <a-row :gutter="0">
        <a-col :span="24" class="text-label-large">{{ t("common.AdvanceFilterGenerateDialog.site") }}</a-col>
      </a-row>
      <a-checkbox-group v-model:value="advanceFilterDictRef.site.required" class="advance-filter-checkbox-group">
        <a-row :gutter="0">
          <a-col
            v-for="site in advanceItemPropsRef.site"
            :key="`${reBuildFilterCountRef}_${site}`"
            class="pa-0"
            :xs="6"
            :sm="8"
            :md="4"
          >
            <a-checkbox
              :value="site"
              :indeterminate="isExcluded('site', site)"
              @click.stop="() => toggleKeywordStateFn('site', site)"
            >
              <SiteFavicon :site-id="site" :size="16" class="mr-2" />
              <SiteName :class="['text-decoration-none']" :site-id="site" tag="span" />
            </a-checkbox>
          </a-col>
        </a-row>
      </a-checkbox-group>

      <template v-if="configStore.searchEntifyControl.showTorrentTag">
        <div class="d-flex align-center">
          <span class="text-label-large">{{ t("SearchEntity.AdvanceFilterGenerateDialog.tags") }}</span>
          <div class="flex-1-1-0" />
          <a-button
            v-if="configStore.searchEntifyControl.hiddenTagNames?.length"
            type="text"
            size="small"
            @click="showHiddenTags = !showHiddenTags"
          >
            {{
              showHiddenTags
                ? t("SearchEntity.AdvanceFilterGenerateDialog.hideHiddenTags")
                : t("SearchEntity.AdvanceFilterGenerateDialog.showHiddenTags")
            }}
          </a-button>
        </div>
        <a-checkbox-group v-model:value="advanceFilterDictRef.tags.required" class="advance-filter-checkbox-group">
          <a-row :gutter="0">
            <a-col
              v-for="tag in filteredTorrentTags"
              :key="`${reBuildFilterCountRef}_${tag.name}`"
              class="pa-0"
              :xs="6"
              :sm="4"
              :md="3"
            >
              <a-checkbox
                :value="tag.name"
                :indeterminate="isExcluded('tags', tag.name)"
                @click.stop="() => toggleKeywordStateFn('tags', tag.name)"
              >
                <a-tag :color="tag.color" :bordered="true" class="mr-1">
                  <template v-if="preDefinedTorrentTagNameSet.includes(tag.name)" #icon>
                    <PushpinOutlined class="pin-icon" />
                  </template>
                  {{ tag.name }}
                </a-tag>
              </a-checkbox>
            </a-col>
          </a-row>
        </a-checkbox-group>
      </template>

      <a-row :gutter="0">
        <a-col :span="24" class="text-label-large">
          {{ t("SearchEntity.AdvanceFilterGenerateDialog.status") }}
        </a-col>
      </a-row>
      <a-checkbox-group v-model:value="advanceFilterDictRef.status.required" class="advance-filter-checkbox-group">
        <a-row :gutter="0">
          <a-col
            v-for="status in statusOptions"
            :key="`${reBuildFilterCountRef}_${status.value}`"
            class="pa-0"
            :xs="12"
            :sm="8"
            :md="6"
          >
            <a-checkbox
              :value="status.value"
              :indeterminate="isExcluded('status', String(status.value))"
              @click.stop="() => toggleKeywordStateFn('status', status.value)"
            >
              <component :is="status.icon" :style="{ color: status.color, marginRight: '8px' }" />
              <span>{{ status.label }}</span>
            </a-checkbox>
          </a-col>
        </a-row>
      </a-checkbox-group>

      <a-row :gutter="0">
        <a-col :xs="24" :md="12">
          <div class="d-flex align-center pr-4">
            <span class="text-label-large">{{ t("common.AdvanceFilterGenerateDialog.date") }}</span>
            <div class="flex-1-1-0" />
            <a-tag
              v-for="dateUnit in ['day', 'week', 'month', 'quarter', 'year'] as const"
              :key="dateUnit"
              class="mr-1"
              @click="
                () => (advanceFilterDictRef.time = getThisDateUnitRange(dateUnit, advanceItemPropsRef.time.range))
              "
            >
              {{ t(`common.AdvanceFilterGenerateDialog.dateUnit.${dateUnit}`) }}
            </a-tag>
            <a-popover trigger="click" placement="top">
              <template #content>
                <a-range-picker :disabled-date="disabledDate" :allow-clear="false" @change="onCustomDateRangeChange" />
              </template>
              <a-tag>{{ t("common.AdvanceFilterGenerateDialog.dateUnit.custom") }}</a-tag>
            </a-popover>
          </div>
          <a-row :gutter="0">
            <a-col :span="24" class="px-6">
              <a-slider
                v-model:value="advanceFilterDictRef.time"
                range
                :min="advanceItemPropsRef.time.range[0]"
                :max="advanceItemPropsRef.time.range[1]"
                :step="60 * 1000"
                :marks="toMarks(advanceItemPropsRef.time.ticks)"
                :tooltip="{ open: true, formatter: formatTimeTooltip }"
              />
            </a-col>
          </a-row>
        </a-col>
        <a-col :xs="24" :md="12">
          <a-row :gutter="0">
            <a-col :span="24" class="text-label-large">
              {{ t("SearchEntity.AdvanceFilterGenerateDialog.size") }}
            </a-col>
          </a-row>
          <a-row :gutter="0">
            <a-col :span="24" class="px-6">
              <a-slider
                v-model:value="advanceFilterDictRef.size"
                range
                :min="advanceItemPropsRef.size.range[0]"
                :max="advanceItemPropsRef.size.range[1]"
                :step="1024 ** 3"
                :marks="toMarks(advanceItemPropsRef.size.ticks)"
                :tooltip="{ open: true, formatter: formatSizeTooltip }"
              />
            </a-col>
          </a-row>
        </a-col>
      </a-row>
      <a-row :gutter="0">
        <a-col :xs="24" :md="8">
          <a-row :gutter="0">
            <a-col :span="24" class="text-label-large">
              {{ t("SearchEntity.AdvanceFilterGenerateDialog.seeders") }}
            </a-col>
          </a-row>
          <a-row :gutter="0">
            <a-col :span="24" class="px-6">
              <a-slider
                v-model:value="advanceFilterDictRef.seeders"
                range
                :min="advanceItemPropsRef.seeders.range[0]"
                :max="advanceItemPropsRef.seeders.range[1]"
                :step="1"
                :marks="toMarks(advanceItemPropsRef.seeders.ticks)"
                :tooltip="{ open: true, formatter: null }"
              />
            </a-col>
          </a-row>
        </a-col>
        <a-col :xs="24" :md="8">
          <a-row :gutter="0">
            <a-col :span="24" class="text-label-large">
              {{ t("SearchEntity.AdvanceFilterGenerateDialog.leechers") }}
            </a-col>
          </a-row>
          <a-row :gutter="0">
            <a-col :span="24" class="px-6">
              <a-slider
                v-model:value="advanceFilterDictRef.leechers"
                range
                :min="advanceItemPropsRef.leechers.range[0]"
                :max="advanceItemPropsRef.leechers.range[1]"
                :step="1"
                :marks="toMarks(advanceItemPropsRef.leechers.ticks)"
                :tooltip="{ open: true, formatter: null }"
              />
            </a-col>
          </a-row>
        </a-col>
        <a-col :xs="24" :md="8">
          <a-row :gutter="0">
            <a-col :span="24" class="text-label-large">
              {{ t("SearchEntity.AdvanceFilterGenerateDialog.completed") }}
            </a-col>
          </a-row>
          <a-row :gutter="0">
            <a-col :span="24" class="px-6">
              <a-slider
                v-model:value="advanceFilterDictRef.completed"
                range
                :min="advanceItemPropsRef.completed.range[0]"
                :max="advanceItemPropsRef.completed.range[1]"
                :step="1"
                :marks="toMarks(advanceItemPropsRef.completed.ticks)"
                :tooltip="{ open: true, formatter: null }"
              />
            </a-col>
          </a-row>
        </a-col>
      </a-row>
    </div>

    <template #footer>
      <div class="d-flex align-center">
        <a-button type="text" @click="() => reBuildAdvanceFilter(true)">
          {{ t("common.AdvanceFilterGenerateDialog.reset") }}
        </a-button>
        <div class="flex-1-1-0" />
        <a-button danger type="text" @click="showDialog = false">{{ t("common.dialog.cancel") }}</a-button>
        <a-button type="text" @click="updateTableFilter">
          {{ t("common.AdvanceFilterGenerateDialog.generate") }}
        </a-button>
      </div>
    </template>
  </a-modal>
</template>

<style scoped lang="scss">
.advance-filter-checkbox-group {
  width: 100%;
}

.pin-icon {
  transform: rotate(45deg);
}
</style>
