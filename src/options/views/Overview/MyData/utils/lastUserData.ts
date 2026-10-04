import { computed, ref } from "vue";
import { computedAsync } from "@vueuse/core";
import { differenceInDays } from "date-fns";
import { type ISiteUserConfig, type IUserInfo, type TSiteID } from "@ptd/site";

import { sendMessage } from "@/messages.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import { useConfigStore } from "@/options/stores/config.ts";

import { fixUserInfo } from "./format.ts";
import { allAddedSiteMetadata, loadAllAddedSiteMetadata } from "./siteMetadata.ts";

export interface IUserInfoItem extends IUserInfo {
  siteUserConfig: ISiteUserConfig;
  /** 注意：这里放的是 combinedSiteName（全部别名用 "|$|" 连接），高级过滤靠它匹配站点名 */
  siteName: string;
  /** 对 isDead 或者 isOffline 的站点不允许选择（ https://github.com/pt-plugins/PT-depiler/pull/140 ） */
  selectable: boolean;
  /** 多少天未访问站点，预先计算防止 template 中反复计算 */
  lastAccessDuration: number;
}

const metadataStore = useMetadataStore();

/** computedAsync 的第三参：求值期间自动翻转为 true */
export const isLoadingSiteMetadata = ref<boolean>(false);

/**
 * 异步的那一半：把已添加站点的「定义 / 名称 / 图标」填进 allAddedSiteMetadata。
 *
 * 形状照抄 Settings/SetSite/utils.ts 的 allAddedSiteInfo —— 那是仓库里已有的正解，
 * 站点管理页从来没有 MyData 那个「首屏空表等 5 秒」的问题，就是因为它走的是这条派生链。
 *
 * 关键点：`Object.keys(metadataStore.sites)` 写在 computedAsync 体内，所以
 * **pinia 水合完成的那次 $patch 本身就是一次依赖变化**，会自动触发重新求值。
 * 首屏因此不需要 $onReady、不需要 watchDebounced、不需要 5 秒 debounce ——
 * 原来那套是在手动补一条 Vue 已经免费提供的边。
 */
export const addedSiteIds = computedAsync<string[]>(
  async () => {
    const siteIds = Object.keys(metadataStore.sites);
    try {
      await loadAllAddedSiteMetadata(siteIds);
    } catch (e) {
      // 整体失败时必须给用户反馈，否则表格转圈后只剩空白，用户分不清是「加载失败」还是「没数据」。
      // 这条保证原来在 initTableData 的外层 catch 里，改成派生链时差点被顺手删掉。
      // （loadAllAddedSiteMetadata 内部对单站点已 catch + allSettled，所以这里基本只会兜到前置异常）
      console.error("[MyData] 站点数据加载失败", e);
      useRuntimeStore().showSnakebar("加载用户数据失败", { color: "error" });
    }
    return siteIds;
  },
  [],
  isLoadingSiteMetadata,
);

/** 表格 loading：等价于「站点定义还在加载」。派生之后不再有「整表重建」这个动作，也就没有第二种 loading 态 */
export const isTableLoading = computed<boolean>(() => isLoadingSiteMetadata.value);

/**
 * 行集合：纯同步派生。
 *
 * 依赖三处 —— sites（增删站点）、allAddedSiteMetadata（定义与图标到位）、lastUserInfo（刷新结果），
 * 任一变化都只重算这一个数组；rc-table 按 rowKey diff，实际只有内容变了的那几行重渲染。
 * 这就是「回调能改几行就改几行」——不需要 perSiteLastUserData 那份平行副本。
 */
