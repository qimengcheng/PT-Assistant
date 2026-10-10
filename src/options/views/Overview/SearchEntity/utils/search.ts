import PQueue from "p-queue";
import { computed, markRaw } from "vue";
import {
  definedFilters,
  EResultParseStatus,
  ETorrentStatus,
  type IAdvanceKeywordSearchConfig,
  type TSiteID,
} from "@ptd/site";

import { sendMessage } from "@/messages.ts";
import { i18n } from "@/options/plugins/i18n.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { useConfigStore } from "@/options/stores/config.ts";
import type { ISearchResultTorrent, TSearchSolutionKey } from "@/shared/types.ts";

import { tableCustomFilter } from "./filter.ts";

const runtimeStore = useRuntimeStore();
const configStore = useConfigStore();
const metadataStore = useMetadataStore();

const { advanceFilterDictRef, buildAdvanceItemPropsFn, updateTableFilterValueFn, advanceItemPropsRef } =
  tableCustomFilter;

// 模块级别的 Set，用于跟踪已存在的搜索结果 ID，避免并发时的重复
const globalExistingIds = new Set<string>();

export const searchQueue = new PQueue({ concurrency: 1 }); // 默认设置为 1，避免并发搜索

/**
 * 搜索世代（generation）。
 *
 * ⚠️ `searchQueue.clear()` 只清**还没开始**的排队任务，**不影响已经在跑的那个** ——
 * 它会继续跑完并把结果追加进表格、回写 status/count。所以「取消」之后仍会不断冒出新结果，
 * 而 isSearching 已经被打回 false，界面状态是脱节的。
 *
 * 这里给每轮搜索发一个世代号：取消或发起新一轮搜索时 +1；任务在每个 await 之后
 * 校验自己是否还属于当前世代，不是就直接放弃（不再写任何状态）。这样在途任务
 * 的迟到结果不会污染新一轮。
 */
let searchGeneration = 0;

/** 开始新一轮搜索：作废所有在途任务的后续写入 */
export function bumpSearchGeneration(): number {
  return ++searchGeneration;
}

/** 任务入队时领一个世代号（此刻的当前世代） */
export function currentSearchGeneration(): number {
  return searchGeneration;
}

/** 世代是否仍然有效 —— 取消/重新搜索后旧任务据此自行放弃 */
export function isSearchGenerationAlive(generation: number): boolean {
  return generation === searchGeneration;
}

/**
 * 把配置里的并发数同步进队列（队列构造时是 1，配置默认是 5）。
 *
 * ⚠️ 只能在**投递任务之前**调用，绝不能放在 searchQueue 的事件回调里（原先写在 active 里）：
 * p-queue 的 `concurrency` setter 会同步跑一遍 `#processQueue()`，而 active 事件是在
 * `#tryToStartAnother()` 里、`job()` **之前**发出的 —— 那一刻刚出队的那个任务还没执行到它
 * 自己的 `pending++`，队列里也可能只剩它自己（单站点方案，或队列里恰好只剩最后一个任务）。
 * 于是 setter 里的判定 `size === 0 && pending === 0` 成立，**误发一次 idle**，
 * 把 active 刚置上的 isSearching = true 当场又打回 false。
 *
 * 表现：整个第一次搜索期间 isSearching 都是 false —— 提示条不显示「搜索中」，而是直接显示
 * 「共 0 条结果 + 计时」，表格也不转圈；第二次搜索时并发数已经等于配置值、不再进 setter，
 * 那次误发的 idle 也就没有了，于是又「正常」了，即「第一次不会，第二次才会」。
 * 同一处地雷的另一个触发口：在设置页改「同时搜索站点数」后回到搜索页搜第一次，同样不出「搜索中」。
 *
 * 放在这里（搜索开始前、队列多数情况下是空的）赋值是安全的：万一 setter 仍触发一次 idle，
 * 此刻 isSearching 本来就是 false，紧接着 doSearch 才把它置 true。
 */
function syncSearchQueueConcurrency() {
  if (searchQueue.concurrency != configStore.searchEntity.queueConcurrency) {
    searchQueue.concurrency = configStore.searchEntity.queueConcurrency;
    console.debug("Search queue concurrency changed to: ", searchQueue.concurrency);
  }
}

