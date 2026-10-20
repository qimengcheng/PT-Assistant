/**
 * 「换基准之后，原来那条基准在下载器里的那一条要不要删掉」的判据。
 *
 * 单独一份是为了让它能被 Node 断言引用（判据住在 .vue 里就进不了用例，也进不了反证）。
 *
 * 来由（用户 2026-10-20）：「替换基准后自动把原基准任务从下载器删除并自动发送新基准，
 * 把原来设为基准并发送的按钮删掉，因为设为基准后就会自动发送」。
 * 他要的是「换下载源」这一动作一次做完：旧的那条（往往是下不动 / 只下了一部分的那条）
 * 从下载器清掉，新的那条去下。
 *
 * 三条口径写在这里，不在组件里各判各的：
 * ① **只删任务记录，绝不删数据文件** —— 这一批所有副本挂的就是那一份数据，
 *    删文件等于把整件事拆掉（调用点必须传 `removeData: false`）；
 * ② 拿不准的一律**不删**：没记 infoHash、新旧是同一条、同一条还被别的行 / 别的任务挂着、
 *    下载器连不上、下载器里根本没有这一条。这五档的代价都是「原基准还留在下载器里」，
 *    而误删的代价是「把一条正在做种的种子停了」—— 两边不对称；
 * ③ 每一档都要说得出**为什么没删**（界面那句提示直接读这里返回的档位）。
 *
 * 判「下载器里有没有这一条」比的是 hash，而真正删的时候要的是**下载器报的 id**
 * （qBittorrent 那边两者相同，Aria2 那边 id 是数字 gid、与 infoHash 无关）。
 * 所以 `removed` 那一档必须把 id 一起交回去：调用点只查一次表，也拿不到
 * 「判过了却没有 id」这种中间状态。
 */

/** 五档「不删」的原因；界面那句提示按它拼 i18n 键 `KeepUploadTask.rebase.keep.<这一档>` */
export type TOldBaseHoldReason = "noHash" | "sameAsNew" | "shared" | "unreachable" | "notFound";

export interface IOldBaseRemovalInput<TId> {
  /** 原基准那一条的 infoHash（任务里记的那份） */
  oldHash?: string;
  /** 换上来那一条的 infoHash：与旧的同一条时删下去就是把刚发出去的那条删掉 */
  newHash?: string;
  /** 这个任务里**除它自己之外**还有几条挂着同一个 hash */
  sameInTask: number;
  /** 别的任务里挂着同一个 hash 的条数（同一台下载器才算，跨下载器互不影响） */
  sameInOtherTasks: number;
  /** 那台下载器报回来的全部条目（infoHash 原样 + 删除要用的 id）；`null` = 这台连不上，列表压根没拿到 */
  downloaderEntries: Array<{ hash?: string; id: TId }> | null;
}

export type TOldBaseRemoval<TId> = { outcome: "removed"; id: TId } | { outcome: TOldBaseHoldReason };

/** 判定顺序本身就是判据的一部分：先认「没对象」，再认「有对象但删了会伤到别人」，最后才看列表 */
export function decideOldBaseRemoval<TId>(input: IOldBaseRemovalInput<TId>): TOldBaseRemoval<TId> {
  const oldHash = String(input.oldHash ?? "").toLowerCase();
  if (!oldHash) return { outcome: "noHash" };
  if (oldHash === String(input.newHash ?? "").toLowerCase()) return { outcome: "sameAsNew" };
  if (input.sameInTask > 0 || input.sameInOtherTasks > 0) return { outcome: "shared" };
  if (input.downloaderEntries === null) return { outcome: "unreachable" };
  const hit = input.downloaderEntries.find((one) => String(one.hash ?? "").toLowerCase() === oldHash);
  if (!hit) return { outcome: "notFound" };
  return { outcome: "removed", id: hit.id };
}
