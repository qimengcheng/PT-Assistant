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
function getByPath(row: any, path: string): any {
  return path.split(".").reduce<any>((acc, k) => (acc == null ? acc : acc[k]), row);
}

/**
 * 通用比较器：数值优先，回退中文字符串比较。
 * 对象类型的单元格（如 SearchEntity 的 category: { name }）取其 name 字段参与比较。
 *
 * ⚠️ antd 受控排序必须提供真正的 compare 函数——`sorter: true` 无 compare 时
 * antd 内部 getSortFunction 返回 false，排序器被静默跳过（箭头动、数据不排）。
 * 见 AGENTS.md 里记的 antdv-next 踩坑表。
 */
export function makeSorter<T = any>(path: string) {
  return (a: T, b: T): number => {
    const pick = (row: T) => {
      const v = getByPath(row, path);
      return v && typeof v === "object" ? ((v as any).name ?? "") : v;
    };
    const ra = pick(a);
    const rb = pick(b);
    const na = typeof ra === "number" ? ra : Number.parseFloat(ra);
    const nb = typeof rb === "number" ? rb : Number.parseFloat(rb);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    return String(ra ?? "").localeCompare(String(rb ?? ""), "zh-CN");
  };
}

/**
 * 把「本地表头定义」转成 antd columns。
 *
 * 会原样保留表头里的其余字段（title / width / align / ellipsis / className /
 * defaultSortOrder / customRender 等），只统一补上 dataIndex、sorter、sortOrder。
 *
 * @param header 本地表头（key/title/align/width/sortable/props.disabled，可夹带任意 antd 列字段）
 * @param sortOrderMap 列 key → antd sortOrder（受控排序时传入；未出现在 map 中的列不带 sortOrder，保持非受控）
 * @param options.multiSort 多列排序：sortable 列的 sorter 包装为 { compare, multiple: 列序号 + 1 }
 */
export function toTableColumns<T = any>(
  header: Array<Record<string, any>>,
  sortOrderMap: Record<string, "ascend" | "descend" | null> = {},
  options: { multiSort?: boolean } = {},
): TableColumnsType<T> {
  return header.map(({ props: _props, sortable, sortOrder: explicitSortOrder, ...rest }, colIdx) => {
    const compare = makeSorter<T>(rest.key);
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
  }) as TableColumnsType<T>;
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
 */
export function toPagination(
  itemsPerPage: unknown,
  fallback = 10,
  extras: { size?: "small" | "middle"; showTotal?: (total: number) => string } = {},
): TablePaginationConfig {
  const raw = itemsPerPage;
  const pageSize = typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : fallback;
  return {
    pageSize,
    showSizeChanger: true,
    ...(extras.size ? { size: extras.size } : {}),
    ...(extras.showTotal ? { showTotal: extras.showTotal } : {}),
  };
}