/**
 * 「同一个文件的多条副本」怎么认、折叠之后这一页该长什么样。
 *
 * 判据零依赖（不 import store、不发消息、不碰 DOM），这样它能在 Node 里被 Vitest 直接断言
 * —— 这一页原先的判据都长在组件里，改一次要开浏览器点一遍。
 *
 * 两层判据（用户 2026-10-13 定的口径）：
 * ① 能对上一辅种任务台账的，进那一条任务的组 —— 这是精确的，不看字面像不像；
 * ② 没出现在任何辅种任务里的，按**内容指纹**成组：下载器 + 名称 + 大小 + 保存路径，四项全等才算同一份。
 *    少一项都不并（尤其不许只按名称+大小并）：折叠起来的那几条是**看不见**的，并错一条就等于把一条
 *    他需要看见的种子藏掉了，那比多占一行严重得多。带上下载器是因为这一页第一列就是下载器 ——
 *    跨下载器的同名条目是两件事，不该被一组吃掉。
 * ③ 同一个内容指纹只要已经被某个任务组占走，剩下那几条就并进那个任务组，不留「同一份内容两组」。
 */

/** 台账里这一层只吃三样：任务 id、各条目的 infoHash、基准那条的 infoHash */
export interface IReseedTaskForGroup {
  id: string | number;
  items?: { hash?: string }[];
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
  for (const row of sorted) {
    const info = meta.get(row.key);
    if (!info) {
      rows.push(row);
      continue;
    }
    if (!info.anchor) continue; // 组员由代表行那一次一起放出
    if (emitted.has(info.group)) continue;
    emitted.add(info.group);
    const list = byGroup.get(info.group) ?? [row];
    if (expanded.has(info.group)) rows.push(...list);
    else rows.push(row);
  }
  return { rows, meta, members };
}
