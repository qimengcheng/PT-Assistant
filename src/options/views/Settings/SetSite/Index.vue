<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  AimOutlined,
  DeleteOutlined,
  EditOutlined,
  ExportOutlined,
  FilterOutlined,
  MinusOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  ToolOutlined,
} from "@antdv-next/icons";
import type { TableColumnsType, TablePaginationConfig, TableSorterResult } from "antdv-next";

import type { TSiteID } from "@ptd/site";

import { useConfigStore } from "@/options/stores/config.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { useTableCustomFilter } from "@/options/directives/useAdvanceFilter.ts";
import { sendMessage } from "@/messages.ts";
import { extStore } from "@/storage.ts";
import { formatDate } from "@/options/utils.ts";

import AddDialog from "./AddDialog.vue";
import EditDialog from "./EditDialog.vue";
import EditSearchEntryList from "./EditSearchEntryList.vue";
import OneClickImportDialog from "./OneClickImportDialog.vue";
import RebuildMapDialog from "./RebuildMapDialog.vue";
import SiteFavicon from "@/options/components/SiteFavicon/Index.vue";
import { flushSiteFavicon } from "@/options/components/SiteFavicon/utils.ts";
import DeleteDialog from "@/options/components/DeleteDialog.vue";
import { isPageSizePicked, toPagination } from "@/options/components/tableSorters.ts";
import { useAutoFitPageSize } from "@/options/directives/useAutoFitPageSize.ts";

// 数据来源
import { allAddedSiteInfo, isLoadingAllAddedSites, type ISiteTableItem } from "./utils.ts";

const { t } = useI18n();

const configStore = useConfigStore();
const runtimeStore = useRuntimeStore();
const metadataStore = useMetadataStore();

const showAddDialog = ref<boolean>(false);
const showEditDialog = ref<boolean>(false);
const showDeleteDialog = ref<boolean>(false);
const showOneClickImportDialog = ref<boolean>(false);
const showRebuildMapDialog = ref<boolean>(false);

const booleanUserConfigKeywords = ["isOffline", "allowSearch", "allowQueryUserInfo"];

const {
  tableWaitFilterRef,
  tableFilterRef,
  tableFilterFn,
  advanceFilterDictRef,
  setKeywordRequiredFn,
  buildFilterDictFn,
  updateTableFilterValueFn,
} = useTableCustomFilter<ISiteTableItem>({
  parseOptions: {
    keywords: ["id", ...booleanUserConfigKeywords.map((x) => `userConfig.${x}`), "userConfig.groups"],
  },
  titleFields: ["metadata.name", "metadata.urls", "userConfig.merge.name", "userConfig.url"],
  format: {
    ...Object.fromEntries(booleanUserConfigKeywords.map((x) => [`userConfig.${x}`, "boolean"])),
  },
});

const persistedSort = computed(() => configStore.tableBehavior.SetSite?.sortBy?.[0]);
function orderOf(key: string): "ascend" | "descend" | null {
  const s = persistedSort.value;
  if (!s || s.key !== key) return null;
  return s.order === "asc" ? "ascend" : "descend";
}

/**
 * Cookie 两列的数据。
 *
 * 到期时间不落在我们自己的存储里 —— 它就在浏览器的 cookie 罐里（`expirationDate`，秒），
 * 所以每次要展示时按站点 URL 现查一次 chrome.cookies（经 getAllCookies 消息，
 * 与全仓一致：选项页不直接碰 chrome.cookies）。
 * 续期时间则是新增的一条：自动续期发生在 service worker，它只拿得到 URL，
 * 因此由它按 siteId 记进 storage 的 cookieRenewals 键（见 shared/types/storages/other.ts）。
 */
interface ICookieExpiryInfo {
  /** 被续期管理的 cookie 数量，0 = 这个站点没有 c_secure_* / remember_web_* 之类的 cookie */
  managed: number;
  /** 其中最早过期的那一枚（毫秒）；全是会话级 cookie 时为 null */
  earliest: number | null;
}

const cookieExpiry = ref<Record<string, ICookieExpiryInfo>>({});
const cookieRenewals = ref<Record<string, number>>({});
const isLoadingCookieInfo = ref(false);

