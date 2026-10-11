<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useBreakpoint } from "antdv-next";
import { AimOutlined, BranchesOutlined, CheckCircleFilled, GlobalOutlined, HddOutlined, UnorderedListOutlined } from "@antdv-next/icons";

import { useConfigStore } from "@/options/stores/config.ts";
import { formatSize } from "@/options/utils.ts";
import { findAllReseedGroups, type IReseedGroup } from "@/shared/bestReseed.ts";
import { ETorrentStatus } from "@ptd/site";
import type { ISearchResultTorrent } from "@/shared/types/storages/runtime.ts";
import { TORRENT_STATUS_META } from "./torrentStatusMeta.ts";

import { tableCustomFilter } from "./utils/filter.ts";

import SiteName from "@/options/components/SiteName.vue";
import SiteFavicon from "@/options/components/SiteFavicon/Index.vue";
import KeepUploadDialog from "./KeepUploadDialog.vue";
import ReseedGroupDialog from "./ReseedGroupDialog.vue";

const { selectedTorrents, allTorrents } = defineProps<{
  selectedTorrents: ISearchResultTorrent[];
  /** 当前这一份结果（已过筛选器、含没翻页看到的），「最佳辅种」按整份算 */
  allTorrents: ISearchResultTorrent[];
}>();

const { t } = useI18n();
const configStore = useConfigStore();
const emit = defineEmits<{ locate: [rows: ISearchResultTorrent[]] }>();

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

/**
 * 这批结果里所有可辅种的一档一档（判据、以及为什么按「字节完全相同」算，都在
 * src/shared/bestReseed.ts）。排第一的就是那颗 chip。没有任何一档被 ≥2 站共有时是空数组，
 * chip 和「更多」都不出。
 */
const reseedGroups = computed(() => findAllReseedGroups(allTorrents));
const bestGroup = computed(() => reseedGroups.value[0] ?? null);

const showBestReseedDialog = ref(false);
const showReseedGroupDialog = ref(false);
/**
 * 点的那一刻把这一批快照下来再交给弹窗。搜索结果是一个站点一个站点陆续回包的，
 * 直接绑 bestGroup.items 会让弹窗**开着的时候**换列表 —— 那个弹窗的基准选择、
 * 指纹比对都是在打开时算的，中途换输入不会重算，只会对不上账。
 * 「更多」那一屏同理，所以它吃的是打开那一刻的组列表，不是活算的 computed。
 */
const bestReseedItems = ref<ISearchResultTorrent[]>([]);
const pickedGroups = ref<IReseedGroup<ISearchResultTorrent>[]>([]);

/** chip 与「更多」里挑中的那一组，走的是同一条路：选好种子 → 开辅种检测 */
function useReseedGroup(group: IReseedGroup<ISearchResultTorrent> | null | undefined) {
  if (!group) return;
  bestReseedItems.value = [...group.items];
  showReseedGroupDialog.value = false;
  showBestReseedDialog.value = true;
}

function openBestReseedDialog() {
  useReseedGroup(bestGroup.value);
}

/**
 * 那颗定位图标：把这一组在列表里的位置找出来。排序、翻页、滚动都住在页面那一层
 * （只有它拿着 a-table 和分页状态），这里只递出「要跳到的是哪几行」——
 * 递的是快照，理由与上面开弹窗那条一样：结果是一条一条陆续回包的。
 */
function locateBestGroup() {
  if (bestGroup.value) emit("locate", [...bestGroup.value.items]);
}

function openReseedGroupDialog() {
  pickedGroups.value = reseedGroups.value.map((group) => ({ ...group, items: [...group.items] }));
  showReseedGroupDialog.value = true;
}

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

/** 下拉里的五档（标签现取：切语言要跟着变） */
const statusOptions = computed(() =>
  TORRENT_STATUS_META.map((meta) => ({ value: meta.value as string, label: t(meta.labelKey) }))
);

