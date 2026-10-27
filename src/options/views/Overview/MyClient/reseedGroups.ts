/**
 * 「同一个文件的多条副本」怎么认、折叠之后这一页该长什么样。
 *
 * 判据零依赖（不 import store、不发消息、不碰 DOM；只借 `@/shared/fingerprint/title` 那一份标题归一），
 * 这样它能在 Node 里被 Vitest 直接断言 —— 这一页原先的判据都长在组件里，改一次要开浏览器点一遍。
 *
 * **这里有两套并组判据，各管各的用途，不许互相顶替**：
 *
 * 一、`assignGroups`（折叠用，用户 2026-10-13 定的口径）两层判据：
 * ① 能对上一辅种任务台账的，进那一条任务的组 —— 这是精确的，不看字面像不像；
 * ② 没出现在任何辅种任务里的，按**内容指纹**成组：下载器 + 名称 + 大小 + 保存路径，四项全等才算同一份。
 *    少一项都不并（尤其不许只按名称+大小并）：折叠起来的那几条是**看不见**的，并错一条就等于把一条
 *    他需要看见的种子藏掉了，那比多占一行严重得多。带上下载器是因为这一页第一列就是下载器 ——
 *    跨下载器的同名条目是两件事，不该被一组吃掉。
 * ③ 同一个内容指纹只要已经被某个任务组占走，剩下那几条就并进那个任务组，不留「同一份内容两组」。
 *
 * 二、`assignContentGroups`（汇总用，v0.123.1 因用户报「做种站点算错」而加）：
 * 并的是**内容**，所以保存路径与下载器都不参与 —— 一片内容各站一份目录（qBittorrent 给每个站点
 * 建一个分类、分类各自带一条保存路径）时，一套按目录算的判据会把一条内容切成 N 项，界面上每一行
 * 只报「1 份副本 · 1 个站」。汇总不藏任何东西（组里每一条都还在份数与 `memberKeys` 里），
 * 所以它可以按内容并，也**应当**按内容并。
 *
 * 为什么反过来不行（汇总那套不许拿去折叠）：折叠会把组员从列表里摘掉，把两片碰巧同名同大小、
 * 实际各存一份的内容并起来就是藏掉一条他要找的种子 —— 那才是 `assignGroups` 收紧到四项全等的理由。
 */
import { buildTitleSizeKey, normalizeTitle } from "@/shared/fingerprint/title.ts";

/**
 * 台账里这一层吃的三样：任务 id、各条目的 infoHash、基准那条的 infoHash。
 *
 * `site` / `category` 是给「做种价值」那一屏折分类用的（它拿台账条目当分类的原料之一，
 * 见 `SeedValue/seedValueView.ts` 的 `categoryKindOfGroup`）—— 判组本身只看 hash，
 * 多带这两样不改变分组结论，所以这里放宽而不是另开一份类型。
 */
export interface IReseedTaskForGroup {
  id: string | number;
  items?: { hash?: string; site?: string; category?: string | number }[];
  baseLocal?: { hash?: string };
}

/** 列表里的一行参与判组要用的字段（`key` 由调用方给，本页用的是 `clientId:id`） */
export interface IRowForGroup {
  key: string;
  clientId: string;
  name: string;
  totalSize: number;
  savePath: string;
  infoHash?: string;
}

export interface IGroupMeta {
  /** 组键 */
  group: string;
  /** 组里一共几条（含折叠时没出现的那些） */
  count: number;
  /** 这一行是不是组的代表行（折叠态下唯一出现的那条） */
  anchor: boolean;
}