/** 与 background/utils/cookies.ts 里 shouldExtendCookie 同一口径，两处要一起改 */
function isAutoRenewedCookie(name: string): boolean {
  return name.startsWith("c_secure_") || name.startsWith("remember_web_");
}

/**
 * 靠用户填的 API 凭据访问、不依赖 cookie 的站点 —— 这些站点的「Cookie 到期 / 最近续期」两列
 * 该说「不需要」，而不是「无 / 尚未续期过」（后者读起来像「你少了个 cookie」，用户 2026-10-07
 * 拿 YemaPT 指出这一点）。
 *
 * 名单是 2026-10-07 把场上 17 个声明了 `userInputSettingMeta` 的站点**逐个回请求层读过**得出的：
 *   yemapt / mteam / gazellegames / generationfree / milkie / sunnypt / fsm / beyondhd / hdbits /
 *   rousipro / huno —— 各自把 token / apikey / passkey 发进请求头或请求体（Authorization、
 *   x-api-key、X-API-Key、x-milkie-auth、APITOKEN、Bearer、X-Api-Token…；huno 更硬，没填 token
 *   就抛 NoUserInputError 把请求拦下）
 *   avistaz / cinemaz / exoticaz / privatehd / animez —— 共用 schemas/AvistazNetwork.ts，
 *   先 POST /api/v1/jackett/auth 用 username+password+pid 换令牌，再带着令牌打 /api/v1/*
 *
 * 为什么不用结构判据（「声明了 userInputSettingMeta 就算」）：两头都会错 ——
 *   mooko 那个字段 name 叫 note、required:false，是一句「搜索前把结果显示切成列表视图」的提示，
 *   它其实是 Gazelle 那套 cookie 站点（结构判据会误标它）；
 *   beyondhd 的 apikey/rsskey 两项都写着 required:false（结构判据会漏掉它）。
 * 所以这里老实列名单。**新增 API 类站点时往名单里加一行 id**（id == 定义文件名）。
 */
const API_AUTH_SITE_IDS: readonly string[] = [
  "yemapt",
  "mteam",
  "gazellegames",
  "generationfree",
  "milkie",
  "sunnypt",
  "fsm",
  "beyondhd",
  "hdbits",
  "rousipro",
  "huno",
  "avistaz",
  "cinemaz",
  "exoticaz",
  "privatehd",
  "animez",
];
const apiAuthSiteIdSet = new Set(API_AUTH_SITE_IDS);

async function loadCookieInfo() {
  const sites = (allAddedSiteInfo.value ?? []) as ISiteTableItem[];
  isLoadingCookieInfo.value = true;
  try {
    const renewals = (await extStore.getItem("cookieRenewals")) ?? {};
    const info = await Promise.all(
      sites.map(async (item): Promise<ICookieExpiryInfo> => {
        // 靠 API 凭据的站点不去查 cookie 罐：那趟消息往返问不出任何有用信息
        if (apiAuthSiteIdSet.has(item.id)) return { managed: 0, earliest: null };
        const url = item.userConfig?.url ?? item.metadata?.urls?.[0];
        if (!url) return { managed: 0, earliest: null };
        try {
          const cookies = (await sendMessage("getAllCookies", { url })).filter((c) => isAutoRenewedCookie(c.name));
          const dated = cookies.map((c) => c.expirationDate).filter((x): x is number => !!x);
          return { managed: cookies.length, earliest: dated.length > 0 ? Math.min(...dated) * 1000 : null };
        } catch {
          // 消息没回应/权限异常时按"查不到"处理，不要让一列把整张表带崩
          return { managed: 0, earliest: null };
        }
      }),
    );
    const next: Record<string, ICookieExpiryInfo> = {};
    sites.forEach((item, i) => (next[item.id] = info[i]));
    cookieExpiry.value = next;
    cookieRenewals.value = renewals;
  } finally {
    isLoadingCookieInfo.value = false;
  }
}

// 站点增删后要重查（allAddedSiteInfo 是 computedAsync，水合完成才会有一批 id）
watch(
  () => (allAddedSiteInfo.value ?? []).map((x) => x.id).join(","),
  () => {
    void loadCookieInfo();
  },
  { immediate: true },
);

/** 该站点靠 API 凭据访问，Cookie 两列一律走「不需要」分支（判据与证据见 API_AUTH_SITE_IDS 注释） */
const usesApiAuth = (siteId: string) => apiAuthSiteIdSet.has(siteId);

