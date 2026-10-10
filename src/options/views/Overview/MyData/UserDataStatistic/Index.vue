<script setup lang="ts">
import { saveAs } from "file-saver";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { computed, onMounted, ref, shallowRef, provide } from "vue";
import { eachDayOfInterval } from "date-fns";
import { flatten, mapValues, pick, uniq } from "es-toolkit";
import VChart, { THEME_KEY } from "vue-echarts";
import { isNumber } from "es-toolkit/compat";
import { use as useEcharts, type ComposeOption } from "echarts/core";
import { BarChart, LineChart, type LineSeriesOption, type BarSeriesOption } from "echarts/charts";
import { CanvasRenderer } from "echarts/renderers";
import {
  TitleComponent,
  type TitleComponentOption,
  TooltipComponent,
  type TooltipComponentOption,
  LegendComponent,
  type LegendComponentOption,
  GridComponent,
  type GridComponentOption,
} from "echarts/components";
import {
  ArrowLeftOutlined,
  ExportOutlined,
  HistoryOutlined,
  LockOutlined,
  SaveOutlined,
  UnlockOutlined,
} from "@antdv-next/icons";

import { NO_IMAGE } from "@ptd/site";

import { formatSize, formatDate } from "@/options/utils.ts";
import { type IStoredUserInfo } from "@/shared/types.ts";

import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { useConfigStore } from "@/options/stores/config.ts";

import SiteFavicon from "@/options/components/SiteFavicon/Index.vue";
import SiteName from "@/options/components/SiteName.vue";
import CheckSwitchButton from "@/options/components/CheckSwitchButton.vue";

import { type IUserDataStatistic, loadFullData, setSubDate } from "./utils.ts";
import { allAddedSiteMetadata, loadAllAddedSiteMetadata } from "../utils/siteMetadata.ts";

/**
 * 转义后再拼进 tooltip 的 HTML 字符串。
 *
 * ⚠️ formatter 返回的是字符串，ECharts 把它当 HTML 塞进 tooltip 容器。站点名来自
 * 第三方定义/解析结果（含 aka），favicon URL 也是外部拼出来的 —— 未转义时一个
 * `<img onerror=…>` 或一个引号就能改写这段 HTML，在扩展的特权页里注入钓鱼内容。
 * MV3 的 CSP 挡住内联脚本执行，所以危害上限是 HTML 注入而不是任意 JS，
 * 但属性引号逃逸是确定可行的，仍然要转义。
 */
function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

type EChartsLineChartOption = ComposeOption<
  TitleComponentOption | TooltipComponentOption | LegendComponentOption | GridComponentOption | LineSeriesOption
>;

type EChartsBarChartOption = ComposeOption<
  TitleComponentOption | TooltipComponentOption | LegendComponentOption | GridComponentOption | BarSeriesOption
>;

useEcharts([TitleComponent, TooltipComponent, LegendComponent, GridComponent, LineChart, BarChart, CanvasRenderer]);

// 文件名与 MyData/Index.vue 等同名，显式命名避免 KeepAlive/devtools 里全是 "Index"
defineOptions({ name: "UserDataStatistic" });

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const configStore = useConfigStore();
const perChartHeight = 400;

const allowEditName = ref<boolean>(false);

const rawDataRef = shallowRef<IUserDataStatistic>({ siteDateRange: {}, dailyUserInfo: {}, incrementalData: {} });

const allDateRanges = computed(() => Object.keys(rawDataRef.value.dailyUserInfo));
const allSites = computed<string[]>(() => Object.keys(rawDataRef.value.siteDateRange));

const selectedDateRanges = shallowRef<string[]>([]);
const selectedDateRangeRawData = computed<IUserDataStatistic["dailyUserInfo"]>(() =>
  pick(rawDataRef.value.dailyUserInfo, selectedDateRanges.value),
);

