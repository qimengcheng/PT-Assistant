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
import { isPageSizePicked, toPagination } from "@/options/components/tableSorters.ts";
import { useAutoFitPageSize } from "./useAutoFitPageSize.ts";

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
  /**
   * 按面板高度实测每页条数（用户 2026-10-08：「既不能出现滚动条又要把页面铺满」）。
   * 没挑过档时这一档就等于它，挑过档时它是上限 —— 见 toPagination 的 fitSize。
   */
  autoFit?: {
    container: MaybeRefOrGetter<HTMLElement | null | undefined>;
    rows: MaybeRefOrGetter<readonly unknown[] | null | undefined>;
    min?: number;
  };
  /**
   * 「不超过这么多条就整页放完、不出分页条」，透传给 toPagination 的同名硬档。
   * 与 autoFit 各管一头：autoFit 问「这一屏放得下几条」，这条问「这么点值不值得分页」。
   */
  maxSinglePage?: number;
}

export function useTableBehavior(tableKey: string, options: IUseTableBehaviorOptions = {}) {
  const {
    defaultPageSize = 10,
    size,
    showTotal,
    multiSort = false,
    clearOnEmpty = false,
    totalRows,
    autoFit,
    maxSinglePage,
  } = options;
  const configStore = useConfigStore();

  const behavior: ComputedRef<{
    itemsPerPage?: number;
    pageSizePicked?: boolean;
    columns?: string[];
    sortBy?: ISortBy[];
  }> = computed(() => (configStore.tableBehavior as Record<string, any>)[tableKey] ?? {});

  const itemsPerPage = computed(() => {
    const raw = behavior.value.itemsPerPage;
    // 旧版（Vuetify）用 -1 表示「不分页」；antd 前端分页 pageSize<=0 会 slice 出错、页数为负
    return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : defaultPageSize;
  });

  const sortBy = computed<ISortBy[]>(() => behavior.value.sortBy ?? []);

  /** 他有没有挑过一档 —— 挑过就用那一档，但实测容量仍是上限（见 toPagination 的 fitSize） */
  const pickedSize = computed(() =>
    isPageSizePicked(behavior.value.itemsPerPage, defaultPageSize, behavior.value.pageSizePicked),
  );

  // 挑过档也要继续量：那一档得拿实测容量当上限，不然他挑的 20 在一屏只放得下 15 时就把面板撑出滚动条
  const fitted = autoFit ? useAutoFitPageSize(autoFit).fitted : computed(() => 0);

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
      // fitSize 没启用时这两个键都不带，toPagination 走它原来那条判据，老页面一字不变
      ...(autoFit ? { fitSize: fitted.value, picked: pickedSize.value } : {}),
      ...(maxSinglePage ? { maxSinglePage } : {}),
    }),
  );

  function handleTableChange(
    page: TablePaginationConfig,
    _filters: unknown,
    sorter: TableSorterResult | TableSorterResult[],
  ) {
    // 「他改了尺寸」唯一的可靠信号是「报回来的档 ≠ 界面上正在显示的那一档」：翻页和排序
    // 同样会带着 pageSize 回来，而带的就是当前这一档（InternalTable 的 triggerOnChange 用
    // getPaginationParam 把 mergedPagination 原样递出来）。原先那句 `!== itemsPerPage.value`
    // 在没有实测档时等价，但开了 autoFit 之后显示的是实测档 —— 他一翻页就会被误判成
    // 「他挑了实测那一档」，从此永久锁死。分页条没出（false）时不可能改尺寸，一并跳过。
    const displayed = pagination.value === false ? 0 : pagination.value?.pageSize ?? 0;
    if (page.pageSize && displayed && page.pageSize !== displayed) {
      configStore.updateTableBehavior(tableKey, "itemsPerPage", page.pageSize);
      // 挑档 = 明确意图，从此不再被实测条数盖掉。只有开了 autoFit 的页才写这个标记，
      // 免得给没这功能的页面凭空多存一个键。
      if (autoFit) configStore.updateTableBehavior(tableKey, "pageSizePicked", true);
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