function cookieExpiryText(siteId: string): string {
  if (usesApiAuth(siteId)) return t("SetSite.cookie.notNeeded");
  const info = cookieExpiry.value[siteId];
  if (!info) return isLoadingCookieInfo.value ? "…" : "-";
  if (info.managed === 0) return t("SetSite.cookie.none");
  if (info.earliest === null) return t("SetSite.cookie.sessionOnly");
  return formatDate(info.earliest, "yyyy-MM-dd");
}

/** 悬停提示：单元格只放短文案，解释都收在这里 */
function cookieExpiryTip(siteId: string): string {
  if (usesApiAuth(siteId)) return t("SetSite.cookie.notNeededHint");
  const info = cookieExpiry.value[siteId];
  if (!info) return "";
  if (info.managed === 0) return t("SetSite.cookie.noneHint");
  if (info.earliest === null) return t("SetSite.cookie.sessionHint");
  const days = Math.floor((info.earliest - Date.now()) / 86400000);
  return days < 0 ? t("SetSite.cookie.expired") : t("SetSite.cookie.remainingDays", { n: days });
}

function cookieExpiryClass(siteId: string): string {
  if (usesApiAuth(siteId)) return "cookie-muted";
  const info = cookieExpiry.value[siteId];
  if (!info || info.earliest === null) return "cookie-muted";
  const days = Math.floor((info.earliest - Date.now()) / 86400000);
  if (days < 0) return "cookie-expired";
  // 阈值以下的天数交给颜色提示：自动续期的默认触发阈值是 1 周（config.ts 的 triggerThreshold）
  return days < 7 ? "cookie-warning" : "";
}

function cookieRenewText(siteId: string): string {
  if (usesApiAuth(siteId)) return t("SetSite.cookie.notNeeded");
  const at = cookieRenewals.value[siteId];
  return at ? formatDate(at, "yyyy-MM-dd HH:mm") : t("SetSite.cookie.neverRenewed");
}

const columns = computed<TableColumnsType<ISiteTableItem>>(() => {
  const base: TableColumnsType<ISiteTableItem> = [
    {
      title: "№",
      key: "userConfig.sortIndex",
      align: "center",
      width: 72,
      sorter: (a, b) => (a.userConfig.sortIndex ?? 0) - (b.userConfig.sortIndex ?? 0),
      sortOrder: orderOf("userConfig.sortIndex"),
    },
    { title: t("SetSite.common.name"), key: "name", align: "left" },
    { title: t("SetSite.common.groups"), key: "groups", align: "left", width: 160 },
    { title: t("SetSite.common.url"), key: "url", align: "left" },
    // 单元格内容是短文案（日期 / 会话级 / 无），解释走 tooltip，避免换行把行高撑开
    { title: t("SetSite.common.cookieExpires"), key: "cookieExpires", align: "center", width: 104 },
    { title: t("SetSite.common.cookieRenewedAt"), key: "cookieRenewedAt", align: "center", width: 132 },
    {
      title: t("SetSite.common.isOffline"),
      key: "userConfig.isOffline",
      align: "center",
      width: 90,
      sorter: (a, b) => Number(!!a.userConfig.isOffline) - Number(!!b.userConfig.isOffline),
      sortOrder: orderOf("userConfig.isOffline"),
    },
    {
      title: t("SetSite.common.allowSearch"),
      key: "userConfig.allowSearch",
      align: "center",
      width: 90,
      sorter: (a, b) => Number(!!a.userConfig.allowSearch) - Number(!!b.userConfig.allowSearch),
      sortOrder: orderOf("userConfig.allowSearch"),
    },
    {
      title: t("SetSite.common.allowQueryUserInfo"),
      key: "userConfig.allowQueryUserInfo",
      align: "center",
      width: 120,
      sorter: (a, b) => Number(!!a.userConfig.allowQueryUserInfo) - Number(!!b.userConfig.allowQueryUserInfo),
      sortOrder: orderOf("userConfig.allowQueryUserInfo"),
    },
  ];

  if (configStore.contentScript.enabled && configStore.contentScript.allowExceptionSites) {
    base.push({
      title: t("SetSite.common.allowContentScript"),
      key: "userConfig.allowContentScript",
      align: "center",
      width: 110,
    });
  }

  base.push({ title: t("common.action"), key: "action", align: "center", width: 170 });
  return base;
});