/**
 * 这批结果里**真的报得出**哪些做种状态。取的是 `advanceItemPropsRef.status` —— 那份由
 * `utils/search.ts` 在搜索队列空闲时从**未过滤**的整份结果算出来，所以：
 * ① 用它当「这颗下拉有没有意义」的判据不会被自己的筛选结果反过来影响（选了「做种中」之后
 *    下拉不该只剩一档）；② 站点一条都不报这一列时整颗下拉不出 —— 一排只有「未知」可选的
 *    筛选器等于把全部结果再筛一遍，是噪音。
 */
const knownStatuses = computed<string[]>(() => (advanceItemPropsRef.value.status as string[]) ?? []);
const statusFilterShown = computed(() => knownStatuses.value.some((value) => value !== ETorrentStatus.unknown));

/** 当前选中的档：直接读那份筛选字典，不另起第二份状态（对话框改了我们这边跟着变） */
const statusFilter = computed<string[]>(() => (advanceFilterDictRef.value.status?.required as string[]) ?? []);

/**
 * 只动 `required`，`exclude` 原样留着 —— 这一颗和高级筛选对话框写的是**同一个字段**，
 * 清空下拉不该把人在对话框里勾的那几项「不要」一起抹掉。代价是这一排看不见排除项（对话框里看得见）。
 */
function onStatusFilterChange(value: unknown) {
  const dict = advanceFilterDictRef.value.status;
  if (!dict) return;
  dict.required = Array.isArray(value) ? (value as string[]) : [];
  updateTableFilterValueFn();
}

