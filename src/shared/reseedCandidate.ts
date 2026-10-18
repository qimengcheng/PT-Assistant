/**
 * 「下载器里这一条值不值得拿去辅种」的判据。
 *
 * 为什么单独成一个模块、而且零依赖：这一条要能被 Node 直接 import 断言（同 `trackerHost.ts`、
 * `reseedRecommend.ts` 的先例），判错的代价是界面上给一条种子标出「还能往 N 个站辅」这种
 * 看起来像事实的话。
 *
 * ⚠️ 这一条与 `reseedRecommend.ts` 回答的不是同一个问题，别去复用它的输入：
 * 那边判的是「在搜索结果里挑哪一条**当基准**」（基准那条要真下一次，所以分享率低于 1 的站不能当），
 * 而这里判的是「内容已经在本地的那一条，还可以推到哪些站」—— 从下载器发起辅种时那一份不再下载，
 * 所以分享率那道闸在这条路上本来就不成立（v0.105.2 文件头「刻意没扩到的地方」那一节写明的事）。
 * 这里因此**不看** ratio、seeders、tags。
 *
 * 也要说清这一条判不了的事（界面上的浮层文案必须带上这句，不能只摆那个数字）：
 * 「还有 N 个站没挂」里的 N 是**用户添加且没标离线的站点**里还没挂上这份内容的数量，
 * 而那 N 个站上到底**有没有发布过**这条种子，只有逐站搜过才知道 —— 辅种流程本来就是
 * 先在搜索页把各站的同一条搜出来，才能建任务。所以这个数回答的是「值不值得去搜」，
 * 不是「这 N 个站点了就能成」。
 */

export type TReseedCandidateVerdict =
  /** 值得辅：内容完整，且还有站点没挂上这份内容 */
  | { kind: "candidate"; pending: number; covered: number }
  /** 添加的站点已经全挂上了这份内容（没有可辅的目标） */
  | { kind: "all-covered"; covered: number }
  /** 数据还没下完：推过去也做不了种 */
  | { kind: "incomplete" }
  /** 这份内容挂在哪个站一条都认不出来，谈不上「还差哪些站」 */
  | { kind: "no-site" };

export interface IReseedCandidateInput {
  /** 这一条（或同内容任一份副本）数据是否已下完 */
  completed: boolean;
  /**
   * 这份内容**已经挂着**的站点，来自同内容全部副本的 tracker 反查并集。
   * 空数组 = 一份都认不出站（界面上退回「-」而不是「已挂满」）。
   */
  coveredSites: readonly string[];
  /** 用户添加的站点里可以当作辅种目标的那些（已离线的那几站由调用方剔除） */
  usableSites: readonly string[];
}

/**
 * 四档的顺序是判据的一部分：
 * 没下完排第一 —— 它压掉其余一切（认不出站也好、挂满也好，都不该给一条下完的种子标「可辅」）；
 * 认不出站排在算缺口之前 —— 没有「已挂」这份事实，缺口那个数会是整片站点数，那是假话。
 */
export function judgeReseedCandidate(input: IReseedCandidateInput): TReseedCandidateVerdict {
  if (!input.completed) return { kind: "incomplete" };

  const covered = new Set(input.coveredSites.filter((siteId) => !!siteId));
  if (covered.size === 0) return { kind: "no-site" };

  const pending = input.usableSites.filter((siteId) => siteId && !covered.has(siteId));
  if (pending.length === 0) return { kind: "all-covered", covered: covered.size };
  return { kind: "candidate", pending: pending.length, covered: covered.size };
}
