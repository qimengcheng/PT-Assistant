/**
 * 表格行为公共 composable：把各页面 a-table 的「持久化排序 + 分页 + change 回写」
 * 从 configStore.tableBehavior 的读写收敛到一处。
 *
 * 背景：DownloadHistory / SearchResultSnapshot / SetSite / MyData / SearchEntity /
 * SetDownloader / SetSearchSolution 各自抄了一份几乎逐字相同的
 * persistedSort → antd sortOrder 换算、itemsPerPage 兜底（Vuetify 的 -1 非法值）、
 * handleTableChange 回写，修一处要改七八个文件。
 *
 * 用法：
 *   const { sortOrderOf, pagination, handleTableChange } = useTableBehavior("DownloadHistory");
 *   // column.sortOrder = sortOrderOf("downloadAt")
 *   // <a-table :pagination="pagination" @change="handleTableChange" />
 */
import { computed, toValue, type ComputedRef, type MaybeRefOrGetter } from "vue";
import type { TablePaginationConfig, TableSorterResult } from "antdv-next";

import { useConfigStore } from "@/options/stores/config.ts";
import { toPagination } from "@/options/components/tableSorters.ts";

type TSortOrder = "asc" | "desc";
interface ISortBy {
  key: string;
  order: TSortOrder;
}

interface IUseTableBehaviorOptions {
  /** itemsPerPage 缺失或为非法值（Vuetify 遗留 -1/0）时的兜底 */
  defaultPageSize?: number;
  /** 透传给 a-table pagination.size；不传则不带 size 键 */
  size?: "small" | "middle";
  /** 透传给 a-table pagination.showTotal */
  showTotal?: (total: number) => string;
  /** true 时持久化全部排序列（多列排序）；false（默认）只取第一列 */
  multiSort?: boolean;
  /**
   * 用户取消排序（sorter 为空）时是否写入 [] 清掉持久化排序。
   * 默认 false，保留 DownloadHistory/SetSite 等旧页面的行为（只写非空排序）；
   * SearchEntity / MyClient 需要「点第三下取消排序」，传 true。
   */
  clearOnEmpty?: boolean;
  /**
   * 当前要展示的条数（过滤后的）。传了就走「一页放得下就不出分页条」，
   * pagination 的类型也相应变成 `TablePaginationConfig | false`。
   */
  totalRows?: MaybeRefOrGetter<number>;
}

export function useTableBehavior(tableKey: string, options: IUseTableBehaviorOptions = {}) {
  const { defaultPageSize = 10, size, showTotal, multiSort = false, clearOnEmpty = false, totalRows } = options;
  const configStore = useConfigStore();

  const behavior: ComputedRef<{
    itemsPerPage?: number;
    columns?: string[];
    sortBy?: ISortBy[];
  }> = computed(() => (configStore.tableBehavior as Record<string, any>)[tableKey] ?? {});

  const itemsPerPage = computed(() => {
    const raw = behavior.value.itemsPerPage;
    // 旧版（Vuetify）用 -1 表示「不分页」；antd 前端分页 pageSize<=0 会 slice 出错、页数为负
    return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : defaultPageSize;
  });

  const sortBy = computed<ISortBy[]>(() => behavior.value.sortBy ?? []);

  /** configStore 里某列的排序状态 → antd 的受控 sortOrder */
  const sortOrderOf = (key: string): "ascend" | "descend" | null => {
    const found = sortBy.value.find((s) => s.key === key);
    if (!found) return null;
    return found.order === "asc" ? "ascend" : "descend";
  };

  // 分页统一走 tableSorters.toPagination（含 Vuetify -1/0 非法值守卫与 size/showTotal 透传）
  const pagination = computed<TablePaginationConfig | false>(() =>
    toPagination(itemsPerPage.value, defaultPageSize, {
      ...(size ? { size } : {}),
      ...(showTotal ? { showTotal } : {}),
      ...(totalRows === undefined ? {} : { totalRows: toValue(totalRows) }),
    }),
  );

  function handleTableChange(
    page: TablePaginationConfig,
    _filters: unknown,
    sorter: TableSorterResult | TableSorterResult[],
  ) {
    if (page.pageSize && page.pageSize !== itemsPerPage.value) {
      configStore.updateTableBehavior(tableKey, "itemsPerPage", page.pageSize);
    }

    const sorters = (Array.isArray(sorter) ? sorter : [sorter]).filter(
      (item) => item?.order && item?.columnKey,
    );
    if (sorters.length === 0 && !clearOnEmpty) {
      return;
    }

    const next = sorters.map((item) => ({
      key: String(item.columnKey),
      order: item.order === "descend" ? ("desc" as const) : ("asc" as const),
    }));
    configStore.updateTableBehavior(tableKey, "sortBy", multiSort ? next : next.slice(0, 1));
  }

  return {
    itemsPerPage,
    sortBy,
    sortOrderOf,
    pagination,
    handleTableChange,
  };
}
