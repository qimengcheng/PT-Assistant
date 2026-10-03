<script setup lang="ts">
import { useI18n } from "vue-i18n";
import {
  type IImplicitUserInfo,
  type isoDuration,
  convertIsoDurationToDate,
  convertSecondsToIsoDuration,
  type IUserInfo,
} from "@ptd/site";
import { formatNumber, formatSize, formatDate, simplifyNumber } from "@/options/utils";
import { useConfigStore } from "@/options/stores/config";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  BranchesOutlined,
  ClockCircleOutlined,
  CloudDownloadOutlined,
  CloudUploadOutlined,
  ColumnHeightOutlined,
  AimOutlined,
  DatabaseOutlined,
  DollarOutlined,
  FileAddOutlined,
  FileDoneOutlined,
  LikeOutlined,
  SwapOutlined,
  TagsOutlined,
  ThunderboltOutlined,
  VerticalAlignBottomOutlined,
  VerticalAlignTopOutlined,
} from "@antdv-next/icons";

const {
  userInfo,
  levelRequirement,
  hideRatioInTable = false,
  useJoinTimeAsRef = false,
} = defineProps<{
  userInfo: IUserInfo;
  levelRequirement: IImplicitUserInfo;
  hideRatioInTable?: boolean;
  useJoinTimeAsRef?: boolean; // 在 formatIntervalDate 中是否使用 joinTime 作为参考时间，默认参考为 currentTime
}>();

const { t } = useI18n();
const configStore = useConfigStore();

// Toggle function for double-click
function toggleIntervalDisplay() {
  configStore.myDataTableControl.showIntervalAsDate = !configStore.myDataTableControl.showIntervalAsDate;
}

// Toggle function for double-click to switch number simplification
function toggleNumberSimplification() {
  configStore.myDataTableControl.simplifyBonusNumbers = !configStore.myDataTableControl.simplifyBonusNumbers;
}

// Get interval display text and title
function getIntervalDisplay(interval: number | isoDuration) {
  const showAsDate = configStore.myDataTableControl.showIntervalAsDate;
  const durationText = formatDuration(interval);
  const dateText = formatIntervalDate(interval);

  return {
    text: showAsDate ? dateText : durationText,
    title: showAsDate ? durationText : dateText,
  };
}

function formatDuration(duration: number | isoDuration) {
  try {
    if (typeof duration === "number") {
      // 如果是秒数，先转换为ISO duration格式再显示
      const isoDurationStr = convertSecondsToIsoDuration(duration);
      return isoDurationStr.substring(1);
    } else {
      if (duration === "P") return "0D"; // 修正：如果 duration 只有 P，返回 0D
      return duration.substring(1);
    }
  } catch (e) {
    console.error("Error formatting duration:", duration, e);
    return "";
  }
}

function formatIntervalDate(duration: number | isoDuration): string {
  try {
    // #1140 unmet 结果带有绝对达标时间时优先使用，避免「挂载时刻 + 重算差值」的时钟错位导致日期漂移
    if (levelRequirement.passTime) {
      const passTimeDate = formatDate(new Date(levelRequirement.passTime), "yyyy-MM-dd");
      if (typeof passTimeDate === "string") {
        return passTimeDate;
      }
    }

    // 展示剩余时间时，基于当前时刻计算；展现等级要求时，基于 joinTime 计算
    // 注意每次渲染时重新取值，不能缓存到 setup 顶层（浏览器长期不关闭时缓存值会持续陈旧）
    const refTime = useJoinTimeAsRef ? (userInfo.joinTime ?? Date.now()) : Date.now();
    if (typeof duration === "number") {
      // 如果是数字（秒）
      const targetDate = new Date(refTime + duration * 1000);
      const result = formatDate(targetDate, "yyyy-MM-dd");
      return typeof result === "string" ? result : "";
    } else {
      // 如果是isoDuration字符串
      const result = formatDate(convertIsoDurationToDate(duration, refTime), "yyyy-MM-dd");
      return typeof result === "string" ? result : "";
    }
  } catch (e) {
    console.error("Error formatting interval date:", duration, e);
    return "";
  }
}

function formatBonus(bonusKey: "bonus" | "seedingBonus") {
  // 等级需求配置里 bonus 只会是 number；协议类型放宽出的 string 形态（"N/A"）归一成 0
  const bonusValue = Number(levelRequirement[bonusKey]) || 0;
  return (
    (configStore.myDataTableControl.simplifyBonusNumbers
      ? simplifyNumber(bonusValue)
      : formatNumber(bonusValue)) +
    (configStore.myDataTableControl.showBonusNeededInterval && levelRequirement[`${bonusKey}NeededInterval`]
      ? ` (~${levelRequirement[`${bonusKey}NeededInterval`]})`
      : "")
  );
}
</script>