/**
 * 旧实现交给 Vuetify 的 custom-filter；tableFilterFn 内部读 item.raw，
 * 这里在调用点适配（与 DownloadHistory 同一做法，不改共享的 useAdvanceFilter）。
 */
const filteredItems = computed(() => {
  const list = (allAddedSiteInfo.value ?? []) as ISiteTableItem[];
  if (!tableFilterRef.value.trim()) return list;
  return list.filter((item) => tableFilterFn(item.id, tableFilterRef.value, { raw: item }));
});

const tableSelected = ref<TSiteID[]>([]);

// 每页条数按面板实高算（用户 2026-10-08：「既不能出现滚动条又要把页面铺满」）
const pagePanel = useTemplateRef<HTMLDivElement>("pagePanel");
/** 他挑过一档之后仍要量：那一档以实测容量为上限 */
const pickedSize = computed(() => {
  const behavior = configStore.tableBehavior.SetSite;
  return isPageSizePicked(behavior?.itemsPerPage, 50, (behavior as any)?.pageSizePicked);
});
const { fitted: fitPageSize } = useAutoFitPageSize({
  container: () => pagePanel.value,
  rows: () => filteredItems.value,
});

const pagination = computed<TablePaginationConfig | false>(() =>
  // 本页默认档是 -1（`config.ts` 里存的就是它）：旧版 Vuetify 用 -1 表示「不分页、一次全展示」。
  // 这个约定由 toPagination 兜底换算成 50（原样交给 antd 会 slice(0,-1) 吃掉最后一行）。
  // 用户 2026-10-06 定的口径也在那条公共实现里：默认档下条目全放得下就不出分页条，
  // 一旦他在尺寸选择器里挑过一档（存的是不等于默认档的正数）分页条就常驻。
  toPagination(configStore.tableBehavior.SetSite?.itemsPerPage, 50, {
    size: "small",
    totalRows: filteredItems.value.length,
    fitSize: fitPageSize.value,
    picked: pickedSize.value,
    // 用户 2026-10-08：「这个页面大于 50 条时才启用分页」——50 个站以内整页放完，由面板自己滚
    maxSinglePage: 50,
  }),
);

function handleTableChange(
  page: TablePaginationConfig,
  _filters: unknown,
  sorter: TableSorterResult | TableSorterResult[],
) {
  // 只有「报回来的档 ≠ 界面上正在显示的那一档」才算他改了尺寸：翻页与排序也带着当前档回来
  const displayed = pagination.value === false ? 0 : pagination.value?.pageSize ?? 0;
  if (page.pageSize && displayed && page.pageSize !== displayed) {
    configStore.updateTableBehavior("SetSite", "itemsPerPage", page.pageSize);
    // 挑档 = 明确意图，从此不再被实测条数盖掉
    configStore.updateTableBehavior("SetSite", "pageSizePicked", true);
  }
  const single = Array.isArray(sorter) ? sorter[0] : sorter;
  if (single?.order && single.columnKey) {
    configStore.updateTableBehavior("SetSite", "sortBy", [
      { key: String(single.columnKey), order: single.order === "ascend" ? "asc" : "desc" },
    ]);
  }
}

const toEditId = ref<TSiteID | null>("");
function editSite(siteId: TSiteID) {
  toEditId.value = siteId;
  showEditDialog.value = true;
}

const toDeleteIds = ref<TSiteID[]>([]);
function deleteSite(siteId: TSiteID[]) {
  toDeleteIds.value = siteId;
  showDeleteDialog.value = true;
}

async function confirmDeleteSite(siteId: TSiteID) {
  tableSelected.value = tableSelected.value.filter((id) => id !== siteId);
  return await metadataStore.removeSite(siteId);
}

