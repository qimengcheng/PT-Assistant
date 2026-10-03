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
  for (const siteId of canAddedSiteList) {
    canAddedSiteMetadata[siteId] = await metadataStore.getSiteMetadata(siteId);
  }
  return canAddedSiteMetadata;
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

  const sitesReturn = [];
  for (const [siteId, siteUserConfig] of Object.entries(metadataStore.sites)) {
    sitesReturn.push({
      id: siteId,
      metadata: await metadataStore.getSiteMetadata(siteId),
      userConfig: siteUserConfig,
    });
  }

  return sitesReturn;
}, [], isLoadingAllAddedSites);
