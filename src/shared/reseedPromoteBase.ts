/**
 * 「把某一条待辅条目换成这一批的新基准」判得出吗。
 *
 * 场景（用户 2026-11-01 那一屏）：一条 `baseLocal` 任务的基准种子被删了，界面上那句
 * 「基准已不在下载器，无法核对目录」会一直挂着 —— 而这一批 7 条里其实有一条**此刻就在下载器里
 * 并且在做种**，它脚下就有那份完整数据。把这一条换成新基准，其余各条就能挂上去。
 *
 * 为什么这道判断要住在 `src/shared` 而不是页面里：它决定的是**要不要改一条已存的任务记录**，
 * 而且吃的是下载器报的三个字段（在场 / 下完 / 报得出目录）。住在 `.vue` 里就进不了 Node 断言，
 * 也就进不了反证（本仓记过多次：判据全绿而界面没接上，只有把判据抽出来才分得开是谁的锅）。
 *
 * 三条取向：
 * - **只认下载器此刻报的实况**，不认界面上那一列的旧结论（`verify.statuses` 是上一轮回查写的，
 *   种子被删之后它还留着「在做种」）；
 * - **拿不准就拦**：这一条要写进任务、后续每条都带 `skip_checking` 推下去，
 *   推错的方向是「挂到一份根本没下完的数据上」= 整批 0% 卡住；
 * - **不猜目录形状**：`contentIsFile` 一律不写（那是建任务那一刻由文件清单判出来的事实，
 *   见 `reseedTargetDir.ts` 的 ④），这里没有文件清单，就没有资格写它。
 */

/** 条目那一侧我们吃得下的两点（`IKeepUploadTaskItem` 的子集，方便造夹具） */
export interface IPromoteBaseItem {
  hash?: string | null;
  title?: string | null;
}

/** 下载器那一侧吃得下的四点（`CTorrent` 的子集） */
export interface IPromoteBaseTorrent {
  infoHash?: string | null;
  name?: string | null;
  savePath?: string | null;
  isCompleted?: boolean | null;
}

/** 换成的新基准，形状与 `IKeepUploadTaskLocalBase` 对齐（少的那几项一律不写） */
export interface IPromoteBaseResultBase {
  hash: string;
  name: string;
  savePath: string;
}

/**
 * 拦下来的五种原因，界面要分开说 —— 出路各不相同：
 * - `noHash`：这条任务里没记下它的 infoHash，先点「回查做种状态」让它认上；
 * - `unreachable`：列表压根没拿到（连不上下载器）—— 这**不是**「不在下载器里」，
 *   把「查不了」说成「没有」是本仓反复记过的那一型；
 * - `notInClient`：拿到了列表而没有它（被删了 / 从没发出去）；
 * - `incomplete`：在它里面但没下完，拿它当基准就是让其余各条挂到一份缺数据的东西上；
 * - `noPath`：下完了，可下载器没报它的保存目录 —— 换过去也核对不了目录，等于白换。
 */
export type TPromoteBaseBlock = "noHash" | "unreachable" | "notInClient" | "incomplete" | "noPath";

export type TPromoteBaseResult =
  | { kind: "promoted"; baseLocal: IPromoteBaseResultBase }
  | { kind: "blocked"; reason: TPromoteBaseBlock };

/**
 * 按下载器刚报的那份列表，判「这一条能不能当新基准」，能则给出要写进任务的那一份。
 *
 * hash 两侧都归一到小写并剥空白（下载器报小写，任务里存的原样），与
 * `refreshBaseLocalPaths` / `decideOldBaseRemoval` 同一口径。
 * `name` 取下载器报的那一个，报不出才退回条目自己的标题 —— 界面上那行「基准种子（下载器里）」
 * 要说的是盘上真有那么一份的东西叫什么。
 */
export function decidePromoteItemToBase(
  item: IPromoteBaseItem,
  torrents: readonly IPromoteBaseTorrent[] | null | undefined,
): TPromoteBaseResult {
  const hash = String(item.hash ?? "").trim().toLowerCase();
  if (!hash) return { kind: "blocked", reason: "noHash" };
  // 列表没拿到（连不上下载器）与"列表里没有它"是两件事：前者不许说成「不在下载器里」
  if (!torrents) return { kind: "blocked", reason: "unreachable" };
  const live = torrents.find((x) => String(x.infoHash ?? "").trim().toLowerCase() === hash);
  if (!live) return { kind: "blocked", reason: "notInClient" };
  if (live.isCompleted !== true) return { kind: "blocked", reason: "incomplete" };
  const savePath = String(live.savePath ?? "").trim();
  if (!savePath) return { kind: "blocked", reason: "noPath" };
  return {
    kind: "promoted",
    baseLocal: { hash, name: String(live.name ?? "").trim() || String(item.title ?? ""), savePath },
  };
}
