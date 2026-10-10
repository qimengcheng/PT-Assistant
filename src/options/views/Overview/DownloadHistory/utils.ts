import { throttle } from "es-toolkit";
import { computed, reactive, ref, shallowRef, type Component } from "vue";
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  DownloadOutlined,
} from "@antdv-next/icons";

import { useTableCustomFilter } from "@/options/directives/useAdvanceFilter.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { useConfigStore } from "@/options/stores/config.ts";
import { ptdIndexDb } from "@/shared/indexdb.ts";

import type { ITorrentDownloadMetadata, TTorrentDownloadKey } from "@/shared/types.ts";

// 使用 shallowRef 优化大量下载历史数据的性能
export const downloadHistory = shallowRef<Record<TTorrentDownloadKey, ITorrentDownloadMetadata>>({});
export const downloadHistoryList = computed(() => Object.values(downloadHistory.value));

/** 列表加载中标志：供 a-table :loading 与刷新按钮 :loading 共用，防止加载期间重复刷新 */
export const isLoadingHistory = ref<boolean>(false);

export const tableCustomFilter = useTableCustomFilter({
  parseOptions: {
    keywords: ["siteId", "downloaderId", "downloadStatus"],
    ranges: ["downloadAt"],
  },
  titleFields: ["title", "subTitle"],
  initialItems: downloadHistoryList,
  format: {
    downloadAt: "date",
  },
});

// 使用 setTimeout 监听下载状态变化
const watchingMap = reactive<Record<TTorrentDownloadKey, number>>({});
// ⚠️ 世代号：clearWatchingMap() 只能清掉**已经排上**的定时器，清不掉
// 已经在飞的那个回调。那个回调 await 完之后会无条件再排一个 1s 定时器 ——
// 于是组件卸载 / 页面刷新之后，轮询会「复活」并一直每秒读一次 IndexedDB，
// 而且 clearWatchingMap 里再也清不掉它（它不在 map 里了）。
// 每次 clearWatchingMap 递增世代，在飞回调回来时发现世代变了就放弃续排。
let watchingGeneration = 0;
function watchDownloadHistory(downloadHistoryId: TTorrentDownloadKey) {
  const generation = watchingGeneration;
  watchingMap[downloadHistoryId] = setTimeout(async () => {
    // 已经从 map 里摘掉（被 clearWatchingMap 清了）就不再续排
    if (watchingMap[downloadHistoryId] === undefined) return;
    try {
      // 直连 IndexedDB 读，不再 sendMessage 绕 background → offscreen 一跳：
      // 这条是**每个下载中的种子每 1 秒**跑一次的轮询，N 个任务就是每秒 N 次跨上下文往返，
      // 而且 background 的 service worker 会被它反复唤醒。下载历史是扩展同源页面本就能直接
      // 打开的 IndexedDB（同一份 store 定义在 @/shared/indexdb，见那里的注释）。
      const history = await (await ptdIndexDb()).get("download_history", downloadHistoryId);

      // 记录可能已被用户删掉。原先走消息那条路径，返回值被 handler 里的 `!` 断言蒙成有值，
      // 运行时靠读 undefined.downloadStatus 抛 TypeError 落到下面的 catch 才停轮询 ——
      // 结果一样，但那是在拿异常当控制流，还会在控制台留一条误导性的错误。
      if (!history) {
        delete watchingMap[downloadHistoryId];
        return;
      }
      // 必须整体替换：downloadHistory 是 shallowRef，写 `value[id] = x` 不改变引用、
      // 不触发任何响应式更新，下载状态会永远停在「下载中」。
      // 整体替换既触发更新又保持条目不被深度代理（当初选 shallowRef 就是为了这个）。
      downloadHistory.value = { ...downloadHistory.value, [downloadHistoryId]: history };
      // ⚠️ 关键判据：await 期间可能已经 clearWatchingMap() 过（卸载 / 刷新 /
      // 上一条 loadDownloadHistory 自己就调了一次）。世代变了说明这次轮询
      // 已被作废，绝不能续排 —— 否则就是卸载后仍在每秒读 IndexedDB。
      if (generation !== watchingGeneration) {
        return;
      }
      if (history.downloadStatus == "downloading" || history.downloadStatus == "pending") {
        watchDownloadHistory(downloadHistoryId);
      } else {
        delete watchingMap[downloadHistoryId];
      }
    } catch (e) {
      // 抛错时必须清理定时器并放弃轮询，否则会变成每 1s 一次的死循环 unhandledRejection
      console.error(`[PTD] watch download history failed: ${downloadHistoryId}`, e);
      delete watchingMap[downloadHistoryId];
    }
  }, 1e3) as unknown as number;
}

