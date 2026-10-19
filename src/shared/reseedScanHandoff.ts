/**
 * 「可辅种扫描」的结论 → 辅种任务（纯判据，不碰网络、不碰存储）。
 *
 * 为什么要有这一份（用户 2026-10-18：「这个界面应该有个一键辅种的按钮，直接把查到的进行辅种」）：
 * 扫描那一屏只回答「那个站上有没有这条」，答完了却还要人回搜索页把同一条再搜一遍、再点一次
 * 「辅种检测」—— 那一步的全部信息扫描都已经有了。这里做的就是那一下搬运。
 *
 * **它刻意不复制 `KeepUploadDialog` 那套建任务判据**，只复制「组装」那一段：
 * - 分享率那道硬闸（v0.105.2）只管「基准取自列表第一条」那一路；这里每条任务的基准都是**下载器里
 *   已经下完的那一份**（`baseLocal`），整批不再下一遍，那条闸的理由在这条路上不成立，所以不重算；
 * - 「验证通过的全是基准本身 → 拒建」也不在这里：能进任务的只有结论是「该站有这条」的那些对子，
 *   而扫描的计划本来就**跳过**了已经挂在的那个站（`planReseedScan` 的 `knownSites` 那一档）；
 * - **重复任务**这一闸是真的要，所以直接复用现成那份 `findDuplicateTasks`，不自己另写一套比法。
 * - 目录取基准实际所在目录（不猜），标签取 `reseedHandoffLabelOf` 那一份默认值 —— v0.110.2 之前这里
 *   压根不写 `addTorrentOptions`，于是同一份内容走两条路建出来的任务，推下去的种子一个有标签一个没有。
 *   **但「基准的 `savePath`」并不等于「数据所在那一层」**：多文件种的数据在 `savePath/<顶层目录>` 里，
 *   而各站那个目录名起得不一样，直接按 `savePath` 发就会另起一个空目录、0% 卡住。把目标下沉到那一层
 *   并让下载器别另起目录的那一步在调用方（`reseedTargetDir.ts` + 弹窗那圈），因为它要问下载器要文件清单。
 * 界面上那张弹窗该走的路没被绕过：想**逐条**挑目录/标签，仍然去搜索页那颗「辅种检测」。
 */
import { findDuplicateTasks } from "./reseedTaskDup.ts";
import type { IKeepUploadTask, IKeepUploadTaskItem } from "./types/storages/keepUploadTask.ts";
import type { IReseedScanResult } from "./types/storages/reseedScan.ts";

/** 下载器里那一份基准（由界面从种子列表的行折出来，这一层不去读下载器） */
export interface IReseedHandoffBase {
  /** 与扫描侧同一个内容键（`reseedScanContentKey`） */
  contentKey: string;
  downloaderId: string;
  downloaderName?: string;
  /** 基准那颗种子的 infoHash —— `baseLocal.hash` 是必填的，缺了这条内容就没法建 */
  hash?: string;
  name: string;
  /** 基准实际所在目录。任务目录取它，于是「目录不一致」那一种卡法从结构上不会出现 */
  savePath?: string;
  /**
   * 基准那份数据**实际**所在那一条路径（下载器报的，报不出就留空）。
   *
   * 它常常是 `savePath/<顶层目录>`，而那一段目录名各站打包时起的并不一样 —— 一键辅种要把目标
   * 定到它那一层，新副本才认得出盘上已有的数据（用户 2026-10-19 报的 0% 已停止）。
   * 判据与「拿不准就不动」那三条都在 `src/shared/reseedTargetDir.ts`，这里只负责把它带过来。
   */
  contentPath?: string;
  /**
   * 这一条要带给新副本的**种子标签**（任务页那格「种子标签」同一个字段）。
   *
   * 为什么必须由调用方折好传进来（而不是这里去读 store）：这一层不碰存储，判据才能在 Node 里断言。
   * 取数口径照 `reseedHandoffLabelOf`，与手动那颗「辅种检测」弹窗的默认值同一份 ——
   * 少写这一项时，同一份内容走两条路建出来的任务，推下去的种子一个有标签一个没有
   * （用户 2026-10-18：「现在的一键辅种没有把标签带上，标签还是要有的」）。
   */
  label?: string;
}

/**
 * 一键辅种那一批任务该打的标签，口径与手动弹窗的**默认值**一致（两处不许各说一套）：
 * 勾了「记住上次下载器」且记住的那颗就是这一条基准所在的下载器时，用上次记下的标签；
 * 否则用「默认下载服务器设置 → 标签」里那一栏。
 *
 * `remembered` 由调用方按 `configStore.download.saveLastDownloader` 决定传不传（弹窗那一步就是这么取的），
 * 这里不再判那颗开关，免得同一道开关被读两遍、以后改档位时漏一处。
 *
 * 刻意**没有**沿用「基准那条种子自己在下载器里挂着的标签」：读回来的那一格与发送时的那一格
 * 不是同一个概念（qBittorrent 发送时把 `label` 写进 `tags`，见 `packages/downloader/entity/qBittorrent.ts:558`，
 * 而读列表时把 `category` 折成 `label`，同文件 `:674`）。照抄会把**分类**打成**标签**，
 * 那是往用户数据上写一个原本不存在的东西，比少打一个标签更坏。
 */