searchQueue.on("active", () => {
  runtimeStore.search.isSearching = true;
  // 队列开始活跃时，更新全局 Set
  globalExistingIds.clear();
  runtimeStore.search.searchResult.forEach((r) => globalExistingIds.add(r.uniqueId));
});

searchQueue.on("idle", () => {
  runtimeStore.search.isSearching = false;
  runtimeStore.search.endAt = Date.now();

  globalExistingIds.clear(); // 队列空闲时，清空全局 Set
  buildAdvanceItemPropsFn(); // 队列空闲时，构建高级筛选词
});

interface ISearchPlanStatusMap {
  success: number; // success, noResults
  error: number; // unknownError, parseError, needLogin
  queued: number; // waiting, working
}

export const defaultErrorSearchPlanStatus = [
  EResultParseStatus.parseError,
  EResultParseStatus.unknownError,
  EResultParseStatus.CFBlocked,
  EResultParseStatus.needLogin,
  EResultParseStatus.noUserInput,
];

export const searchPlanStatus = computed<ISearchPlanStatusMap>(() => {
  const statusMap: ISearchPlanStatusMap = { success: 0, error: 0, queued: 0 };
  Object.values(runtimeStore.search.searchPlan ?? {}).forEach((plan) => {
    switch (plan.status) {
      case EResultParseStatus.success:
      case EResultParseStatus.noResults:
        statusMap.success++;
        break;
      case EResultParseStatus.unknownError:
      case EResultParseStatus.parseError:
      case EResultParseStatus.CFBlocked:
      case EResultParseStatus.needLogin:
      case EResultParseStatus.noUserInput:
        statusMap.error++;
        break;
      case EResultParseStatus.waiting:
      case EResultParseStatus.working:
        statusMap.queued++;
        break;
    }
  });
  return statusMap;
});

export async function raiseSearchPriority(solutionKey: TSearchSolutionKey) {
  const currentPriority = runtimeStore.search.searchPlan[solutionKey].queuePriority ?? 1;
  searchQueue.setPriority(solutionKey, currentPriority + 1);
}