export function clearWatchingMap() {
  // 先作废所有在飞回调（世代 +1），再清已排的定时器
  watchingGeneration++;
  for (const key of Object.keys(watchingMap)) {
    clearTimeout(watchingMap[key as unknown as number]);
    delete watchingMap[key as unknown as number];
  }
}

async function loadDownloadHistory() {
  // 首先清除所有的下载状态监听
  clearWatchingMap();

  // 刷新进行中直接忽略后续调用（节流窗口外仍可能连点），避免多条请求竞态互相覆盖
  if (isLoadingHistory.value) {
    return;
  }
  isLoadingHistory.value = true;
  try {
    // 同上：整表读一次就是一次 background → offscreen 的往返，还要把全量记录结构化克隆
    // **两趟**（offscreen→background→options）传回来。直连 store 只要一趟。
    const history: ITorrentDownloadMetadata[] = await (await ptdIndexDb()).getAll("download_history");

    // 先在普通对象里把整表拼好，再一次性替换 shallowRef：
    // 旧写法先置 {} 再逐 key 赋值，shallowRef 对逐 key 变更不触发更新，
    // 表格只能靠后续副作用碰巧刷新，且中途会短暂闪成空表。
    const historyMap: Record<TTorrentDownloadKey, ITorrentDownloadMetadata> = {};
    history.forEach((item) => {
      // ⚠️ id 在类型上是可选的（写入时还没落库、由 store 的 keyPath
      // autoIncrement 补上），但下面这四行都当它必有：`historyMap[undefined]`
      // 会把所有无 id 的记录塌成同一条、watchDownloadHistory(undefined) 会去
      // 轮询一条永远不存在的记录，而界面上 row-key="id" + record.id!
      // 又会让多行共用一个 undefined key（选中/删除会串行）。
      // 正常数据一定有 id（keyPath 保证），这里只是把「万一」变成一条
      // 明确日志 + 跳过，而不是让下游拿着 undefined 猜。
      if (typeof item.id !== "number") {
        console.error("[DownloadHistory] 跳过没有 id 的下载历史记录", item);
        return;
      }
      historyMap[item.id] = item;
      if (item.downloadStatus == "downloading" || item.downloadStatus == "pending") {
        watchDownloadHistory(item.id);
      }
    });
    downloadHistory.value = historyMap;
    tableCustomFilter.buildAdvanceItemPropsFn();
  } catch (e) {
    console.error("[DownloadHistory] load download history failed", e);
    useRuntimeStore().showSnakebar(i18nLoadErrorText(), { color: "error" });
  } finally {
    isLoadingHistory.value = false;
  }
}

/** 非组件模块拿不到 useI18n 注入，按 configStore.lang 选双语文案，避免错误提示只给中文 */
function i18nLoadErrorText(): string {
  return useConfigStore().lang === "en" ? "Failed to load download history" : "加载下载历史失败";
}

export const throttleLoadDownloadHistory = throttle(loadDownloadHistory, 1e3);

export interface IDownloadStatusMeta {
  /**
   * i18n 键而不是文案本身：这是非组件模块，拿不到 useI18n，写死中文会让英文界面
   * 显示中文（AGENTS.md §3.5 零容忍）。由调用方用 t() 解析。
   */
  titleKey: string;
  icon: Component;
  /** antd Tag 的颜色字面量（预置名或 16 进制） */
  color: string;
}

export const downloadStatusMap: Record<ITorrentDownloadMetadata["downloadStatus"], IDownloadStatusMeta> = {
  downloading: { titleKey: "DownloadHistory.status.downloading", icon: DownloadOutlined, color: "processing" },
  pending: { titleKey: "DownloadHistory.status.pending", icon: ClockCircleOutlined, color: "warning" },
  completed: { titleKey: "DownloadHistory.status.completed", icon: CheckCircleOutlined, color: "success" },
  failed: { titleKey: "DownloadHistory.status.failed", icon: CloseCircleOutlined, color: "error" },
};
