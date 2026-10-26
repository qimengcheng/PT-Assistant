<script setup lang="ts">
import { computed, ref, shallowRef, type Component } from "vue";
import { useI18n } from "vue-i18n";
import { pickBy } from "es-toolkit";
import { isEmpty } from "es-toolkit/compat";
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  EditOutlined,
  ExclamationCircleOutlined,
  ImportOutlined,
  QuestionCircleOutlined,
  SearchOutlined,
  ToolOutlined,
} from "@zboson/icons";
import { EResultParseStatus, type ISiteMetadata, type ISiteUserConfig, type TSiteID } from "@ptd/site";

import { sendMessage } from "@/messages.ts";
import { filterSitesByKeyword } from "@/shared/siteSearchFilter.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import { useResetableRef } from "@/options/directives/useResetableRef.ts";

import SiteFavicon from "@/options/components/SiteFavicon/Index.vue";
import CheckSwitchButton from "@/options/components/CheckSwitchButton.vue";

import { getCanAddedSiteMetadata } from "./utils.ts";

const showDialog = defineModel<boolean>();

interface IImportStatus {
  isWorking: boolean;
  toWork: TSiteID[];
  working: TSiteID;
  success: TSiteID[];
  failed: TSiteID[];
}

const { ref: importStatus, reset: resetImportStatus } = useResetableRef<IImportStatus>(() => ({
  isWorking: false,
  toWork: [],
  working: "",
  success: [],
  failed: [],
}));

const { t } = useI18n();
const runtimeStore = useRuntimeStore();
const metadataStore = useMetadataStore();

// 获取所有能添加的站点
const canAddSites = shallowRef<Record<TSiteID, ISiteMetadata>>({});

/**
 * `canAddSites` 是哪一份「已添加站点名单」的补集 —— 名单没动过，这一份就没变，
 * 不必再跑一遍：`getCanAddedSiteMetadata()` 是逐个站点取定义的，未添加的两三百个 ——
 * 头一次是两三百次 dynamic import（要等），之后每次重开至少也还是两三百次 await
 * 加上一整轮全量重渲染。名单没变时这些都能整段省掉。
 */
const loadedForAddedIds = shallowRef<string | null>(null);

/**
 * 搜索过滤（用户 2026-10-12：「这个界面应该支持搜索过滤」）。
 * 未添加的站点有几百张卡，原先只能一页一页翻 —— 想找「所有 NexusPHP 的站」或「海胆」都得靠肉眼。
 * 判据在 `@/shared/siteSearchFilter.ts`（能直接跑断言），这里不另写一份字符串匹配。
 */
const keyword = ref("");

const filteredSites = computed(() => filterSitesByKeyword(Object.values(canAddSites.value), keyword.value));

/** 「全选 / 反选」吃的那一份：过滤生效时只选得着**过滤结果里**可自动添加的那些 */
const selectableFilteredIds = computed(() =>
  filteredSites.value.filter((x) => !x.userInputSettingMeta && x.type === "private").map((x) => x.id),
);

const isFiltering = computed(() => keyword.value.trim() !== "");

/** 过滤前那一共多少（计数行右边那个「共 M」） */
const siteTotal = computed(() => Object.keys(canAddSites.value).length);

/**
 * 旧版返回 mdi-xxx 字符串图标，antdv-next 要求组件对象；
 * 分支条件与旧版逐条对应（helper/close/wrench/check/alert/pencil）。
 *
 * ⚠️ 这里原来写的是 `(site) => computed(() => …)`，而模板里每张卡取三次 ——
 * 那等于**每次重渲染都 new 出 3×N 个 computed**（未添加的站点有 239 张卡，一轮 717 个）。
 * 渲染期 `getCurrentScope()` 实测是 undefined（台架 .tmp-build/bench-computed-leak），
 * 所以这些 computed 不归属任何 effect scope；弹窗内容首次打开后又不卸载，
 * 于是除了 Vue 自己在依赖通知时剪掉的，剩下那些（实测堆 +6.8MB vs +2.3MB、
 * 累积后整表重建 3.80ms vs 0.80ms）都是白建白占的。
 *
 * 正解是算一次、存进 Map，模板只做 O(1) 取值。顺带把原来每张卡都要做的
 * `success.includes()` / `toWork.includes()`（各 O(选中数)）换成 Set 查表。
 */
