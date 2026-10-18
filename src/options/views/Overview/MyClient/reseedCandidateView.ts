/**
 * 「下载器里每一条还可以往几个站辅」这份事实怎么拼出来。
 *
 * 为什么单独成一个模块（跟 `reseedGroups.ts`、`columnText.ts` 同一先例）：这一层是**取数拼判据**，
 * 出错不会报错，只会让界面上那枚「待查 N 站」/「已查 N 站」安静地不出现、或者把数字算大。
 * 判据本体在 `@/shared/reseedCandidate`（那文件头写清了三件事：为什么这条路不看分享率、
 * 那个数字为什么只代表「还没挂上」而不代表「那站上确有这条种子」、以及查过的站为什么不再算待查）；
 * 这里负责把它和「同内容分组」「tracker 反查」「扫描结论」拼起来，并且能在 Node 里被断言。
 */
import { judgeReseedCandidate, type IReseedScanTally, type TReseedCandidateVerdict } from "@/shared/reseedCandidate.ts";
import { resolveTrackerHostSite, trackerFieldToHost } from "@/shared/trackerHost.ts";
import { isReseedScanFresh, reseedScanContentKey } from "@/shared/reseedScanPlan.ts";
import type { IReseedHandoffBase } from "@/shared/reseedScanHandoff.ts";
import type { IReseedScanResult, IReseedScanTarget, TReseedScanVerdict } from "@/shared/types/storages/reseedScan.ts";

import { assignGroups, buildTaskGroups, type IReseedTaskForGroup, type IRowForGroup } from "./reseedGroups.ts";

/** 参与判据的一行：折叠那套分组要的字段（`IRowForGroup`）加两样这一层自己要的 */
export interface IReseedRow extends IRowForGroup {
  /** 下载器报的 tracker：URL 或裸主机名，各家不同；空 / 缺省 = 这一格没报 */
  tracker?: string;
  /** 数据下完了没有。由调用方从 `isCompleted` 折过来，这里不认各家那套 state 字面 */
  completed: boolean;
}

/** 行 key → 组键。没进组（或组里只有一条）的行拿自己当组键 */
type TGroupKeyOf = (row: IReseedRow) => string;

/**
 * 一行属于哪份「内容」：与扫描那一侧、一键辅种基准那一侧**同一条算式**（同一个 `reseedScanContentKey`
 * + 同样 round 过的大小）。三处各折一套就会「查回来的结论对不上任何一行」。
 */
function rowContentKey(row: IReseedRow): string {
  return reseedScanContentKey(row.name, Math.max(0, Math.round(row.totalSize ?? 0)));
}

/** 「这条内容查过哪些站、各查到哪一档」 */
interface IContentScanFacts {
  scanned: Set<string>;
  verdicts: { siteId: string; verdict: keyof IReseedScanTally }[];
}

/** 结论档 → 判据那一侧的四档键。`failed` 与 `no-match` 不许并，见 `reseedCandidate.ts` 文件头 */
const TALLY_KEY: Record<TReseedScanVerdict, keyof IReseedScanTally> = {
  "has-it": "hasIt",
  suspect: "suspect",
  "no-match": "noMatch",
  failed: "failed",
};

/**
 * 扫描结论 → 「内容键 → 查过的站与各档计数」。
 *
 * 只收**还在新鲜期里**的那些（`isReseedScanFresh`，与排查询计划用的是同一个判据）：
 * 过期的结论下一轮会被重查，这时候还标「已查」就是把人挡在门外。
 * `failed` 那一档的新鲜期短得多（30 分钟），所以「某个站今天坏了」只会让那一档短暂地算已查，
 * 过了就重新变回待查 —— 这是要的，不是漏的。
 */
function scanFactsByContent(results: IReseedScanResult[], now: number): Map<string, IContentScanFacts> {
  const out = new Map<string, IContentScanFacts>();
  for (const item of results) {
    if (!isReseedScanFresh(item, now)) continue;
    let facts = out.get(item.contentKey);
    if (!facts) {
      facts = { scanned: new Set(), verdicts: [] };
      out.set(item.contentKey, facts);
    }
    if (facts.scanned.has(item.siteId)) continue;
    facts.scanned.add(item.siteId);
    facts.verdicts.push({ siteId: item.siteId, verdict: TALLY_KEY[item.verdict] });
  }
  return out;
}