export const tableData = computed<IUserInfoItem[]>(() => {
  // 显式依赖异步加载结果：定义没到位时不过滤条件算不出来（siteMeta.type / isDead 来自站点定义）
  addedSiteIds.value;

  const configStore = useConfigStore();
  const currentDate = new Date();
  const rows: IUserInfoItem[] = [];

  for (const [siteId, siteUserConfig] of Object.entries(metadataStore.sites)) {
    const siteMeta = allAddedSiteMetadata[siteId];

    // siteMeta 缺失说明该站点没能建好条目（loadAllAddedSiteMetadata 里已 catch 并打日志）。
    // 这里必须 continue 而不能继续访问 siteMeta.type —— 那会抛 TypeError 中断整个 computed，
    // 导致后面所有站点都不出现，且现象是「没有报错但表格空白」。
    if (!siteMeta) continue;

    if (
      // 只显示私有站点的用户信息
      siteMeta.type === "public" ||
      // 根据配置决定是否显示已死亡站点的用户信息
      (!configStore.userInfo.showDeadSiteInOverview && siteMeta.isDead) ||
      // 根据配置决定是否显示设置了离线模式或不允许查询用户信息的站点
      (!siteMeta.isDead &&
        !configStore.userInfo.showPassedSiteInOverview &&
        (siteUserConfig.isOffline || siteUserConfig.allowQueryUserInfo === false))
    ) {
      continue;
    }

    const siteUserInfoData = metadataStore.lastUserInfo[siteId] ?? {};

    rows.push({
      ...fixUserInfo(siteUserInfoData),
      site: siteId as TSiteID,
      siteUserConfig,
      siteName: siteMeta.combinedSiteName,
      // 对 isDead 或者 isOffline 的站点不允许选择（ https://github.com/pt-plugins/PT-depiler/pull/140 ）
      selectable: !(siteMeta.isDead || siteMeta.isOffline),
      // 预先计算多少天未访问站点，以防止在 template 中反复计算
      lastAccessDuration:
        typeof siteUserInfoData.lastAccessAt === "number"
          ? differenceInDays(currentDate, siteUserInfoData.lastAccessAt)
          : 0,
    });
  }

  return rows;
});

/**
 * 把刷新结果写回唯一真源。
 *
 * 只改 store 镜像、不调 $save：offscreen 侧的 setSiteLastUserInfo 已经把同一份数据落进
 * chrome.storage（storage.ts 的 metadata 键），这里写镜像只是为了让本行立刻更新，
 * 不必等 onChanged → $patch 那一趟往返。metadata store 用的是 persistWebExt: true 的布尔形态，
 * autoSaveType 为 false，所以这次赋值不会触发任何持久化写入。
 */
function applyRefreshedUserInfo(siteId: TSiteID, userInfo: IUserInfo) {
  metadataStore.lastUserInfo[siteId] = userInfo;
}

export function flushSiteLastUserInfo(sites: TSiteID[]) {
  const runtimeStore = useRuntimeStore();
  for (const site of sites) {
    runtimeStore.userInfo.flushPlan[site] = true;

    sendMessage("getSiteUserInfoResult", site)
      .then((userInfo) => applyRefreshedUserInfo(site, userInfo))
      .catch((e) => {
        // flushPlan[site] 已被置为 false 有两种情况：① 用户主动取消（cancelFlushSiteLastUserInfo）；
        // ② 本链路自己的 finally 刚执行完。catch 先于 finally 跑，所以此刻仍为 true 才说明是
        // 「没被取消的真失败」——旧代码条件写反（!flushPlan），导致正常失败不提示、取消后迟到的
        // 失败反而弹错误。
        if (runtimeStore.userInfo.flushPlan[site]) {
          // 面向用户的提示一律用站点名，不暴露内部 id（AGENTS.md §3.5）
          const siteName = allAddedSiteMetadata[site]?.siteName ?? site;
          runtimeStore.showSnakebar(`获取站点 [${siteName}] 用户信息失败`, { color: "error" });
          console.error(e);
        }
      })
      .finally(() => {
        runtimeStore.userInfo.flushPlan[site] = false;
      });
  }
}

export async function cancelFlushSiteLastUserInfo() {
  const runtimeStore = useRuntimeStore();
  for (const runtimeStoreKey in runtimeStore.userInfo.flushPlan) {
    runtimeStore.userInfo.flushPlan[runtimeStoreKey] = false;
  }

  try {
    await sendMessage("cancelUserInfoQueue", undefined);
  } catch (e) {
    // 本地计划已经作废，SW 侧取消失败不能让「已取消」提示也丢掉
    console.error("cancelUserInfoQueue failed", e);
  }

  runtimeStore.showSnakebar(`用户信息刷新队列已取消`, { color: "error" });
}

export async function loadSiteHistoryData(siteId: TSiteID): Promise<Array<IUserInfo & { date: string }>> {
  const retData: Array<IUserInfo & { date: string }> = [];

  const siteUserInfoData = (await sendMessage("getSiteUserInfo", siteId)) as Record<string, IUserInfo>;

  for (const [date, item] of Object.entries(siteUserInfoData)) {
    retData.push({ ...fixUserInfo(item), date });
  }

  return retData;
}