/**
 * 六种状态：图标/颜色与文案各一份，卡片和头部那行图例读的是同一批，不会各说一套。
 *
 * 图例是新加的那一环：状态说明原先挂在每颗图标的原生 title 上，而 239 张卡每卡换一颗
 * 浮层组件要多 ~0.5s（v0.101.6 刚把这页从 9.6s 降到 0.6s），所以把说明从卡片里挪到头部。
 */
type TStatusKind = "manual" | "trying" | "success" | "failed" | "selected" | "none";

const STATUS_ICONS: Record<TStatusKind, { icon: Component; color: string }> = {
  // 需要手动添加 (progress-close)
  manual: { icon: CloseCircleOutlined, color: "purple" },
  // 正在尝试中 (progress-wrench)
  trying: { icon: ToolOutlined, color: "blue" },
  // 已添加成功 (progress-check)
  success: { icon: CheckCircleOutlined, color: "green" },
  // 添加失败 (progress-alert)
  failed: { icon: ExclamationCircleOutlined, color: "red" },
  // 已选择 (progress-pencil)
  selected: { icon: EditOutlined, color: "" },
  // 没选、也没处理过
  none: { icon: QuestionCircleOutlined, color: "grey" },
};

/** 图例的排列顺序 = 一次导入从选到完的流程顺序 */
const STATUS_ORDER: TStatusKind[] = ["selected", "trying", "success", "failed", "manual", "none"];

// computed：标签里有 t()，写成常量切语言不会重算（AGENTS §3.4）
const statusText = computed<Record<TStatusKind, string>>(() => ({
  manual: t("SetSite.oneClickImportDialog.status.manual"),
  trying: t("SetSite.oneClickImportDialog.status.trying"),
  success: t("SetSite.oneClickImportDialog.status.success"),
  failed: t("SetSite.oneClickImportDialog.status.failed"),
  selected: t("SetSite.oneClickImportDialog.status.selected"),
  none: t("SetSite.oneClickImportDialog.status.none"),
}));

const statusLegend = computed(() =>
  STATUS_ORDER.map((kind) => ({
    kind,
    icon: STATUS_ICONS[kind].icon,
    color: STATUS_ICONS[kind].color,
    text: statusText.value[kind],
  })),
);

interface IStatusIcon {
  icon: Component;
  color: string;
}

const statusIcon = computed(() => {
  const status = importStatus.value;
  const success = new Set(status.success);
  const selected = new Set(status.toWork);
  const failed = new Set(status.failed);
  const byId = new Map<TSiteID, IStatusIcon>();

  for (const site of filteredSites.value) {
    const id = site.id;
    if (site.userInputSettingMeta) {
      byId.set(id, STATUS_ICONS.manual);
    } else if (status.working === id) {
      byId.set(id, STATUS_ICONS.trying);
    } else if (success.has(id)) {
      byId.set(id, STATUS_ICONS.success);
    } else if (failed.has(id)) {
      byId.set(id, STATUS_ICONS.failed);
    } else if (selected.has(id)) {
      byId.set(id, STATUS_ICONS.selected);
    } else {
      byId.set(id, STATUS_ICONS.none);
    }
  }

  return { byId, success };
});

function statusIconProp(siteId: TSiteID): IStatusIcon {
  return statusIcon.value.byId.get(siteId) ?? STATUS_ICONS.none;
}

