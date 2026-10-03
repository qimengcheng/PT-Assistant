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

/**
 * 搜索方案列表缓存。
 *
 * onInputChanged 是按键级触发的（中文输入法拼到一半也会触发），
 * 每敲一个字符都 extStore.getItem("metadata") 一次 —— 而 metadata 里装着
 * 300+ 站点的 userConfig，几十到几百 KB 起步，纯属浪费。
 * 缓存后在 metadata 变更时主动失效（见文件末尾的 storage.onChanged）。
 */
const SOLUTION_CACHE_TTL = 30_000;
let cachedSolutions: { at: number; all: ISearchSolution[]; top5: ISearchSolution[] } | null = null;

async function loadSearchSolutions() {
  const { defaultSolutionId = "default", solutions = {} } =
    ((await extStore.getItem("metadata")) ?? {}) as Partial<IMetadataPiniaStorageSchema>;

  const enabled = Object.values(solutions)
    .filter((x) => !!x.enabled) // 过滤掉未启用的搜索方案
    .sort((a, b) => b.sort - a.sort) // 按照 sort 降序排序
    .map((x) => ({
      name: x.name,
      value: x.id,
    }));

  const all = defaultSolutionId !== "default" ? [allSolution, ...enabled] : enabled;
  return { all, top5: all.slice(0, 5) };
}

async function getSearchSolution(getAll = false) {
  const now = Date.now();
  if (!cachedSolutions || now - cachedSolutions.at > SOLUTION_CACHE_TTL) {
    const loaded = await loadSearchSolutions();
    cachedSolutions = { at: now, all: loaded.all, top5: loaded.top5 };
  }

  return getAll ? cachedSolutions.all : cachedSolutions.top5;
}

// 方案被改动后立即失效缓存，不必等 TTL 自然过期
chrome.storage?.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && Object.hasOwn(changes, "metadata")) {
    cachedSolutions = null;
  }
});

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
