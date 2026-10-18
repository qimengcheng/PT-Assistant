/**
 * 「下载器里每一条还可以往几个站辅」这份事实怎么拼出来。
 *
 * 为什么单独成一个模块（跟 `reseedGroups.ts`、`columnText.ts` 同一先例）：这一层是**取数拼判据**，
 * 出错不会报错，只会让界面上那枚「待辅 N 站」安静地不出现、或者把数字算大。
 * 判据本体在 `@/shared/reseedCandidate`（那文件头写清了两件事：为什么这条路不看分享率、
 * 以及那个数字为什么只代表「还没挂上」而不代表「那站上确有这条种子」）；
 * 这里负责把它和「同内容分组」「tracker 反查」拼起来，并且能在 Node 里被断言。
 */
import { judgeReseedCandidate, type TReseedCandidateVerdict } from "@/shared/reseedCandidate.ts";
import { resolveTrackerHostSite, trackerFieldToHost } from "@/shared/trackerHost.ts";

import { assignGroups, buildTaskGroups, type IReseedTaskForGroup, type IRowForGroup } from "./reseedGroups.ts";

/** 参与判据的一行：折叠那套分组要的字段（`IRowForGroup`）加两样这一层自己要的 */
export interface IReseedRow extends IRowForGroup {
  /** 下载器报的 tracker：URL 或裸主机名，各家不同；空 / 缺省 = 这一格没报 */
  tracker?: string;
  /** 数据下完了没有。由调用方从 `isCompleted` 折过来，这里不认各家那套 state 字面 */
  completed: boolean;
}

/**
 * 行 key → 判据结果。
 *
 * 三条取数口径（都要和界面上看得见的那半同源，不然标记会和列对不上账）：
 * ① 一份副本挂在哪个站，拿**表里 Tracker 那一列同一份数据**（`row.tracker`）反查，
 *    raw 里那整串 announce 列表不参与；
 * ② 同内容的几份副本并成一个「已挂集合」，用的是**折叠那套同一份判据**（`assignGroups` + 辅种台账），
 *    所以被折叠起来、这一屏看不见的那些副本也算已挂，缺口不会虚报；
 * ③ 可辅目标就是调用方给的那批站点（已添加、没标离线），这一层不再自己筛。
 */
export function buildReseedFacts(
  rows: IReseedRow[],
  hostSiteEntries: Iterable<readonly [string, string]>,
  usableSites: readonly string[],
  tasks: IReseedTaskForGroup[],
): Map<string, TReseedCandidateVerdict> {
  const groupOf = assignGroups(rows, buildTaskGroups(tasks));
  // 没进组的行拿自己当组键：一份都认不出站时并集是空的，判据据此退到 no-site，
  // 而不是把「不知道」读成「已挂满」或「还差全部站点」。
  const groupKeyOf = (row: IReseedRow) => groupOf.get(row.key) ?? row.key;

  const coveredByGroup = new Map<string, Set<string>>();
  for (const row of rows) {
    const group = groupKeyOf(row);
    let covered = coveredByGroup.get(group);
    if (!covered) {
      covered = new Set<string>();
      coveredByGroup.set(group, covered);
    }
    const host = trackerFieldToHost(row.tracker);
    const site = host ? resolveTrackerHostSite(host, hostSiteEntries) : null;
    if (site) covered.add(site);
  }

  const out = new Map<string, TReseedCandidateVerdict>();
  for (const row of rows) {
    out.set(
      row.key,
      judgeReseedCandidate({
        completed: row.completed,
        coveredSites: [...(coveredByGroup.get(groupKeyOf(row)) ?? [])],
        usableSites,
      }),
    );
  }
  return out;
}
