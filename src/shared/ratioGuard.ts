/**
 * 发送下载器之前的分享率分档。纯函数，Node 可直接 import 跑断言
 * （`.tmp-build/ratio-guard-test.mjs`）。
 *
 * **判的不是「现在多少」，是「把这一批下完之后会变成多少」**（用户 2026-10-11）：
 * 下载会给该站记上一整份下载量，`新分享率 = 上传量 ÷（已下载量 + 这一批的体积）`。
 * 一条 60 GiB 的电影能把 1.8 直接压到 0.4，只看现状就漏掉了这一档 —— 那正是他要拦的东西。
 *
 * **免费的条目不增加下载量**，所以不压低预估；判据与辅种推荐共用一份（`torrentFree.ts`）。
 * 同一站在一批里多条时体积**相加**（那才是真要记上去的量），站点仍然只报一行。
 *
 * **辅种不在这一条里**：那是纯上传，反而在救分享率。所以辅种任务的重发、后台自动辅种
 * 两条路都不该套这个判据，套了会把「该做的补救」也拦下来。
 *
 * 哨兵值必须显式处理，否则「报不出」会被判成风险、或者被判成完美：
 * packages/site 的 `fixRatio` 拿不到数时回 `-1`，上下行都是 0 时回 `-Infinity`，
 * 而有上传没下载时回 `+Infinity` —— 最后那个是最好的情况，不是缺失。
 */
import { isFreeTorrent } from "./torrentFree.ts";

export type TRatioTier = "danger" | "warn" | "ok" | "unknown";

/** 低于它 → 发送前要人确认 */
export const RATIO_DANGER_CEIL = 1;
/** 低于它（但不低于上一档）→ 发送后给一条提示，不拦 */
export const RATIO_WARN_CEIL = 2;

/**
 * 归一站点报的分享率：`-1` / `-Infinity` / 负数 / `NaN` / 认不出的串都算「未取到」，
 * `+Infinity`（有上传没下载）原样留着 —— 它是达标里最好的那一档，不是缺失。
 */
function normalizeRatio(ratio: unknown): number | null {
  const value = typeof ratio === "string" ? parseFloat(ratio) : ratio;
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  if (value === Infinity) return Infinity;
  if (value === -Infinity || value < 0) return null;
  return value;
}

/**
 * 分档。吃的是已归一的数，也吃站点原样报的字符串（`"1.5"`）。
 *
 * 拿不出上下行、只能按**现状**判的那几行也走这一条：因为非免费下载只会把分母变大，
 * 现状低于 1 的站下完之后必然还是低于 1 —— 按现状判这一档既不多拦也不漏拦。
 */
export function ratioTier(ratio: unknown): TRatioTier {
  const value = normalizeRatio(ratio);
  if (value === null) return "unknown";
  if (value === Infinity) return "ok";
  if (value < RATIO_DANGER_CEIL) return "danger";
  if (value < RATIO_WARN_CEIL) return "warn";
  return "ok";
}

