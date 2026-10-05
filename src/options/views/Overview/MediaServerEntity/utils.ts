/**
 * 媒体服务器浏览页搜索工具（antdv-next 平移）。
 * 模块级单例：选中的服务器列表 + 串行 PQueue，结果按 url 全局去重后写入 runtimeStore.mediaServerSearch。
 */
import PQueue from "p-queue";
import { computed, markRaw, ref } from "vue";
import { omit } from "es-toolkit";
import { filesize } from "filesize";
import type { IMediaServerSearchOptions } from "@ptd/mediaServer";
import { EResultParseStatus } from "@ptd/site";

import { sendMessage } from "@/messages.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { useConfigStore } from "@/options/stores/config.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import type { TMediaServerKey } from "@/shared/types.ts";

const runtimeStore = useRuntimeStore();
const configStore = useConfigStore();
const metadataStore = useMetadataStore();

export const formatSize = (size: number | string) => {
  try {
    return filesize(Number(size), { base: 2, round: 2, pad: true });
  } catch {
    return String(size);
  }
};

/**
 * 「参与搜索的服务器范围」。
 *
 * ⚠️ 原先是 `ref(metadataStore.getEnabledMediaServers.map(...))` —— **模块顶层同步求值**。
 * 而 metadata store 是 persistWebExt（靠 chrome.storage 异步水合），模块被 import 那一刻
 * mediaServers 还是 {}、getter 返回 []，于是这个 ref 被**永久钉成空数组**：冷启动进页面时
 * doSearch 的循环一次都不跑，而且完全不报错、不进 vue-tsc。
 * 后面那个 `?? []` 也是死代码 —— getter 恒返回数组，`.map()` 永远不会给出 nullish。
 *
 * 改成可写 computed（AGENTS 3.5 那条「优先派生」的正解）：
 *   - getter 直接派生自 store，水合一到自动重算（同 Index.vue 里 enabledServerIds 的写法）；
 *   - setter 把用户的选择记进 userSelection，只有用户真的动过选择框才覆盖派生值。
 * 用户主动取消全选时 userSelection 是 []，不是 nullish，所以不会被 store 的水合覆盖回去。
 */
const userServerSelection = ref<TMediaServerKey[] | null>(null);

export const searchMediaServerIds = computed<TMediaServerKey[]>({
  get: () => userServerSelection.value ?? metadataStore.getEnabledMediaServers.map((mediaServer) => mediaServer.id),
  set: (value) => {
    userServerSelection.value = value;
  },
});

export const searchQueue = new PQueue({ concurrency: 1 }); // 默认设置为 1，避免并发搜索

// 模块级别的 Set，用于跟踪已存在的搜索结果 ID，避免并发时的重复
const globalExistingIds = new Set<string>();

/**
 * 把配置里的并发数同步进队列（队列构造时是 1，配置默认是 8）。
 *
 * ⚠️ 只能在**投递任务之前**调用，不能放在 searchQueue 的事件回调里（原先写在 active 里）：
 * p-queue 的 `concurrency` setter 会同步跑一遍 #processQueue()，而 active 事件是在
 * #tryToStartAnother() 里、`job()` **之前**发出的 —— 那一刻刚出队的那个任务还没执行到它
 * 自己的 pending++，队列里也可能只剩它自己，于是 setter 里的判定
 * `size === 0 && pending === 0` 成立，**误发一次 idle**，把 active 刚置上的
 * mediaServerSearch.isSearching = true 当场又打回 false。
 * 表现：第一次搜索期间 isSearching 一直是 false（第二次搜索并发数已等于配置值，就正常了）。
 * 同 SearchEntity/utils/search.ts 的 syncSearchQueueConcurrency。
 */
function syncSearchQueueConcurrency() {
  if (searchQueue.concurrency != configStore.mediaServerEntity.queueConcurrency) {
    searchQueue.concurrency = configStore.mediaServerEntity.queueConcurrency;
    void sendMessage("logger", { msg: `Search queue concurrency changed to: ${searchQueue.concurrency}` });
  }
}

searchQueue.on("active", () => {
  runtimeStore.mediaServerSearch.isSearching = true;

  // 队列开始活跃时，更新全局 Set
  globalExistingIds.clear();
  runtimeStore.mediaServerSearch.searchResult.forEach((r) => globalExistingIds.add(r.url));
});

searchQueue.on("idle", () => {
  runtimeStore.mediaServerSearch.isSearching = false;

  // 队列空闲时，清空全局 Set
  globalExistingIds.clear();
});

export async function doSearch(option: { searchKey?: string; loadMore?: boolean } = {}) {
  const { searchKey = "", loadMore = false } = option;

  if (searchKey != runtimeStore.mediaServerSearch.searchKey) {
    runtimeStore.resetMediaServerSearchData();
  }

  runtimeStore.mediaServerSearch.searchKey = searchKey;

  // 并发数在投递任务之前同步，见 syncSearchQueueConcurrency 的说明
  syncSearchQueueConcurrency();

  for (const mediaServerId of searchMediaServerIds.value) {
    // noinspection ES6MissingAwait
    searchQueue.add(async () => {
      let searchOptions: IMediaServerSearchOptions = { limit: configStore.mediaServerEntity.searchLimit ?? 50 };
      if (loadMore) {
        searchOptions = runtimeStore.mediaServerSearch.searchStatus[mediaServerId]?.options ?? {};
        searchOptions.startIndex = (searchOptions.startIndex ?? 0) + (searchOptions.limit ?? 0);
      }

      const searchResult = await sendMessage("getMediaServerSearchResult", {
        mediaServerId,
        keywords: searchKey,
        options: searchOptions,
      });

      runtimeStore.mediaServerSearch.searchStatus[mediaServerId] = {
        ...omit(searchResult, ["items"]),
        canLoadMore: false,
      };

      if (searchResult.status !== EResultParseStatus.success) {
        const mediaServerDetail = metadataStore.mediaServers[mediaServerId];
        // 只有认证类失败才提示检查认证信息，其余（超时/网络不可达/解析异常）展示真实原因（#1396）
        const failReason =
          searchResult.status === EResultParseStatus.needLogin
            ? "请检查认证信息"
            : (searchResult.errorMessage ?? "未知错误");
        runtimeStore.showSnakebar(
          `媒体服务器 ${mediaServerDetail.name} [${mediaServerDetail.address}] 更新失败：${failReason}`,
          {
            color: "error",
          },
        );
        return;
      }

      for (const item of searchResult.items) {
        // 根据 url 去重
        const isDuplicate = globalExistingIds.has(item.url);
        if (!isDuplicate) {
          runtimeStore.mediaServerSearch.searchResult.push(markRaw(item));
          globalExistingIds.add(item.url);
          // 如果本次有成功添加的，则认为可以加载更多
          runtimeStore.mediaServerSearch.searchStatus[mediaServerId].canLoadMore = true;
        }
      }
    });
  }
}
