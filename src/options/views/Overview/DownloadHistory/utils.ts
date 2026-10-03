import { throttle } from "es-toolkit";
import { computed, reactive, shallowRef, type Component } from "vue";
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  DownloadOutlined,
} from "@antdv-next/icons";

import { sendMessage } from "@/messages.ts";
import { useTableCustomFilter } from "@/options/directives/useAdvanceFilter.ts";

import type { ITorrentDownloadMetadata, TTorrentDownloadKey } from "@/shared/types.ts";

// 使用 shallowRef 优化大量下载历史数据的性能
export const downloadHistory = shallowRef<Record<TTorrentDownloadKey, ITorrentDownloadMetadata>>({});
export const downloadHistoryList = computed(() => Object.values(downloadHistory.value));

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
function watchDownloadHistory(downloadHistoryId: TTorrentDownloadKey) {
  watchingMap[downloadHistoryId] = setTimeout(async () => {
    try {
      const history = await sendMessage("getDownloadHistoryById", downloadHistoryId);
      // 必须整体替换：downloadHistory 是 shallowRef，写 `value[id] = x` 不改变引用、
      // 不触发任何响应式更新，下载状态会永远停在「下载中」。
      // 整体替换既触发更新又保持条目不被深度代理（当初选 shallowRef 就是为了这个）。
      downloadHistory.value = { ...downloadHistory.value, [downloadHistoryId]: history };
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
  for (const key of Object.keys(watchingMap)) {
    clearTimeout(watchingMap[key as unknown as number]);
    delete watchingMap[key as unknown as number];
  }
}

function loadDownloadHistory() {
  // 首先清除所有的下载状态监听
  clearWatchingMap();

  sendMessage("getDownloadHistory", undefined).then((history: ITorrentDownloadMetadata[]) => {
    downloadHistory.value = {}; // 清空目前的下载记录
    history.forEach((item) => {
      downloadHistory.value[item.id!] = item;
      if (item.downloadStatus == "downloading" || item.downloadStatus == "pending") {
        watchDownloadHistory(item.id!);
      }
    });
    tableCustomFilter.buildAdvanceItemPropsFn();
  });
}

export const throttleLoadDownloadHistory = throttle(loadDownloadHistory, 1e3);

export interface IDownloadStatusMeta {
  title: string;
  icon: Component;
  /** antd Tag 的颜色字面量（预置名或 16 进制） */
  color: string;
}

export const downloadStatusMap: Record<ITorrentDownloadMetadata["downloadStatus"], IDownloadStatusMeta> = {
  downloading: { title: "下载中", icon: DownloadOutlined, color: "processing" },
  pending: { title: "等待中", icon: ClockCircleOutlined, color: "warning" },
  completed: { title: "已完成", icon: CheckCircleOutlined, color: "success" },
  failed: { title: "错误", icon: CloseCircleOutlined, color: "error" },
};