async function doAutoImport() {
  importStatus.value.isWorking = true;
  importStatus.value.failed = [];

  // 遍历所有需要添加的站点，在遍历过程中我们不更新 siteHostMap 和 siteNameMap
  for (const site of importStatus.value.toWork) {
    if (importStatus.value.success.includes(site)) {
      continue; // 如果已经添加成功，则跳过
    }

    importStatus.value.working = site;

    try {
      let isThisSiteSuccess = false;

      // 拿到 siteMetadata, siteUserConfig
      const siteMetadata = canAddSites.value[site] as ISiteMetadata;
      const siteUserConfig = (await metadataStore.getSiteUserConfig(site, true)) as ISiteUserConfig;

      // 对于 public 站点，不需要额外测试是否能够搜索
      if (siteMetadata.type === "public") {
        // 直接将该站点设置存入 metadataStore
        await metadataStore.addSite(site, siteUserConfig, { reBuildMap: false }); // 抑制 site{Name, Host}Map 更新
        isThisSiteSuccess = true;
      } else {
        // 遍历所有 private site 预设的 urls ，找到用户实际使用的 url
        for (const siteUrl of siteMetadata.urls) {
          siteUserConfig.url = siteUrl;
          // 临时将该设置存入 metadataStore
          await metadataStore.addSite(site, siteUserConfig, { reBuildMap: false });
          const { status: testStatus } = await sendMessage("getSiteSearchResult", { siteId: site });
          if (testStatus === EResultParseStatus.success) {
            isThisSiteSuccess = true; // 如果搜索成功，说明该站点可以自动添加
            break;
          }
        }
      }

      if (isThisSiteSuccess) {
        importStatus.value.success.push(site);
      } else {
        importStatus.value.failed.push(site);
        // 如果搜索失败，说明该站点不能自动添加，移除在 metadataStore 中临时添加的配置项
        await metadataStore.removeSite(site, { reBuildMap: false });
      }
    } catch (e) {
      importStatus.value.failed.push(site);
      // ⚠️ catch 分支同样要把临时配置清掉：上面 addSite() 已经落库了，
      // 而 getSiteUserConfig / sendMessage 抛错（网络、SW 挂了、动态 import 失败）
      // 会直接跳到这里 —— 只记 failed 而不清理，站点就以「已添加但连不上」的
      // 状态留在库里，还会进 buildSiteMapCache（后面 addSite 时按 host/name
      // 建索引，于是站点列表里多出一个永远搜不出东西的条目）。
      console.error(`[OneClickImport] 导入站点失败：${site}`, e);
      try {
        await metadataStore.removeSite(site, { reBuildMap: false });
      } catch (cleanupError) {
        // 清理本身失败不能再抛出去打断整批 —— 但要记下来，
        // 否则用户看到「导入失败」却不知道库里还留着一条脏数据
        console.error(`[OneClickImport] 回退站点失败：${site}`, cleanupError);
      }
    }
  }

  importStatus.value.working = "";
  importStatus.value.isWorking = false;
  importStatus.value.toWork = [];

  // 所有导入完成，重构 site{Host, Name}Map
  await metadataStore.buildSiteMapCache(true);

  // 有失败站点时不能再弹 success：旧逻辑无视 failed 一律报「导入完成」，全失败也显示成功
  if (importStatus.value.failed.length > 0) {
    runtimeStore.showSnakebar(
      t("SetSite.oneClickImportDialog.stats", {
        count: importStatus.value.success.length + importStatus.value.failed.length,
        success: importStatus.value.success.length,
        failed: importStatus.value.failed.length,
      }),
      { color: "warning", timeout: 8 },
    );
  } else {
    runtimeStore.showSnakebar(
      t("SetSite.oneClickImportDialog.importComplete", { count: importStatus.value.success.length }),
      { color: "success" },
    );
  }
}

async function dialogEnter() {
  resetImportStatus(); // 重置状态
  keyword.value = ""; // 上次筛的那一串不该留给下一次打开

  // 「待添加」就是全部定义的补集：已添加的那份名单没动过，这一份就没变，整段取数
  // 连同那一次全量重渲染都可以跳过（判据与代价见 `loadedForAddedIds` 那条注释）。
  const addedIds = Object.keys(metadataStore.sites).sort().join(",");
  if (loadedForAddedIds.value === addedIds) return;

  const allCanAddedSite = await getCanAddedSiteMetadata(); // 加载待添加站点
  canAddSites.value = pickBy(allCanAddedSite, (site) => site.isDead !== true) as Record<string, ISiteMetadata>;
  loadedForAddedIds.value = addedIds;
}
</script>

