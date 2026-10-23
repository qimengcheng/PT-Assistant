/**
 * 「做种价值」那一屏的取数与拼法（判据本体在 `@/shared/seedValue`）。
 *
 * 为什么单独成一份而不是写在 `.vue` 里：这一层出错不报错，只会让某一类内容整个从清单上消失
 * （分组并错、站点反查折错、状态认歪），而这一屏的用途恰恰是「哪些还该留」—— 少一条就是
 * 一次没人看见的判断。住在 `.vue` 里就进不了 Node 断言（AGENTS 记过这条），所以拆出来。
 *
 * 四条取数口径：
 * ① **一份内容一行**，用的是 `assignContentGroups`（名称归一 + 字节，再让辅种台账把写法不同的几条串上）。
 *    v0.123.1 之前这里直接用「我的下载器」**折叠**那套判据（名称+大小+路径+下载器四项全等），
 *    于是各站各存一个目录的那种内容被切成 N 行、每行只报「1 个站」—— 折叠那套把路径当身份是有理由的
 *    （折叠会藏行），这一屏不藏东西，所以按内容并；
 * ② 每份副本的站点走 Tracker 反查（与行上那枚可辅种标记同一份判据），认不出站点的照算进产出，
 *    只是那一栏报不出；
 * ③ 「在做种」吃的是下载器报的状态，不是「数据下完了」—— 下完但暂停着的不产出魔力；
 * ④ 「算哪一类」**不自己折一遍**，走 `sharedCategory` 那一套投票（与辅种任务页、目录预选同一个判据），
 *    理由见下面 `categoryKindOfGroup` 的注释。
 */
import { CTorrentState, type CTorrent } from "@ptd/downloader/types.ts";
import { sharedCategory, type ICategorySource } from "@/options/components/SentToDownloaderDialog/categoryMatch.ts";
import { CATEGORY_KINDS, type TCategoryKind } from "@/shared/category.ts";
import type { TSiteCategoryMapOf } from "@/shared/keepUploadTaskFilter.ts";
import { judgeSeedValue, type ISeedValueCopy, type ISeedValueVerdict } from "@/shared/seedValue.ts";
import { resolveTrackerHostSite, trackerFieldToHost } from "@/shared/trackerHost.ts";
import type { IReseedTaskForGroup, IRowForGroup } from "../MyClient/reseedGroups.ts";
import { assignContentGroups, buildTaskGroups, dataLocationKey } from "../MyClient/reseedGroups.ts";

/** 参与这一屏的一行：分组要的字段 + 时魔公式与状态各样 */
export interface ISeedValueRow extends IRowForGroup {
  tracker?: string;
  /** 数据完整（只勾了部分文件的那一份不算） */
  completed: boolean;
  /** 当前在做种 */
  seeding: boolean;
  /** 全网做种人数，报不出留 undefined */
  swarmSeeders?: number;
  /** 开始做种的 unix 秒：有完成时间用完成时间，否则用添加时间 */
  seedingSince?: number;
  totalUploaded: number;
  uploadSpeed: number;
  /**
   * 下载器自己给这一条挂的分类（qBittorrent 是 category、Transmission 是 labels[0]、Flood 是 tags[0]，
   * 见 `CTorrent.label` 那段「各家叫法不一」的注释）。报不出留 undefined，不折成空串。
   */
  category?: string;
}

/**
 * 下载器报的那一份 → 这一屏吃的那一份。
 *
 * 特意放在这一层而不是页面里：这一段是纯折叠，错了一格不报错、只让某一类内容安静地算歪
 * （把暂停的当在做种、把 0 当 1970 年），而住在 `.vue` 里就进不了 Node 断言。
 * 三条口径：
 * ① `seeding` 只认下载器报的状态，**不认「数据下完了」** —— 下完但暂停着的不产出魔力；
 * ② 开始做种的时间优先取完成时间，没有才退回添加时间；两者都是 0/非数字时给 `undefined`
 *    （qBittorrent 对没下完的种子把 `completion_on` 报成 0，那是「没有」不是 1970 年 ——
 *    当成真数的话 `Ci` 会算成 1，等于把一条昨天刚下的种子吹成年老种）；
 * ③ `completed` 用 `isCompleted`（v0.110.4 起 qBittorrent 那一路已按「选定文件全下完」判）。
 */
