/**
 * 「场上已经有一条辅种任务在管同一份内容了」的判据。
 *
 * 为什么要拦这一步：两条任务管同一份数据时，各自都按**自己的基准**往下走 —— 搬目录会把那一份
 * 数据往两条任务各自的目录上挪（v0.101.1 那条「同内容副本一起带上」正是跟着基准走的），
 * 回查也各查各的。基准不是同一条种子时，两边会互相把对方刚放好的位置挪走。
 *
 * 三档证据从硬到软，命中哪档就说哪档：
 * 1. `sameItem` —— 两条任务里有**同一条种子**（认详情页链接 `link`，其次 `site:id`）。
 * 2. `sameHash` —— 有相同的 infoHash。私有站 announce 里带 passkey，同一份内容两次下载算出的
 *    hash 可以不一样（v0.93.2 那条口径），所以这一档**只补充**第 1 档，不能反过来取代它。
 * 3. `sameTitleSize` —— 只有标题与大小相同。这是弱证据，够用来提示一句，不够用来替用户决定。
 *
 * 这一层故意**不含 i18n、不碰消息通道**：判据要能在 Node 里直接断言（`tests/shared/reseedTaskDup.test.ts`）。
 */
import type { IKeepUploadTask, IKeepUploadTaskItem } from "./types/storages/keepUploadTask.ts";

export type TDupReason = "sameItem" | "sameHash" | "sameTitleSize";

export interface IDupTaskHit {
  /** 撞上的那条已有任务 */
  task: IKeepUploadTask;
  reason: TDupReason;
  /** 共有的种子数；`sameTitleSize` 那一档是 0（共有的不是「同一条种子」，是整份内容） */
  sharedItems: number;
  /**
   * 两边的基准**确定不是**同一条种子。
   *
   * 只在两边都拿得出可比的基准键时才给 true —— 拿不出（旧任务没记 hash、items 为空）时给 false，
   * 判不出就不往文案里断言。
   */
  baseDiffers: boolean;
}

/** 归一化：链接/hash 都可能出现大小写不一（各家下载器报的写法不同），统一按小写比 */
const norm = (v: unknown): string => (typeof v === "string" ? v.trim().toLowerCase() : "");

/**
 * 「同一条种子」的键。
 *
 * 首选详情页链接：每条任务都记着它（`IKeepUploadTaskItem.link` 是必填），同站同一条种子它必相同。
 * `id` 是 v0.100 之后才记的，旧任务没有；`hash` 留给第 2 档单独比（passkey 那条理由）。
 */
function itemKey(item: IKeepUploadTaskItem): string {
  const link = norm(item.link);
  if (link) return link;
  if (item.id !== undefined && item.id !== null && item.id !== "") return `${norm(item.site)}:#${String(item.id)}`;
  return "";
}

function hashKey(item: IKeepUploadTaskItem): string {
  return norm(item.hash);
}

function countShared(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const key of a) if (b.has(key)) n += 1;
  return n;
}

/**
 * 一条任务的基准标识，两条轴分开记：
 * - `hash`：基准那颗的 infoHash（基准取自下载器时是本地那条的 hash）
 * - `item`：基准那颗的「同一条种子」键（详情页链接 / site:id）
 *
 * 为什么要两条轴：`baseLocal.hash` 与另一条任务 `items[0].hash` 是同一个东西（同一颗种子的 hash），
 * 但 `baseLocal.hash` 和 `items[0].link` 不是同一种标识 —— 跨轴比出来的「不等」说明不了基准不同。
 * 所以只在**至少一条轴两边都拿得出值**时才下结论。
 */
interface IBaseKeys {
  hash: string;
  item: string;
}

function baseOf(task: IKeepUploadTask): IBaseKeys {
  const local = norm(task.baseLocal?.hash);
  if (local) return { hash: local, item: "" };
  const first = task.items?.[0];
  if (!first) return { hash: "", item: "" };
  return { hash: hashKey(first), item: itemKey(first) };
}

/** 两边的基准是否**确定不是**同一条种子；拿不出可比的轴就给 false（判不出就不往文案里断言） */
function basesDiffer(a: IBaseKeys, b: IBaseKeys): boolean {
  const bothHash = !!a.hash && !!b.hash;
  const bothItem = !!a.item && !!b.item;
  if (bothHash && a.hash === b.hash) return false;
  if (bothItem && a.item === b.item) return false;
  return bothHash || bothItem;
}

/** 把一条任务的种子键与 hash 各收成一份集合 */
function keysOf(task: IKeepUploadTask) {
  const items = task.items ?? [];
  return {
    itemKeys: new Set(items.map(itemKey).filter(Boolean)),
    hashes: new Set(items.map(hashKey).filter(Boolean)),
    title: norm(task.title),
    size: task.size,
  };
}

/**
 * 找出 `candidate` 撞上的已有任务，按证据从硬到软排（同档内按共有条数从多到少）。
 *
 * 与 candidate 自己同 id 的那条会被跳过：调用方传进来的可能就是**已经存过**的任务形状，
 * 重新创建同一条任务时不该跟自己比。
 */
export function findDuplicateTasks(candidate: IKeepUploadTask, tasks: IKeepUploadTask[]): IDupTaskHit[] {
  const mine = keysOf(candidate);
  const myBase = baseOf(candidate);
  const hits: IDupTaskHit[] = [];

  for (const task of tasks ?? []) {
    if (!task || task.id === candidate.id) continue;
    const theirs = keysOf(task);

    const sharedItems = countShared(mine.itemKeys, theirs.itemKeys);
    const sharedHashes = countShared(mine.hashes, theirs.hashes);
    const sameTitleSize = !!mine.title && mine.title === theirs.title && mine.size === theirs.size;

    let reason: TDupReason | null = null;
    if (sharedItems > 0) reason = "sameItem";
    else if (sharedHashes > 0) reason = "sameHash";
    else if (sameTitleSize) reason = "sameTitleSize";
    if (!reason) continue;

    hits.push({
      task,
      reason,
      sharedItems: reason === "sameTitleSize" ? 0 : Math.max(sharedItems, sharedHashes),
      baseDiffers: basesDiffer(myBase, baseOf(task)),
    });
  }

  const rank: Record<TDupReason, number> = { sameItem: 0, sameHash: 1, sameTitleSize: 2 };
  return hits.sort((a, b) => rank[a.reason] - rank[b.reason] || b.sharedItems - a.sharedItems);
}