export async function doSearchEntity(
  siteId: TSiteID,
  searchEntryName: string,
  searchEntry: IAdvanceKeywordSearchConfig,
  flush: boolean = false,
) {
  const solutionKey = `${siteId}|$|${searchEntryName}` as TSearchSolutionKey;
  let queuePriority = runtimeStore.search.searchPlan[solutionKey]?.queuePriority ?? 1;

  // 对重新搜索的，清除对应搜索方法的搜索结果
  if (flush) {
    const removedItems = runtimeStore.search.searchResult.filter((item) => item.solutionKey === solutionKey);
    runtimeStore.search.searchResult = runtimeStore.search.searchResult.filter(
      (item) => item.solutionKey != solutionKey,
    );
    // 同步更新全局 Set，移除被删除项目的 uniqueId
    removedItems.forEach((item) => globalExistingIds.delete(item.uniqueId));
    queuePriority -= 1; // 对重新搜索的，降低优先级
  }

  runtimeStore.search.searchPlan[solutionKey] = {
    siteId,
    searchEntryName,
    searchEntry,
    status: EResultParseStatus.waiting,
    statusMsg: undefined,
    queuePriority,
    count: 0,
  };

  // Search site by plan in queue
  console.log(`Add search ${solutionKey} to queue.`);
  runtimeStore.search.searchPlan[solutionKey].queueAt = Date.now();

  // 领世代号放在**投递时**（不是任务体里）：.catch 回调也要用到它来判断
  // 「这次失败是否还属于当前这轮搜索」
  const generation = currentSearchGeneration();

  searchQueue
    .add(
      async () => {
      // 世代在投递时就领好了；下面每个 await 之后都要校验 —— 世代过期就放弃本次写入
      const alive = () => isSearchGenerationAlive(generation);

      const startAt = (runtimeStore.search.searchPlan[solutionKey].startAt = Date.now());
      console.log(`search ${solutionKey} start at ${startAt}`);
      runtimeStore.search.searchPlan[solutionKey].status = EResultParseStatus.working;

      let searchKeyword = runtimeStore.search.searchKey ?? "";
      if (configStore.searchEntity.treatTTQueryAsImdbSearch && searchKeyword.match(/^tt\d{7,8}/)) {
        searchKeyword = "imdb|" + searchKeyword;
      }

      let imdbSearchKeywords;
      if (searchKeyword.startsWith("imdb|")) {
        imdbSearchKeywords = definedFilters.extImdbId(searchKeyword.replace("imdb|", ""));
      }

      const {
        status: searchStatus,
        statusMsg: searchStatusMsg,
        data: searchResult,
      } = await sendMessage("getSiteSearchResult", {
        keyword: searchKeyword,
        siteId,
        searchEntry,
      });

      // 请求回来时可能已经被取消了（或已经开始了新一轮搜索）—— 这时它的结果
      // 不该再进表格，也不该回写 status/count
      if (!alive()) {
        console.debug(`[SearchEntity] search ${solutionKey} 已取消，丢弃返回结果`);
        return;
      }

      console.log(
        `success get search ${solutionKey} result, with code ${searchStatus}: ${searchStatusMsg ?? ""}`,
        searchResult,
      );
      runtimeStore.search.searchPlan[solutionKey].status = searchStatus;
      searchStatusMsg && (runtimeStore.search.searchPlan[solutionKey].statusMsg = searchStatusMsg);

      // 优化：批量处理搜索结果，减少响应式更新次数
      const newItems: ISearchResultTorrent[] = [];

      for (const item of searchResult) {
        const itemUniqueId = `${item.site}-${item.id}`;
        if (!globalExistingIds.has(itemUniqueId)) {
          const searchResultItem = item as ISearchResultTorrent;
          searchResultItem.uniqueId = itemUniqueId;
          searchResultItem.solutionId = searchEntryName;
          searchResultItem.solutionKey = solutionKey;
          searchResultItem.status ??= ETorrentStatus.unknown; // 确保 status 字段有默认值，避免过滤器无法处理 undefined

          if (imdbSearchKeywords && configStore.searchEntity.forceImdbIdMatchFilter && searchResultItem.ext_imdb) {
            if (definedFilters.extImdbId(searchResultItem.ext_imdb) !== imdbSearchKeywords) {
              continue;
            }
          }

          newItems.push(markRaw(searchResultItem)); // 使用 markRaw 冻结对象，避免 Vue 创建响应式代理，提升性能
          globalExistingIds.add(itemUniqueId);
        }
      }

      // 批量添加新项目，减少响应式更新。
        // 用整体替换而不是 push(...newItems)：单批上万条时展开实参会爆调用栈
        // （Maximum call stack size exceeded）。
        if (newItems.length > 0) {
          runtimeStore.search.searchResult = [...runtimeStore.search.searchResult, ...newItems];
        }

        // 更新计数状态
        const endAt = Date.now();
        runtimeStore.search.searchPlan[solutionKey].count = newItems.length;
        runtimeStore.search.searchPlan[solutionKey].endAt = endAt;
        runtimeStore.search.searchPlan[solutionKey].costTime = endAt - startAt;

        // 直接向 advanceItemPropsRef.site 添加 siteId，而不是重新构造全部字典，以便于站点快速选择器更新
        const sites = advanceItemPropsRef.value.site;
        if (Array.isArray(sites) && !sites.includes(siteId)) {
          sites.push(siteId);
        }
      },
      { priority: queuePriority, id: solutionKey },
    )
    .catch((e) => {
      // 队列任务必须兜底catch：
      // 站点不可达 / 解析崩溃 / 扩展重载都会让 getSiteSearchResult 抛错，原先无人接手的
      // rejection 会让该方案的 status 永远停在 working、endAt/costTime 不写、
      // 排队计数不降（按钮一直显示「排队中」），甚至 idle 事件不触发导致 isSearching 卡在 true。
      console.error(`[SearchEntity] search failed: ${solutionKey}`, e);

      // 世代已过期 = 这轮搜索已被取消/替换，别把「失败」写到新一轮的方案上
      if (!isSearchGenerationAlive(generation)) return;

      const plan = runtimeStore.search.searchPlan[solutionKey];
      if (plan) {
        const failedAt = Date.now();
        plan.status = EResultParseStatus.unknownError;
        plan.statusMsg = e instanceof Error ? e.message : String(e);
        plan.endAt = failedAt;
        plan.costTime = failedAt - (plan.startAt ?? failedAt);
      }
    });
}