<template>
  <!-- ⚠️ 原来这里写 :styles="{ body: { maxHeight: '…vh', overflowY: 'auto' } }"，
       把 style.css 那套布局算出来的 body 高度覆盖成了手写常数（AGENTS.md §3.4 点名的
       那一族）。body 的高度交给全局规则算即可。 -->
  <a-modal
    v-model:open="showDialog"
    :title="t('SetSite.oneClickImportDialog.title')"
    :width="1000"
    :closable="!importStatus.isWorking"
    :mask="{ closable: !importStatus.isWorking }"
    :keyboard="!importStatus.isWorking"
    :after-open-change="(open: boolean) => open && dialogEnter()"
  >

    <a-alert class="mb-2" type="warning" show-icon :title="t('SetSite.oneClickImportDialog.alert1')" />

    <a-alert class="mb-1" type="info" :title="t('SetSite.oneClickImportDialog.alert2')">
      <template #description>
        <span>
          {{
            t("SetSite.oneClickImportDialog.stats", {
              count: importStatus.toWork.length,
              success: importStatus.success.length,
              failed: importStatus.failed.length,
            })
          }}
        </span>
        <span v-if="importStatus.isWorking">
          {{ t("SetSite.oneClickImportDialog.trying", { name: canAddSites[importStatus.working].name }) }}
        </span>
        <!-- 六种状态的图例。卡片右上角那颗图标不再挂提示：239 张卡每卡多一颗浮层组件要多
             ~0.5s（v0.101.6 刚把这页从 9.6s 降到 0.6s），所以说明从每卡挪到这里，一次画完。
             图标沿用全局 `.cell-icon`（那 0.5px 的光学补偿也在这一条上）。 -->
        <div class="status-legend d-flex align-center flex-wrap">
          <span v-for="item in statusLegend" :key="item.kind" class="status-legend-item d-flex align-center">
            <component :is="item.icon" class="cell-icon" :style="{ color: item.color || undefined }" />
            {{ item.text }}
          </span>
        </div>
      </template>
      <template #action>
        <!-- 原先这里包了一层 a-space :size="4"，对多根组件不起作用（它只数得见一个孩子），
             缝现在由 CheckSwitchButton 自己给，那层壳留着只会多套一层 -->
        <CheckSwitchButton v-model="importStatus.toWork" :all="selectableFilteredIds" />
      </template>
    </a-alert>

    <!-- 过滤那一行：输入框在工具条那一档就是默认档（32px），不写 size -->
    <div class="site-filter mb-2">
      <a-input
        v-model:value="keyword"
        allow-clear
        :placeholder="t('SetSite.oneClickImportDialog.searchPlaceholder')"
        style="width: 320px; max-width: 100%"
      >
        <template #prefix>
          <SearchOutlined />
        </template>
      </a-input>
      <span v-if="isFiltering" class="site-filter-count">
        {{ t("SetSite.oneClickImportDialog.filterCount", { n: filteredSites.length, total: siteTotal }) }}
      </span>
    </div>

    <a-skeleton v-if="isEmpty(canAddSites)" active :paragraph="{ rows: 8 }" class="site-skeleton" />
    <div v-else-if="filteredSites.length === 0" class="site-filter-empty">
      {{ t("SetSite.oneClickImportDialog.filterEmpty", { keyword: keyword.trim() }) }}
    </div>
    <!-- 这一片每张卡原来是 25 个组件实例，主成本是 a-typography-text 的 :ellipsis：
         它一个就占约 15 个，并且每卡挂载时同步量一次 DOM。同一台架、暖机后、239 张卡，
         改前后各一趟（?cut=full / ?cut=fix）：
           首挂 9643ms → 601ms、勾一颗 8065ms → 89ms、过滤框敲一个字 2291ms → 24ms、
           实例/卡 25.3 → 9.3。
         截断按 AGENTS.md §3.4 走 CSS 写法，顺带修掉一处静默失效：:ellipsis 要把子节点折成
         纯文本，原来那个 <b> 的加粗其实从没生效过。
         站点名不挂悬停浮层：340 条定义的 name 逐个摆进真字号里量，最宽的一条（SkipTheCommercials）
         是 137px（14px 档，产品那档 13px 约 127px），而三列布局下这张卡留给名字的宽度约 190px
         —— 一条都截不到，属 §3.4「文字本来就已完整铺开」那族豁免，挂上去只是重复一遍。
         .text-truncate 仍然留着：窄窗口真截到时也不会撑破卡片。 -->
    <a-checkbox-group v-else v-model:value="importStatus.toWork" class="site-grid">
      <div v-for="site in filteredSites" :key="site.id" class="site-card">
        <a-checkbox
          :value="site.id"
          :indeterminate="!!site.userInputSettingMeta || statusIcon.success.has(site.id)"
          :disabled="!!site.userInputSettingMeta || importStatus.isWorking || statusIcon.success.has(site.id)"
        />
        <SiteFavicon :site-id="site.id" :size="28" class="mr-2" flush-on-click />
        <div class="site-card-main">
          <b class="site-name text-truncate">{{ site.name ?? "" }}</b>
          <a-tag :color="site.type === 'private' ? 'blue' : 'default'">
            {{ site.schema ?? (site.type === "private" ? "AbstractPrivateSite" : "AbstractBittorrentSite") }}
          </a-tag>
        </div>
        <!-- 状态说明不再挂在每颗图标上：这里曾是原生 title，而 239 张卡每卡多一颗浮层组件
             要多 ~0.5s（v0.101.6 刚把这页从 9.6s 降到 0.6s，翻倍不能接受）。
             所以改成下面那行图例 —— 一次渲染，六种状态一次说清，卡片本身零浮层。 -->
        <a
          :href="site.urls[0]"
          target="_blank"
          rel="noopener noreferrer nofollow"
        >
          <component
            :is="statusIconProp(site.id).icon"
            :style="{ color: statusIconProp(site.id).color }"
            class="status-icon"
          />
        </a>
      </div>
    </a-checkbox-group>

    <template #footer>
      <a-button size="small" type="text" danger :disabled="importStatus.isWorking" @click="showDialog = false">
        <template #icon>
          <CloseCircleOutlined />
        </template>
        <span class="ml-1">{{ t("common.dialog.cancel") }}</span>
      </a-button>

      <a-button size="small" type="primary" :disabled="importStatus.isWorking" @click="doAutoImport">
        <template #icon>
          <ImportOutlined />
        </template>
        <span class="ml-1">{{ t("common.import") }}</span>
      </a-button>
    </template>
  </a-modal>