/**
 * v-chip-group(filter + mandatory) 在 antd 里没有等价物，改为可横向滚动的 a-tag 行：
 * 选中项用实心 tag 表示，点任意一个站点即快速筛选该站点。
 *
 * 2026-10-07 复核过 a-checkable-tag-group 这条退路（旧注释写的「渲染不了站点图标 + 站点名」
 * 不准确，别按它下结论）：它的 options[].label 是走 CheckableTag 默认插槽渲染的，塞 VNode
 * 可以带图标。真正不用它的原因是另一条 —— 未选中态是 `background-color: transparent` +
 * `border-color: transparent`（tag/style/index.js 的 `&-checkable`），在这块淡蓝 alert 上
 * 看着就是一行裸文字，不像可点的 chip。
 *
 * ⚠️ 一颗 chip 的整包内容必须是**一个**子节点（下面统一包 `.chip-inner`）。
 * dist/tag/index.js 取的是 `filterEmpty(slots?.default?.())[0]` —— 图标和站名并列成两颗
 * 子节点时，站名被静默丢掉，这一排从平移过来就一直只剩图标（台架 .tmp-build/bench-chips
 * 量到 chip 的 textContent 是空串、childElementCount=1）。和 a-alert / a-select 不读默认
 * 插槽是同一族，见 AGENTS §3.4。
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
            class="chip chip_limit_width chip_white"
            :class="{ chip_content_hidden_fix: smAndDown }"
            @click.stop="clearSiteFilter"
          >
            <span class="chip-inner">
              <GlobalOutlined />
              {{ smAndDown ? "" : t("SearchEntity.siteFilter.all") }}
            </span>
          </a-tag>

          <!-- 分站点选项（可横向滚动，对应 v-chip-group 的 scroll-to-active + show-arrows） -->
          <div class="site-filter-scroll d-flex flex-nowrap align-center">
            <a-tag
              v-for="siteId in advanceItemPropsRef.site"
              :key="siteId"
              :color="siteId === selectedSite ? 'blue' : undefined"
              :variant="siteId === selectedSite ? 'solid' : 'outlined'"
              :class="['chip', { chip_white: siteId !== selectedSite }]"
              @click.stop="selectSite(siteId)"
            >
              <span class="chip-inner">
                <SiteFavicon :site-id="siteId" :size="14" />
                <SiteName :site-id="siteId" tag="span" />
              </span>
            </a-tag>
          </div>
        </template>

        <!-- 做种状态快速筛选。这一档原先只能从「过滤搜索结果」那颗漏斗打开的高级筛选对话框里挑，
             而它恰恰是挑辅种候选时最常按的一档（哪几站报「我在做种」、哪几站是「我没下过」）。
             写的是**同一份**筛选字典（`advanceFilterDictRef.status`），不另起第二条过滤路径：
             这一排、那颗漏斗里的对话框、上面那排站点 chip 看到的永远是同一个条件。
             宽度写在行内 style：a-select 的根元素拿不到本组件的 data-v-*，scoped class 选不中它。 -->
        <a-select
          v-if="statusFilterShown"
          :value="statusFilter"
          mode="multiple"
          :max-tag-count="1"
          :options="statusOptions"
          :placeholder="t('SearchEntity.statusFilter.label')"
          :popup-match-select-width="false"
          allow-clear
          style="margin-inline-start: 8px; min-width: 128px; max-width: 220px"
          @change="onStatusFilterChange"
        />

        <!-- 最佳辅种：这批结果里被最多站点共有的那一份，点一下直接开辅种检测，
             要辅种哪几条由判据选好（不重排、不要求用户先勾）。 -->
        <template v-if="bestGroup">
          <a-divider orientation="vertical" class="mx-2" />
          <!-- 定位：同一份数据那几条散在几十行里（大小相同的那些就是它们），这颗把它们找出来 ——
               没按大小排序时先按大小排、翻到它们所在那一页、滚进视野。
               单独一颗而不并进右边那颗 chip：那颗点下去是开辅种检测，两件事不该共用一个点击区。 -->
          <a-tooltip :title="t('SearchEntity.bestReseed.locate')">
            <span class="locate-btn" @click="locateBestGroup">
              <AimOutlined />
            </span>
          </a-tooltip>
          <a-tooltip :title="t('SearchEntity.bestReseed.tip')">
            <a-tag class="chip chip_limit_width" color="green" @click.stop="openBestReseedDialog">
              <span class="chip-inner">
                <BranchesOutlined />
                {{ t("SearchEntity.bestReseed.hint", { size: formatSize(bestGroup.size), count: bestGroup.siteCount }) }}
              </span>
            </a-tag>
          </a-tooltip>
          <!-- 「更多」：chip 那一档往往也是最大的一档（全集 2160p），想换小一档得能看见其余每一档。
               只有一档可挑时这颗不出（没有可挑的，摆一颗开了个空列表是纯噪音）。
               样式跟站点 chip 同族（白底描边）而不是 a-button：这一排的高度由 chip 定，
               默认档按钮 32px 会把整条提示撑高。 -->
          <a-tooltip v-if="reseedGroups.length > 1" :title="t('SearchEntity.reseedGroups.tip', { count: reseedGroups.length })">
            <a-tag class="chip chip_limit_width chip_white" @click.stop="openReseedGroupDialog">
              <span class="chip-inner">
                <UnorderedListOutlined />
                {{ t("SearchEntity.reseedGroups.button") }}
              </span>
            </a-tag>
          </a-tooltip>
        </template>

        <div class="flex-1-1-0" />

        <!-- 挂在上面那一排里、不与 a-alert 并列，是为了保住**单根**：Index.vue 用
             `class="site-filter-notice"` 引这个组件，模板一旦变成双根 fragment，那个 class
             就无处可挂、被 Vue 静默丢掉。Modal 自己 portal 到 body，不参与这一排的 flex。
             ⚠️ 这里**不许**加 `v-if="bestReseedItems.length"`：那个弹窗的全部初始化挂在
             `watch(showDialog)`（不带 immediate）上，而 items 和 open 是同一拍置的 ——
             挂上去时 showDialog 已经是 true，watcher 一次都不触发，候选表永远是空的
             （台架 .tmp-build/bench-bestreseed 第一版就是这么抓到的）。不挂 v-if 也不额外花钱：
             工具条那颗 ActionTd 本来就常驻着一份同组件实例。 -->
        <KeepUploadDialog v-model="showBestReseedDialog" :torrent-items="bestReseedItems" />

        <!-- 「更多」挑中一组 = 把 chip 那一批换成这一组，之后开的是上面同一个辅种检测弹窗。
             这一颗**可以**挂 v-if（它的数据是 props 到了才渲染的表格，没有挂在 watch(打开标志) 上的初始化），
             但没必要：不挂也不多花一分钱。 -->
        <ReseedGroupDialog v-model="showReseedGroupDialog" :groups="pickedGroups" @pick="useReseedGroup" />

        <!-- 选中种子信息条 -->
        <a-divider orientation="vertical" class="mx-2" />
        <!-- 这里原本给 a-tag 传了 `bordered` 属性，已删。结论不变（换 variant 走官方路线），
             但「渲染层完全忽略」这个说法不准确：antdv-next 1.5.6 的 Tag 确实声明了
             bordered?: boolean（无 @deprecated），hooks/useColor.js:16 真读它，语义是**降级**
             —— bordered === false 时强制把 variant 压成 filled（默认值是 true）。
             也就是说它只能「取消描边」，永远造不出描边；
             真正切换实心/描边的是 variant="solid" / variant="outlined"，已按它改写。 -->
        <a-tag class="my-2 chip chip_limit_width" color="blue">
          <!-- 同样必须是**一个**子节点：这里原先五颗并列（图标 / 条数 / 分隔线 / 图标 / 大小），
               a-tag 只渲染第一颗，界面上就只剩一个对勾，条数和大小整个静默丢掉。 -->
          <span class="chip-inner">
            <CheckCircleFilled />
            {{
              smAndDown
                ? selectedTorrentsInfo.count
                : t("SearchEntity.index.selectedTorrents", [selectedTorrentsInfo.count])
            }}
            <a-divider orientation="vertical" class="mx-2" />
            <HddOutlined />
            {{ formatSize(selectedTorrentsInfo.totalSize) }}
          </span>
        </a-tag>
      </div>
    </template>
  </a-alert>
</template>

<style lang="scss" scoped>
.chip_limit_width {
  min-width: fit-content;
}

/**
 * 未选中的 chip 换白底：antd 的灰底（台架实测 .ant-tag-filled 算出 rgb(245,245,245)）落在
 * a-alert 的淡蓝底上很脏（用户 2026-10-07 指的就是这块）。Tag 的 API 给不出「白底深字」：
 * color="#fff" 走 filled 分支时 useColor 把文字也刷成传入色（白底白字），走 solid 分支时
 * 文字固定 colorTextLightSolid（也是白）；components.Tag.defaultBg 能改，但会连带整棵子树里
 * 所有 tag。所以按实测强度写这一条：scoped 后是 .chip_white.ant-tag[data-v-…] (0,3,0)，
 * 压过 cssinjs 运行时注入的 .css-var-….ant-tag (0,2,0) —— 不靠文档顺序，也不用 !important。
 */