export async function doSearch(search: string, plan?: string, flush: boolean = true) {
  const searchKey = search ?? runtimeStore.search.searchKey ?? "";
  const searchPlanKey = plan ?? runtimeStore.search.searchPlanKey ?? "default";

  if (flush) {
    runtimeStore.resetSearchData();

    try {
      // 清除过滤器中的站点关键词，但保留其他过滤器
      advanceItemPropsRef.value.site = [];
      advanceFilterDictRef.value.site = { required: [], exclude: [] };
      updateTableFilterValueFn();
    } catch (e) {
      console.error("Failed to reset table filter site field: ", e);
    }
  }

  console.log("Start search with: ", searchKey, searchPlanKey, flush);

  runtimeStore.search.searchKey = searchKey;
  runtimeStore.search.searchPlanKey = searchPlanKey;

  try {
    // 冷启动必须先等水合。从站点页「搜索标题」/右键划词/omnibox 跳进来时，选项页是
    // `chrome.tabs.create` 新开的，搜索页那个 `watch(() => route.query, …, { immediate: true })`
    // 会在 persistWebExt 的 `chrome.storage.local.get` 回来之前就跑到这里：
    // 那时 `metadataStore.sites` 还是 `{}`，"default" 方案展开出 0 个站点，
    // 于是弹「请至少添加一个站点进行搜索」—— 而用户其实加了几十个站点。
    // configStore 同一趟：没等它就同步并发数，用户设的「同时搜索站点数」会被默认的 5 顶掉。
    await Promise.all([metadataStore.$onReady(), configStore.$onReady()]);

    // Expand search plan
    const searchSolution = await metadataStore.getSearchSolution(runtimeStore.search.searchPlanKey);

    if (!searchSolution) {
      // 原来这里把方案 id 直接端进提示（`搜索方案 [nanoid] 不存在`）—— 那串 id 用户既读不懂也没法用，
      // 而方案名在方案被删之后确实没了，所以提示只说该怎么做，id 留给控制台。
      console.error("[SearchEntity] 搜索方案取不到: ", searchPlanKey);
      runtimeStore.showSnakebar(i18n.t("SearchEntity.index.searchPlanGone"), { color: "error" });
      return;
    }

    runtimeStore.search.searchPlanKey = searchSolution.id; // 重写 searchPlanKey 为实际的 id
    console.log(`Expanded Search Plan for ${searchPlanKey}: `, searchSolution);

    if (searchSolution.solutions.length === 0) {
      runtimeStore.showSnakebar(i18n.t("SearchEntity.index.needSite"), { color: "error" });
      return;
    }

    // 并发数在这里同步（此时还没有任务投递），见 syncSearchQueueConcurrency 的说明
    syncSearchQueueConcurrency();

    runtimeStore.search.startAt = Date.now();
    runtimeStore.search.isSearching = true;
    // 新一轮搜索：作废上一轮所有在途任务的后续写入（它们返回后不该再往这张表里追加）
    bumpSearchGeneration();

    for (const { siteId, searchEntries } of searchSolution.solutions) {
      for (const [searchEntryName, searchEntry] of Object.entries(searchEntries)) {
        await doSearchEntity(siteId, searchEntryName, searchEntry);
      }
    }
  } catch (e) {
    // getSearchSolution / 队列投递抛错时原先一路冒泡到路由 watcher，变成 unhandled rejection：
    // isSearching 可能卡在 true（表格一直转圈），用户也看不到任何提示。
    console.error("[SearchEntity] doSearch failed", e);
    runtimeStore.search.isSearching = false;
    // 原因必须进提示：这句以前只说「请重试」，而配置类错误重试一万次也不会好，
    // 用户唯一的办法是开 F12 找那条 console。
    const reason = e instanceof Error ? `${e.message}` : String(e);
    runtimeStore.showSnakebar(i18n.t("SearchEntity.index.searchStartFailed", { reason }), { color: "error" });
  }
}

export async function retrySearch(retryStatus: EResultParseStatus[] = defaultErrorSearchPlanStatus) {
  const shouldRetrySearchPlan = Object.values(runtimeStore.search.searchPlan).filter((plan) =>
    retryStatus.includes(plan.status),
  );
  if (shouldRetrySearchPlan.length === 0) {
    runtimeStore.showSnakebar(i18n.t("SearchEntity.index.nothingToRetry"), { color: "info" });
    return;
  }
  console.log("Retrying search plans: ", shouldRetrySearchPlan);
  for (const plan of shouldRetrySearchPlan) {
    await doSearchEntity(plan.siteId, plan.searchEntryName, plan.searchEntry, true);
  }
}