const isFaviconFlushing = ref(false);
async function refreshSiteFavicon(siteId: TSiteID | TSiteID[]) {
  // 模板按钮虽有 :loading 禁用，这里再兜一层，防止程序化连点产生重复刷新
  if (isFaviconFlushing.value) {
    return;
  }
  isFaviconFlushing.value = true;
  try {
    // 必须走 SiteFavicon/utils.ts 里那份共享实现：它同时做「删 IndexedDB 条目 → 删本页面内存条目
    // → 重取并写回内存」三件事。原来这里直接 sendMessage("getSiteFavicon", {flush:true})，
    // 只让 offscreen 重抓了一遍，界面上那 20 个 <SiteFavicon> 读的还是内存里的旧值 ——
    // 弹「刷新完成」而图标一个都不变，要 F5 才看得到结果。
    await flushSiteFavicon(Array.isArray(siteId) ? siteId : [siteId]);
    runtimeStore.showSnakebar(t("SetSite.index.flushFaviconFinish"), { color: "success" });
  } catch (e) {
    // 旧实现只有 finally：刷新失败时用户只看到按钮停转，没有任何失败提示
    console.error("[SetSite] flush site favicon failed", e);
    runtimeStore.showSnakebar(t("SetSite.index.flushFaviconFailed"), { color: "error" });
  } finally {
    isFaviconFlushing.value = false;
  }
}

function toggleUserConfigFilter(keyword: string, checked: boolean) {
  // 用 setKeywordRequiredFn 而不是 toggleKeywordStateFn：
  // 这里是无 checkbox-group 的受控复选框，required 没人维护，
  // 用三态函数只会去动 exclude，勾选等于没反应。
  // value 恒为 "1"（取消时传空串会让 exclude 去筛一个空字符串，更错）。
  setKeywordRequiredFn(`userConfig.${keyword}`, "1", checked);
  updateTableFilterValueFn();
}

function toggleGroupFilter(group: string, checked: boolean) {
  setKeywordRequiredFn("userConfig.groups", group, checked);
  updateTableFilterValueFn();
}

function groupChecked(group: string) {
  return (advanceFilterDictRef.value["userConfig.groups"]?.required ?? []).includes(group);
}

function keywordChecked(keyword: string) {
  return (advanceFilterDictRef.value[`userConfig.${keyword}`]?.required ?? []).includes("1");
}
</script>