/**
 * 每一组「已经挂在哪些站上」。
 *
 * 两条对外函数都用它，不许各拼一遍（拼歪一次就是那枚标记与扫描范围两边各说一套）：
 * ① 一份副本挂在哪个站，拿**表里 Tracker 那一列同一份数据**（`row.tracker`）反查，
 *    raw 里那整串 announce 列表不参与；
 * ② 同内容的几份副本并成一个集合，用的是**折叠那套同一份判据**（`assignGroups` + 辅种台账），
 *    所以被折叠起来、这一屏看不见的那些副本也算已挂，缺口不会虚报。
 * 没进组的行拿自己当组键：一份都认不出站时并集是空的，判据据此退到 `no-site`，
 * 而不是把「不知道」读成「已挂满」或「还差全部站点」。
 */
function coverOfGroups(
  rows: IReseedRow[],
  hostSiteEntries: Iterable<readonly [string, string]>,
  tasks: IReseedTaskForGroup[],
): { groupKeyOf: TGroupKeyOf; covered: Map<string, Set<string>> } {
  const groupOf = assignGroups(rows, buildTaskGroups(tasks));
  const groupKeyOf: TGroupKeyOf = (row) => groupOf.get(row.key) ?? row.key;
  const entries = hostSiteEntries instanceof Map ? hostSiteEntries : new Map(hostSiteEntries);

  const covered = new Map<string, Set<string>>();
  for (const row of rows) {
    const group = groupKeyOf(row);
    let sites = covered.get(group);
    if (!sites) {
      sites = new Set<string>();
      covered.set(group, sites);
    }
    const host = trackerFieldToHost(row.tracker);
    const site = host ? resolveTrackerHostSite(host, entries) : null;
    if (site) sites.add(site);
  }
  return { groupKeyOf, covered };
}

/**
 * 行 key → 判据结果。
 *
 * 第三条取数口径：可辅目标就是调用方给的那批站点（已添加、没标离线），这一层不再自己筛。
 * 第四条（v0.109.8）：`scan` 给的是**已经逐站查过**的那些结论，按**整组副本**的内容键并起来 ——
 * 同一份内容在下载器里往往有好几行、标题写法还不一致（各自一个 contentKey），
 * 只看其中一行的结论就会「查过了却仍报待查」，而那正是这一档要盖掉的东西。
 */
export function buildReseedFacts(
  rows: IReseedRow[],
  hostSiteEntries: Iterable<readonly [string, string]>,
  usableSites: readonly string[],
  tasks: IReseedTaskForGroup[],
  scan?: { results: IReseedScanResult[]; now: number },
): Map<string, TReseedCandidateVerdict> {
  const { groupKeyOf, covered } = coverOfGroups(rows, hostSiteEntries, tasks);
  const byContent = scan ? scanFactsByContent(scan.results, scan.now) : null;

  const scannedOfGroup = new Map<string, IContentScanFacts>();
  if (byContent) {
    for (const row of rows) {
      const facts = byContent.get(rowContentKey(row));
      if (!facts) continue;
      const group = groupKeyOf(row);
      let merged = scannedOfGroup.get(group);
      if (!merged) {
        merged = { scanned: new Set(), verdicts: [] };
        scannedOfGroup.set(group, merged);
      }
      for (const siteId of facts.scanned) {
        if (merged.scanned.has(siteId)) continue;
        merged.scanned.add(siteId);
        merged.verdicts.push(...facts.verdicts.filter((item) => item.siteId === siteId));
      }
    }
  }

  const out = new Map<string, TReseedCandidateVerdict>();
  for (const row of rows) {
    const scanned = scannedOfGroup.get(groupKeyOf(row));
    out.set(
      row.key,
      judgeReseedCandidate({
        completed: row.completed,
        coveredSites: [...(covered.get(groupKeyOf(row)) ?? [])],
        usableSites,
        ...(scanned ? { scannedSites: [...scanned.scanned], scannedVerdicts: scanned.verdicts } : {}),
      }),
    );
  }
  return out;
}

