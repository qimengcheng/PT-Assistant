import { computed, nextTick, ref, shallowRef, toRaw, watch } from "vue";
import { computedAsync } from "@vueuse/core";
import { differenceInDays } from "date-fns";
import { type ISiteUserConfig, type IUserInfo, type TSiteID } from "@ptd/site";

import { sendMessage } from "@/messages.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import { useConfigStore } from "@/options/stores/config.ts";

import { tOutside } from "@/options/i18nOutside.ts";

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
      useRuntimeStore().showSnakebar(tOutside("MyData.loadFailed"), { color: "error" });
    }
    return siteIds;
  },
  [],
  isLoadingSiteMetadata,
);

/** 表格 loading：等价于「站点定义还在加载」。派生之后不再有「整表重建」这个动作，也就没有第二种 loading 态 */
export const isTableLoading = computed<boolean>(() => isLoadingSiteMetadata.value);

/**
 * 表格读的是这份快照，**不是** `metadataStore.lastUserInfo` 本体。
 *
 * 为什么要隔一层（用户 2026-10-17 报「我的数据在加载的时候点别的标签没有响应」）：
 * 一轮刷新是**逐站**写回的，而且每一站写两次 —— 本页 `.then` 写一次镜像，offscreen 落库后
 * `storage.onChanged` 又 `$patch` 一次（pinia 的 mergeReactiveObjects 对数组是按标识整体替换，
 * `levelRequirements` 每条都是新数组，所以那一趟一定触发）。`tableData` 直接读 `lastUserInfo`
 * 的话，这些写入每一条都要「整表重算 + 整表重渲染」，而重渲染不按行省钱。
 * 实测（`.tmp-build/bench-mydata`：vite build 之后的**产物级**、真组件、合成数据，40 站 40 行可见）：
 * 单条写入造成的一次 pass = **314 ms 中位 / 345 ms 最大**，12 次写入触发 12 次 pass；
 * 把这 40 条一次写完只要 **506 ms**（1 次 pass）—— 钱全花在 pass 的条数上。
 * 同一天量到「数据刚到的那一拍点导航」要 **246~306 ms** 才落地，这就是用户读到的「没响应」。
 *
 * 接上快照之后（同一台架、同一档，改后实测）：写入当场不再触发整表 pass（12 次写入合计 1 次），
 * 一次写完 40 条 **16 ms**，那一拍点导航 **12~31 ms** 落地。
 * 节拍从「上一轮画完」起算，所以两次 pass 之间一定留得出空档给输入事件。
 */
const TABLE_TICK_MS = 250;

const userInfoSnapshot = shallowRef<typeof metadataStore.lastUserInfo>({});
let snapshotTimer: ReturnType<typeof setTimeout> | null = null;
/** 上一轮快照「画完」的时刻。初值 0 让水合那第一次变化立刻收敛，不等窗口 */
let snapshotTakenAt = 0;

function copyUserInfoSnapshot() {
  // 换引用而不是就地改：tableData 只认这个 ref 的新对象
  userInfoSnapshot.value = { ...toRaw(metadataStore.lastUserInfo) };
}

function takeUserInfoSnapshot() {
  snapshotTimer = null;
  copyUserInfoSnapshot();
  // 从「这一轮渲染落地」起算，不是从「数据换掉」起算：40 行那一档一次 pass 要 314 ms，
  // 从换数据起算的话这 314 ms 算在等待里，下一次立刻又收敛 —— 空档一分钟都不剩，等于没改。
  void nextTick(() => {
    snapshotTakenAt = Date.now();
  });
}

function scheduleUserInfoSnapshot() {
  if (snapshotTimer) return;
  snapshotTimer = setTimeout(takeUserInfoSnapshot, Math.max(0, TABLE_TICK_MS - (Date.now() - snapshotTakenAt)));
}

// 首屏：store 里已经水合到了就直接拿，别空着一轮
copyUserInfoSnapshot();

// deep：`$patch` 那条路是把叶子逐个赋回原对象（对象标识不变），只看键的浅监听会漏掉它
watch(() => metadataStore.lastUserInfo, scheduleUserInfoSnapshot, { deep: true, flush: "post" });

/**
 * 行集合。
 *
 * 依赖三处 —— sites（增删站点）、allAddedSiteMetadata（定义与图标到位）、userInfoSnapshot（刷新结果），
 * 任一变化都只重算这一个数组。
 *
 * ⚠️ 「只有内容变了的那几行重渲染」这句原先写在这里，是**没实测的断言**：行对象每轮全部新建，
 * rc-table 拿到的 dataSource 是全新数组、每条 record 是全新对象，于是整张表逐行重渲染 ——
 * 上面那 314 ms/条 就是这件事的价。要改成「按行复用」得让 record 标识稳定下来，
 * 那是另一件事（要动 a-table 的插槽结构），本次先用收敛把 pass 的条数压住。
 */
export const tableData = computed<IUserInfoItem[]>(() => {
  // 显式依赖异步加载结果：定义没到位时不过滤条件算不出来（siteMeta.type / isDead 来自站点定义）
  // 这一行读的是**依赖**不是值：computed 必须订阅它，站点刷新后才会重算。
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
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

    const siteUserInfoData = userInfoSnapshot.value[siteId] ?? {};

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
 * chrome.storage（storage.ts 的 metadata 键），这里写镜像是为了不等 onChanged → $patch
 * 那一趟往返就把数落到真源上（什么时候进界面由上面那份快照的节拍决定）。metadata store 用的是
 * persistWebExt: true 的布尔形态，autoSaveType 为 false，所以这次赋值不会触发任何持久化写入。
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
          runtimeStore.showSnakebar(tOutside("MyData.fetchUserInfoFailed", { name: siteName }), { color: "error" });
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
    console.error("取消用户信息队列失败", e);
  }

  // 队列取消不是错误（原先用了 color: error，红色报错条说「已取消」纯属吓人），走 info 档。
  runtimeStore.showSnakebar(tOutside("MyData.refreshCanceled"), { color: "info" });
}

export async function loadSiteHistoryData(siteId: TSiteID): Promise<Array<IUserInfo & { date: string }>> {
  const retData: Array<IUserInfo & { date: string }> = [];

  const siteUserInfoData = (await sendMessage("getSiteUserInfo", siteId)) as Record<string, IUserInfo>;

  for (const [date, item] of Object.entries(siteUserInfoData)) {
    retData.push({ ...fixUserInfo(item), date });
  }

  return retData;
}
