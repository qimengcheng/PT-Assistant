/**
 * 此处放置一些其他数据，这些数据一般具有以下特征：
 * 1. 不需要persist
 * 2. 不需要跨tab共享的
 * 3. 可以在不同component中共享的
 */

import { defineStore } from "pinia";
import type { IRuntimePiniaStorageSchema, ISearchData, SnackbarMessageOptions } from "@/shared/types.ts";

const initialSearchData: () => ISearchData = () => ({
  isSearching: false,
  startAt: 0,
  endAt: 0,
  searchKey: "",
  searchPlanKey: "default",
  searchPlan: {},
  searchResult: [],
});

const initialMediaServerSearchData = () => ({
  isSearching: false,
  searchKey: "",
  searchStatus: {},
  searchResult: [],
});

export const useRuntimeStore = defineStore("runtime", {
  persist: {
    storage: sessionStorage,
    key: "__ptd_runtime_store", // 由于 runtimeStore 可能会在 content-script 中注册，所以此处需要使用一个独特的 key
    /**
     * 只序列化「用户可见的偏好」，把两个大结果集排除掉。
     *
     * 插件默认在每次 mutation 后把整个 state 写进 sessionStorage，而
     * search.searchResult 是全站搜索命中结果（340 站 × 每站几十条，可达上万条 × 20+ 字段），
     * 搜索流式回填时每批结果都会触发一次全量 JSON.stringify + 同步 setItem —— 主线程卡顿，
     * 且很快撞上sessionStorage 配额（约 5-10MB）抛 QuotaExceededError。
     *
     * 这里保留 searchKey / searchPlanKey / isSearching 等标量（刷新后仍停在同一个搜索方案），
     * 但结果集与逐站点状态字典一律不跨刷新保留。
     */
    serialize: (state: Partial<IRuntimePiniaStorageSchema>) =>
      JSON.stringify({
        ...state,
        // 只保留用户输入的偏好。进行中状态、耗时、结果集、逐站点状态字典都是单次会话的
        // 运行时数据。特别注意 isSearching 必须一并重置：只清结果集却留着 isSearching，
        // 刷新后会出现「搜索中」永远不消失（结果集已空、没有任何 plan 在跑）的卡死状态。
        search: {
          searchKey: state.search?.searchKey ?? "",
          searchPlanKey: state.search?.searchPlanKey ?? "default",
        },
        mediaServerSearch: {
          searchKey: state.mediaServerSearch?.searchKey ?? "",
        },
        uiGlobalSnakebar: [],
      }),
  },
  persistWebExt: false,
  state: (): IRuntimePiniaStorageSchema => ({
    search: initialSearchData(),
    userInfo: {
      flushPlan: {},
    },
    mediaServerSearch: initialMediaServerSearchData(),
    uiGlobalSnakebar: [],
  }),

  getters: {
    searchCostTime(state) {
      const plans = Object.values(state.search.searchPlan).filter((plan) => plan.startAt);

      if (plans.length === 0) {
        return 0;
      }

      const now = Date.now();
      const startTimes = plans.map((plan) => plan.startAt!);
      const endTimes = plans.map((plan) => plan.endAt || (plan.costTime ? plan.startAt! + plan.costTime : now));

      const earliestStart = Math.min(...startTimes);
      const latestEnd = Math.max(...endTimes);

      return latestEnd - earliestStart;
    },

    isUserInfoFlush(state) {
      return Object.values(state.userInfo.flushPlan).some((v) => v);
    },
  },

  actions: {
    resetSearchData() {
      this.search = initialSearchData();
    },

    resetMediaServerSearchData() {
      this.mediaServerSearch = initialMediaServerSearchData();
    },

    showSnakebar(text: string, options: SnackbarMessageOptions = {}) {
      // @ts-ignore
      this.uiGlobalSnakebar.push({ text, ...options });
    },
  },
});
