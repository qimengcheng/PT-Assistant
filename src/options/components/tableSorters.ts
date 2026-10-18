/**
 * antd 表格与 configStore.tableBehavior 之间的公共适配工具。
 *
 * 背景：MyData / SearchEntity / MyClient / DownloadHistory / SearchResultSnapshot /
 * SetSite / SetDownloader / SetSearchSolution / HistoryDataViewDialog 这些页面
 * 各自抄了一份几乎逐字相同的「sortOrder 换算 + 列生成 + change 回写 + 分页」，
 * 修一处 bug 要改八九个文件，且很容易漏（MyClient 就是因为漏抄，表格完全没有排序功能）。
 * 这里收敛成单一实现，各页面只提供自己的表头定义与 key。
 */
import type { TableColumnsType, TablePaginationConfig } from "antdv-next";

/** vuetify 的 order 是 asc/desc，antd 的 SortOrder 是 ascend/descend */
export function toAntdSortOrder(order: "asc" | "desc" | undefined | null): "ascend" | "descend" | null {
  if (order === "asc") return "ascend";
  if (order === "desc") return "descend";
  return null;
}

/** 嵌套 key 取值（"siteUserConfig.sortIndex" → item.siteUserConfig.sortIndex） */
function getByPath(row: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((acc, k) => (acc == null ? acc : (acc as Record<string, unknown>)[k]), row);
}

/**
 * 通用比较器：数值优先，回退中文字符串比较。
 * 对象类型的单元格（如 SearchEntity 的 category: { name }）取其 name 字段参与比较。
 *
 * ⚠️ antd 受控排序必须提供真正的 compare 函数——`sorter: true` 无 compare 时
 * antd 内部 getSortFunction 返回 false，排序器被静默跳过（箭头动、数据不排）。
 * 见 AGENTS.md 里记的 antdv-next 踩坑表。
 */
export function makeSorter<T>(path: string) {
  return (a: T, b: T): number => {
    const pick = (row: T) => {
      const v = getByPath(row, path);
      return v && typeof v === "object" ? ((v as { name?: unknown }).name ?? "") : v;
    };
    const ra = pick(a);
    const rb = pick(b);
    const na = typeof ra === "number" ? ra : Number.parseFloat(ra as string);
    const nb = typeof rb === "number" ? rb : Number.parseFloat(rb as string);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    return String(ra ?? "").localeCompare(String(rb ?? ""), "zh-CN");
  };
}

/**
 * 本地表头 = 适配层自己消费的四个字段。
 *
 * 这里**故意不带索引签名**：列定义上还夹带着 title / width / align / ellipsis /
 * customRender 等一整套 antd 列字段，它们只被原样透传，结构上无可校验（页面写在
 * `computed(() => [...])` 的字面量数组里，`align: "center"` 早已被放宽成 `string`，
 * 套 antd 的 `AlignType` 会让每个页面都报错）。加了索引签名还会连带要求
 * 「源类型必须有隐式索引签名」，页面那三个 `interface ITableHeader` 全得改写。
 * 所以这一层只钉住 key / sortable / sortOrder / compare —— 那个「不带 sortOrder 键
 * 才是非受控」的语义必须由类型保证，不能靠约定。
 */
export type TLocalColumnHeader<T> = {
  key: string;
  /** 默认 true，只有显式 false 的列不排（action 列那类） */
  sortable?: boolean;
  /** Vuetify 表头残留：列显隐多选里用它标记「这一列不许隐藏」，适配层只负责丢掉它 */
  props?: { disabled?: boolean };
  sortOrder?: "ascend" | "descend" | null;
  /** 显示值 ≠ 存储值时自带比较函数，会顶掉按 dataIndex 取值的默认实现 */
  compare?: (a: T, b: T) => number;
};

/**
 * 把「本地表头定义」转成 antd columns。
 *
 * 会原样保留表头里的其余字段（title / width / align / ellipsis / className /
 * defaultSortOrder / customRender 等），只统一补上 dataIndex、sorter、sortOrder。
 *
 * @param header 本地表头（key/title/align/width/sortable/props.disabled，可夹带任意 antd 列字段；
 *               给了 `compare` 的列用自带的比较函数 —— 显示值与存储值不是一回事的列需要它，
 *               例如搜索结果页的「分类」：格子里是折过的规范类别，排序要按规范类别排）
 * @param sortOrderMap 列 key → antd sortOrder（受控排序时传入；未出现在 map 中的列不带 sortOrder，保持非受控）
 * @param options.multiSort 多列排序：sortable 列的 sorter 包装为 { compare, multiple: 列序号 + 1 }
 */
