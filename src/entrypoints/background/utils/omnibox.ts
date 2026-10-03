/**
 * 地址栏（omnibox）搜索（平移自 PT-depiler background/utils/omnibox.ts）。
 * 用户在地址栏输入 ptd + Tab 唤起：输入关键词后展示各启用搜索方案建议，
 * 选择「方案名 → 关键词」建议或直接回车，跳转到搜索页。
 *
 * 文案说明：旧版走 chrome.i18n.getMessage（_locales），新项目未铺 _locales，
 * 与 contextMenus.ts 的平移约定一致，此处直接使用中文字符串。
 */
import { extStore } from "@/storage.ts";
import type { IMetadataPiniaStorageSchema } from "@/shared/types.ts";

import { openOptionsPage } from "./base.ts";

const splitString = " → ";

interface ISearchSolution {
  name: string;
  value: string;
}

const allSolution: ISearchSolution = {
  name: "全部站点",
  value: "all",
};

async function getSearchSolution(getAll = false) {
  const { defaultSolutionId = "default", solutions = {} } =
    ((await extStore.getItem("metadata")) ?? {}) as Partial<IMetadataPiniaStorageSchema>;

  let solutionsList: ISearchSolution[] = Object.values(solutions)
    .filter((x) => !!x.enabled) // 过滤掉未启用的搜索方案
    .sort((a, b) => b.sort - a.sort) // 按照 sort 降序排序
    .map((x) => ({
      name: x.name,
      value: x.id,
    }));

  if (getAll || defaultSolutionId !== "default") {
    solutionsList = [allSolution, ...solutionsList];
  }

  if (!getAll) {
    solutionsList = solutionsList.slice(0, 5); // 只显示前 5 个搜索方案
  }

  return solutionsList;
}

chrome.omnibox?.onInputChanged.addListener(async (text, suggest) => {
  if (!text) return;

  const solutions = await getSearchSolution();
  const result: chrome.omnibox.SuggestResult[] = solutions.map((x) => ({
    content: `${x.name}${splitString}${text}`,
    description: `在 [ ${x.name} ] 中搜索 ${text}`,
  }));

  suggest(result);
});

// 当用户接收关键字建议时触发
chrome.omnibox?.onInputEntered.addListener(async (text) => {
  let solutionName = "";
  let solutionId = "default";
  let key = "";

  if (text.indexOf(splitString) != -1) {
    const solutions = await getSearchSolution(true);

    [solutionName, key] = text.split(splitString);

    const solution = solutions.find((item) => item.name == solutionName);
    if (solution) {
      solutionId = solution.value;
    }
  } else {
    key = text;
  }

  // 按关键字进行搜索（新路由 /search 保留了 /search-entity alias）
  openOptionsPage({ path: "/search", query: { search: key, plan: solutionId, flush: 1 } });
});