const availableSites = computed(() =>
  uniq(flatten(Object.values(mapValues(selectedDateRangeRawData.value, (x) => Object.keys(x))))),
);

const selectedSites = ref<string[]>([]);
const selectedDataComputed = computed<IUserDataStatistic["dailyUserInfo"]>(() =>
  mapValues(selectedDateRangeRawData.value, (x) => pick(x, selectedSites.value)),
);

function getTotalDataByField(field: keyof IStoredUserInfo) {
  return selectedDateRanges.value.map((x) =>
    Object.values(selectedDataComputed.value[x] ?? {})
      .map((x: IStoredUserInfo) => x[field])
      .filter(isNumber)
      .reduce((a, b) => (a ?? 0) + (b ?? 0), 0),
  ) as number[];
}

const formatDict = {
  int: (value: number) => value.toFixed(0),
  number: (value: number) => value.toFixed(2),
  size: (value: number) => formatSize(value),
} as const;

function createTotalInfoTooltipFormatter(type: (keyof typeof formatDict)[]) {
  return function (params: any) {
    let result = "<div>" + params[0].name + "</div>";
    params.forEach(function (param: any) {
      const formatFunction = formatDict[type[param.seriesIndex] ?? "number"];

      result +=
        `<div style='color: ${param.color}'>` +
        param.marker +
        param.seriesName +
        ": " +
        formatFunction(param.value) +
        "</div>";
    });
    return result;
  };
}

const totalSiteBaseInfoChartOptions = computed(() => {
  const uploaded = getTotalDataByField("uploaded");
  const downloaded = getTotalDataByField("downloaded");
  const bonus = getTotalDataByField("bonus");
  const seedingBonus = getTotalDataByField("seedingBonus");

  return {
    title: {
      text: `[${configStore.getUserName}] ${t("UserDataStatistic.chart.totalSiteBase")}`,
      subtext: `${t("UserDataStatistic.chart.uploadLabel")}: ${formatSize(uploaded.at(-1) ?? 0)}, ${t("UserDataStatistic.chart.downloadLabel")}: ${formatSize(downloaded.at(-1) ?? 0)}, ${t("levelRequirement.bonus")}: ${(bonus.at(-1) ?? 0).toFixed(2)}, ${t("levelRequirement.seedingBonus")}: ${(seedingBonus.at(-1) ?? 0).toFixed(2)}`,
      left: "center",
    },
    tooltip: {
      trigger: "axis",
      formatter: createTotalInfoTooltipFormatter(["size", "size", "number", "number"]),
    },
    legend: {
      data: [
        t("UserDataStatistic.chart.uploadLabel"),
        t("UserDataStatistic.chart.downloadLabel"),
        t("levelRequirement.bonus"),
        t("levelRequirement.seedingBonus"),
      ],
      bottom: 10,
      orient: "horizontal",
    },
    grid: { left: "3%", right: "4%", bottom: "10%", containLabel: true },
    xAxis: { type: "category", boundaryGap: false, data: selectedDateRanges.value },
    yAxis: [
      {
        type: "value",
        name: t("UserDataStatistic.chart.dataLabel"),
        position: "left",
        axisLabel: { formatter: formatSize },
      },
      {
        type: "value",
        name: t("levelRequirement.bonus"),
        position: "right",
        axisLabel: { formatter: (value: number) => value.toFixed(0) },
      },
    ],
    series: [
      { name: t("UserDataStatistic.chart.uploadLabel"), type: "line", smooth: true, data: uploaded, yAxisIndex: 0 },
      { name: t("UserDataStatistic.chart.downloadLabel"), type: "line", smooth: true, data: downloaded, yAxisIndex: 0 },
      { name: t("levelRequirement.bonus"), type: "line", smooth: true, data: bonus, yAxisIndex: 1 },
      { name: t("levelRequirement.seedingBonus"), type: "line", smooth: true, data: seedingBonus, yAxisIndex: 1 },
    ],
  } as EChartsLineChartOption;
});