export function toTableColumns<T>(
  header: ReadonlyArray<TLocalColumnHeader<T>>,
  sortOrderMap: Record<string, "ascend" | "descend" | null> = {},
  options: { multiSort?: boolean } = {},
): TableColumnsType<T> {
  return header.map(
    ({ props: _props, sortable, sortOrder: explicitSortOrder, compare: customCompare, ...rest }, colIdx) => {
      const compare = customCompare ?? makeSorter<T>(rest.key);
      const sortOrder = explicitSortOrder !== undefined ? explicitSortOrder : sortOrderMap[rest.key];

      return {
        ...rest,
        key: String(rest.key),
        // 嵌套路径（如 siteUserConfig.sortIndex）用数组形式，antd 才会正确取值 / 排序
        dataIndex: String(rest.key).split("."),
        // 默认所有列可排序，只有显式 sortable: false 的例外
        sorter:
          sortable === false
            ? false
            : options.multiSort
              ? { compare, multiple: colIdx + 1 }
              : compare,
        // 只给受控页面里持久化了排序状态的列带 sortOrder；其余列不带此键，保持非受控
        // （如弹窗里只用 defaultSortOrder 声明初始排序的场景——带 null 会被 antd 判为受控、点击不生效）
        ...(sortOrder !== undefined ? { sortOrder } : {}),
      };
    },
    // 透传袋子里的值在类型上是 unknown，与 antd 列的具体 prop 类型不可比 —— 这一处断言
    // 跨过的是「原样保留未知列字段」这件事本身，不是把校验漏给了自己写的四个字段。
  ) as unknown as TableColumnsType<T>;
}

/**
 * 把 configStore 里的 sortBy（[{key, order}]）转成 antd 的列 sortOrder map。
 */
export function buildSortOrderMap(
  sortBy: { key: string; order: "asc" | "desc" }[] | undefined,
): Record<string, "ascend" | "descend" | null> {
  const out: Record<string, "ascend" | "descend" | null> = {};
  for (const s of sortBy ?? []) {
    out[s.key] = s.order === "desc" ? "descend" : "ascend";
  }
  return out;
}

/**
 * 分页配置。
 *
 * ⚠️ 必须兜底成正整数：旧版（Vuetify）用 -1 表示「不分页」，这个约定被搬进了
 * config 默认值，但 antd Table 是前端分页，pageSize=-1 会让 slice(0, -1) 吃掉最后一行、
 * 页数算成负数。
 *
 * extras.size / extras.showTotal 透传给 a-table 的 pagination，不传则不带对应键。
 * extras.extraConfig 是给受控分页（current / onChange / total）留的口子。
 *
 * **extras.totalRows 一传就启用「一页放得下就不出分页条」**（用户 2026-10-07 的口径，
 * 原先只有站点管理页有）。判"用户挑过一档"的依据是存下来的正数**不等于本页默认档** ——
 * 因为一旦他挑过一档，分页条就要常驻：否则挑一档大到放得下全部，分页条连同尺寸选择器
 * 一起消失，就再也切不回小档了（这条取舍最早在 SetSite 上定下）。
 *
 * **extras.fitSize 一传就启用「按面板高度实测每页条数」**（useAutoFitPageSize，用户
 * 2026-10-08）。它和「挑过一档」的关系是（用户 2026-10-18 改的口径）：
 * 没挑过档 → 这一档就等于实测容量（一进这一页就是「铺满、不出滚动条」那一档）；
 * 挑过档 → **照他那一档，容量压不住它**（挑 50 就画 50 条，那一屏放不下就出滚动条 ——
 * 手动挑过之后是他的明确意图，比「不许出滚动条」优先）。
 * 「挑过档」现在是**本次进入这一页之内**的事，不持久：重新进来又回到实测铺满那一档。
 * 所以传 fitSize 就要同时传 picked（由调用方那份页内状态给），不再从存下来的档里猜。
 */
export function toPagination(
  itemsPerPage: unknown,
  fallback = 10,
  extras: {
    size?: "small" | "middle";
    showTotal?: (total: number) => string;
    totalRows?: number;
    extraConfig?: TablePaginationConfig;
    fitSize?: number;
    picked?: boolean;
    /**
     * 「不超过这么多条就整页放完、不出分页条」——按页给的硬档，优先于 fitSize。
     *
     * 为什么要它而只靠 fitSize：fitSize 是「面板实高 ÷ 行高」量出来的，我的数据那页量到 13，
     * 于是 19 个站被切成两页 —— 而他要的是这个页数不到 50 就别分页（面板自己滚）。
     * 两条判据不是一回事：一条问「放得下吗」，一条问「值不值得分页」。
     */
    maxSinglePage?: number;
  } = {},
): TablePaginationConfig | false {
  const raw = itemsPerPage;
  const usable = typeof raw === "number" && Number.isFinite(raw) && raw > 0;
  const stored = usable ? raw : fallback;
  const pickedASize = extras.picked ?? (usable && raw !== fallback);
  const fit = typeof extras.fitSize === "number" && extras.fitSize > 0 ? extras.fitSize : 0;
  const pageSize = fit ? (pickedASize ? stored : fit) : stored;
  if (extras.totalRows !== undefined && !pickedASize) {
    if (extras.maxSinglePage && extras.totalRows <= extras.maxSinglePage) {
      return false;
    }
    if (extras.totalRows <= pageSize) {
      return false;
    }
  }
  return {
    pageSize,
    showSizeChanger: true,
    ...(extras.size ? { size: extras.size } : {}),
    ...(extras.showTotal ? { showTotal: extras.showTotal } : {}),
    ...(extras.extraConfig ?? {}),
  };
}