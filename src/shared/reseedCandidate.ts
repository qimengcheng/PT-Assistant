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
 *
 * ## 「查过了」要盖掉「待查」（v0.109.8）
 *
 * 上面那段话在有了「可辅种扫描」之后只说对一半：那 N 个站里，有些已经真发过请求、
 * 结论就躺在结果表里。这时候界面对一条查完的种子还说「待查 20 站」，是把已经做完的事
 * 又摆回人面前（用户 2026-10-18：「已经查过的在下载器里要标记出来，不再显示有多少站待查了」）。
 * 所以 `scannedSites` 参与判据，**缺口只数还没查过的那些站**；一个都不剩时改出 `scanned` 那一档。
 *
 * `scanned` 档为什么还要带四档计数：「查过了」不等于「那个站没有」。把 `failed`
 * （要登录 / 超时 / 解析歪了）折进「没有」，人就再也不去那个站辅了 —— 那是假阴性，
 * 与 `reseedScanPlan.ts` 文件头「四档不许并成两档」是同一条纪律。
 *
 * ## 认不出来源站点的那一条也要报缺口（v0.117.1）
 *
 * 这一档原先单独叫 `no-site` 并且**什么都不说**：理由是「没有『已挂』这份事实，缺口那个数
 * 会是整片站点数，那是假话」。前半句到现在都对，后半句把两件事混成了一件 ——
 * 「还差 N 站没挂」是假话，「N 站还没查过」是真话，而那枚标记上写的本来就是「待查」。
 * 沉默换来的代价是现场的三次驳回（用户 2026-10-18 / 10-19 连着三句「这一行为什么没有标记」），
 * 以及一条更实在的：`pendingRowKeys` 只认 `candidate`，所以那一档**连「待查的 N 条」扫描范围都进不去**
 * —— 界面上没有标记、扫描又不查，它就成了永久看不见的那一类。
 *
 * 所以现在的形状是：`covered` 报 0，缺口按全部站点算，**由界面把那一句假话换成真话**
 * （浮层改成「Tracker 认不出属于哪个站点，所以已挂这一格报不出」，见 `Index.vue` 的 `reseedBadgeTip`）。
 * 判据这一层不许为了省事而闭嘴 —— 闭嘴在这里不是保守，是把一条能查的内容永久藏起来。
 */

/** 一条内容在各站上查到的结论分布。四档分开数，界面要哪个都从这里取 */
export interface IReseedScanTally {
  hasIt: number;
  suspect: number;
  noMatch: number;
  failed: number;
}

export type TReseedCandidateVerdict =
  /** 值得辅：内容完整，且还有**没查过**的站点没挂上这份内容。`covered === 0` = 来源站点认不出，界面要换一句说法 */
  | { kind: "candidate"; pending: number; covered: number }
  /** 没挂上的站点已经全部逐站查过一遍：界面上改标「已查」，不再报待查数 */
  | { kind: "scanned"; scanned: number; covered: number; tally: IReseedScanTally }
  /** 添加的站点已经全挂上了这份内容（没有可辅的目标） */
  | { kind: "all-covered"; covered: number }
  /** 数据还没下完：推过去也做不了种。`partial` = 进度那一格报满、整条数据却不在本地（只勾了部分文件） */
  | { kind: "incomplete"; partial: boolean };

export interface IReseedCandidateInput {
  /** 这一条（或同内容任一份副本）数据是否已下完 */
  completed: boolean;
  /** 下载器报的进度（0~100）。只用来把「没下完」分成两种：还在下 / 看着下完了其实只选了部分文件 */
  progress?: number;
  /**
   * 这份内容**已经挂着**的站点，来自同内容全部副本的 tracker 反查并集。
   * 空数组 = 一份都认不出站（这一格报不出，界面上要换成「认不出来源站点」那一句，不许照抄「已挂在 0 个站点」）。
   */
  coveredSites: readonly string[];
  /** 用户添加的站点里可以当作辅种目标的那些（已离线的那几站由调用方剔除） */
  usableSites: readonly string[];
  /**
   * 其中**已经逐站查过、结论还在新鲜期里**的那些站（调用方按同内容全部副本的内容键并好）。
   * 不给 = 当作一条都没查过（退回 v0.109.7 之前的行为，扫描结论还没读到时就是这样）。
   */
  scannedSites?: readonly string[];
  /** 查过的那些站各自的结论档，用来把「已查」那一档的浮层说全 */
  scannedVerdicts?: readonly { siteId: string; verdict: keyof IReseedScanTally }[];
}

/** 四档计数：`siteId` 去重后按档数，同站两条结论（脏数据）只数第一次 */
function tallyOf(scannedVerdicts: readonly { siteId: string; verdict: keyof IReseedScanTally }[], open: Set<string>): IReseedScanTally {
  const tally: IReseedScanTally = { hasIt: 0, suspect: 0, noMatch: 0, failed: 0 };
  const seen = new Set<string>();
  for (const item of scannedVerdicts) {
    if (!open.has(item.siteId) || seen.has(item.siteId)) continue;
    seen.add(item.siteId);
    tally[item.verdict] += 1;
  }
  return tally;
}

/**
 * 四档的顺序是判据的一部分：
 * 没下完排第一 —— 它压掉其余一切（认不出站也好、挂满也好，都不该给一条数据不全的种子标「可辅」）；
 * 「查过了」排在「待查」之后 —— 只要还剩一个站没查，那一档就还当值不值得去搜来说。
 *
 * `covered` 空**不再是提前返回的一档**（v0.117.1，理由见文件头那一节）：它照旧往下走算缺口，
 * 于是这一条会进「待查」那枚标记、也进扫描范围。它只影响 `covered` 那个数报 0，
 * 而 0 该被说成什么，是界面那一层的事。
 */
export function judgeReseedCandidate(input: IReseedCandidateInput): TReseedCandidateVerdict {
  if (!input.completed) return { kind: "incomplete", partial: (input.progress ?? 0) >= 100 };

  const covered = new Set(input.coveredSites.filter((siteId) => !!siteId));

  const open = new Set(input.usableSites.filter((siteId) => siteId && !covered.has(siteId)));
  if (open.size === 0) return { kind: "all-covered", covered: covered.size };

  const scanned = new Set((input.scannedSites ?? []).filter((siteId) => siteId && open.has(siteId)));
  const pending = open.size - scanned.size;
  if (pending > 0) return { kind: "candidate", pending, covered: covered.size };

  return { kind: "scanned", scanned: scanned.size, covered: covered.size, tally: tallyOf(input.scannedVerdicts ?? [], scanned) };
}
