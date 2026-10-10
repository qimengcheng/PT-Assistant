<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useBreakpoint } from "antdv-next";
import { BranchesOutlined, CheckCircleFilled, GlobalOutlined, HddOutlined } from "@antdv-next/icons";

import { useConfigStore } from "@/options/stores/config.ts";
import { formatSize } from "@/options/utils.ts";
import { findBestReseedGroup } from "@/shared/bestReseed.ts";
import type { ISearchResultTorrent } from "@/shared/types/storages/runtime.ts";

import { tableCustomFilter } from "./utils/filter.ts";

import SiteName from "@/options/components/SiteName.vue";
import SiteFavicon from "@/options/components/SiteFavicon/Index.vue";
import KeepUploadDialog from "./KeepUploadDialog.vue";

const { selectedTorrents, allTorrents } = defineProps<{
  selectedTorrents: ISearchResultTorrent[];
  /** 当前这一份结果（已过筛选器、含没翻页看到的），「最佳辅种」按整份算 */
  allTorrents: ISearchResultTorrent[];
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

/**
 * 「最佳辅种」：这批结果里被最多站点同时收录的那一份（判据、以及为什么按「字节完全相同」
 * 算，都在 src/shared/bestReseed.ts）。没有任何一档被 ≥2 站共有时返回 null，这颗 chip 就不出。
 */
const bestGroup = computed(() => findBestReseedGroup(allTorrents));

const showBestReseedDialog = ref(false);
/**
 * 点的那一刻把这一批快照下来再交给弹窗。搜索结果是一个站点一个站点陆续回包的，
 * 直接绑 bestGroup.items 会让弹窗**开着的时候**换列表 —— 那个弹窗的基准选择、
 * 指纹比对都是在打开时算的，中途换输入不会重算，只会对不上账。
 */
const bestReseedItems = ref<ISearchResultTorrent[]>([]);

function openBestReseedDialog() {
  const group = bestGroup.value;
  if (!group) return;
  bestReseedItems.value = [...group.items];
  showBestReseedDialog.value = true;
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

        <!-- 最佳辅种：这批结果里被最多站点共有的那一份，点一下直接开辅种检测，
             要辅种哪几条由判据选好（不重排、不要求用户先勾）。 -->
        <template v-if="bestGroup">
          <a-divider orientation="vertical" class="mx-2" />
          <a-tooltip :title="t('SearchEntity.bestReseed.tip')">
            <a-tag class="chip chip_limit_width" color="green" @click.stop="openBestReseedDialog">
              <span class="chip-inner">
                <BranchesOutlined />
                {{ t("SearchEntity.bestReseed.hint", { size: formatSize(bestGroup.size), count: bestGroup.siteCount }) }}
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
  /* chip 之间原先靠每颗自带 mr-1（4px），「全部」那颗没有 → 两颗零间距贴边。
     改成容器给 gap，颗颗同缝，也不再有人多出 4px（那条 mb-1 还会把整排顶高 2px，见下）。 */
  gap: 4px;
  margin-inline-start: 8px;
  /* 不需要再补 min-width:0：flex item 的 min-width:auto 只对**非滚动容器**才等于内容宽，
     这一条自己有 overflow-x:auto，规范里那个 auto 已经折成 0。台架 600px 容器实测：
     提示条 scrollWidth == clientWidth（574，零溢出），超出部分由这一条自己横滚（462 > 289）。 */
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