</template>

<style scoped lang="scss">
.site-skeleton {
  padding: 12px;
}

/* 过滤那一行：输入框 + 计数，缝由 gap 给（全站口径：任何界面不许两个控件零间距贴边） */
.site-filter {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
}

/* 状态图例：整行放在说明那条 alert 里，缝 4/12（项内 4、项间 12） */
.status-legend {
  gap: 4px 12px;
  width: 100%;
}
.status-legend-item {
  gap: 4px;
}

.site-filter-count {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.55);
}

.site-filter-empty {
  padding: 24px 12px;
  text-align: center;
  color: rgba(0, 0, 0, 0.45);
}

/* 卡片直接做网格项，不再套 a-row/a-col：那两层壳每卡多两个组件实例，同一台架里
   单独去掉它们那趟量到 779ms → 611ms（约两成）。列数按原来 :span=24 / :sm=12 / :md=8
   的断点逐档翻成 media query —— antd 的 sm/md 就是 576/960 的 min-width，同样按视口宽度算，
   所以界面列数与改之前一致。 */
.site-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
  overflow: hidden;
  padding: 12px;
}

@media (min-width: 576px) {
  .site-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (min-width: 960px) {
  .site-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

.site-card {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  padding: 8px;
  background-color: rgba(0, 0, 0, 0.02);
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 6px;
}

.site-card-main {
  flex: 1 1 0;
  min-width: 0;
  margin-right: 8px;
}

/* text-overflow 只在不换行的块级元素上出省略号，所以这里必须是块（AGENTS.md §3.4） */
.site-name {
  display: block;
  min-width: 0;
}

.status-icon {
  font-size: 28px;
}
</style>