.chip_white.ant-tag {
  background-color: #fff;
}

.site-filter-scroll {
  overflow-x: auto;
  /* 这一条的滚动条不许占布局。全局那条 `scrollbar-width: thin`（style.css）是**经典**滚动条，
     要真吃掉 10px 高：chip 一多到溢出，这一格就被顶高 10px，而父级是 align-center 的 flex ——
     行变高之后外面那几颗（「全部站点」/「已选中 N 条」）跟着居中到新的行中线，里面这排还贴在顶部，
     台架 .tmp-build/bench-chips 实测差 **5.2px**（正好半个滚动条），界面表现就是他报的
     「满了之后这块会往上偏移，没有水平对齐」。改成不画轨道、只保留可滚（滚轮 / 触控板 / 拖选照旧）：
     右边那颗被切一半的 chip 已经是「还有更多」的提示，不靠这条 10px 的轨道说话。
     两套写法都给，与 style.css 那条同口径（老 Chrome / Edge 只认伪元素那条）。 */
  scrollbar-width: none;
  /* chip 之间原先靠每颗自带 mr-1（4px），「全部」那颗没有 → 两颗零间距贴边。
     改成容器给 gap，颗颗同缝，也不再有人多出 4px（那条 mb-1 还会把整排顶高 2px，见下）。 */
  gap: 4px;
  margin-inline-start: 8px;
  /* 不需要再补 min-width:0：flex item 的 min-width:auto 只对**非滚动容器**才等于内容宽，
     这一条自己有 overflow-x:auto，规范里那个 auto 已经折成 0。台架 600px 容器实测：
     提示条 scrollWidth == clientWidth（574，零溢出），超出部分由这一条自己横滚（462 > 289）。 */
}

