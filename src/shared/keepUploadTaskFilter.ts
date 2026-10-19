/**
 * 「辅种任务」那张表的名称搜索与分类筛选（纯判据，不碰存储、不碰界面）。
 *
 * 为什么单独成模块（与 `categoryMatch.ts` / `seedVerify.ts` 同一个理由）：这几条判据要能在 Node 里
 * 断言，混在 `.vue` 里就只能靠手点。
 *
 * 分类**不自己折一遍**：一条任务那批条目可能各站叫法不同（同一部内容在 4 个站被分别标成
 * 3 综艺 + 1 电视剧），这一档的判据早就有了 —— 就是「辅种检测」给目录预选用的那份
 * `sharedCategory`（按每一条自己的站点覆盖表折、取唯一最多、并列不猜）。再写一套就会
 * 「下拉里说它是综艺、发送时按电视剧的目录建路径」这种两句互相打脸。
 */
import { sharedCategory } from "@/options/components/SentToDownloaderDialog/categoryMatch.ts";
import { CATEGORY_KINDS, type TCategoryKind } from "@/shared/category.ts";
import type { IKeepUploadTask } from "@/shared/types/storages/keepUploadTask.ts";

/** 站点 → 该站的用户覆盖表（`ISiteUserConfig.categoryMap`），由调用方从 store 里折好传进来 */
export type TSiteCategoryMapOf = (siteId: string) => Record<string, string> | undefined;

/** 名称搜索命中什么：任务标题 + 副标题。大小写不敏感，两侧空白不算 */
export function matchesTaskWord(task: IKeepUploadTask, word: string): boolean {
  const needle = word.trim().toLowerCase();
  if (!needle) return true;
  return [task.title, task.subTitle].some(
    (text) => typeof text === "string" && text.toLowerCase().includes(needle),
  );
}

/**
 * 这一条任务算哪一类；折不出唯一一类（条目都没写分类、或两档并列）时返回 null。
 *
 * null 的任务在任何具体分类筛选下都不出现 —— 它只出现在「全部分类」里。
 * 这一档不许退化成「按 items[0] 猜」：基准那条恰好被某个站标歪时，整条任务就会跑到别的类里，
 * 而人在下拉里看不到它，只会以为任务被删了。
 */
export function taskCategoryKind(task: IKeepUploadTask, siteMapOf: TSiteCategoryMapOf): TCategoryKind | null {
  return sharedCategory(task.items ?? [], siteMapOf).kind;
}

/** 筛完要显示的那几条 */
export function filterKeepUploadTasks(
  tasks: readonly IKeepUploadTask[],
  input: { word: string; kind: TCategoryKind | null; siteMapOf: TSiteCategoryMapOf },
): IKeepUploadTask[] {
  return tasks.filter(
    (task) =>
      matchesTaskWord(task, input.word) &&
      (input.kind === null || taskCategoryKind(task, input.siteMapOf) === input.kind),
  );
}

/**
 * 分类下拉里该出现哪些档：**只列当前这批任务里真有的**，按 `CATEGORY_KINDS` 定序
 * （不是按出现次数，也不是按字面 —— 同一份数据两次打开顺序不该变）。
 *
 * 调用方传进来的那份清单**只能按名称筛过，不能按分类筛过**：拿筛完的算，选了「电影」之后
 * 下拉就只剩「电影」一档，人再也换不到别的类。
 */
export function categoryKindChoices(
  tasks: readonly IKeepUploadTask[],
  siteMapOf: TSiteCategoryMapOf,
): TCategoryKind[] {
  const present = new Set<TCategoryKind>();
  for (const task of tasks) {
    const kind = taskCategoryKind(task, siteMapOf);
    if (kind) present.add(kind);
  }
  return CATEGORY_KINDS.filter((kind) => present.has(kind));
}
