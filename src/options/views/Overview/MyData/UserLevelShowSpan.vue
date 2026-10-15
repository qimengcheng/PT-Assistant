<script setup lang="ts">
import { computed, type Component } from "vue";
import { useI18n } from "vue-i18n";
import {
  type IImplicitUserInfo,
  type isoDuration,
  convertIsoDurationToDate,
  convertSecondsToIsoDuration,
  type IUserInfo,
} from "@ptd/site";
import { formatNumber, formatSize, formatDate, simplifyNumber } from "@/options/utils";
import HoverTip from "@/options/components/HoverTip.vue";
import { useConfigStore } from "@/options/stores/config";
import { formatRatioText } from "@/shared/ratioGuard.ts";
import { COMPOSITE_LEVEL_SCORES, convertLevelScoreGap, LEVEL_SCORE_CURRENCIES, type TLevelScoreCurrency } from "@/shared/levelScoreSites.ts";
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
  showLevelScoreConversion = false,
} = defineProps<{
  userInfo: IUserInfo;
  levelRequirement: IImplicitUserInfo;
  hideRatioInTable?: boolean;
  useJoinTimeAsRef?: boolean; // 在 formatIntervalDate 中是否使用 joinTime 作为参考时间，默认参考为 currentTime
  /**
   * 这一格是「还差多少」而不是「现在有多少」时才可以打开：把海胆那类站的等级积分缺口
   * 换算成上传/下载/魔力值/活种四种等价物（判据与系数见 `@/shared/levelScoreSites.ts`）。
   * 「当前值」那张卡传 false —— 那里摆的是积分本身，换算一个已有的数是编造。
   */
  showLevelScoreConversion?: boolean;
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
    console.error("格式化时长时报错：", duration, e);
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
    console.error("格式化区间日期时报错：", duration, e);
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

/**
 * 海胆那类站点把「等级积分」存进了 `seedingBonus`：那一格上的数字不是做种积分，
 * 而是一串四项加权和的差额。光看「还差 38」用户无从判断代价，所以按站点自己公布的
 * 公式把它摊成四种等价物（系数与来由见 `@/shared/levelScoreSites.ts`）。
 */
const LEVEL_SCORE_ICONS: Record<TLevelScoreCurrency, Component> = {
  uploaded: ArrowUpOutlined,
  downloaded: ArrowDownOutlined,
  bonus: DollarOutlined,
  seeding: BranchesOutlined,
};

const levelScoreEquivalents = computed<{ key: TLevelScoreCurrency; icon: Component; text: string }[]>(() => {
  if (!showLevelScoreConversion || !COMPOSITE_LEVEL_SCORES[userInfo.site]) return [];
  const gap = Number(levelRequirement.seedingBonus) || 0;
  const out: { key: TLevelScoreCurrency; icon: Component; text: string }[] = [];
  for (const currency of LEVEL_SCORE_CURRENCIES) {
    const value = convertLevelScoreGap(userInfo.site, currency, gap);
    if (value === null) continue;
    const text =
      currency === "uploaded" || currency === "downloaded"
        ? // formatSize 解不开时原样退回入参（类型上是 string | number）
          String(formatSize(value))
        : // 魔力值与活种都是按个计的：半个种凑不出来所以向上取整，点数也不留两位小数
          formatNumber(Math.ceil(value), { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    out.push({ key: currency, icon: LEVEL_SCORE_ICONS[currency], text });
  }
  return out;
});
</script>

<template>
  <slot name="prepend"></slot>
  <template v-if="levelRequirement.interval">
    <HoverTip :text="t('levelRequirement.interval')">
      <ClockCircleOutlined class="level-require-icon" />
    </HoverTip>
    <HoverTip :text="getIntervalDisplay(levelRequirement.interval).title">
      <span style="cursor: pointer; user-select: none" @dblclick="toggleIntervalDisplay">
        {{ getIntervalDisplay(levelRequirement.interval).text }} ;
      </span>
    </HoverTip>
  </template>
  <template v-if="levelRequirement.uploaded">
    <HoverTip :text="t('levelRequirement.uploaded')">
      <ArrowUpOutlined class="level-require-icon level-require-icon--green" />
    </HoverTip>
    {{ formatSize(levelRequirement.uploaded) }};
  </template>
  <template v-if="levelRequirement.trueUploaded">
    <HoverTip :text="t('levelRequirement.trueUploaded')">
      <VerticalAlignTopOutlined class="level-require-icon level-require-icon--green" />
    </HoverTip>
    {{ formatSize(levelRequirement.trueUploaded) }};
  </template>
  <template v-if="levelRequirement.downloaded">
    <HoverTip :text="t('levelRequirement.downloaded')">
      <ArrowDownOutlined class="level-require-icon level-require-icon--red" />
    </HoverTip>
    {{ formatSize(levelRequirement.downloaded) }};
  </template>
  <template v-if="levelRequirement.trueDownloaded">
    <HoverTip :text="t('levelRequirement.trueDownloaded')">
      <VerticalAlignBottomOutlined class="level-require-icon level-require-icon--red" />
    </HoverTip>
    {{ formatSize(levelRequirement.trueDownloaded) }};
  </template>

  <template v-if="levelRequirement.totalTraffic">
    <HoverTip :text="t('levelRequirement.totalTraffic')">
      <SwapOutlined class="level-require-icon level-require-icon--orange" />
    </HoverTip>
    {{ formatSize(levelRequirement.totalTraffic) }};
  </template>

  <!--
    分享率走 `shared/ratioGuard.ts` 的 formatRatioText，不在这格自己写判据：站点报的是
    浮点原值（实测见过 6.68369301494062），直接插值就是用户报的「当前值那一串里有个十几位
    的小数」。这一份折的是 `0.85` / `∞` / `-` 三档，与「我的数据 → 分享率」那一列同一口径；
    需求侧的整数 1 因此画成 1.00 —— 两处共用一份格式化，比让需求与现状两种写法更稳。
  -->
  <template v-if="levelRequirement.ratio && !hideRatioInTable">
    <HoverTip :text="t('levelRequirement.ratio')">
      <ColumnHeightOutlined class="level-require-icon level-require-icon--orange" />
    </HoverTip>
    {{ formatRatioText(levelRequirement.ratio) }};
  </template>

  <template v-if="levelRequirement.trueRatio && !hideRatioInTable">
    <HoverTip :text="t('levelRequirement.trueRatio')">
      <AimOutlined class="level-require-icon level-require-icon--orange" />
    </HoverTip>
    {{ formatRatioText(levelRequirement.trueRatio) }};
  </template>

  <template v-if="levelRequirement.seeding">
    <HoverTip :text="t('levelRequirement.seeding')">
      <BranchesOutlined class="level-require-icon level-require-icon--green" />
    </HoverTip>
    {{ formatNumber(levelRequirement.seeding, { minimumFractionDigits: 0 }) }};
  </template>

  <template v-if="levelRequirement.seedingSize">
    <HoverTip :text="t('levelRequirement.seedingSize')">
      <DatabaseOutlined class="level-require-icon level-require-icon--blue" />
    </HoverTip>
    {{ formatSize(levelRequirement.seedingSize) }};
  </template>

  <template v-if="levelRequirement.seedingTime">
    <HoverTip :text="t('levelRequirement.seedingTime')">
      <ClockCircleOutlined class="level-require-icon level-require-icon--green" />
    </HoverTip>
    {{ formatDuration(levelRequirement.seedingTime) }};
  </template>

  <template v-if="levelRequirement.averageSeedingTime">
    <HoverTip :text="t('levelRequirement.averageSeedingTime')">
      <ClockCircleOutlined class="level-require-icon level-require-icon--blue" />
    </HoverTip>
    {{ formatDuration(levelRequirement.averageSeedingTime) }};
  </template>

  <template v-if="levelRequirement.bonus">
    <HoverTip :text="t('levelRequirement.bonus')">
      <DollarOutlined class="level-require-icon level-require-icon--green" />
    </HoverTip>
    <HoverTip :text="formatNumber(Number(levelRequirement.bonus) || 0)">
      <span style="cursor: pointer; user-select: none" @dblclick="toggleNumberSimplification">
        {{ formatBonus("bonus") }} ;
      </span>
    </HoverTip>
  </template>

  <template v-if="levelRequirement.seedingBonus">
    <HoverTip :text="t(COMPOSITE_LEVEL_SCORES[userInfo.site] ? 'levelRequirement.levelScore' : 'levelRequirement.seedingBonus')">
      <ThunderboltOutlined class="level-require-icon level-require-icon--green" />
    </HoverTip>
    <HoverTip :text="formatNumber(levelRequirement.seedingBonus)">
      <span style="cursor: pointer; user-select: none" @dblclick="toggleNumberSimplification">
        {{ formatBonus("seedingBonus") }}
      </span>
    </HoverTip>
    <!-- 缺口换算只在「还差多少」那一行出（showLevelScoreConversion）。下面这四个键是动态拼出来的，
         防线③ 看不见这种键，所以逐个对过：uploaded / downloaded / bonus / seeding 两侧 locale 都在。 -->
    <span v-if="levelScoreEquivalents.length" class="level-score-convert">
      （≈
      <template v-for="(item, i) in levelScoreEquivalents" :key="item.key">
        <span v-if="i > 0"> / </span>
        <HoverTip :text="t(`levelRequirement.${item.key}`)">
          <component :is="item.icon" class="level-require-icon" />
        </HoverTip>
        {{ item.text }}
      </template>
      ）
    </span>
    ;
  </template>

  <template v-if="levelRequirement.bonusPerHour">
    <HoverTip :text="t('levelRequirement.bonusPerHour')">
      <TagsOutlined class="level-require-icon level-require-icon--green" />
    </HoverTip>
    {{ formatNumber(Number(levelRequirement.bonusPerHour) || 0) }};
  </template>

  <template v-if="levelRequirement.uploads">
    <HoverTip :text="t('levelRequirement.uploads')">
      <CloudUploadOutlined class="level-require-icon level-require-icon--green" />
    </HoverTip>
    {{ formatNumber(levelRequirement.uploads, { minimumFractionDigits: 0 }) }};
  </template>

  <template v-if="levelRequirement.leeching">
    <HoverTip :text="t('levelRequirement.leeching')">
      <CloudDownloadOutlined class="level-require-icon level-require-icon--red" />
    </HoverTip>
    {{ formatNumber(levelRequirement.leeching, { minimumFractionDigits: 0 }) }};
  </template>

  <template v-if="levelRequirement.snatches">
    <HoverTip :text="t('levelRequirement.snatches')">
      <FileDoneOutlined class="level-require-icon level-require-icon--orange" />
    </HoverTip>
    {{ formatNumber(levelRequirement.snatches, { minimumFractionDigits: 0 }) }};
  </template>

  <template v-if="levelRequirement.posts">
    <HoverTip :text="t('levelRequirement.posts')">
      <FileAddOutlined class="level-require-icon level-require-icon--green" />
    </HoverTip>
    {{ formatNumber(levelRequirement.posts, { minimumFractionDigits: 0 }) }};
  </template>

  <template v-if="levelRequirement.adoptions">
    <HoverTip :text="t('levelRequirement.adoptions')">
      <LikeOutlined class="level-require-icon level-require-icon--green" />
    </HoverTip>
    {{ formatNumber(levelRequirement.adoptions, { minimumFractionDigits: 0 }) }};
  </template>
</template>

<style scoped lang="scss">
.level-require-icon {
  font-size: 14px; /* 原 <v-icon size="small"> */
}

/*
 * 换算那一串里图标与后随数字之间要留缝：Vue 编译模板时会把「元素 + 换行 + 文本」之间的空白
 * 整个折叠掉（whitespace: condense），而行内图标自己不带缝 —— 全站那条
 * `.d-flex > .cell-icon { margin-inline: 4px }` 只在 flex 容器里生效，这一串是行内流。
 */
.level-score-convert .level-require-icon {
  margin-inline-end: 2px;
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