<template>
  <!-- 这页是整页工作台（工具条 + 全宽表格），不是「一张信息卡」，所以不用 a-card。
       原先按钮条挂在卡片 #title、筛选框挂在 #extra：卡片头的垂直 padding 实测是 0
       （`padding: 0 headerPadding`，高度只靠 min-height），size="small" 下头高 38px，
       塞进 32px 的按钮只剩上下各 3px —— 整条贴到窗口顶。
       现在用 .page 网格：48px 的工具条一行 + 白底面板一行，间距 8px（见 style.css）。 -->
  <div class="page">
    <a-flex align="center" gap="small" wrap justify="space-between" class="page-bar">
    <a-flex align="center" gap="small" wrap>
      <a-button type="primary" @click="showAddDialog = true"><template #icon><PlusOutlined /></template><span>{{ t('common.btn.add') }}</span></a-button>

      <a-button type="primary" danger :disabled="tableSelected.length === 0" @click="deleteSite(tableSelected)"><template #icon><MinusOutlined /></template><span>{{ t('common.remove') }}</span></a-button>

      <a-button @click="showOneClickImportDialog = true"><template #icon><AimOutlined /></template><span>{{ t('SetSite.index.oneClickImport') }}</span></a-button>

      <a-button
        :disabled="tableSelected.length === 0"
        :loading="isFaviconFlushing"
        :title="t('SetSite.index.table.flushFavicon')"
        @click="() => refreshSiteFavicon(tableSelected)"
      >
        <template #icon>
          <ReloadOutlined />
        </template>
        <span class="ml-1">{{ t("SetSite.index.table.flushFavicon") }}</span>
      </a-button>

      <a-button @click="showRebuildMapDialog = true"><template #icon><ToolOutlined /></template><span>{{ t('SetSite.index.reBuildMap') }}</span></a-button>
    </a-flex>

    <a-input
      v-model:value="tableWaitFilterRef"
      allow-clear
      class="toolbar-filter page-bar-extra"
    >
        <template #prefix>
          <a-popover trigger="click" placement="bottomLeft">
            <template #content>
                <div class="filter-panel">
                  <label
                    v-for="keyword in booleanUserConfigKeywords"
                    :key="keyword"
                    class="filter-row"
                  >
                    <a-checkbox
                      :checked="keywordChecked(keyword)"
                      @change="
                        (e: any) => {
                          toggleUserConfigFilter(keyword, e.target.checked);
                        }
                      "
                    >
                      {{ t(`SetSite.common.${keyword}`) }}
                    </a-checkbox>
                  </label>

                  <a-divider class="filter-divider" />

                  <div class="filter-subtitle">{{ t("SetSite.common.groups") }}</div>
                  <label v-for="(sites, group) in metadataStore.getSitesGroupData" :key="group" class="filter-row">
                    <a-checkbox
                      :checked="groupChecked(String(group))"
                      @change="
                        (e: any) => {
                          toggleGroupFilter(String(group), e.target.checked);
                        }
                      "
                    >
                      {{ group }} ({{ sites.length }})
                    </a-checkbox>
                  </label>
                </div>
              </template>
              <FilterOutlined class="filter-trigger" @click="buildFilterDictFn('')" />
            </a-popover>
          </template>
          <template #suffix>
            <SearchOutlined />
          </template>
    </a-input>
    </a-flex>

    <!-- 面板是唯一的滚动容器：这张表不写 scroll.y（视口常数是目测的，外壳内衬一改就失准），
         一次全展示时由 .page-panel 自己滚 -->
    <div ref="pagePanel" class="page-panel">
    <a-table
      bordered
      :columns="columns"
      :data-source="filteredItems"
      :loading="isLoadingAllAddedSites"
      :pagination="pagination"
      :row-selection="{
        selectedRowKeys: tableSelected,
        onChange: (keys: (string | number)[]) => (tableSelected = keys as TSiteID[]),
      }"
      row-key="id"
      size="small"
      @change="handleTableChange"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'userConfig.sortIndex'">
          <!-- 24 而不是组件默认的 32：行高 = 内容高 + 上下内衬 8+8，32 会把行顶到 48px，
               比表头（21 行高 + 16 = 37px）还高 11px。全站其它表格的图标是 16/18/24，
               这一页是孤例，收齐到 24 后行高 40px，与表头基本平齐。 -->
          <SiteFavicon :site-id="record.id" :size="24" />
        </template>

        <template v-else-if="column.key === 'name'">
          <a-tooltip v-if="record.metadata.description" placement="top">
            <template #title>
              <span v-if="typeof record.metadata.description === 'string'">{{ record.metadata.description }}</span>
              <ul v-else class="desc-list">
                <li v-for="(text, index) in record.metadata.description" :key="index">{{ text }}</li>
              </ul>
            </template>
            <span>{{ record.userConfig?.merge?.name ?? record.metadata?.name }}</span>
          </a-tooltip>
          <span v-else>{{ record.userConfig?.merge?.name ?? record.metadata?.name }}</span>
        </template>

        <template v-else-if="column.key === 'groups'">
          {{ (record.userConfig.groups ?? []).join(", ") }}
        </template>

        <template v-else-if="column.key === 'url'">
          <a
            :href="record.userConfig?.url ?? record.metadata?.urls?.[0]"
            class="url-link"
            rel="noopener noreferrer nofollow"
            target="_blank"
          >
            {{ record.userConfig?.url ?? record.metadata?.urls?.[0] }}
            <ExportOutlined class="url-link-icon" />
          </a>
        </template>

        <template v-else-if="column.key === 'cookieExpires'">
          <a-tooltip :title="cookieExpiryTip(record.id)">
            <span :class="cookieExpiryClass(record.id)">{{ cookieExpiryText(record.id) }}</span>
          </a-tooltip>
        </template>

        <template v-else-if="column.key === 'cookieRenewedAt'">
          <!-- 只有「不需要」这一种情况需要解释（其余状态本身就是可读的日期或「尚未续期过」），
               标题为空时 antd 的 Tooltip 判定 noTitle、浮层不会出现 -->
          <a-tooltip :title="usesApiAuth(record.id) ? t('SetSite.cookie.notNeededHint') : ''">
            <span :class="{ 'cookie-muted': !cookieRenewals[record.id] }">{{ cookieRenewText(record.id) }}</span>
          </a-tooltip>
        </template>

        <template v-else-if="String(column.key).startsWith('userConfig.')">
          <a-switch
            size="small"
            :checked="Boolean(record.userConfig[String(column.key).replace('userConfig.', '')])"
            :disabled="
              record.metadata.isDead ||
              record.userConfig.isOffline ||
              (column.key === 'userConfig.allowSearch' && !Object.hasOwn(record.metadata, 'search')) ||
              (column.key === 'userConfig.allowQueryUserInfo' && !Object.hasOwn(record.metadata, 'userInfo'))
            "
            @change="
              (checked: boolean | string | number) =>
                metadataStore.simplePatch(
                  'sites',
                  record.id,
                  String(column.key).replace('userConfig.', ''),
                  !!checked,
                )
            "
          />
        </template>

        <template v-else-if="column.key === 'action'">
          <a-space :size="0">
            <a-tooltip :title="t('common.edit')">
              <a-button :disabled="record.metadata.isDead" size="small" type="text" @click="() => editSite(record.id)">
                <template #icon>
                  <EditOutlined />
                </template>
              </a-button>
            </a-tooltip>

            <!-- 默认站点搜索入口编辑（只有配置了 searchEntry 的站点才支持） -->
            <a-dropdown :trigger="['click']" placement="bottomRight">
              <a-tooltip :title="t('SetSite.index.table.searchEntries')">
                <a-button
                  :disabled="record.metadata.isDead || !record.metadata.searchEntry"
                  size="small"
                  type="text"
                >
                  <template #icon>
                    <SearchOutlined />
                  </template>
                </a-button>
              </a-tooltip>
              <template #popupRender>
                <EditSearchEntryList :item="record" />
              </template>
            </a-dropdown>

            <a-tooltip :title="t('SetSite.index.table.flushFavicon')">
              <a-button
                :disabled="record.metadata.isDead"
                :loading="isFaviconFlushing"
                size="small"
                type="text"
                @click="() => refreshSiteFavicon(record.id)"
              >
                <template #icon>
                  <ReloadOutlined />
                </template>
              </a-button>
            </a-tooltip>

            <a-tooltip :title="t('common.remove')">
              <a-button danger size="small" type="primary" @click="() => deleteSite([record.id])">
                <template #icon>
                  <DeleteOutlined />
                </template>
              </a-button>
            </a-tooltip>
          </a-space>
        </template>
      </template>
    </a-table>
    </div>
  </div>

  <AddDialog v-model="showAddDialog" />
  <DeleteDialog v-model="showDeleteDialog" :to-delete-ids="toDeleteIds" :confirm-delete="confirmDeleteSite" />
  <EditDialog v-model="showEditDialog" :site-id="toEditId!" />
  <OneClickImportDialog v-model="showOneClickImportDialog" />
  <RebuildMapDialog v-model="showRebuildMapDialog" />