export interface ICollapseResult<T> {
  /** 该交给表格的行：折叠的组只留代表行，展开的组整组连着出现 */
  rows: T[];
  /**
   * 分页的**单位**：每项是一组必须同页出现的行。
   *
   * 为什么不直接拿 `rows` 分页（这一条就是用户 2026-10-26 报的那个坏法）：表格按固定步长切
   * 摊平后的数组，展开一组会一次多出 N 行，页边界落在组中间 ⇒ 「6 条同内容」点开只画出 4 条，
   * 剩下两条在下一页。单位切法结构上劈不开一组。
   *
   * 折叠的组 = 1 个单位（只有代表行）、展开的组 = 1 个单位（含全部组员，行数不止一行）、
   * 不成组的行 = 1 个单位（一行）。所以**没有展开时 `units.length === rows.length`**，
   * 分页总数与改动前一字不差；展开也不改变单位数 —— 这正是「一屏放得下的条目变多了」那句话。
   */
  units: T[][];
  /** 行 key → 组信息；不属于任何组（或组里只有一条）的行不在里面 */
  meta: Map<string, IGroupMeta>;
  /** 组键 → 组内全部行 key，勾选代表行时要连着这些一起算 */
  members: Map<string, string[]>;
}

/** 内容指纹。用 \0 分隔：名称与路径里都可能出现冒号、空格，拼成 `a:b` 那种串会撞 */
export function contentFingerprint(row: IRowForGroup): string {
  return `${row.clientId}\u0000${row.name}\u0000${row.totalSize}\u0000${row.savePath}`;
}

/**
 * 台账 → `infoHash（小写）→ 组键`。
 *
 * 旧任务没有 `items[].hash`（界面上那一条写的就是「未记录 infoHash」），这里只能跳过 ——
 * 那几条退到内容指纹那条路，不假装认得。
 */
export function buildTaskGroups(tasks: IReseedTaskForGroup[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const task of tasks ?? []) {
    const group = `t:${String(task.id)}`;
    for (const item of task.items ?? []) {
      const hash = typeof item?.hash === "string" ? item.hash.trim().toLowerCase() : "";
      if (hash) out.set(hash, group);
    }
    const baseHash = typeof task.baseLocal?.hash === "string" ? task.baseLocal.hash.trim().toLowerCase() : "";
    if (baseHash) out.set(baseHash, group);
  }
  return out;
}

/**
 * 给每一行定组键（两层判据 + 第 ③ 条并组）。
 *
 * @returns 行 key → 组键；只有一条的「组」返回 null（没有可折叠的东西，别给它挂标记）
 */
export function assignGroups<T extends IRowForGroup>(
  rows: T[],
  taskByHash: Map<string, string>,
): Map<string, string | null> {
  // 第一遍：认台账。同时记下「哪些内容指纹已经被任务组占了」→ 并进哪个组
  const groupOf = new Map<string, string>();
  const taskGroupOfFingerprint = new Map<string, string>();
  for (const row of rows) {
    const hash = typeof row.infoHash === "string" ? row.infoHash.trim().toLowerCase() : "";
    const group = hash ? taskByHash.get(hash) : undefined;
    if (group) {
      groupOf.set(row.key, group);
      // 一个指纹对上多个任务组时（他把同一份内容辅了两批）认第一个认到的：
      // 至少不会凭空多出一组，判据也仍然唯一。
      const fp = contentFingerprint(row);
      if (!taskGroupOfFingerprint.has(fp)) taskGroupOfFingerprint.set(fp, group);
    }
  }
  // 第二遍：没认上的按内容指纹成组；指纹与某个任务组重合的直接并进那个任务组
  const groupOfFingerprint = new Map<string, string>();
  for (const row of rows) {
    if (groupOf.has(row.key)) continue;
    const fp = contentFingerprint(row);
    const owner = taskGroupOfFingerprint.get(fp);
    if (owner) {
      groupOf.set(row.key, owner);
      continue;
    }
    let group = groupOfFingerprint.get(fp);
    if (!group) {
      group = `c:${fp}`;
      groupOfFingerprint.set(fp, group);
    }
    groupOf.set(row.key, group);
  }
  // 第三遍：组里只有一条的退回「不成组」
  const counts = new Map<string, number>();
  for (const group of groupOf.values()) counts.set(group, (counts.get(group) ?? 0) + 1);
  const out = new Map<string, string | null>();
  for (const [key, group] of groupOf) out.set(key, (counts.get(group) ?? 0) > 1 ? group : null);
  return out;
}