/** 一条待扫内容 + 它在表里对应的那几行（`memberKeys` 供调用方回查判据，这一层不判第②遍） */
export interface IReseedScanScopeItem extends IReseedScanTarget {
  memberKeys: string[];
}

/**
 * 扫描面板上的一个范围档。
 *
 * 形状住这一份而不是住在那个 `.vue` 里：`<script setup>` 不许 `export`，
 * 而页面与弹窗两头都要这个类型。
 */
export interface IReseedScanScope {
  key: string;
  /** 已按当前语言算好的那一档标签（带条数） */
  label: string;
  targets: IReseedScanScopeItem[];
}

/**
 * 把表里那些**已下完**的内容折成「可辅种扫描」的范围清单。
 *
 * 三条取数口径：
 * - 未下完的一律不进：数据不全，查到那个站上有也不能拿去辅（与 `pickLocalBaseCandidates` 同一条）；
 * - `knownSites` 取的是**整组副本**的并集（`coverOfGroups` 那一遍），被折叠藏起来的副本也算；
 *   那些站不排进计划 —— 已经挂在上面的站再查一遍，只会得到一个「该站有这条」的废话结论；
 * - 内容键用 `reseedScanContentKey`，与 offscreen 那侧本地指纹索引的第 1 层同一个算法，
 *   两边各折一套就会「查了却对不上号」。同一内容在不同下载器/不同路径里有好几行时，
 *   这些行会算出**同一个** contentKey，这里并成一条（否则一次扫描要重复发同样的查询）。
 *
 * 字节数取 `totalSize` 并 `Math.round`：下载器索引那侧也是这么取的（`offscreen/utils/fingerprint.ts`），
 * 一处不round就会两边 key 不相等。
 */
export function buildReseedScanScope(
  rows: IReseedRow[],
  hostSiteEntries: Iterable<readonly [string, string]>,
  tasks: IReseedTaskForGroup[],
): IReseedScanScopeItem[] {
  const { groupKeyOf, covered } = coverOfGroups(rows, hostSiteEntries, tasks);
  const byKey = new Map<string, IReseedScanScopeItem>();

  for (const row of rows) {
    if (!row.completed) continue;
    const size = Math.max(0, Math.round(row.totalSize ?? 0));
    const contentKey = rowContentKey(row);
    const knownSites = [...(covered.get(groupKeyOf(row)) ?? [])];
    const hit = byKey.get(contentKey);
    if (hit) {
      hit.memberKeys.push(row.key);
      for (const site of knownSites) if (!hit.knownSites.includes(site)) hit.knownSites.push(site);
      continue;
    }
    byKey.set(contentKey, { contentKey, name: row.name, size, knownSites, memberKeys: [row.key] });
  }

  return [...byKey.values()];
}

/**
 * 表里的行 → 「一键辅种」要的本地基准清单。
 *
 * 内容键与 `buildReseedScanScope` **同一条算式**（同一个 `reseedScanContentKey` + 同样 round 过的大小），
 * 两边各折一套就会「扫描说查到了 23 条，一键时又说找不到基准」。
 * 同一份内容在下载器里有几份副本时取**第一条报得出 infoHash 的**：它们内容相同，
 * 差别只在挂过哪个站 —— 而基准要的正是「数据在哪、有多少」，不是「它是哪一颗种子」。
 * 没下完的行照旧不进（与扫描范围同一条：数据不全不能拿去辅）。
 */
export function buildReseedLocalBases(
  rows: IReseedRow[],
  downloaderNames: Record<string, string | undefined>,
): IReseedHandoffBase[] {
  const out = new Map<string, IReseedHandoffBase>();
  for (const row of rows) {
    if (!row.completed) continue;
    const contentKey = rowContentKey(row);
    const existing = out.get(contentKey);
    if (existing && (existing.hash || !row.infoHash)) continue;
    out.set(contentKey, {
      contentKey,
      downloaderId: row.clientId,
      downloaderName: downloaderNames[row.clientId],
      hash: row.infoHash,
      name: row.name,
      savePath: row.savePath,
    });
  }
  return [...out.values()];
}