.site-filter-scroll::-webkit-scrollbar {
  width: 0;
  height: 0;
}

/**
 * 一颗 chip 的整包内容（图标 + 文字）。四条都是台架 .tmp-build/bench-chips 逐条量出来的，
 * 每条对应一种「把它撤掉就复现」的坏形状：
 * 1. 整包必须是**一个**子节点 —— a-tag 的默认插槽取的是 `filterEmpty(…)[0]`，两颗并列时
 *    第二颗被静默丢掉（这一排从 Vuetify 平移过来就一直只剩图标：chip 的 childElementCount=1、
 *    textContent 是空串）。右边那颗「已选中 N 条 · 大小」同理，原先五颗并列只剩一个对勾。
 * 2. `display:flex + align-items:center`：退回 inline 排列时，图标盒中心比站名盒中心低 **2.3px**
 *    （就是「里面的图标没垂直居中」）；加了这两条之后 6 颗 chip 的差全是 **0px**。
 * 3. `height: 14px`：不钉的话每颗的内容盒高跟着自己最高的那个孩子走，实测三种 10 / 11.7 / 14，
 *    top 也差 ~2px —— 一排 chip 的盒子不同位，看着就是歪的。钉死后 8 颗全是 `20.9+14`。
 * 4. `vertical-align: middle`：inline-flex 的基线由它第一个 flex 子项给，而图标（块化的替换元素）
 *    的基线是它的**下沿**，于是 14px 那颗整体被抬起来，chip 高会分成 19.6 与 20.8 两种。
 */
.chip-inner {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 14px;
  vertical-align: middle;
}

/** chip 本体不许带上下外边距：父级是 align-center 的 flex，单侧 mb-1 会让这一排比左边那颗高 2px */
.chip.ant-tag {
  margin-block: 0;
}

/**
 * 那颗定位图标。高度钉成 14px 与右边 chip 的内容盒同档（`.chip-inner` 那条实测），
 * 不然它按自己的行盒算高，这一排里会比旁边的图标高/低一两像素。
 * 颜色一律继承（不写死）：这颗落在淡蓝的 alert 上，图标要跟正文同色才够对比度。
 */
.locate-btn {
  display: inline-flex;
  align-items: center;
  height: 14px;
  margin-inline-end: 4px;
  cursor: pointer;
}

/**
 * 在窄屏下，「全部站点」这一项的文字内容被隐藏（见模板中的 smAndDown），
 * 只剩一颗图标，这里把它压紧，避免图标两侧留白过大。
 * （原先这条还顺手清了 `.ant-tag-icon` 的外边距 —— 那颗是 a-tag 的 icon 插槽产生的，
 * 现在内容统一包在 .chip-inner 里、不再走 icon 插槽，那条已经是死规则，删掉。）
 */
.chip_content_hidden_fix {
  padding: 0 5px !important;
}

/**
 * a-alert 的内容统一渲染在 .ant-alert-title 里（默认字重 500），
 * 而这里原本是 v-alert 的默认插槽（常规字重），还原成常规字重。
 */
:deep(.ant-alert-title) {
  font-weight: 400;
}
</style>