/**
 * 这一份数据**实际落在哪一处**：下载器 + 保存路径。
 *
 * 给「做种价值」那一屏算磁盘用：同一处里的几份副本（辅种到同一个目录）只占一份字节，
 * 不同处各占一份。分隔符与 `contentFingerprint` 同一做法（路径里什么都有，`a:b` 那种串会撞）。
 */
export function dataLocationKey(row: IRowForGroup): string {
  return `${row.clientId}\u0000${row.savePath}`;
}

/**
 * 一行属于哪份**内容**：归一化标题 + 字节，与可辅种扫描、一键辅种基准、本地指纹第 1 层
 * **同一条算式**（`buildTitleSizeKey`）。各处各折一套就会「扫描说查到了，这一屏却分成两条」。
 *
 * 名称折不出可用信息时返回 **null** —— 那时这条算式只剩大小，而「大小相同」不等于「内容相同」
 * （`normalizeTitle` 对纯符号名给空串，本地指纹那一层也专门把这种 key 标成证据更弱的一档）。
 * null 的这一行谁也不并，只跟自己成一组；它仍然能被台账并上，因为台账是精确证据。
 */
export function contentIdentityKey(row: IRowForGroup): string | null {
  return normalizeTitle(row.name) ? buildTitleSizeKey(row.name, row.totalSize) : null;
}

/**
 * 给每一行定「内容组」键（汇总用，见文件头那两套判据的第二套）。
 *
 * 两条并组路（与 `assignGroups` 同构，只是单位换成内容）：
 * ① 名称归一后 + 字节相同的行并一组；
 * ② 同一条辅种台账里的行并一组 —— 这一条补的是①看不见的形状：站点自己改过标题（加/减一个词）、
 *    或两片内容字节不完全一样但确属同一批辅种。
 * 两条叠用所以要走并查集：`A↔B`（台账）而 `B↔C`（同名同大小）时三条是一组，
 * 不能出现「同一份内容两组」。
 *
 * @returns 行 key → 组键。与 `assignGroups` 不同，**每一条都有组键**（汇总不需要「不成组」这一档，
 *   单条内容的组就是那一条）。组键取组内最小的行键，所以行的先后不影响键本身。
 */
export function assignContentGroups<T extends IRowForGroup>(rows: T[], taskByHash: Map<string, string>): Map<string, string> {
  const parent = new Map<string, string>();
  for (const row of rows) {
    if (!parent.has(row.key)) parent.set(row.key, row.key);
  }
  /** 找根，顺手做路径减半：几百条种子连成一条链时不让 find 退化成 O(n) */
  const find = (key: string): string => {
    let cur = key;
    let next = parent.get(cur);
    while (next !== undefined && next !== cur) {
      const grand = parent.get(next);
      if (grand !== undefined && grand !== next) parent.set(cur, grand);
      cur = next;
      next = parent.get(cur);
    }
    return cur;
  };
  const union = (a: string, b: string) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootB, rootA);
  };

  const firstOfContent = new Map<string, string>();
  const firstOfTask = new Map<string, string>();
  for (const row of rows) {
    const content = contentIdentityKey(row);
    if (content) {
      const anchor = firstOfContent.get(content);
      if (anchor) union(anchor, row.key);
      else firstOfContent.set(content, row.key);
    }
    const hash = typeof row.infoHash === "string" ? row.infoHash.trim().toLowerCase() : "";
    const task = hash ? taskByHash.get(hash) : undefined;
    if (task) {
      const anchor = firstOfTask.get(task);
      if (anchor) union(anchor, row.key);
      else firstOfTask.set(task, row.key);
    }
  }

  const repOfRoot = new Map<string, string>();
  for (const row of rows) {
    const root = find(row.key);
    const current = repOfRoot.get(root);
    if (current === undefined || row.key < current) repOfRoot.set(root, row.key);
  }
  const out = new Map<string, string>();
  for (const row of rows) out.set(row.key, repOfRoot.get(find(row.key))!);
  return out;
}