export function toSeedValueRows(torrents: readonly CTorrent[]): ISeedValueRow[] {
  return torrents.map((row) => {
    const completedAt = Number.isFinite(row.completedDate) && (row.completedDate ?? 0) > 0 ? row.completedDate : undefined;
    const addedAt = Number.isFinite(row.dateAdded) && row.dateAdded > 0 ? row.dateAdded : undefined;
    const seedingSince = completedAt ?? addedAt;
    return {
      key: `${row.clientId}:${row.id}`,
      clientId: row.clientId,
      name: row.name,
      totalSize: row.totalSize,
      savePath: row.savePath,
      infoHash: row.infoHash,
      tracker: row.tracker,
      ...(row.label ? { category: row.label } : {}),
      completed: row.isCompleted === true,
      seeding: row.state === CTorrentState.seeding,
      swarmSeeders: row.swarmSeeders,
      ...(seedingSince === undefined ? {} : { seedingSince }),
      totalUploaded: row.totalUploaded,
      uploadSpeed: row.uploadSpeed,
    };
  });
}

/** 一行 = 一份内容 */
export interface ISeedValueItem {
  /** 组键（用于回查这一组包含哪些行） */
  key: string;
  /** 代表行的名称 */
  name: string;
  /** 合计占用磁盘（字节）：按「哪一处物理数据」去重后各算一份，见判据 ⑤ */
  bytes: number;
  verdict: ISeedValueVerdict;
  /** 这一组在下载器列表里的行键，供「跳回去删」那类动作用 */
  memberKeys: string[];
  /**
   * 这一组里出现过的**全部名称写法**（去重，保持首次出现的顺序）。
   *
   * 一行显示的是代表行那一个名称，但组里各站的 .torrent 标题写法可能不同（台账把写法不同的几条
   * 并成一项，见 `assignContentGroups`）。搜索要逐种试：只按界面上那一个筛，他就会「明明在这一行里、
   * 搜那个写法却说没有」。
   */
  names: string[];
  /**
   * 这一组内容算哪一类；**说不清就是 null**（一条都报不出分类、或两档并列）。
   *
   * null 的条目在任何具体分类筛选下都不出现，只在「全部分类」里看得到 —— 与辅种任务页同一口径。
   * 界面那一格留空，不写「其他」：`other` 在折类判据里是「未知」，画成一个类别词会让人以为
   * 这一条被谁标成了「其他」类（站点分类里真有一个叫「其他」的类别，两者不是一回事）。
   */
  categoryKind: TCategoryKind | null;
}

/**
 * 这一组内容的分类：把两份原料放进同一个投票池，按 `sharedCategory` 折一次。
 *
 * 原料一是**下载器自己挂的分类**（每份副本一条票），原料二是**这些副本对应的辅种台账条目在各站上的
 * 叫法**（每一条任务只算一次，不按副本重复计票，否则辅了两批的那一条会把自己的票翻倍）。
 *
 * 为什么不自己写一套、也不定「谁压过谁」：这条判据早就有了 —— 站点条目的分类怎么折成规范类别、
 * 各站写法不同时按多的算、并列不猜，全在 `sharedCategory` 里（用户 2026-10-12 定的口径）。
 * 再写一份就会出现「下拉里说它是综艺、发送时按电视剧建目录」这种两句互相打脸。
 * 折不出来（`other`）的那几条不参与投票，是 `kindVotes` 本来的规矩：那是「未知」，
 * 既不该被当成一个类别，也不该去否决别人。
 */
function categoryKindOfGroup(
  members: ISeedValueRow[],
  taskByHash: Map<string, string>,
  ledgerOfGroup: Map<string, ICategorySource[]>,
  siteMapOf: TSiteCategoryMapOf,
): TCategoryKind | null {
  const pool: ICategorySource[] = [];
  const countedTasks = new Set<string>();
  for (const row of members) {
    if (row.category) pool.push({ category: row.category });
    const hash = typeof row.infoHash === "string" ? row.infoHash.trim().toLowerCase() : "";
    const group = hash ? taskByHash.get(hash) : undefined;
    if (group && !countedTasks.has(group)) {
      countedTasks.add(group);
      pool.push(...(ledgerOfGroup.get(group) ?? []));
    }
  }
  return sharedCategory(pool, siteMapOf).kind;
}

