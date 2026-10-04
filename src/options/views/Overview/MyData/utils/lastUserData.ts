import { ref, computed } from "vue";
import { type ISiteUserConfig, type IUserInfo, type TSiteID } from "@ptd/site";
import { sendMessage } from "@/messages.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";

import { differenceInDays } from "date-fns";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import { useConfigStore } from "@/options/stores/config.ts";

import { fixUserInfo } from "./format.ts";
import { loadAllAddedSiteMetadata } from "./siteMetadata.ts";

export interface IUserInfoItem extends IUserInfo {
  siteUserConfig: ISiteUserConfig;
  siteName: string;
  /** 对 isDead 或者 isOffline 的站点不允许选择（ https://github.com/pt-plugins/PT-depiler/pull/140 ） */
  selectable: boolean;
  /** 多少天未访问站点，预先计算防止 template 中反复计算 */
  lastAccessDuration: number;
}

const metadataStore = useMetadataStore();

export const perSiteLastUserData = ref<Record<TSiteID, IUserInfoItem>>({});
export const tableData = computed(() => Object.values(perSiteLastUserData.value));

/**
 * 表格初始/全量加载进行中标志（$onReady 首屏与 watch 后台重建两处入口共用）。
 *
 * 初值必须是 true：首屏取数挂在 metadata 水合完成之后，从组件挂载到 $onReady 回调之间
 * 有一段真实存在的空窗（storage.get + 大对象 $patch）。若初值为 false，这段空表里
 * a-table 会先渲染成「暂无数据」，等水合完成再切回 loading 再出数据 —— 用户看到的是
 * 一次假空态闪烁，比转圈更糟。
 */
export const isTableLoading = ref<boolean>(true);

async function updatePerSiteData(siteId: TSiteID, siteUserInfoData: IUserInfo) {
  const currentDate = new Date();

  // 再单独加载一遍该站点的配置信息，以免缺失
  const allAddedSiteMetadata = await loadAllAddedSiteMetadata([siteId]);
  const siteMeta = allAddedSiteMetadata[siteId];

  perSiteLastUserData.value[siteId] = {
    ...fixUserInfo(siteUserInfoData),
    site: siteId,
    siteUserConfig: metadataStore.sites[siteId],
    siteName: siteMeta.combinedSiteName,
    // 对 isDead 或者 isOffline 的站点不允许选择（ https://github.com/pt-plugins/PT-depiler/pull/140 ）
    selectable: !(siteMeta.isDead || siteMeta.isOffline),

    // 预先计算 多少天未访问站点，以防止在 template 中反复计算
    lastAccessDuration:
      typeof siteUserInfoData.lastAccessAt === "number"
        ? differenceInDays(currentDate, siteUserInfoData.lastAccessAt)
        : 0,
  };
}

export async function initTableData(options: { silent?: boolean } = {}) {
  const configStore = useConfigStore();
  const runtimeStore = useRuntimeStore();

  // silent 用于 offscreen 后台数据变化触发的静默重建：不亮表格 loading，避免每 5s 闪一次
  if (!options.silent) {
    isTableLoading.value = true;
  }
  try {
    const siteIds = Object.keys(metadataStore.sites);

    // 预加载所有已配置的站点基本属性，同时预加载的变量在全局统一，这样可以加快 Timeline 和 Statistic 的加载速度
    const addedSiteMetaData = await loadAllAddedSiteMetadata(siteIds);

    const tasks: Promise<void>[] = [];

    for (const [siteId, siteUserConfig] of Object.entries(metadataStore.sites)) {
      const siteMeta = addedSiteMetaData[siteId];

      // siteMeta 缺失说明该站点没能在 loadAllAddedSiteMetadata 里建好条目（那里已 catch 并打日志）。
      // 这里必须 continue 而不能继续访问 siteMeta.type —— 那会抛 TypeError 中断整个循环，
      // 导致后面所有站点都不出现在表格里，且现象是「没有报错但表格空白」。
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
      tasks.push(
        updatePerSiteData(siteId as TSiteID, siteUserInfoData).catch((e) => {
          console.error(`initTableData: updatePerSiteData failed for ${siteId}`, e);
        }),
      );
    }

    await Promise.allSettled(tasks);
  } catch (e) {
    // loadAllAddedSiteMetadata 等前置步骤整体失败时必须给用户反馈，
    // 否则表格一直转圈后只剩空白，用户不知道是加载失败还是没数据
    console.error("[MyData] initTableData failed", e);
    runtimeStore.showSnakebar("加载用户数据失败", { color: "error" });
  } finally {
    if (!options.silent) {
      isTableLoading.value = false;
    }
  }
}

export function flushSiteLastUserInfo(sites: TSiteID[]) {
  const runtimeStore = useRuntimeStore();
  for (const site of sites) {
    runtimeStore.userInfo.flushPlan[site] = true;

    sendMessage("getSiteUserInfoResult", site)
      .then((userInfo) => updatePerSiteData(site, userInfo))
      .catch((e) => {
        // flushPlan[site] 已被置为 false 有两种情况：① 用户主动取消（cancelFlushSiteLastUserInfo）；
        // ② 本链路自己的 finally 刚执行完。catch 先于 finally 跑，所以此刻仍为 true 才说明是
        // 「没被取消的真失败」——旧代码条件写反（!flushPlan），导致正常失败不提示、取消后迟到的
        // 失败反而弹错误。
        if (runtimeStore.userInfo.flushPlan[site]) {
          // 面向用户的提示一律用站点名，不暴露内部 id（AGENTS.md §3.5）
          const siteName = perSiteLastUserData.value[site]?.siteName ?? site;
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
