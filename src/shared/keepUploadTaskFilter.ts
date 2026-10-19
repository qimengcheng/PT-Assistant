/**
 * 「辅种任务」那张表的名称搜索 / 分类筛选 / 状态筛选（纯判据，不碰存储、不碰界面）。
 *
 * 为什么单独成模块（与 `categoryMatch.ts` / `seedVerify.ts` 同一个理由）：这几条判据要能在 Node 里
 * 断言，混在 `.vue` 里就只能靠手点。
 *
 * 分类**不自己折一遍**：一条任务那批条目可能各站叫法不同（同一部内容在 4 个站被分别标成
 * 3 综艺 + 1 电视剧），这一档的判据早就有了 —— 就是「辅种检测」给目录预选用的那份
 * `sharedCategory`（按每一条自己的站点覆盖表折、取唯一最多、并列不猜）。再写一套就会
 * 「下拉里说它是综艺、发送时按电视剧的目录建路径」这种两句互相打脸。
 *
 * 状态**也不自己判一遍**：档位由调用方把界面上那一列正在用的那份 `stageOf` 递进来（页面里就是
 * `taskStage`，与「做种状态」那一格画的、那颗「移除已完成」删的是同一个数）。筛选另算一套的话，
 * 就会出现「那一列写着辅种中，按辅种中筛却筛不到它」—— 同一页两个口径迟早对不上账。
 */
import { sharedCategory } from "@/options/components/SentToDownloaderDialog/categoryMatch.ts";
import { CATEGORY_KINDS, type TCategoryKind } from "@/shared/category.ts";
import type { IKeepUploadTask } from "@/shared/types/storages/keepUploadTask.ts";
import type { TReseedStage } from "@/options/views/Overview/KeepUploadTask/seedVerify.ts";

/** 站点 → 该站的用户覆盖表（`ISiteUserConfig.categoryMap`），由调用方从 store 里折好传进来 */
export type TSiteCategoryMapOf = (siteId: string) => Record<string, string> | undefined;

/** 任务 → 进度阶段档位，由调用方把**界面上那一列用的同一个函数**递进来 */
export type TStageOf = (task: IKeepUploadTask) => TReseedStage;

/**
 * 状态下拉的定序：异常最先（点这颗下拉的人多半就是来找哪几条没挂上的），其余按流程走。
 * 顺序**不按出现次数、也不按字面** —— 同一份数据两次打开不该变（同 `categoryKindChoices`）。
 */
export const RESEED_STAGE_FILTER_ORDER: readonly TReseedStage[] = [
  "wrong",
  "idle",
  "baseMissing",
  "baseDownloading",
  "baseReady",
  "reseeding",
  "done",
];

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

/** 筛完要显示的那几条（名称 / 分类 / 状态三条闸都是「与」，任一不满足就出局） */
export function filterKeepUploadTasks(
  tasks: readonly IKeepUploadTask[],
  input: {
    word: string;
    kind: TCategoryKind | null;
    stage: TReseedStage | null;
    siteMapOf: TSiteCategoryMapOf;
    stageOf: TStageOf;
  },
): IKeepUploadTask[] {
  return tasks.filter(
    (task) =>
      matchesTaskWord(task, input.word) &&
      (input.kind === null || taskCategoryKind(task, input.siteMapOf) === input.kind) &&
      (input.stage === null || input.stageOf(task) === input.stage),
  );
}

/**
 * 分类下拉里该出现哪些档：**只列当前这批任务里真有的**，按 `CATEGORY_KINDS` 定序
 * （不是按出现次数，也不是按字面 —— 同一份数据两次打开顺序不该变）。
 *
 * 调用方传进来的那份清单**只能按名称筛过，不能按分类或状态筛过**：拿筛完的算，选了「电影」之后
 * 下拉就只剩「电影」一档，人再也换不到别的类。两个下拉共用同一份「只按名称筛过」的底，
 * 所以它们**互不缩候选** —— 否则选了「辅种完成」会叫「电影」这一档从另一个下拉里消失，
 * 那是同一句理由的另一半。
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

/**
 * 状态下拉的候选：同上，只列这批里真有的那一档，按 `RESEED_STAGE_FILTER_ORDER` 定序。
 * 每一档都是界面上「做种状态」那一格画出来的词，所以这一档**没有「折不出」的形状** ——
 * `stageOf` 对任何任务都给得出一个档位（没回查就是 `idle`），不许出现「哪一类都不算」那种任务。
 */
export function reseedStageChoices(tasks: readonly IKeepUploadTask[], stageOf: TStageOf): TReseedStage[] {
  const present = new Set<TReseedStage>();
  for (const task of tasks) present.add(stageOf(task));
  return RESEED_STAGE_FILTER_ORDER.filter((stage) => present.has(stage));
}