<template>
  <slot name="prepend"></slot>
  <template v-if="levelRequirement.interval">
    <ClockCircleOutlined class="level-require-icon" :title="t('levelRequirement.interval')" />
    <span
      :title="getIntervalDisplay(levelRequirement.interval).title"
      @dblclick="toggleIntervalDisplay"
      style="cursor: pointer; user-select: none"
    >
      {{ getIntervalDisplay(levelRequirement.interval).text }} </span
    >;
  </template>
  <template v-if="levelRequirement.uploaded">
    <ArrowUpOutlined class="level-require-icon level-require-icon--green" :title="t('levelRequirement.uploaded')" />
    {{ formatSize(levelRequirement.uploaded) }};
  </template>
  <template v-if="levelRequirement.trueUploaded">
    <VerticalAlignTopOutlined class="level-require-icon level-require-icon--green" :title="t('levelRequirement.trueUploaded')" />
    {{ formatSize(levelRequirement.trueUploaded) }};
  </template>
  <template v-if="levelRequirement.downloaded">
    <ArrowDownOutlined class="level-require-icon level-require-icon--red" :title="t('levelRequirement.downloaded')" />
    {{ formatSize(levelRequirement.downloaded) }};
  </template>
  <template v-if="levelRequirement.trueDownloaded">
    <VerticalAlignBottomOutlined class="level-require-icon level-require-icon--red" :title="t('levelRequirement.trueDownloaded')" />
    {{ formatSize(levelRequirement.trueDownloaded) }};
  </template>

  <template v-if="levelRequirement.totalTraffic">
    <SwapOutlined class="level-require-icon level-require-icon--orange" :title="t('levelRequirement.totalTraffic')" />
    {{ formatSize(levelRequirement.totalTraffic) }};
  </template>

  <template v-if="levelRequirement.ratio && !hideRatioInTable">
    <ColumnHeightOutlined class="level-require-icon level-require-icon--orange" :title="t('levelRequirement.ratio')" />
    {{ levelRequirement.ratio }};
  </template>

  <template v-if="levelRequirement.trueRatio && !hideRatioInTable">
    <AimOutlined class="level-require-icon level-require-icon--orange" :title="t('levelRequirement.trueRatio')" />
    {{ levelRequirement.trueRatio }};
  </template>

  <template v-if="levelRequirement.seeding">
    <BranchesOutlined class="level-require-icon level-require-icon--green" :title="t('levelRequirement.seeding')" />
    {{ formatNumber(levelRequirement.seeding, { minimumFractionDigits: 0 }) }};
  </template>

  <template v-if="levelRequirement.seedingSize">
    <DatabaseOutlined class="level-require-icon level-require-icon--blue" :title="t('levelRequirement.seedingSize')" />
    {{ formatSize(levelRequirement.seedingSize) }};
  </template>

  <template v-if="levelRequirement.seedingTime">
    <ClockCircleOutlined class="level-require-icon level-require-icon--green" :title="t('levelRequirement.seedingTime')" />
    {{ formatDuration(levelRequirement.seedingTime) }};
  </template>

  <template v-if="levelRequirement.averageSeedingTime">
    <ClockCircleOutlined class="level-require-icon level-require-icon--blue" :title="t('levelRequirement.averageSeedingTime')" />
    {{ formatDuration(levelRequirement.averageSeedingTime) }};
  </template>

  <template v-if="levelRequirement.bonus">
    <DollarOutlined class="level-require-icon level-require-icon--green" :title="t('levelRequirement.bonus')" />
    <span
      :title="formatNumber(Number(levelRequirement.bonus) || 0)"
      @dblclick="toggleNumberSimplification"
      style="cursor: pointer; user-select: none"
    >
      {{ formatBonus("bonus") }} </span
    >;
  </template>

  <template v-if="levelRequirement.seedingBonus">
    <ThunderboltOutlined class="level-require-icon level-require-icon--green" :title="t('levelRequirement.seedingBonus')" />
    <span
      :title="formatNumber(levelRequirement.seedingBonus)"
      @dblclick="toggleNumberSimplification"
      style="cursor: pointer; user-select: none"
    >
      {{ formatBonus("seedingBonus") }} </span
    >;
  </template>

  <template v-if="levelRequirement.bonusPerHour">
    <TagsOutlined class="level-require-icon level-require-icon--green" :title="t('levelRequirement.bonusPerHour')" />
    {{ formatNumber(Number(levelRequirement.bonusPerHour) || 0) }};
  </template>

  <template v-if="levelRequirement.uploads">
    <CloudUploadOutlined class="level-require-icon level-require-icon--green" :title="t('levelRequirement.uploads')" />
    {{ formatNumber(levelRequirement.uploads, { minimumFractionDigits: 0 }) }};
  </template>

  <template v-if="levelRequirement.leeching">
    <CloudDownloadOutlined class="level-require-icon level-require-icon--red" :title="t('levelRequirement.leeching')" />
    {{ formatNumber(levelRequirement.leeching, { minimumFractionDigits: 0 }) }};
  </template>

  <template v-if="levelRequirement.snatches">
    <FileDoneOutlined class="level-require-icon level-require-icon--orange" :title="t('levelRequirement.snatches')" />
    {{ formatNumber(levelRequirement.snatches, { minimumFractionDigits: 0 }) }};
  </template>

  <template v-if="levelRequirement.posts">
    <FileAddOutlined class="level-require-icon level-require-icon--green" :title="t('levelRequirement.posts')" />
    {{ formatNumber(levelRequirement.posts, { minimumFractionDigits: 0 }) }};
  </template>

  <template v-if="levelRequirement.adoptions">
    <LikeOutlined class="level-require-icon level-require-icon--green" :title="t('levelRequirement.adoptions')" />
    {{ formatNumber(levelRequirement.adoptions, { minimumFractionDigits: 0 }) }};
  </template>
</template>

<style scoped lang="scss">
.level-require-icon {
  font-size: 14px; /* 原 <v-icon size="small"> */
}
.level-require-icon--green {
  color: #388e3c; /* Vuetify green-darken-4 */
}
.level-require-icon--red {
  color: #c62828; /* Vuetify red-darken-4 */
}
.level-require-icon--orange {
  color: #e65100; /* Vuetify orange-darken-4 */
}
.level-require-icon--blue {
  color: #1976d2; /* Vuetify blue-darken-4 */
}
</style>
