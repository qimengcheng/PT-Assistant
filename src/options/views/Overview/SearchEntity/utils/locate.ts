/**
 * 「跳到那几行」的两半：算出目标行在**当前排序下**落在第几页，以及把那一行滚进视野。
 *
 * 为什么要自己算：a-table 是「先把整份数据排完，再切当前页」（`InternalTable.js` 里
 * `pageData = mergedData.slice((current-1)*pageSize, ...)`，而 `mergedData` 已是排过序的），
 * 所以目标行不在这一页时，`scrollIntoView` 根本找不到那个节点 —— 得先把页码切过去。
 *
 * 纯判据这一半不碰 DOM，能直接拿 Node 跑断言（`.tmp-build/locate-test.mjs`）；
 * 滚那一下要碰真 DOM，由台架 `.tmp-build/bench-locate` 挂真 `a-table` 验。
 */

/** 一列的比较函数：直接从渲染出去的那份列定义里取，**不另算一套** */
export interface ILocateColumn<T = unknown> {
  key: string;
  compare?: (a: T, b: T) => number;
}

export interface ILocateSortItem {
  key: string;
  order: "asc" | "desc";
}

export interface ILocateInput<T> {
  rows: readonly T[];
  /** 当前生效的排序（configStore 里那份 `sortBy`，按点击先后排） */
  spec: readonly ILocateSortItem[];
  /** 渲染出去的那几列，顺序 = 表头里的左右顺序 */
  columns: readonly ILocateColumn<T>[];
  isTarget: (row: T) => boolean;
  pageSize: number;
}

export interface ILocateResult {
  /** 排序后的下标；-1 = 这一批里没有它 */
  index: number;
  /** 1 起的页码；index 为 -1 时是 null */
  page: number | null;
}

/**
 * 目标行在当前排序下的下标与页码。
 *
 * 多列排序的先后照 antd 那条来：`useSorter` 里
 * `sortStates.slice().sort((a, b) => b.multiplePriority - a.multiplePriority)`，
 * 而 `toTableColumns` 给的 `multiplePriority` 是**列在表头里的序号 + 1** —— 也就是靠右那一列先比，
 * 点击顺序只决定「哪些列参与」，不决定谁优先。（这条是读 `dist/table/hooks/useSorter.js` 得来的，
 * 台架 `.tmp-build/bench-locate` 拿真 a-table 渲染出的顺序逐行对过。）
 *
 * 排序里写了、但已被「列显隐」藏掉的列不参与 —— 那一列压根没有 sorter。
 */
export function pageOfSortedRows<T>(input: ILocateInput<T>): ILocateResult {
  const { rows, spec, columns, isTarget, pageSize } = input;
  const chain = spec
    .map((item) => {
      const priority = columns.findIndex((column) => column.key === item.key);
      const compare = priority >= 0 ? columns[priority].compare : undefined;
      // 没有比较函数的列不参与（antd 那边 `getSortFunction(sorter)` 判不过的同样会被跳过）
      return typeof compare === "function" ? { priority, order: item.order, compare } : null;
    })
    .filter(
      (one): one is { priority: number; order: "asc" | "desc"; compare: (a: T, b: T) => number } => one !== null,
    )
    .sort((a, b) => b.priority - a.priority);

  const sorted = [...rows];
  if (chain.length > 0) {
    sorted.sort((a, b) => {
      for (const one of chain) {
        const result = one.compare(a, b);
        if (result !== 0) return one.order === "desc" ? -result : result;
      }
      return 0;
    });
  }

  const index = sorted.findIndex(isTarget);
  if (index < 0) return { index: -1, page: null };
  // 分页条没出（放得下全部）时调用方给的就是整份条数，那一页就是第 1 页
  const size = Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : sorted.length || 1;
  return { index, page: Math.floor(index / size) + 1 };
}

/**
 * 从渲染出去的那份 antd 列定义里取出「列顺序 + 各自的比较函数」。
 *
 * 单独一个函数是为了让页面和台架走同一份取法：`toTableColumns` 在开了多列排序时把 sorter 包成
 * `{ compare, multiple }`，没开时直接就是那个 compare 函数 —— 两种形状都得吃下，
 * 抄一遍就会在某一档上静默拿到 undefined、于是那一列不参与排序。
 */
/** 这一函数只吃渲染出去的列定义里那两件，其余字段一概不看 */
type TPushedColumn = { key?: unknown; sorter?: unknown };

export function pickSortColumns<T>(columns: readonly TPushedColumn[]): ILocateColumn<T>[] {
  return columns.map((column) => {
    // 断言到比较函数这一步是必要的：sorter 在 antd 那边是 boolean | CompareFn | {compare, multiple}
    // 三档联合，而下面两道 typeof 已经把它收窄到「是函数」/「对象且 compare 是函数」两档。
    const sorter = column.sorter;
    const compare =
      typeof sorter === "function"
        ? (sorter as (a: T, b: T) => number)
        : sorter && typeof sorter === "object" && typeof (sorter as { compare?: unknown }).compare === "function"
          ? (sorter as { compare: (a: T, b: T) => number }).compare
          : undefined;
    return { key: String(column.key ?? ""), compare };
  });
}

/**
 * 把 `row-key` 等于这个值的那一行滚进视野。
 *
 * `row-key` 在 rc-table 里会渲染成 `tr[data-row-key]`（`@v-c/table/dist/body/BodyRow.js`），
 * 所以按 uniqueId 找得到。**不用属性选择器拼字符串** —— 那个值是「站点 + 种子 id + 入口 key」
 * 拼出来的，转义漏一次就是查不到；这里遍历比对属性值。
 * 找不到就返回 false：不猜是哪一行、也不弹一条「没找到」的假提示。
 */
export function scrollRowIntoView(root: ParentNode | null | undefined, rowKey: string): boolean {
  const key = String(rowKey ?? "");
  if (!root || key === "") return false;
  for (const el of Array.from(root.querySelectorAll("tr[data-row-key]"))) {
    if (el.getAttribute("data-row-key") !== key) continue;
    // 不用 smooth：这一步前面刚换过页、也刚换过排序，列表整片重绘过了，从当前这一帧平滑滚过去
    // 只会让人看不清自己跳到了哪；瞬时到位反而对。（全局样式里没有 `scroll-behavior: smooth`，
    // 所以不写 behavior 就是即刻到位，台架也正是这样量到它落进可视区的。）
    el.scrollIntoView({ block: "center" });
    return true;
  }
  return false;
}
