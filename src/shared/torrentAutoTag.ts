/**
 * 「按所属站点自动补标签」的判据：给下载器里那些**没有标签**的种子算出该打哪一个标签。
 *
 * 为什么需要这一条（用户 2026-10-19：「之前一键辅种没有加这个导致现在有一堆没有标签的种子」）：
 * 一键辅种从 v0.110.2 起会把标签随任务一起发下去（`reseedScanHandoff.ts`），但那之前推出去的
 * 那一批副本什么都没带，存量补不回来。这一条就是拿同一份事实（Tracker → 站点）把那些空白填上。
 *
 * 三条口径都是他当场挑的，不是默认值：
 * 1. **标签内容 = 该条所属站点的名字**。他现状的标签就是这个形状（一行一个站名），
 *    站点名取 `siteNameOf`（界面真名，按 §3.5 不许写内部 id）。
 * 2. **只补 `tags` 完全为空的**：已经有标签的一条都不碰 —— 往手工打过的种子上追加一个站名，
 *    比少打一个更难看，而且这一步没有「撤销」可做。
 * 3. **Tracker 反查不到站点就跳过**，不拿下载链接、不拿分类去猜：这一条是往用户数据上写字面量，
 *    猜错的代价是他以后按标签筛选会筛出一批错的东西。与 `reseedCandidate.ts` 的 `no-site` 同一取向。
 *
 * ⚠️ 「没有标签」判的是 `tags` 这一格，**不是 `label`**。qBittorrent 里 `label` 装的是**分类**
 * （读列表时把 `category` 折进 `label`，见 `packages/downloader/entity/qBittorrent.ts` 的映射），
 * 而他那批正是「有分类、没标签」—— 把 `label` 也算成有标签，这一条对他一条都不会生效。
 */
import { resolveTrackerHostSite, trackerFieldToHost } from "./trackerHost.ts";

/** 参与判据的一行：只要这四样，其余字段（进度、大小）与这一条无关 */
export interface IAutoTagRow {
  /** 这一条在哪台下载器上 —— `id` 只在单台内唯一，同一份内容可能同时在两台里，发送时要它定位 */
  downloaderId: string;
  /** 发给下载器的那一个标识（`CTorrent.id`，各家形状不同，这里只当不透明主键用） */
  id: string | number;
  /** 表里 Tracker 那一列同一份数据：URL 或裸主机名，各家不同；空 = 这一格没报 */
  tracker?: string;
  /** 这条种子已有的标签。`undefined` / 空数组 = 没有标签 */
  tags?: readonly string[] | null;
}

/** 没能补上的那一档叫什么。两档都不许并：「已经有标签」和「认不出站」是两句不同的话 */
export type TAutoTagSkip = "hasTags" | "noSite";

export interface IAutoTagPlan {
  /** 要打的：一条一个标签，站名各按各的 tracker 算 */
  adds: { downloaderId: string; id: string | number; tag: string }[];
  skipped: { id: string | number; reason: TAutoTagSkip }[];
}

/**
 * 逐条算。顺序照传进来的行序（界面按列表顺序报数，不重排）。
 *
 * 同一条种子被喂两次不会打出两遍：判据是纯函数，去重由调用方的行集合负责；
 * 但**同一个站名的两条**各自成一项 —— 发送那一步本来就是逐条调下载器。
 */
export function planAutoTagRows(
  rows: readonly IAutoTagRow[],
  opts: {
    /** 主机名 → 站点 id，与行上那枚「已查 N 站」同一份表（`metadataStore.siteHostMap`） */
    hostSiteEntries: Iterable<readonly [string, string]>;
    /** 站点 id → 界面上那个站名（缺失时调用方自己退回 id，这里不再判） */
    siteNameOf: (siteId: string) => string;
  },
): IAutoTagPlan {
  const adds: IAutoTagPlan["adds"] = [];
  const skipped: IAutoTagPlan["skipped"] = [];

  for (const row of rows) {
    const hasTag = (row.tags ?? []).some((tag) => (tag ?? "").trim() !== "");
    if (hasTag) {
      skipped.push({ id: row.id, reason: "hasTags" });
      continue;
    }
    const host = trackerFieldToHost(row.tracker);
    const siteId = host ? resolveTrackerHostSite(host, opts.hostSiteEntries) : null;
    const tag = siteId ? opts.siteNameOf(siteId).trim() : "";
    if (!tag) {
      skipped.push({ id: row.id, reason: "noSite" });
      continue;
    }
    adds.push({ downloaderId: row.downloaderId, id: row.id, tag });
  }

  return { adds, skipped };
}

/** 按档数数，给界面那两句提示用（`hasTags` 与 `noSite` 各报各的，不并成「N 条没动」） */
export function countAutoTagSkips(
  skipped: readonly { id?: string | number; reason: TAutoTagSkip }[],
): Record<TAutoTagSkip, number> {
  const out: Record<TAutoTagSkip, number> = { hasTags: 0, noSite: 0 };
  for (const item of skipped) out[item.reason] += 1;
  return out;
}