const totalSiteSeedingInfoChartOptions = computed(() => {
  const seeding = getTotalDataByField("seeding");
  const seedingSize = getTotalDataByField("seedingSize");

  return {
    title: {
      text: `[${configStore.getUserName}] ${t("UserDataStatistic.chart.totalSiteSeeding")}`,
      subtext: `${t("UserDataStatistic.chart.seedingSizeLabel")}: ${formatSize(seedingSize.at(-1) ?? 0)}, ${t("common.count")}: ${(seeding.at(-1) ?? 0).toFixed(2)}`,
      left: "center",
    },
    tooltip: {
      trigger: "axis",
      formatter: createTotalInfoTooltipFormatter(["size", "int"]),
    },
    legend: {
      data: [t("UserDataStatistic.chart.seedingSizeLabel"), t("UserDataStatistic.chart.seedingLabel")],
      bottom: 10,
      orient: "horizontal",
    },
    grid: { left: "3%", right: "4%", bottom: "10%", outerBoundsMode: "same", outerBoundsContain: "axisLabel" },
    xAxis: { type: "category", boundaryGap: false, data: selectedDateRanges.value },
    yAxis: [
      {
        type: "value",
        name: t("UserDataStatistic.chart.seedingSizeLabel"),
        position: "left",
        axisLabel: { formatter: formatSize },
      },
      {
        type: "value",
        name: t("UserDataStatistic.chart.seedingLabel"),
        position: "right",
        axisLabel: { formatter: (value: number) => value.toFixed(0) },
      },
    ],
    series: [
      {
        name: t("UserDataStatistic.chart.seedingSizeLabel"),
        type: "line",
        smooth: true,
        data: seedingSize,
        yAxisIndex: 0,
      },
      { name: t("UserDataStatistic.chart.seedingLabel"), type: "line", smooth: true, data: seeding, yAxisIndex: 1 },
    ],
  } as EChartsLineChartOption;
});

// Echart 不支持在 tooltip 中直接获取鼠标悬停的系列索引，所以需要通过 mousemove 事件手动记录
const lastHoveredSeriesIndex = ref<number>(-1);

function updateLastHoveredSeriesIndex(data: any) {
  lastHoveredSeriesIndex.value = data?.seriesIndex ?? -1;
}