export function buildSeedValueItems(
  rows: ISeedValueRow[],
  hostSiteEntries: Iterable<readonly [string, string]>,
  tasks: IReseedTaskForGroup[],
  now: number,
  siteMapOf: TSiteCategoryMapOf,
): ISeedValueItem[] {
  const taskByHash = buildTaskGroups(tasks);
  const groupOf = assignContentGroups(rows, taskByHash);
  const entries = hostSiteEntries instanceof Map ? hostSiteEntries : new Map(hostSiteEntries);
  /** 组键（`t:<任务 id>`）→ 那一条台账里各站的分类叫法 */
  const ledgerOfGroup = new Map<string, ICategorySource[]>(
    (tasks ?? []).map((task) => [`t:${String(task.id)}`, (task.items ?? []) as ICategorySource[]]),
  );

  const grouped = new Map<string, ISeedValueRow[]>();
  for (const row of rows) {
    const key = groupOf.get(row.key) ?? row.key;
    const bucket = grouped.get(key);
    if (bucket) bucket.push(row);
    else grouped.set(key, [row]);
  }

  const items: ISeedValueItem[] = [];
  for (const [key, members] of grouped) {
    const copies: ISeedValueCopy[] = members.map((row) => {
      const host = trackerFieldToHost(row.tracker);
      const siteId = host ? resolveTrackerHostSite(host, entries) : undefined;
      return {
        ...(siteId ? { siteId } : {}),
        completed: row.completed,
        seeding: row.seeding,
        totalSize: row.totalSize,
        location: dataLocationKey(row),
        ...(row.swarmSeeders === undefined ? {} : { swarmSeeders: row.swarmSeeders }),
        ...(row.seedingSince === undefined ? {} : { seedingSince: row.seedingSince }),
        totalUploaded: row.totalUploaded,
        uploadSpeed: row.uploadSpeed,
      };
    });
    const verdict = judgeSeedValue({ copies, now });
    items.push({
      key,
      name: members[0]!.name,
      names: [...new Set(members.map((row) => row.name))],
      // 磁盘那一个数只由判据算一次：这里再折一遍 `Math.max` 就会与浮层里那句「占用」分成两套口径
      bytes: verdict.bytes,
      verdict,
      memberKeys: members.map((row) => row.key),
      categoryKind: categoryKindOfGroup(members, taskByHash, ledgerOfGroup, siteMapOf),
    });
  }
  return items;
}

/**
 * 分类下拉里该出现哪些档：**只列这批内容里真有的**，按 `CATEGORY_KINDS` 定序
 * （不按出现次数、也不按字面 —— 同一份数据两次打开顺序不该变，同辅种任务页那条）。
 *
 * 调用方传进来的那份**只能按名称筛过**，不能按分类或「只看低价值」筛过：拿筛完的算，选了「电影」之后
 * 下拉就只剩「电影」一档，人再也换不到别的类。三枚控件互不缩候选（与辅种任务页那两枚下拉同一口径）；
 * 名称那一栏参与缩候选是有道理的 —— 搜完剩下那几条里真有的类，才是要让人挑的。
 */
export function seedValueCategoryChoices(items: readonly ISeedValueItem[]): TCategoryKind[] {
  const present = new Set<TCategoryKind>();
  for (const item of items) {
    if (item.categoryKind) present.add(item.categoryKind);
  }
  return CATEGORY_KINDS.filter((kind) => present.has(kind));
}

/**
 * 名称搜索命中什么：这一组里出现过的**每一种写法**，大小写不敏感、两侧空白不算。
 * 与「辅种任务」那一屏的 `matchesTaskWord` 同一条口径（界面上看得见什么就搜什么，不做模糊/子序列）。
 */
export function matchesSeedWord(item: ISeedValueItem, word: string): boolean {
  const needle = word.trim().toLowerCase();
  if (!needle) return true;
  return item.names.some((name) => name.toLowerCase().includes(needle));
}

/**
 * 三条闸都是「与」：`word` = 名称搜索（空串 = 不筛），`lowOnly` = 只看低价值，`kind` 为 null = 不按分类筛。
 *
 * 抽成纯函数是因为「筛完只剩几条、分页还停在第 3 页」那一族 bug 只在界面上犯，
 * 判据本身先钉住，页面那一侧另有按源码文本的接线断言。
 */
export function filterSeedValueItems(
  items: readonly ISeedValueItem[],
  input: { word: string; lowOnly: boolean; kind: TCategoryKind | null },
): ISeedValueItem[] {
  return items.filter(
    (item) =>
      matchesSeedWord(item, input.word) &&
      (!input.lowOnly || item.verdict.tier === "low") &&
      (input.kind === null || item.categoryKind === input.kind),
  );
}

/**
 * 默认序：**时魔权重从低到高**（最该考虑的排最前），同值再按名称。
 *
 * 为什么不是从高到低：这一屏的用途是「哪些可以不再做种」，人进来是来找要处理的那几条的，
 * 不是来欣赏自己保了多少好种的。要反过来看，点那一列的排序键就行。
 */
export function sortSeedValueItems(items: readonly ISeedValueItem[]): ISeedValueItem[] {
  return [...items].sort((a, b) => a.verdict.weight - b.verdict.weight || a.name.localeCompare(b.name));
}