export function reseedHandoffLabelOf(input: {
  downloaderId: string;
  remembered?: { downloaderId?: string; label?: string };
  defaultTags?: string;
}): string {
  if (input.remembered?.downloaderId && input.remembered.downloaderId === input.downloaderId) {
    return input.remembered.label || "";
  }
  return input.defaultTags || "";
}

/** 一条内容没能建出任务的原因 */
export type TReseedHandoffSkip =
  /** 下载器里找不到这一条（没下完、被删了、或者这一屏的行对不上内容键） */
  | "no-base"
  /** 结论是「该站有这条」，但那次查询没存下可发送的形状（本次之前的老数据） */
  | "no-site-ref";

export interface IReseedHandoffPlan {
  tasks: IKeepUploadTask[];
  /** 因为撞上了已有任务而没建的，按内容键报数（一键模式下不弹 N 个确认框） */
  duplicated: string[];
  skipped: { contentKey: string; name: string; reason: TReseedHandoffSkip }[];
}

/** 任务 id 要唯一又要可测：默认那一份用随机尾巴，测试里注入一个固定的 */
export type TReseedHandoffIdFactory = (contentKey: string, index: number) => string;

const defaultMakeId: TReseedHandoffIdFactory = (contentKey, index) =>
  `${Date.now()}-${contentKey.slice(-8)}-${index}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * 一条结果算不算「那个站上确有这条」。
 *
 * 只认 `has-it`：`suspect`（标题相符、未验文件）说的是「大概有」，把它一起发出去就是替人赌一次。
 * 有没有**可发送的那一半**（`site`）不在这里判 —— 判在分组之后，好让老数据得到一个
 * 「查到了但信息不够」的点名，而不是从这一屏无声消失。
 */
function isHit(result: IReseedScanResult): boolean {
  return result.verdict === "has-it";
}

function sendable(result: IReseedScanResult): result is IReseedScanResult & { site: NonNullable<IReseedScanResult["site"]> } {
  return isHit(result) && !!result.site?.title;
}

/** 站上那条 → 任务里的一条。字段口径照 `IKeepUploadTaskItem`，两处不许各猜一套 */
function toItem(siteId: string, site: NonNullable<IReseedScanResult["site"]>): IKeepUploadTaskItem {
  return {
    site: siteId as IKeepUploadTaskItem["site"],
    id: site.id,
    title: site.title,
    subTitle: site.subTitle,
    category: site.category,
    // 这两条在 ITorrent 那一侧是反着的：`url` = 详情页、`link` = 下载链接，
    // 而任务里 `link` 存详情页、`url` 存下载链接。照弹窗那一份写法来，别"顺手纠正"。
    link: site.url ?? "",
    url: site.link ?? "",
    size: site.size ?? 0,
    seeders: site.seeders,
    leechers: site.leechers,
    hash: site.hash,
  };
}

/**
 * 把扫描结论折成一批要建的辅种任务。
 *
 * 三条口径：
 * ① **一条内容 = 一个任务**，它在几个站上命中就几条 items（后台那套是按任务逐条发的，
 *    拆成 N 个任务会让同一份本地数据被 N 条任务各自当基准管）；
 * ② 基准 = 下载器里那一份，任务目录 = 它实际所在目录（见 `IReseedHandoffBase.savePath`），
 *    标签 = 它实际所在那颗下载器该打的那一份（见 `IReseedHandoffBase.label`）；
 * ③ 撞上已有任务的不建（只认 `sameItem` / `sameHash` 那两种硬证据 —— 标题+大小相同而站点条目不同
 *    是「同一份内容分两批站去辅」的正常形状，把它跳掉就违背了这一屏的用途）。
 */
export function planReseedHandoff(input: {
  results: IReseedScanResult[];
  targets: { contentKey: string; name: string }[];
  bases: IReseedHandoffBase[];
  existingTasks: IKeepUploadTask[];
  autoReseed?: boolean;
  makeId?: TReseedHandoffIdFactory;
  now?: number;
}): IReseedHandoffPlan {
  const { results, targets, bases, existingTasks } = input;
  const now = input.now ?? Date.now();
  const makeId = input.makeId ?? defaultMakeId;
  const nameOf = new Map(targets.map((target) => [target.contentKey, target.name]));
  const baseOf = new Map(bases.map((base) => [base.contentKey, base]));

  // 按内容分组，组内按站点定序：同一批数据两次点「一键辅种」要折出同样的 items 顺序
  const grouped = new Map<string, IReseedScanResult[]>();
  for (const result of results) {
    if (!isHit(result)) continue;
    const list = grouped.get(result.contentKey);
    if (list) list.push(result);
    else grouped.set(result.contentKey, [result]);
  }
  for (const list of grouped.values()) list.sort((a, b) => a.siteId.localeCompare(b.siteId));

  const tasks: IKeepUploadTask[] = [];
  const duplicated: string[] = [];
  const skipped: IReseedHandoffPlan["skipped"] = [];

  for (const [contentKey, hits] of [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const base = baseOf.get(contentKey);
    if (!base?.hash) {
      skipped.push({ contentKey, name: nameOf.get(contentKey) ?? contentKey, reason: "no-base" });
      continue;
    }
    const withRef = hits.filter(sendable);
    if (withRef.length === 0) {
      skipped.push({ contentKey, name: base.name, reason: "no-site-ref" });
      continue;
    }

    const first = withRef[0];
    const task: IKeepUploadTask = {
      id: makeId(contentKey, tasks.length),
      time: now,
      title: first.site?.title || base.name,
      subTitle: first.site?.subTitle,
      size: first.site?.size ?? 0,
      downloadOptions: {
        downloaderId: base.downloaderId,
        savePath: base.savePath || undefined,
        clientName: base.downloaderName || base.downloaderId,
        // 发送那一圈是 `...task.downloadOptions.addTorrentOptions` 原样铺开（`KeepUploadTask/autoReseed.ts`
        // 的 `buildReseedAddTorrentOptions`），这里不写就等于推下去的种子什么标签都没有。
        // 只在真有标签时写这一项：空串会被下载器当成一次「把标签清空」的指令，而空对象 `{}`
        // 落进任务里与「压根没有」在界面上看不出区别，存量任务恰好都没有这一项。
        ...(base.label ? { addTorrentOptions: { label: base.label } } : {}),
      },
      // 建完就交给后台那一路（判据在 `KeepUploadTask/autoReseed.ts`）。显式写值，不留 undefined：
      // 任务页与后台判的都是 `=== true`
      autoReseed: input.autoReseed !== false,
      baseLocal: { hash: base.hash, name: base.name, savePath: base.savePath || undefined },
      items: withRef.map((hit) => toItem(hit.siteId, hit.site)),
    };

    // 只把硬证据当重复：同一颗站点种子（站 + id）或同一个 infoHash 已经被别的任务管着
    const dup = findDuplicateTasks(task, [...existingTasks, ...tasks]).find(
      (hit) => hit.reason === "sameItem" || hit.reason === "sameHash",
    );
    if (dup) {
      duplicated.push(contentKey);
      continue;
    }
    tasks.push(task);
  }

  return { tasks, duplicated, skipped };
}

/** 一键辅种点不动时的几种原因。每一种都得给一句人话，不许留一颗灰着什么都不说的键 */
export type TReseedHandoffBlock =
  /** 这一轮压根还没有「该站有这条」的结论 */
  | "no-hit"
  /** 结论是本次之前那次扫描留下的，没存可发送的那一半 */
  | "legacy"
  /** 下载器里找不到已下完的那一份，没有基准 */
  | "no-base"
  /** 已有任务在管同一颗种子 */
  | "duplicated";

export interface IReseedHandoffBlock {
  reason: TReseedHandoffBlock;
  count: number;
}

/**
 * 一条键为什么是 (0)：把计划里那三类「没建成」拆成可点名的几档。
 *
 * 判据住在这一份而不是那个 `.vue` 里，为的是「灰键到底为什么灰」这件事能被断言 ——
 * 用户 2026-10-18 报的正是这个：屏幕上 23 条「该站有这条」，那颗键却是 (0) 且点不动，
 * 而原因（老记录没存可发送的那一半）只有读源码的人才知道。
 * 有任务可建时返回空表：那时候不需要解释。
 */
export function handoffBlocksOf(
  plan: Pick<IReseedHandoffPlan, "tasks" | "duplicated" | "skipped">,
  hasItCount: number,
): IReseedHandoffBlock[] {
  if (plan.tasks.length > 0) return [];
  const countOf = (reason: TReseedHandoffSkip) => plan.skipped.filter((item) => item.reason === reason).length;

  const out: IReseedHandoffBlock[] = [];
  const legacy = countOf("no-site-ref");
  const noBase = countOf("no-base");
  if (legacy) out.push({ reason: "legacy", count: legacy });
  if (noBase) out.push({ reason: "no-base", count: noBase });
  if (plan.duplicated.length) out.push({ reason: "duplicated", count: plan.duplicated.length });
  // 三类都没有、键却还是 0 ⇒ 唯一剩下的解释就是「这一轮没有命中的结论」
  if (out.length === 0) out.push({ reason: "no-hit", count: hasItCount });
  return out;
}
