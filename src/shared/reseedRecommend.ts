/**
 * 辅种检测里「推荐拿哪一条当基准」的判据。
 *
 * 为什么单独成一个模块（而不是写在弹窗里）：这两组推荐是**替用户挑一条种子**，
 * 挑错的代价是整批辅种都拿错参照物去比。判据要能被 Node 直接 import 断言，
 * 不能只活在组件里 —— 同族先例见 `src/shared/category.ts`、`SentToDownloaderDialog/categoryMatch.ts`。
 *
 * 两条推荐各回答一个问题：
 *  - `mostSeeders`：这批里谁最多人做种 —— 做种人多意味着这份数据在 tracker 上活得久，
 *    基准本身要单独下一遍，从还热着的种子里挑才不必等；
 *  - `mostSeedersFree`：免费下载的那批里谁最多人做种 —— 基准那条是**要真下一次的**，
 *    挑免费的能省下这一份流量（22 GiB 这种量级才看得见差别）。
 */
import { toCount } from "./torrentCount.ts";

/** 候选条目只需要这三样：判据不碰指纹、不碰下载器 */
export interface IReseedBaseCandidate {
  id: string;
  /**
   * 站点报的做种人数。**类型是 unknown 而不是 number**：解析层只在「整串就是纯数字」时才转数，
   * 图标字符混进那一格时它会是字符串甚至 undefined（见 `torrentCount.ts` 文件头）。
   * 所以这里和表格那一列共用 `toCount` 判定 —— 界面上显示得出数字的行才许被推荐，两边不许各判一套。
   */
  seeders?: unknown;
  tags?: { name: string }[] | null;
}

export type TReseedRecommendKind = "mostSeeders" | "mostSeedersFree";

export interface IReseedRecommendation {
  kind: TReseedRecommendKind;
  id: string;
  seeders: number;
}

/**
 * 归一化之后的免费类标签名（`packages/site/utils/tags.ts` 的 preDefinedTorrentTagMap）。
 * 刻意不含 `NL.`（中性 = 0 上传 0 下载）：它的"免费"是双向归零，跟用户挑基准时想的
 * 「下载这一份不花钱」不是一回事，宁可少认不误认。也不含 2x50% / 25% / 50% 这些打折档。
 */
const FREE_TAG_NAMES = new Set(["Free", "2xFree", "Freeload"]);

/**
 * 站点原始标签没被归一化时剩下的写法（标签文本直接来自页面，见 NexusPHP 的 customTags 解析）。
 * 逐条写死而不是 `/free/i` 一把抓：`notFree` 这类含 free 的词会被顺手认成免费。
 */
const FREE_TAG_PATTERNS: RegExp[] = [/^free$/i, /^2x?free$/i, /freeleech/i, /freeload/i, /免费/];

/** 这一条是不是免费下载（促销标签里带免费性质的都算） */
export function isFreeTorrent(tags?: { name: string }[] | null): boolean {
  if (!tags?.length) return false;
  return tags.some(
    (tag) => FREE_TAG_NAMES.has(tag.name) || FREE_TAG_PATTERNS.some((re) => re.test(tag.name)),
  );
}

/** 只有拿得出非负有限数字的条目才参与推荐（与表格那一列同一判据） */
function usableSeeders(candidate: IReseedBaseCandidate): number | null {
  const n = toCount(candidate.seeders);
  return n === null || n < 0 ? null : n;
}

/** 取做种人数最多的那一条；并列时取排在前面的一条（不猜，按用户勾选的先后稳定给一个） */
function pickTop(list: IReseedBaseCandidate[]): { id: string; seeders: number } | null {
  let best: { id: string; seeders: number } | null = null;
  for (const item of list) {
    const seeders = usableSeeders(item);
    if (seeders === null) continue;
    if (!best || seeders > best.seeders) best = { id: item.id, seeders };
  }
  return best;
}

/**
 * 给出两组推荐（做种最多 / 免费里做种最多）。
 *
 * 三条边界：
 *  1. 一条都拿不出做种数 → 空数组（界面上那一行整个不出，而不是摆两颗假按钮）；
 *  2. 没有任何免费条目 → 只出第一组；
 *  3. 两组指向同一条 → 只报 `mostSeeders` 一组 —— 一行里出现两个词指的是同一份数据，
 *     读起来像有两个答案，其实没有。
 */
export function pickBaseRecommendations(list: IReseedBaseCandidate[]): IReseedRecommendation[] {
  const topAll = pickTop(list);
  if (!topAll) return [];

  const topFree = pickTop(list.filter((item) => isFreeTorrent(item.tags)));
  if (!topFree || topFree.id === topAll.id) {
    return [{ kind: "mostSeeders", id: topAll.id, seeders: topAll.seeders }];
  }
  return [
    { kind: "mostSeeders", id: topAll.id, seeders: topAll.seeders },
    { kind: "mostSeedersFree", id: topFree.id, seeders: topFree.seeders },
  ];
}