function createPerSiteChartOptionsFn(
  field: keyof IStoredUserInfo,
  format: keyof typeof formatDict,
  incr: boolean = false,
) {
  return computed(() => {
    const series = selectedSites.value.map((site) => {
      let data;
      if (incr) {
        // 使用预计算的增量数据，大幅提升性能
        data = selectedDateRanges.value.map((date) => {
          const incrementalValue = rawDataRef.value.incrementalData[site]?.[date]?.[field];
          return isNumber(incrementalValue) ? incrementalValue : Number(incrementalValue) || 0;
        });
      } else {
        data = selectedDateRanges.value.map((date) => {
          const val = selectedDataComputed.value[date]?.[site]?.[field];
          return isNumber(val) ? val : Number(val) || 0;
        });
      }

      return {
        name: site,
        type: "bar",
        emphasis: {
          focus: "series",
        },
        stack: "site",
        data,
      };
    });

    const seriesTotal = series.map((x) => ({ name: x.name, value: x.data.reduce((a, b) => a + b, 0) }));

    return {
      title: {
        text: `[${configStore.getUserName}] ${t("UserDataStatistic.chart.perSiteK" + field + (incr ? "Incr" : ""))}`,
        left: "center",
      },
      tooltip: {
        trigger: "axis",
        axisPointer: {
          type: "shadow",
        },
        formatter: (params: any[]) => {
          let ret = "";
          const date = params?.[0]?.name ?? "No Date";
          ret += `<span class="font-weight-bold">${escapeHtml(date)}</span><br>`;

          const hasData = params.some((x) => Number(x.data));
          const totalCount = params.reduce((acc, cur) => acc + (Number(cur.data) || 0), 0);
          let thresholdSite = 0;

          if (hasData) {
            ret += '<table style="width: 100%;">';
            ret += `<tr class="font-weight-bold" style="border-bottom: 1pt solid black;"><td style="padding-right: 12px;">${t("UserDataStatistic.chart.totalLabel")}</td><td style="padding-right: 12px; text-align: right;">${formatDict[format](totalCount)}</td><td style="text-align: right;">100%</td></tr>`;

            const sortedParams = params.sort((a, b) => b.data - a.data);

            for (const data of sortedParams) {
              const dataValue = Number(data.data) || 0;

              if (dataValue === 0) continue; // 跳过无数据的站点
              const site = data.seriesName;
              const siteName = allAddedSiteMetadata[site]?.siteName ?? site;
              const siteFavicon = allAddedSiteMetadata[site]?.faviconSrc ?? NO_IMAGE;
              const precentValue = (dataValue / totalCount) * 100;
              const isHighlightSite = lastHoveredSeriesIndex.value === data.seriesIndex;

              // 跳过低于阈值且没有高亮的站点
              if (
                !isHighlightSite &&
                Math.abs(precentValue) < (configStore.userStatisticControl.hidePerSitePrecentThreshold ?? 0)
              ) {
                thresholdSite++;
                continue;
              }

              ret += `<tr style='${isHighlightSite ? `color: ${data.color};` : ""}'>
<td style="padding-right: 12px;"><div class="d-inline-flex align-center"><img src="${escapeHtml(siteFavicon)}" class="mr-1" style="width:16px; height: 16px; " alt="${escapeHtml(siteName)}">${escapeHtml(siteName)}</div></td>
<td style="padding-right: 12px; text-align: right;">${escapeHtml(formatDict[format](data.value))}</td>
<td style="text-align: right;">${precentValue.toFixed(2)}%</td>
</tr>`;
            }

            if (thresholdSite > 0) {
              ret += `<tr><td colspan="3" style="text-align: right;">${t("UserDataStatistic.chart.hiddenSites", { count: thresholdSite })}</td></tr>`;
            }

            ret += "</table>";
          } else {
            ret += `${t("UserDataStatistic.chart.noData")}`;
          }

          return ret;
        },
      },
      legend: {
        data: seriesTotal.sort((a, b) => b.value - a.value).map((x) => x.name),
        bottom: 10,
        orient: "horizontal",
        type: "scroll",
        formatter: (site: string) => allAddedSiteMetadata[site]?.siteName ?? site,
      },
      grid: { left: "3%", right: "4%", bottom: "10%", outerBoundsMode: "same", outerBoundsContain: "axisLabel" },
      xAxis: { type: "category", boundaryGap: true, data: selectedDateRanges.value },
      yAxis: [
        { type: "value", name: t("UserDataStatistic.chart.dataLabel"), axisLabel: { formatter: formatDict[format] } },
      ],
      series,
    } as EChartsBarChartOption;
  });
}

const perSiteChartField: [keyof IStoredUserInfo, keyof typeof formatDict][] = [
  ["uploaded", "size"],
  ["downloaded", "size"],
  ["seeding", "int"],
  ["seedingSize", "size"],
  ["bonus", "number"],
  ["seedingBonus", "number"],
];

/**
 * 旧实现是在模板里逐次调用 createPerSiteChartOptionsFn(...).value，
 * 每次渲染都新建/丢弃一批 computed；这里在 setup 期一次性建好，行为相同。
 */
const perSiteCharts = perSiteChartField.flatMap(([field, format]) => [
  { key: `perSiteK${field}`, options: createPerSiteChartOptionsFn(field, format, false) },
  { key: `perSiteK${field}Incr`, options: createPerSiteChartOptionsFn(field, format, true) },
]);