</template>

<style scoped lang="scss">
/* 工具条的间距用全局 .toolbar（style.css：margin-bottom + flex-wrap），这里不重复定义。
   .toolbar-filter 只给筛选框限宽，免得它在窄窗口下把按钮条挤散。 */
.toolbar-filter {
  max-width: 320px;
}

.filter-trigger {
  cursor: pointer;
}

.url-link {
  font-weight: 500;
  text-decoration: underline;
}

.url-link-icon {
  margin-left: 4px;
  font-size: 11px;
}

/* Cookie 两列的状态色：查不到/未续期 → 次要文字；快到期 → 琥珀；已过期 → danger。
   全局没有 warning 档的 token（style.css 只有 success/danger），这里就地给一个字面值 */
.cookie-muted {
  color: var(--pt-color-text-secondary);
}

.cookie-warning {
  color: #b45309;
  font-weight: 500;
}

.cookie-expired {
  color: var(--pt-color-danger);
  font-weight: 600;
}

.desc-list {
  margin: 0;
  padding-left: 16px;
}

/* 宽度写在这里而不是 popover 的 :overlay-style —— antdv-next 的 Popover/Tooltip 已经没有
   overlayStyle 这个 prop（tooltip/index.js 里唯一的 overlayStyle 是内部取色器用的），
   写上去是死属性。面板宽度由内容决定，直接给面板本身。 */
.filter-panel {
  width: 240px;
  max-height: 320px;
  overflow-y: auto;
}

.filter-row {
  display: block;
  padding: 2px 0;
}

.filter-subtitle {
  padding: 2px 0;
  color: rgba(0, 0, 0, 0.45);
  font-size: 12px;
}

.filter-divider {
  margin: 8px 0;
}
</style>
