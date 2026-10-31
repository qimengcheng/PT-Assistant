import { computed } from "vue";
import { type ITorrentTag } from "@ptd/site";

import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { useTableCustomFilter } from "@/options/directives/useAdvanceFilter.ts";

const runtimeStore = useRuntimeStore();

export const tableCustomFilter = useTableCustomFilter({
  parseOptions: {
    keywords: ["site", "tags", "status"],
    ranges: ["time", "size", "seeders", "leechers", "completed"],
  },
  titleFields: ["title", "subTitle"],
  initialItems: computed(() => runtimeStore.search.searchResult),
  format: {
    tags: {
      /**
       * 标签列两种写法都出现过：`{ name, type }` 对象与纯字符串（各站解析结果不一样），
       * 所以参数是 `unknown` 再自己收窄 —— 原先标的是 `ITorrentTag | string`，
       * 而 `IValueFormat.parse` 现在要求「吃得下任何列值」，窄参数在逆变下会被拒（实测）。
       * 对象又没有 name 时折成空串：原来会把整个对象交给字符串比较去 `regex.test()`。
       */
      parse: (value: unknown) =>
        typeof value === "object" && value !== null ? ((value as ITorrentTag).name ?? "") : String(value ?? ""),
    },
    time: "date",
    size: "size",
    /**
     * 上传/下载/完成人数：**只给 build，不给 parse**。
     *
     * 为什么必须给 build：`stringifyFilterDictFn` 把区间交给 search-query-parser 拼串，而它
     * 对**数字 0** 是整条丢弃的（实测 `stringify({seeders:{from:0,to:0}})` 出空串，
     * 写成字符串 `"0"` 才出 `seeders:0-0`）。于是「把某一档拖到 0 ~ 0」点生成等于没筛 ——
     * 表格那样，新加的实时预览也照着那样（预览与表格同源，所以预览没算错）。
     *
     * 为什么不能顺手改成 `format: "number"`：那份的 parse 会把**条目自己的值**也转成字符串，
     * `checkRangeValue` 就变成字符串比较 —— `"14" <= "9"` 按字典序是 true，多位数的上界全错。
     * 只改 build 才够：出去时是字符串，回来时条目值仍是数字，比较走数值。
     */
    seeders: { build: (value: unknown) => String(value) },
    leechers: { build: (value: unknown) => String(value) },
    completed: { build: (value: unknown) => String(value) },
  },
});

/**
 * 这里**刻意不持久化**筛选词。
 *
 * `tableCustomFilter` 是模块级单例（本文件顶层调用，内部只有 ref/computed，不绑组件实例），
 * 加上 `App.vue` 的 KeepAlive 白名单含 SearchEntity，切页、组件重建都不会丢；
 * 而页面真正重建（刷新/重开）时 `runtimeStore.search.searchResult` 因为 `persistWebExt: false`
 * 本来就是空的 —— 恢复一个筛选词去过滤空表没有意义。
 * 原实现每 500ms 防抖后调 `metadataStore.setLastSearchFilter`，那是整份 metadata 全量落盘。
 */