/**
 * 这一行所在的组里一共有哪几行（含它自己）。
 *
 * 不属于任何组、或组里只有一条时返回**空数组** —— 调用方据此判「要不要把整组一起端出去」，
 * 不用自己再比一次长度。`members` 里是组内全部行 key，包括折叠态下没出现在列表里的那些，
 * 所以这一句也回答了「看不见的那几条算不算」：算。
 */
export function groupSiblingsOf(key: string, meta: Map<string, IGroupMeta>, members: Map<string, string[]>): string[] {
  const info = meta.get(key);
  if (!info) return [];
  const list = members.get(info.group) ?? [];
  return list.length > 1 ? list : [];
}

/**
 * 把**已经排好序**的行重排成「同组相邻」，并按折叠状态决定组员出不出现。
 *
 * 组的位置 = 组内第一条在输入里的位置；组内顺序 = 它们在输入里的相对顺序。
 * 所以调用方负责排序（本页按用户选的排序键排完再进来），这里不重新排。
 */
export function collapseGroups<T extends IRowForGroup>(
  sorted: T[],
  groupOf: (row: T) => string | null,
  expanded: Set<string>,
): ICollapseResult<T> {
  const members = new Map<string, string[]>();
  const byGroup = new Map<string, T[]>();
  for (const row of sorted) {
    const group = groupOf(row);
    if (!group) continue;
    const list = byGroup.get(group);
    if (list) list.push(row);
    else byGroup.set(group, [row]);
    const keys = members.get(group);
    if (keys) keys.push(row.key);
    else members.set(group, [row.key]);
  }

  const meta = new Map<string, IGroupMeta>();
  for (const [group, list] of byGroup) {
    if (list.length < 2) continue;
    list.forEach((row, i) => meta.set(row.key, { group, count: list.length, anchor: i === 0 }));
  }

  const emitted = new Set<string>();
  const rows: T[] = [];
  const units: T[][] = [];
  for (const row of sorted) {
    const info = meta.get(row.key);
    if (!info) {
      rows.push(row);
      units.push([row]);
      continue;
    }
    if (!info.anchor) continue; // 组员由代表行那一次一起放出
    if (emitted.has(info.group)) continue;
    emitted.add(info.group);
    const list = byGroup.get(info.group) ?? [row];
    // 展开的组放整组、折叠的只放代表行 —— 两者都是**一个**分页单位（见 ICollapseResult.units）
    const unit = expanded.has(info.group) ? list : [row];
    rows.push(...unit);
    units.push(unit);
  }
  return { rows, units, meta, members };
}

/**
 * 这一页该出现第几页：把越界的页码夹回来。
 *
 * 为什么需要单独一步：筛条件、删条目都会让单位数变小，而页码是受控状态（只由翻页回调写）。
 * 停在第 5 页而只剩 2 页时，不夹就会切出一个空数组 —— 界面表现为「筛到什么都没有」，
 * 看着像筛坏了。与这一页原本那句「换筛选条件要回到第 1 页」是同一族，只是那条管的是主动筛，
 * 这一条管「单位数自己变小了」（展开一组不改变单位数，所以不会走到这里）。
 */
export function clampUnitPage(current: number, unitCount: number, pageSize: number): number {
  const size = Number.isFinite(pageSize) && pageSize >= 1 ? Math.floor(pageSize) : 1;
  const pages = Math.max(1, Math.ceil(unitCount / size));
  const page = Number.isFinite(current) ? Math.floor(current) : 1;
  return Math.min(Math.max(1, page), pages);
}

/**
 * 切出某一页要交给表格的那些行。
 *
 * 一条硬判据：**一个单位绝不跨页**，哪怕这一组有 19 条、一页容量只有 11 条 —— 放不下就整组
 * 画出来并让面板出滚动条（用户 2026-10-26：「这种情况不受不能出现滚动条的约束」，
 * 与他 2026-10-18 那句「展开造成的滚动条不用管」同一条取向）。
 */
export function sliceUnitsToPage<T>(units: readonly T[][], current: number, pageSize: number): T[] {
  const size = Number.isFinite(pageSize) && pageSize >= 1 ? Math.floor(pageSize) : 1;
  const page = clampUnitPage(current, units.length, size);
  return units.slice((page - 1) * size, page * size).flat();
}