// ===== 控制面板（antdv-next 适配） =====

const userNameOptions = computed(() =>
  Object.keys(configStore.getUserNames.names).map((name) => ({ value: name })),
);

/** 展示图表开关列表 */
const chartToggles = computed(() =>
  Object.entries(configStore.userStatisticControl.showChart).map(([key, value]) => ({ key, value })),
);

function setShowChart(key: string, checked: boolean) {
  (configStore.userStatisticControl.showChart as Record<string, boolean>)[key] = checked;
}

const dateRangeControl = computed(() => configStore.userStatisticControl.dateRange);

/**
 * 日期范围的预设项：近 N 天 + 全部。
 * 「自定义」不进这里 —— 它选中后要弹 RangePicker 挑具体区间，是另一套交互，
 * 仍然由旁边的按钮承载（见模板）。这里用 a-segmented 而不是 v-for 按钮，
 * 是与 MyData/Index.vue 的 joinTimeFormat、PushToDownloaderDialog 的 inputMode 保持同一套写法。
 */
const dateRangePresetOptions = computed(() => [
  ...[7, 30, 60, 90, 180].map((day) => ({ value: day, label: t("UserDataStatistic.dateRange.day", [day]) })),
  { value: "all", label: t("UserDataStatistic.dateRange.all") },
]);

/** 当前是「自定义」时没有任何预设被选中，segmented 高亮不到项，留空字符串即可 */
const dateRangePresetValue = computed(() =>
  typeof dateRangeControl.value === "number" || dateRangeControl.value === "all" ? dateRangeControl.value : "",
);

function selectDateRangePreset(value: number | string) {
  if (value === "all") {
    selectDateRangeAll();
    return;
  }
  selectDateRangeDays(Number(value));
}

function selectDateRangeDays(day: number) {
  configStore.userStatisticControl.dateRange = day;
  selectedDateRanges.value = setSubDate(day);
}

function selectDateRangeAll() {
  configStore.userStatisticControl.dateRange = "all";
  selectedDateRanges.value = allDateRanges.value;
}

// 不直引 dayjs（它只是 antdv-next 的传递依赖）：区间值取 picker 回调的 dateStrings
function applyCustomDateRange(dateStrings: [string, string] | null) {
  const [start, end] = dateStrings ?? [];
  if (!start || !end) return;

  selectedDateRanges.value = eachDayOfInterval({
    start: new Date(`${start}T00:00:00`),
    end: new Date(`${end}T00:00:00`),
  }).map((x) => formatDate(x, "yyyy-MM-dd"));
  configStore.userStatisticControl.dateRange = "custom";
}

const allDataDayBounds = computed(() => {
  const min = allDateRanges.value.at(0);
  const max = allDateRanges.value.at(-1);
  if (!min || !max) return null;
  return { min: new Date(`${min}T00:00:00`), max: new Date(`${max}T23:59:59.999`) };
});

function disabledDateOutsideData(current: { toDate: () => Date }) {
  const bounds = allDataDayBounds.value;
  if (!bounds) return false;
  const d = current.toDate();
  return d < bounds.min || d > bounds.max;
}

