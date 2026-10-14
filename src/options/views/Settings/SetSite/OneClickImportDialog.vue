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
} from "@antdv-next/icons";
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
interface IStatusIcon {
  icon: Component;
  color: string;
  title: string;
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
      // 需要手动添加 (progress-close)
      byId.set(id, {
        icon: CloseCircleOutlined,
        color: "purple",
        title: t("SetSite.oneClickImportDialog.status.manual"),
      });
    } else if (status.working === id) {
      // 正在尝试中 (progress-wrench)
      byId.set(id, {
        icon: ToolOutlined,
        color: "blue",
        title: t("SetSite.oneClickImportDialog.status.trying"),
      });
    } else if (success.has(id)) {
      // 已添加成功 (progress-check)
      byId.set(id, {
        icon: CheckCircleOutlined,
        color: "green",
        title: t("SetSite.oneClickImportDialog.status.success"),
      });
    } else if (failed.has(id)) {
      // 添加失败 (progress-alert)
      byId.set(id, {
        icon: ExclamationCircleOutlined,
        color: "red",
        title: t("SetSite.oneClickImportDialog.status.failed"),
      });
    } else if (selected.has(id)) {
      // 已选择 (progress-pencil)
      byId.set(id, { icon: EditOutlined, color: "", title: t("SetSite.oneClickImportDialog.status.selected") });
    } else {
      byId.set(id, { icon: QuestionCircleOutlined, color: "grey", title: "" });
    }
  }

  return { byId, success };
});

function statusIconProp(siteId: TSiteID): IStatusIcon {
  return statusIcon.value.byId.get(siteId) ?? { icon: QuestionCircleOutlined, color: "grey", title: "" };
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
    <a-checkbox-group v-else v-model:value="importStatus.toWork" class="site-grid">
      <a-row :gutter="8">
        <a-col v-for="site in filteredSites" :key="site.id" :span="24" :sm="12" :md="8" class="site-col">
          <div class="site-card">
            <a-checkbox
              :value="site.id"
              :indeterminate="!!site.userInputSettingMeta || statusIcon.success.has(site.id)"
              :disabled="!!site.userInputSettingMeta || importStatus.isWorking || statusIcon.success.has(site.id)"
            />
            <SiteFavicon :site-id="site.id" :size="28" class="mr-2" flush-on-click />
            <div class="site-card-main">
              <!-- 站点名可能很长：ellipsis.tooltip 顺带补上原先缺的悬停提示 -->
              <a-typography-text :ellipsis="{ tooltip: site.name ?? '' }">
                <b>{{ site.name ?? "" }}</b>
                <!-- 站点类型 -->
              </a-typography-text>
              <a-tag :color="site.type === 'private' ? 'blue' : 'default'">
                {{ site.schema ?? (site.type === "private" ? "AbstractPrivateSite" : "AbstractBittorrentSite") }}
              </a-tag>
            </div>
            <a :href="site.urls[0]" target="_blank" rel="noopener noreferrer nofollow">
              <a-tooltip :title="statusIconProp(site.id).title">
                <component
                  :is="statusIconProp(site.id).icon"
                  :style="{ color: statusIconProp(site.id).color }"
                  class="status-icon"
                />
              </a-tooltip>
            </a>
          </div>
        </a-col>
      </a-row>
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

.site-filter-count {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.55);
}

.site-filter-empty {
  padding: 24px 12px;
  text-align: center;
  color: rgba(0, 0, 0, 0.45);
}

.site-grid {
  display: block;
  overflow-x: hidden;
  overflow-y: hidden;
  padding: 12px;
}

.site-col {
  padding-bottom: 8px;
}

.site-card {
  display: flex;
  align-items: center;
  gap: 4px;
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

.status-icon {
  font-size: 28px;
}
</style>
