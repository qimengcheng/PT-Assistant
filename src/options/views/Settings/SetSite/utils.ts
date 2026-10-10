import { computedAsync } from "@vueuse/core";
import { ref } from "vue";
import { definitionList, type ISiteMetadata, type ISiteUserConfig, type TSiteID } from "@ptd/site";

import { useMetadataStore } from "@/options/stores/metadata.ts";

/**
 * 取全部「尚未添加」的站点定义元数据。
 * 注意这会 await getSiteMetadata 逐个动态 import 定义分片，站点数多时不轻，
 * 只在添加对话框需要按名称/tag 检索时调用一次。
 */
export async function getCanAddedSiteMetadata() {
  const canAddedSiteMetadata: Record<TSiteID, ISiteMetadata> = {};
  const metadataStore = useMetadataStore();
  const canAddedSiteList = definitionList.filter((x) => !metadataStore.getAddedSiteIds.includes(x));
  await Promise.all(
    canAddedSiteList.map(async (siteId) => {
      try {
        canAddedSiteMetadata[siteId] = await metadataStore.getSiteMetadata(siteId);
      } catch (e) {
        // 同 makeMissingMetadata 的注释：定义分片缺失不该让整个下拉空掉
        console.error(`[SetSite] load site metadata failed: ${siteId}`, e);
        canAddedSiteMetadata[siteId] = makeMissingMetadata(siteId);
      }
    }),
  );
  return canAddedSiteMetadata;
}

/**
 * 定义分片取不到的占位元数据。
 *
 * ⚠️ 不是「防御性编程」：站点升级时上游删掉某个定义，而用户库里还留着那条
 * 站点配置（升级不会主动清用户数据），getSiteMetadata 的动态 import 就 reject。
 * 原来这里没有 try/catch，一个 reject 顺着 for 循环抛出 Promise.all，
 * computedAsync 整体 reject → 站点管理**整张表**都空（不是那一条空），
 * 用户看到「我几十个站点全没了」，实际数据都还在。
 *
 * 逐个 try，取不到就留一行占位：用户仍能看到那一条（并知道它缺定义），
 * 其余站点照常显示。
 */
function makeMissingMetadata(siteId: TSiteID): ISiteMetadata {
  return {
    id: siteId,
    // ISiteMetadata 的必填项之一（同 interface 里 id/name/type/urls）。少写一个字段就得
    // 靠 `as unknown as` 把类型糊过去 —— 那正是 v0.59.2 那次「只返回 3 个字段却 as 成完整类型」
    // 把缺陷藏到运行时的形状，这里补齐，让 TS 继续替我们盯着必填项。
    // 表格里没有任何一处读 metadata.version（全仓 grep 过），所以这个占位值不会上屏。
    version: 0,
    name: siteId,
    type: "private",
    urls: [],
    tags: [],
  };
}

export interface ISiteTableItem {
  id: TSiteID;
  metadata: ISiteMetadata;
  userConfig: ISiteUserConfig;
}

/**
 * 已添加站点的「定义 + 用户配置」合并视图，供管理表格整体消费。
 * isLoadingAllAddedSites：computedAsync 第三参传 Ref<boolean>，会随求值过程自动翻转（evaluating）
 */
export const isLoadingAllAddedSites = ref(false);
export const allAddedSiteInfo = computedAsync<ISiteTableItem[]>(async () => {
  const metadataStore = useMetadataStore();
  // 显式触碰 sites，令增删站点时该异步 computed 重新求值
  Object.values(metadataStore.sites).map((x) => x);

  const sitesReturn: ISiteTableItem[] = [];
  for (const [siteId, siteUserConfig] of Object.entries(metadataStore.sites)) {
    try {
      sitesReturn.push({
        id: siteId,
        metadata: await metadataStore.getSiteMetadata(siteId),
        userConfig: siteUserConfig,
      });
    } catch (e) {
      // 一个站点缺定义不该让整张表 reject（computedAsync 一失败就全空）
      console.error(`[SetSite] load site metadata failed: ${siteId}`, e);
      sitesReturn.push({
        id: siteId,
        metadata: makeMissingMetadata(siteId as TSiteID),
        userConfig: siteUserConfig,
      });
    }
  }

  return sitesReturn;
}, [], isLoadingAllAddedSites);