onMounted(async () => {
  try {
    // 这个页面读两份异步水合的数据：按天存档（loadFullData 内部等的是 metadata）和用户存的
    // 统计偏好（config）。两个 store 各等各的 —— 只等 metadata 时下面 dateRange 那几行照样
    // 可能读到初始值，表现为「上次选的是 30 天，冷启动打开却变成全部」。
    await configStore.$onReady();

    rawDataRef.value = await loadFullData();

    // 加载所有站点的元数据
    await loadAllAddedSiteMetadata(Object.keys(rawDataRef.value.siteDateRange));

    // 从路由中加载默认参数
    const queryDays = Number(route.query.days ?? -1);
    const sitesParam = Array.isArray(route.query.sites)
      ? route.query.sites.map(String)
      : route.query.sites
        ? [String(route.query.sites)]
        : [];

    const dateRange =
      Number.isFinite(queryDays) && queryDays > 0 ? queryDays : configStore.userStatisticControl.dateRange;

    if (typeof dateRange === "number") {
      selectedDateRanges.value = setSubDate(dateRange);
    } else {
      // 不保存上一次自定义时间段的范围，因此上次是自定义时这里默认显示所有数据
      if (dateRange === "custom") {
        configStore.userStatisticControl.dateRange = "all";
      }

      selectedDateRanges.value = allDateRanges.value;
    }

    // 勾选站点，优先使用 route 参数，其次是上次保存的配置，最后是全部站点
    if (sitesParam.length > 0) {
      selectedSites.value = sitesParam;
    } else if ((configStore.userStatisticControl.selectedSites ?? []).length > 0) {
      selectedSites.value = [...configStore.userStatisticControl.selectedSites];
    } else {
      selectedSites.value = allSites.value;
    }
  } catch (e) {
    console.error("UserDataStatistic: 数据加载失败", e);
    useRuntimeStore().showSnakebar(t("UserDataStatistic.loadFailed"), { color: "error" });
  }
});

async function exportStatisticImg() {
  const createdAt = formatDate(new Date());
  const chartsCanvas = Array.from(document.querySelectorAll("#chartContainer canvas")) as HTMLCanvasElement[];
  if (chartsCanvas.length === 0) return;

  // 按屏幕上的实际网格位置拼接（两列/单列自适应都正确）
  const rects = chartsCanvas.map((c) => c.getBoundingClientRect());
  const minX = Math.min(...rects.map((r) => r.left));
  const minY = Math.min(...rects.map((r) => r.top));
  const width = Math.max(...rects.map((r) => r.right)) - minX;
  const height = Math.max(...rects.map((r) => r.bottom)) - minY;

  const mainCanvas = document.createElement("canvas");
  mainCanvas.width = width;
  mainCanvas.height = height + 20; // 底部留出水印行

  const ctx = mainCanvas.getContext("2d") as CanvasRenderingContext2D;

  // 填充白色背景
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, mainCanvas.width, mainCanvas.height);

  // 将 echart 图表渲染到 canvas 上
  for (let i = 0; i < chartsCanvas.length; i++) {
    const chartCanvas = chartsCanvas[i];
    const rect = rects[i];
    ctx.drawImage(chartCanvas, rect.left - minX, rect.top - minY, chartCanvas.clientWidth, chartCanvas.clientHeight);
  }

  // 在 canvas 上添加右对齐文字
  ctx.font = "12px Arial";
  ctx.fillStyle = "#b5b5b5";
  ctx.textAlign = "right";

  ctx.fillText(
    "Created By PT-Depiler (" + __EXT_VERSION__ + ") at " + createdAt,
    mainCanvas.width - 10,
    mainCanvas.height - 6,
  );

  mainCanvas.toBlob((blob) => {
    saveAs(
      blob!,
      t("UserDataStatistic.chart.exportFilename", { name: configStore.getUserName, date: createdAt }) + ".png",
    );
  });
}

function saveControl() {
  configStore.userStatisticControl.selectedSites = selectedSites.value;
  configStore.$save();
  useRuntimeStore().showSnakebar(t("common.saveSuccess"), { color: "success" });
}

// echarts 主题
const echartsTheme = computed(() => (configStore.uiTheme === "dark" ? "dark" : null));
provide(THEME_KEY, echartsTheme);
</script>