/** 字节数那种字段：字符串按 parseFloat 认，负数与 Infinity 都算拿不出 */
function toNonNegativeBytes(value: unknown): number | null {
  const parsed = typeof value === "string" ? parseFloat(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

/** 这一档的数是从哪来的 */
export type TRatioBasis =
  /** 按「整条下完」预估过的 */
  | "projected"
  /** 只拿得出现在的分享率（缺上传量/下载量，或这批里有条目报不出体积） */
  | "current";

export interface IProjectedRatio {
  value: number;
  basis: TRatioBasis;
}

export interface IProjectRatioInput {
  uploaded?: unknown;
  downloaded?: unknown;
  ratio?: unknown;
  /** 这一批在该站要新记上的下载量（字节），免费的条目不计 */
  countedSize?: number;
  /** 这批里有没有报不出体积的非免费条目；false 时不敢当真算完了 */
  sizeKnown?: boolean;
}

/**
 * 下完这一批之后的分享率。拿不出上下行、或体积没算全时退回现状那一档，
 * 由 `basis` 告诉界面「这个数不是预估出来的」—— 不替数据源编一个看着像预估的数。
 */
export function projectRatio(input: IProjectRatioInput): IProjectedRatio | null {
  const uploaded = toNonNegativeBytes(input.uploaded);
  const downloaded = toNonNegativeBytes(input.downloaded);
  const counted = Math.max(0, toNonNegativeBytes(input.countedSize) ?? 0);

  if (uploaded !== null && downloaded !== null && input.sizeKnown !== false) {
    const divisor = downloaded + counted;
    // 0 ÷ 0：什么都没发生过，判不出（与 fixRatio 给 -Infinity 的口径一致）
    if (divisor === 0) return uploaded > 0 ? { value: Infinity, basis: "projected" } : null;
    return { value: uploaded / divisor, basis: "projected" };
  }

  const now = normalizeRatio(input.ratio);
  return now === null ? null : { value: now, basis: "current" };
}

export interface IRatioRow {
  site: string;
  /** 面向用户的站点名（内部 id 不进界面，见 AGENTS.md §3.5） */
  name: string;
  /** 判这一档用的那个数；null = 判不出 */
  ratio: number | null;
  basis: TRatioBasis | null;
  /** 这一批在该站要新记上的下载量（字节） */
  countedSize: number;
}

export interface IRatioRisk {
  danger: IRatioRow[];
  warn: IRatioRow[];
  unknown: IRatioRow[];
}

/** 参与预估只需要这三样 */
export interface ISizeBearingTorrent {
  site?: string;
  size?: number;
  tags?: { name: string }[] | null;
}

/** 该站的账户数（来自上次取到的用户信息那份缓存） */
export interface ISiteAccount {
  uploaded?: unknown;
  downloaded?: unknown;
  ratio?: unknown;
}

/**
 * 这一条种子会不会给该站新记下载量 —— 「下完之后会变成多少」那一行的四种答案。
 *
 * 判它的是调用方（它才知道这一条在当前流程里到底会不会被下载），组件只按它选措辞。
 * 分开列而不是统一按 size 算：辅种里只有基准那一条要真下一次，其余是跳过校验直接算完成，
 * 把 15 GiB 记到它们头上就是凭空吓人。
 */
export type TRatioImpact =
  /** 这一条会真下，按体积计入下载量 */
  | "download"
  /** 免费下载，不增加下载量 */
  | "free"
  /** 跳过校验直接算完成，不产生下载量 */
  | "skipCheck"
  /** 基准取自下载器里已有的一条，这一批压根不下 */
  | "localBase"
  /** 这一条报不出体积，算不出 */
  | "noSize";

/**
 * 一批种子 + 每站的账户 → 三档。
 *
 * 按站合并：一批 18 条结果可能全来自同一个站，报 18 行同样的话没有意义，
 * 而那一站的下载量恰恰是这 18 条**加在一起**。
 *
 * 这一层只出 `nameFor` 给得出的名字；名字没命中的那些行由调用方补
 * （见 {@link fillRatioRowNames}），判据本身不碰异步。
 */
export function assessRatioBatch(
  torrents: ISizeBearingTorrent[],
  deps: { accountFor: (site: string) => ISiteAccount | undefined; nameFor: (site: string) => string },
): IRatioRisk {
  const perSite = new Map<string, { counted: number; sizeKnown: boolean }>();

  for (const torrent of torrents) {
    const site = torrent.site;
    if (!site) continue;
    let acc = perSite.get(site);
    if (!acc) {
      acc = { counted: 0, sizeKnown: true };
      perSite.set(site, acc);
    }
    if (isFreeTorrent(torrent.tags)) continue;
    const size = toNonNegativeBytes(torrent.size);
    if (size === null) acc.sizeKnown = false;
    else acc.counted += size;
  }

  const risk: IRatioRisk = { danger: [], warn: [], unknown: [] };
  for (const [site, acc] of perSite) {
    const projected = projectRatio({
      ...deps.accountFor(site),
      countedSize: acc.counted,
      sizeKnown: acc.sizeKnown,
    });
    const row: IRatioRow = {
      site,
      name: deps.nameFor(site),
      ratio: projected?.value ?? null,
      basis: projected?.basis ?? null,
      countedSize: acc.counted,
    };
    const tier = projected ? ratioTier(projected.value) : "unknown";
    if (tier !== "ok") risk[tier].push(row);
  }

  return risk;
}

/**
 * 给真要画进界面的那两档补站点名（未取到那一档只报个数，不必补）。
 *
 * `siteNameMap` 只覆盖已添加的站，且是选项页启动时建的那份缓存 —— 没命中就退回
 * 异步取站点定义里的名字。直接 `?? site` 会把内部 id 画进界面，那是 AGENTS.md §3.5
 * 的零容忍项（`KeepUploadDialog.vue:1332` 那条注释判的是同一件事）。
 */
export async function fillRatioRowNames(
  risk: IRatioRisk,
  getName: (site: string) => Promise<string>,
): Promise<void> {
  for (const row of [...risk.danger, ...risk.warn]) {
    if (!row.name) row.name = await getName(row.site);
  }
}

/**
 * 分享率的展示形态：`0.85` / `∞` / `-`。
 *
 * 与「我的数据」那一列的 `realFormatRatio` 同一口径（∞ 与 - 两档必须两边一致，
 * 否则同一个站在两处说法不同）。判不出写 `-`，不替数据源编一个 0.00。
 */
export function formatRatioText(ratio: unknown): string {
  const normalized = normalizeRatio(ratio);
  if (normalized === Infinity) return "∞";
  if (normalized === null) return "-";
  return normalized.toFixed(2);
}

/**
 * 低分享率确认框的重弹策略（用户 2026-10-12：「已经确认过的站用户可以选择当天不提示或者每次都提示」）。
 *
 * - `always`：每次都问（v0.84.0 起的老行为，也是这里的默认 —— 这是一道拦误操作的闸，
 *   默认值不该悄悄把闸放轻）；
 * - `day`：同一批站点当天确认过一次就不再问，过了当天（按本地日期）重新生效。
 */
export type TRatioConfirmPolicy = "always" | "day";

/** 当天已确认过的那些站。`day` 是本地日期串，跨天即整体作废（不做逐站过期） */
export interface IRatioConfirmMute {
  day: string;
  sites: string[];
}

/**
 * 本地日期串（`YYYY-MM-DD`）。
 *
 * 故意不用 `toISOString()`：那是 UTC，晚上十点确认的站会在凌晨两点「过期」，
 * 而用户心里的「今天」从来都是本地那一天。
 */
export function ratioDayKey(at: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** 今天已经免掉的那些站；记录不是今天的那一份时一律作废（返回空表）。存 null = 还没有记录 */
export function ratioMutedSites(mute?: IRatioConfirmMute | null, today: string = ratioDayKey()): string[] {
  if (!mute || mute.day !== today) return [];
  return mute.sites ?? [];
}

/** 用户刚确认过这些站：并进当天的那一份记录（跨天从空表起算，不去重则反复发送会把数组撑大） */
export function ratioMuteAfterConfirm(
  mute: IRatioConfirmMute | null | undefined,
  sites: string[],
  today: string = ratioDayKey(),
): IRatioConfirmMute {
  const base = ratioMutedSites(mute, today);
  return { day: today, sites: [...new Set([...base, ...sites])] };
}
