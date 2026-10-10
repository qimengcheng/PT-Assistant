import { nanoid } from "nanoid";
import { cloneDeep, toMerged } from "es-toolkit";
import { isEmpty, set } from "es-toolkit/compat";
import type { IAdvancedSearchRequestConfig, ISearchCategories, TSelectSearchCategoryValue, TSiteID } from "@ptd/site";

import { useMetadataStore } from "@/options/stores/metadata.ts";
import type { ISearchSolution } from "@/shared/types/storages/metadata.ts";

/**
 * 取不到分类元数据时的显示名。
 *
 * 故意**不是**内部 key：那串标识（category / type / video / audio…）是站点定义
 * 的字段名，用户看不懂也没法据此做任何事，按 AGENTS.md §3.5 属零容忍项。
 */
export const UNKNOWN_CATEGORY_NAME = "—";

const metadataStore = useMetadataStore();

export const radioDefault = Symbol("default");

export type TSelectCategory = Record<ISearchCategories["key"], TSelectSearchCategoryValue | symbol>;

export async function getSiteMetaCategory(siteId: TSiteID): Promise<ISearchCategories[]> {
  return (await metadataStore.getSiteMergedMetadata(siteId, "category", []))!;
}

export function isDefaultCategory(field: TSelectSearchCategoryValue | symbol) {
  return Array.isArray(field) ? field.length === 0 : field === radioDefault;
}

export async function generateSiteSearchSolution(
  siteId: TSiteID,
  selectCategory: TSelectCategory,
): Promise<ISearchSolution> {
  let id = nanoid(); // 通过这种panel生成的solution，其 entries 只有一个值，所以可以直接将id作为entries的id
  const searchSolution: ISearchSolution = {
    id,
    siteId: siteId,
    selectedCategories: {},
    searchEntries: {},
  };

  const siteMetaCategory = await getSiteMetaCategory(siteId);

  // 将selectCategory按照siteMetaCategory的顺序转换为searchEntries，并合并成一个规则，合并方法参照ISearchCategories的说明
  let entriesConfig: IAdvancedSearchRequestConfig = {};
  for (const category of siteMetaCategory) {
    const field = cloneDeep(selectCategory[category.key]);

    // 跳过默认值（未设置）
    if (isDefaultCategory(field)) {
      continue;
    }

    searchSolution.selectedCategories![category.key] = field as TSelectSearchCategoryValue;

    if (category.generateRequestConfig) {
      entriesConfig = toMerged(entriesConfig, category.generateRequestConfig(field as TSelectSearchCategoryValue));
    } else {
      let fieldKey = category.key;
      if (fieldKey === "#url") {
        set(entriesConfig, "requestConfig.url", field);
      } else {
        const updatePath = `requestConfig.${category.keyPath ?? "params"}`;

        if (category.cross) {
          if (typeof category.cross.key != "undefined") {
            fieldKey = category.cross.key as string;
          }
          if (category.cross.mode === "append") {
            for (const option of field as (string | number)[]) {
              set(entriesConfig, `${updatePath}.${fieldKey}${option}`, 1);
            }
          } else if (category.cross.mode === "appendQuote") {
            const options = Object.fromEntries((field as (string | number)[]).map((option) => [option, 1]));
            set(entriesConfig, `${updatePath}.${fieldKey}`, options);
          } else if (category.cross.mode === "comma") {
            set(entriesConfig, `${updatePath}.${fieldKey}`, (field as (string | number)[]).join(","));
          } else {
            // category.cross.mode === "brackets"
            set(entriesConfig, `${updatePath}.${fieldKey}`, field);
          }
        } else {
          set(entriesConfig, `${updatePath}.${fieldKey}`, field);
        }
      }
    }
  }

  if (!isEmpty(entriesConfig)) {
    searchSolution.searchEntries![id] = entriesConfig;
  } else {
    searchSolution.id = "default";
    searchSolution.searchEntries = {};
  }

  return searchSolution;
}

function getCategory(siteMetaCategory: ISearchCategories[], key: string) {
  return siteMetaCategory.find((x) => x.key === key) ?? { key, name: key, options: [] };
}

export function getCategoryName(siteMetaCategory: ISearchCategories[], key: string) {
  // ⚠️ 原来兜底是把内部 key 原样返回：站点定义取不到（扩展刚更新、旧 chunk 404）
  // 时 siteMetaCategory 是空数组，于是方案那一列直接显示出 "category" / "type"
  // 这类内部标识 —— AGENTS.md §3.5 的零容忍项（内部 id 不进 UI）。
  // 兜底改成「保留原样但不区分」：交给调用方用未知分类的中性名渲染。
  return getCategory(siteMetaCategory, key)?.name ?? UNKNOWN_CATEGORY_NAME;
}

export function getCategoryOptionName(
  siteMetaCategory: ISearchCategories[],
  key: string,
  value: string | number | (string | number)[],
) {
  const options = getCategory(siteMetaCategory, key)?.options ?? [];
  if (Array.isArray(value)) {
    return value.map((v) => options.find((o) => o.value === v)?.name ?? v).join(", ");
  } else {
    return options.find((o) => o.value === value)?.name ?? value;
  }
}