<template>
  <!-- 根卡挂 .page-fill：卡片自带白底，撑满一屏就不会在图表下面露出整片灰底 -->
  <a-card variant="outlined" class="page-fill">
    <div class="user-statistic-layout">
      <div id="chartContainer" class="user-statistic-charts">
        <!-- 总上传、总下载、总积分 -->
        <a-card v-if="configStore.userStatisticControl.showChart.totalSiteBase" class="user-statistic-card" size="small" :styles="{ body: { padding: '8px' } }">
          <VChart
            :option="totalSiteBaseInfoChartOptions"
            :style="{ height: `${perChartHeight}px` }"
            autoresize
            class="chart"
            group="totalSiteBase"
          />
        </a-card>
        <!-- 总保种体积、总保种数量 -->
        <a-card v-if="configStore.userStatisticControl.showChart.totalSiteSeeding" class="user-statistic-card" size="small" :styles="{ body: { padding: '8px' } }">
          <VChart
            :option="totalSiteSeedingInfoChartOptions"
            :style="{ height: `${perChartHeight}px` }"
            autoresize
            class="chart"
            group="totalSiteSeeding"
          />
        </a-card>
        <!-- 分站点上传、下载、做种、做种量、积分、时魔值数据 -->
        <template v-for="chart in perSiteCharts" :key="chart.key">
          <a-card
            v-if="
              // @ts-ignore
              configStore.userStatisticControl.showChart[chart.key]
            "
            size="small"
            :styles="{ body: { padding: '8px' } }"
            class="user-statistic-card"
          >
            <VChart
              :group="chart.key"
              :option="chart.options.value"
              :style="{ height: `${perChartHeight}px` }"
              autoresize
              class="chart"
              @mousemove="updateLastHoveredSeriesIndex"
            />
          </a-card>
        </template>
      </div>

      <div class="user-statistic-control">
        <div class="d-flex align-center mb-2">
          <a-button @click="() => router.back()"><template #icon><ArrowLeftOutlined /></template><span>{{ t('common.back') }}</span></a-button>
          <div class="flex-1-1-0" />
          <a-button @click="exportStatisticImg"><template #icon><ExportOutlined /></template><span>{{ t('common.exportImage') }}</span></a-button>
          <a-button type="primary" class="ml-2" @click="saveControl"><template #icon><SaveOutlined /></template><span>{{ t('common.saveSettings') }}</span></a-button>
        </div>

        <a-alert type="info" :title="t('UserDataStatistic.chart.chartStyleSettings')" class="mb-2" />

        <div class="user-statistic-field">
          <span class="user-statistic-field-label">{{ t("common.username") }}</span>
          <div class="user-statistic-field-control d-flex align-center">
            <!-- 文案随状态走：解锁图标 → 提示「锁定」；锁定图标 → 提示「解锁」 -->
            <a-tooltip :title="allowEditName ? t('common.lock') : t('common.unlock')">
              <a-button type="text" size="small" @click="allowEditName = !allowEditName">
                <template #icon>
                  <UnlockOutlined v-if="allowEditName" class="text-green" />
                  <LockOutlined v-else />
                </template>
              </a-button>
            </a-tooltip>
            <!-- AutoComplete 没有 `readonly` prop：不声明的属性会被透传到根 <div readonly>（SSR 实测），
                   压根没到内部 input，锁定状态下照样能打字。用 `disabled`。 -->
            <a-auto-complete
              v-model:value="configStore.userName"
              :options="userNameOptions"
              :disabled="!allowEditName"
              :popup-match-select-width="true"
              class="flex-1-1-0"
            />
            <a-button type="text" size="small" :title="configStore.getUserNames.perfName" @click="configStore.userName = configStore.getUserNames.perfName">
              <template #icon>
                <HistoryOutlined />
              </template>
            </a-button>
          </div>
        </div>

        <div class="user-statistic-field">
          <span class="user-statistic-field-label">{{ t("UserDataStatistic.chart.displayChart") }}</span>
          <div class="user-statistic-field-control user-statistic-chart-toggles">
            <a-checkbox
              v-for="toggle in chartToggles"
              :key="toggle.key"
              :checked="toggle.value"
              @update:checked="(checked: boolean) => setShowChart(toggle.key, checked)"
            >
              {{ t(`UserDataStatistic.chart.${toggle.key}`) }}
            </a-checkbox>
          </div>
        </div>

        <div class="user-statistic-field">
          <span class="user-statistic-field-label">{{ t("UserDataStatistic.chart.dateRange") }}</span>
          <div class="user-statistic-field-control d-flex flex-wrap align-center" style="gap: 8px">
            <a-segmented :value="dateRangePresetValue" :options="dateRangePresetOptions" @change="selectDateRangePreset" />
            <a-popover trigger="click" placement="bottomLeft">
              <a-button size="small" :type="dateRangeControl === 'custom' ? 'primary' : 'default'">
                {{ t("UserDataStatistic.dateRange.custom") }}
              </a-button>
              <template #content>
                <a-range-picker
                  :disabled-date="disabledDateOutsideData"
                  :allow-empty="[false, false]"
                  @change="(_dates: any, dateStrings: [string, string]) => applyCustomDateRange(dateStrings)"
                />
              </template>
            </a-popover>
          </div>
        </div>

        <div class="user-statistic-field">
          <span class="user-statistic-field-label">{{ t("UserDataStatistic.chart.chartSettings") }}</span>
          <div class="user-statistic-field-control">
            <a-input-number
              v-model:value="configStore.userStatisticControl.hidePerSitePrecentThreshold"
              :min="0"
              :max="100"
              :step="1"
              :precision="2"
              size="small"
              addon-after="%"
              class="hide-threshold"
            />
            <div class="field-hint mt-1">{{ t("UserDataStatistic.chart.hideLowPercentHint") }}</div>
          </div>
        </div>

        <div class="d-flex align-center">
          <a-alert
            type="info"
            :title="t('UserDataStatistic.chart.displaySiteSettings')"
            :description="t('UserDataStatistic.chart.hideLowPercentLabel')"
            class="flex-1-1-0"
          />
          <CheckSwitchButton v-model="selectedSites" :all="allSites" class="ml-2" />
        </div>

        <a-checkbox-group v-model:value="selectedSites" class="user-statistic-site-toggles">
          <div v-for="siteId in allSites" :key="siteId" class="user-statistic-site-toggle">
            <a-checkbox :value="siteId" :disabled="!availableSites.includes(siteId)">
              <span class="d-inline-flex align-center">
                <SiteFavicon :site-id="siteId" :size="16" />
                <SiteName :site-id="siteId" class="ml-1" />
              </span>
            </a-checkbox>
          </div>
        </a-checkbox-group>
      </div>
    </div>
  </a-card>
</template>

<style scoped lang="scss">
.user-statistic-layout {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}

.user-statistic-charts {
  flex: 1 1 60%;
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  align-content: start;
}

/* 窄容器（如分屏浏览）退化为单列 */
@media (max-width: 900px) {
  .user-statistic-charts {
    grid-template-columns: 1fr;
  }
}

.user-statistic-control {
  flex: 1 1 320px;
  max-width: 420px;
}

.chart {
  height: 400px;
}

.user-statistic-card {
  border: 1px solid rgba(0, 0, 0, 0.06);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12);
  transition: box-shadow 0.2s ease;

  &:hover {
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
  }
}

.user-statistic-field {
  display: flex;
  align-items: flex-start;
  margin-bottom: 12px;
  gap: 8px;
}

.user-statistic-field-label {
  flex: 0 0 88px;
  padding-top: 4px;
}

.user-statistic-field-control {
  flex: 1 1 auto;
  min-width: 0;
}

.user-statistic-chart-toggles {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px 8px;
}

.user-statistic-site-toggles {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 0;
}

.user-statistic-site-toggle {
  flex: 0 0 25%;
  min-width: 140px;
}

.hide-threshold {
  width: 160px;
}

.field-hint {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
}
</style>
