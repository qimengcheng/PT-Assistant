import { nanoid } from "nanoid";
import { defineStore } from "pinia";
import { isEmpty, set } from "es-toolkit/compat";
import {
  getHostFromUrl,
  getDefinedSiteMetadata,
  type ISearchCategories,
  type ISearchEntryRequestConfig,
  type ISiteMetadata,
  type ISiteUserConfig,
  type TSiteHost,
  type TSiteID,
} from "@ptd/site";

import {
  type IBackupServerMetadata,
  type IDownloaderMetadata,
  type IMediaServerMetadata,
  type IMetadataPiniaStorageSchema,
  type ISearchSolution,
  type TDownloaderKey,
  type TMediaServerKey,
  type TSearchSnapshotKey,
  type TSolutionKey,
  type ISearchSolutionMetadata,
} from "@/shared/types.ts";
import { sendMessage } from "@/messages.ts";
import { i18n } from "@/options/plugins/i18n.ts";
import { useConfigStore } from "@/options/stores/config.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";

type TSimplePatchFieldKey = keyof Pick<
  IMetadataPiniaStorageSchema,
  "sites" | "solutions" | "snapshots" | "downloaders" | "mediaServers" | "backupServers"
>;

export const useMetadataStore = defineStore("metadata", {
  persistWebExt: true,
  state: (): IMetadataPiniaStorageSchema => ({
    sites: {},
    solutions: {},
    snapshots: {},
    downloaders: {},
    mediaServers: {},
    backupServers: {},

    defaultSolutionId: "default",
    defaultDownloader: {},

    lastSearchFilter: "",
    lastUserInfo: {},
    lastDownloader: {},
    lastKeepUpload: {},
    lastUserInfoAutoFlushAt: 0,

    siteHostMap: {},
    siteNameMap: {},
  }),

  getters: {
    getAddedSiteIds(state) {
      return Object.keys(state.sites);
    },

    getAddedSites(state) {
      return Object.entries(state.sites).map(([siteId, metadata]) => {
        return { ...metadata, id: siteId };
      });
    },

    getSortedAddedSites(state): Array<ISiteUserConfig & { id: string }> {
      return this.getAddedSites.sort((a, b) => {
        return (b.sortIndex ?? 0) - (a.sortIndex ?? 0);
      });
    },

    getSitesGroupData(state) {
      const sitesGroupData: Record<string, TSiteID[]> = {};
      for (const siteId in state.sites) {
        const site = state.sites[siteId];
        if (site.groups) {
          for (const group of site.groups) {
            sitesGroupData[group] ??= [];
            sitesGroupData[group].push(siteId);
          }
        }
      }
      return sitesGroupData;
    },

    getSiteMetadata(state) {
      return async (siteId: TSiteID): Promise<ISiteMetadata> => {
        return await getDefinedSiteMetadata(siteId);
      };
    },

    getSiteUserConfig(state) {
      return async (siteId: TSiteID, flush: boolean = false): Promise<ISiteUserConfig> => {
        const siteUserConfig = state.sites[siteId] ?? {};
        if (flush || isEmpty(siteUserConfig)) {
          return await sendMessage("getSiteUserConfig", { siteId, flush });
        }
        return siteUserConfig;
      };
    },

    getSiteMergedMetadata(state) {
      return async <T extends keyof ISiteMetadata>(
        siteId: TSiteID,
        field: T,
        defaultValue?: ISiteMetadata[T],
      ): Promise<ISiteMetadata[T]> => {
        const siteConfig = await this.getSiteUserConfig(siteId);
        if (siteConfig.merge?.[field]) {
          return siteConfig.merge[field];
        }
        const siteMetadata = await this.getSiteMetadata(siteId);
        return siteMetadata[field] ?? (defaultValue as ISiteMetadata[T]);
      };
    },

    getSiteName(state) {
      return async (siteId: TSiteID): Promise<string> => {
        return await this.getSiteMergedMetadata(siteId, "name", siteId);
      };
    },

    getSiteUrl(state) {
      return async (siteId: TSiteID): Promise<string> => {
        const siteConfig = await this.getSiteUserConfig(siteId);
        if (siteConfig.url) {
          return siteConfig.url;
        }
        const siteMetadata = await this.getSiteMetadata(siteId);
        return siteMetadata.urls?.[0] ?? "#";
      };
    },

    getSiteCategory(state) {
      return async (siteId: TSiteID, categoryKey?: string): Promise<ISearchCategories | ISearchCategories[]> => {
        const siteMetadataCategory = await this.getSiteMergedMetadata(siteId, "category", []);
        if (categoryKey) {
          return siteMetadataCategory?.find((x) => x.key === categoryKey) as ISearchCategories;
        }
        return siteMetadataCategory as ISearchCategories[];
      };
    },

    getSiteCategoryName(state) {
      return async (siteId: TSiteID, categoryKey: string): Promise<string> => {
        const siteMetadataCategory = (await this.getSiteCategory(siteId, categoryKey)) as ISearchCategories;
        return siteMetadataCategory?.name ?? categoryKey;
      };
    },

    getSiteCategoryOptionName(state) {
      return async (
        siteId: TSiteID,
        categoryKey: string,
        optionKey: string | number | (string | number)[],
      ): Promise<string> => {
        const siteMetadataCategory = (await this.getSiteCategory(siteId, categoryKey)) as ISearchCategories;
        const options = siteMetadataCategory?.options ?? [];
        if (Array.isArray(optionKey)) {
          return optionKey.map((v) => options.find((o) => o.value === v)?.name ?? v).join(", ");
        } else {
          return options.find((o) => o.value === optionKey)?.name ?? (optionKey as string);
        }
      };
    },

    getSearchSolutionIds(state) {
      return Object.keys(state.solutions);
    },

    getSearchSolutions(state) {
      return Object.values(state.solutions);
    },

    getSiteDefaultSearchSolution(state) {
      // 如果站点 isDead 或者 isOffline 则不返回搜索方案（ undefined ），调用该方法的地方需要额外判断
      return async (siteId: TSiteID): Promise<Record<string, ISearchEntryRequestConfig> | undefined> => {
        const siteUserConfig = state.sites[siteId];
        /**
         * 站点可能已经被删掉，但 `site:a,b,c` 这个作用域键、或某个已存搜索方案里还留着它的 id。
         * 原来这里直接读 `.isOffline` 会抛 TypeError，而调用方是在 for 循环里 await 它 ——
         * 一条脏 id 就能让整次搜索一个任务都不投，界面上只剩一句没有原因的「搜索启动失败，请重试」。
         */
        if (!siteUserConfig || siteUserConfig.isOffline) {
          return;
        }

        // ⚠️ 这里**故意不包 try/catch**：取不到定义要么是扩展刚更新、旧标签页里的动态 chunk 404，
        // 要么是这条定义真的没了。两种都必须响亮地冒到调用方去（doSearch 会把原因写进提示），
        // 静默跳过就会把前者伪装成「请至少添加一个站点进行搜索」。
        const siteMetadata = await getDefinedSiteMetadata(siteId);

        if (siteMetadata.isDead) {
          return;
        }

        /**
         * ⚠️ 必须先浅拷贝容器再改写：getDefinedSiteMetadata 返回的是**共享缓存对象**
         * （同一 siteId 多次调用返回同一引用）。直接 `searchEntries[key] = {...}` 会把
         * 站点定义里真正的 searchEntry 配置（selectors / requestConfig）永久抹成
         * {id, name, enabled}，该站点的搜索随即完全失效。
         */
        let searchEntries = { ...(siteMetadata.searchEntry ?? { default: {} }) };
        for (const [key, value] of Object.entries(siteUserConfig?.merge?.searchEntry ?? {})) {
          if (searchEntries[key] && typeof value.enabled === "boolean") {
            /**
             * 由于我们需要通过 sendMessage 向 offscreen 发送搜索方案，然而 sendMessage 不支持 Function 等复杂类型，
             * 所以我们这里只传递 id, name, enabled，其他的搜索方案的内容在 站点实例里面组合
             */
            searchEntries[key] = { id: key, name: searchEntries[key].name, enabled: value.enabled };
          }
        }
        return searchEntries;
      };
    },

    getSearchSolution(state) {
      return async (
        solutionId: TSolutionKey | `site:${string}` | "default" | "all",
      ): Promise<ISearchSolutionMetadata | undefined> => {
        // 首先判断是否是约定的 "all"  "default"  "site:xxx,xxx" 站点搜索方案
        if (
          // 全部站点
          solutionId === "all" ||
          (solutionId === "default" && state.defaultSolutionId === "default") ||
          // 特定站点
          solutionId.startsWith("site:")
        ) {
          const solutions: ISearchSolution[] = [];

          let addedSiteIds = Object.keys(state.sites);
          if (solutionId.startsWith("site:")) {
            addedSiteIds = solutionId
              .slice(5) //  /^site:/
              .split(",")
              .map((id) => id.trim());
          }

          for (const siteId of addedSiteIds) {
            const searchEntries = await this.getSiteDefaultSearchSolution(siteId);
            if (searchEntries) {
              solutions.push({ id: "default", siteId, searchEntries });
            }
          }

          return {
            name: "all",
            id: solutionId.startsWith("site:") ? (solutionId as `site:${string}`) : "all",
            sort: 0,
            enabled: true,
            isDefault: true,
            createdAt: 0,
            solutions,
          };
        } else if (solutionId === "default") {
          // 如果 solutionId 是 "default"，则使用默认的搜索方案 ID
          solutionId = state.defaultSolutionId;
        }

        // 对于已经存在的搜索方案，其中如果有 id === "default" 的特殊情况，将其动态解开
        const solution = state.solutions[solutionId] as ISearchSolutionMetadata | undefined;

        /**
         * 方案可能已经被删掉、而 `runtimeStore.search.searchPlanKey` 还记着它。
         * 原来这里直接读 `solution.solutions` → TypeError → 一句没有原因的「搜索启动失败」。
         * 返回 undefined 让调用方走它本来就有的那条「方案不存在」分支
         * （`SetSearchSolution/Index.vue:144` 的 copySearchSolution 早就在判 undefined 了 ——
         *   说明「取不到就返回 undefined」本来就是这个 getter 的约定）。
         */
        if (!solution) {
          return;
        }

        /**
         * ⚠️ 不要在 getter 里改state：
         * 原来这里 `solutionItem.searchEntries = ...` 与 `solution.solutions = solutionItems`
         * 是就地改写持久化数据 —— 「读」一个搜索方案会把解开的 default 条目永久写回 storage，
         * 而且 pinia getter 是 computed，在其依赖上做 mutation 会触发级联失效/重渲染，
         * 调用方 cloneDeep 拿到的还是被就地改过的对象。
         * 改成构造新对象返回。
         */
        const solutionItems: ISearchSolution[] = [];
        for (const solutionItem of solution.solutions) {
          if (solutionItem.id === "default") {
            const searchEntries = await this.getSiteDefaultSearchSolution(solutionItem.siteId);
            if (searchEntries) {
              solutionItems.push({ ...solutionItem, searchEntries });
            }
          } else {
            solutionItems.push(solutionItem);
          }
        }

        return { ...solution, solutions: solutionItems };
      };
    },

    getSearchSolutionName(state) {
      return (solutionId: TSolutionKey): string => {
        // pinia getter 里没有组件实例，useI18n() 用不了；直接取全局 Composer。
        // 引 i18n 单例对 content chunk 零增量 —— i18n-lite.ts 已经在引它了。
        if (solutionId === "all") {
          return i18n.t("SearchEntity.solutionAll");
        }

        /**
         * `site:a,b,c` 是搜索页直接勾站点产生的作用域键（见 SearchScopeSelect.vue），
         * 不在这里解析就会把 `m-18,m-24` 这类内部 id 显示到搜索提示条、快照名、
         * 下载器模板变量里（AGENTS.md §3.5 零容忍项）。
         */
        if (solutionId.startsWith("site:")) {
          const names = solutionId
            .slice("site:".length)
            .split(",")
            .map((id) => id.trim())
            .filter(Boolean)
            .map((id) => state.siteNameMap[id] ?? id);
          if (names.length <= 1) return names[0] ?? solutionId;
          return i18n.t("SearchEntity.scope.moreSites", [names[0], names.length]);
        }

        return state.solutions[solutionId]?.name ?? solutionId;
      };
    },

    getSearchSnapshotList(state) {
      return Object.values(state.snapshots);
    },

    getSearchSnapshotData(state) {
      return async (id: TSearchSnapshotKey) => {
        const snapshotInfo = state.snapshots[id];
        if (snapshotInfo?.id) {
          return await sendMessage("getSearchResultSnapshotData", id);
        } else {
          const runtimeStorage = useRuntimeStore();
          runtimeStorage.showSnakebar("未找到该搜索快照...", { color: "error" });
          return;
        }
      };
    },

    getDownloaderIds(state) {
      return Object.keys(state.downloaders);
    },

    getDownloaders(state) {
      return Object.values(state.downloaders);
    },

    getEnabledDownloaders(state) {
      return Object.values(state.downloaders).filter((downloader) => downloader.enabled);
    },

    getSortedEnabledDownloaders(state): Array<IDownloaderMetadata> {
      return this.getEnabledDownloaders.sort((a, b) => {
        return (b.sortIndex ?? 0) - (a.sortIndex ?? 0);
      });
    },

    getEnabledDownloadersBySite(state) {
      return (siteId: string): IDownloaderMetadata[] => {
        const configStore = useConfigStore();
        if (!configStore.download.allowDownloaderFilterForSite) {
          return this.getEnabledDownloaders;
        }
        return this.getEnabledDownloaders.filter((d) => !d.excludedSites?.includes(siteId));
      };
    },

    getSortedEnabledDownloadersBySite(state) {
      return (siteId: string): IDownloaderMetadata[] => {
        return [...this.getEnabledDownloadersBySite(siteId)].sort((a, b) => {
          return (b.sortIndex ?? 0) - (a.sortIndex ?? 0);
        });
      };
    },

    getMediaServerIds(state) {
      return Object.keys(state.mediaServers);
    },

    getMediaServers(state) {
      return Object.values(state.mediaServers);
    },

    getEnabledMediaServers(state) {
      return Object.values(state.mediaServers).filter((mediaServer) => mediaServer.enabled);
    },

    getBackupServerIds(state) {
      return Object.keys(state.backupServers);
    },

    getBackupServers(state) {
      return Object.values(state.backupServers);
    },
  },
  actions: {
    async simplePatch<
      Field extends TSimplePatchFieldKey,
      Id extends keyof IMetadataPiniaStorageSchema[Field],
      Key extends keyof IMetadataPiniaStorageSchema[Field][Id],
      Value extends IMetadataPiniaStorageSchema[Field][Id][Key],
    >(schemaKey: Field, id: Id, key: Key | string, value: Value | any) {
      set(this[schemaKey][id], key, value);
      await this.$save();
    },

    /**
     * 按给定顺序重写站点 sortIndex（降序：越靠前值越大，与 getSortedAddedSites 的排法一致）。
     *
     * orderedIds 允许只是「可见子集」（搜索作用域面板里只列可搜站点），所以先把新顺序
     * 映射回全量序列里那些可见站点原本占着的槽位，未列出的站点保持相对位置不动 ——
     * 直接按子集重编号会把没显示出来的站点顺序打乱。
     */
    async reorderSites(orderedIds: string[]) {
      const fullOrder = this.getSortedAddedSites.map((site) => site.id);
      const knownIds = orderedIds.filter((id) => id in this.sites);
      if (knownIds.length === 0) return;

      const slots: number[] = [];
      fullOrder.forEach((id, index) => {
        if (knownIds.includes(id)) slots.push(index);
      });
      if (slots.length !== knownIds.length) return; // 刚被增删过，这次重排作废而不是写出半截顺序

      const nextOrder = [...fullOrder];
      knownIds.forEach((id, k) => (nextOrder[slots[k]] = id));

      const total = nextOrder.length;
      let changed = false;
      nextOrder.forEach((id, index) => {
        const sortIndex = total - index;
        if (this.sites[id].sortIndex !== sortIndex) {
          this.sites[id].sortIndex = sortIndex;
          changed = true;
        }
      });

      if (changed) await this.$save();
    },

    async addSite(siteId: TSiteID, siteConfig: ISiteUserConfig, options?: { reBuildMap?: boolean }) {
      const { reBuildMap = true } = options ?? {};

      delete siteConfig.valid;
      this.sites[siteId] = siteConfig;

      if (reBuildMap) {
        await this.buildSiteMapCache(false);
      }

      await this.$save();
    },

    async removeSite(siteId: TSiteID, options?: { reBuildMap?: boolean }) {
      const { reBuildMap = true } = options ?? {};

      delete this.sites[siteId];

      if (reBuildMap) {
        await this.buildSiteMapCache(false);
      }

      await this.$save();
    },

    /**
     * 在添加、编辑站点时调用，重新生成 host 对站点的映射，
     * 便于 content-script 等其他地方通过 (await extStorage.getItem('metadata')).siteHostMap[host] 获取站点 ID
     */
    async buildSiteHostMap() {
      const siteHostMap: Record<TSiteHost, TSiteID> = {};
      for (const siteId in this.sites) {
        const site = this.sites[siteId];
        if (site.url) {
          siteHostMap[getHostFromUrl(site.url)] = siteId;
        }
        const urls = await this.getSiteMergedMetadata(siteId, "urls", []);
        if (urls.length > 0) {
          for (const url of urls) {
            siteHostMap[getHostFromUrl(url)] = siteId;
          }
        }
        const legacyUrls = (await this.getSiteMergedMetadata(siteId, "legacyUrls", []))!;
        if (legacyUrls.length > 0) {
          for (const url of legacyUrls) {
            siteHostMap[getHostFromUrl(url)] = siteId;
          }
        }
      }
      this.siteHostMap = siteHostMap;
    },

    async buildSiteNameMap() {
      const siteNameMap: Record<TSiteID, string> = {};
      for (const siteId in this.sites) {
        siteNameMap[siteId] = await this.getSiteName(siteId);
      }
      this.siteNameMap = siteNameMap;
    },

    async buildSiteMapCache(save: boolean = false) {
      await this.buildSiteNameMap();
      await this.buildSiteHostMap();

      if (save) {
        await this.$save();
      }
    },

    async addSearchSolution(solution: ISearchSolutionMetadata) {
      this.solutions[solution.id] = solution;
      await this.$save();
    },

    async removeSearchSolution(solutionId: TSolutionKey) {
      delete this.solutions[solutionId];

      if (this.defaultSolutionId === solutionId) {
        this.defaultSolutionId = "default";
      }

      await this.$save();
    },

    async saveSearchSnapshotData(name: string) {
      const runtimeStorage = useRuntimeStore();
      const searchSnapshotData = runtimeStorage.search;

      if (searchSnapshotData.isSearching) {
        runtimeStorage.showSnakebar("你不能创建一个正在搜索中的快照...", { color: "error" });
        return;
      }

      const snapshotId = nanoid();
      this.snapshots[snapshotId] = {
        id: snapshotId,
        name,
        createdAt: Date.now(),
        recordCount: searchSnapshotData.searchResult.length,
      };

      // 保存搜索快照数据
      await sendMessage("saveSearchResultSnapshotData", { snapshotId, data: searchSnapshotData });

      await this.$save();
    },

    async editSearchSnapshotDataName(id: TSearchSnapshotKey, name: string) {
      this.snapshots[id].name = name;
      await this.$save();
    },

    async removeSearchSnapshotData(id: TSearchSnapshotKey) {
      delete this.snapshots[id]; // 删除搜索快照元数据
      await sendMessage("removeSearchResultSnapshotData", id); // 删除搜索快照数据
      await this.$save();
    },

    async addDownloader(downloaderConfig: IDownloaderMetadata) {
      delete downloaderConfig.valid;
      this.downloaders[downloaderConfig.id] = downloaderConfig;
      await this.$save();
    },

    async removeDownloader(downloaderId: TDownloaderKey) {
      delete this.downloaders[downloaderId];
      await this.$save();
    },

    async setLastSearchFilter(filter: string) {
      this.lastSearchFilter = (filter ?? "").replace(/\s*site:\S+/g, "").trim();
      await this.$save();
    },

    async setLastDownloader(downloader: IMetadataPiniaStorageSchema["lastDownloader"]) {
      this.lastDownloader = downloader;
      await this.$save();
    },

    async addMediaServer(mediaServerConfig: IMediaServerMetadata) {
      this.mediaServers[mediaServerConfig.id] = mediaServerConfig;
      await this.$save();
    },

    async removeMediaServer(mediaServerId: TMediaServerKey) {
      delete this.mediaServers[mediaServerId];
      await this.$save();
    },

    async addBackupServer(backupServerConfig: IBackupServerMetadata) {
      this.backupServers[backupServerConfig.id] = backupServerConfig;
      await this.$save();
    },

    async removeBackupServer(backupServerId: string) {
      delete this.backupServers[backupServerId];
      await this.$save();
    },
  },
});
