import { throttle } from "es-toolkit";
import { computed, reactive, ref, shallowRef, type Component } from "vue";
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  DownloadOutlined,
  QuestionCircleOutlined,
  RobotOutlined,
  UserOutlined,
} from "@antdv-next/icons";

import { useTableCustomFilter } from "@/options/directives/useAdvanceFilter.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { useConfigStore } from "@/options/stores/config.ts";
import { ptdIndexDb } from "@/shared/indexdb.ts";

import type { ITorrentDownloadMetadata, TDownloadTrigger, TTorrentDownloadKey } from "@/shared/types.ts";

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
      console.error(`[PT-Assistant] 监听下载历史失败：${downloadHistoryId}`, e);
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

/**
 * 一次读取的看门狗时长。
 *
 * 这条 `getAll` 一旦不返回，`isLoadingHistory` 就永久停在 true —— 而这个标志同时管着两件事：
 * 界面上那圈转（表格与刷新键共用它）和「不许再发一次」那道闸。于是整页变成僵尸：表格永远
 * 半透明转圈，连点刷新都被自己的闸吃掉，用户只能重开页面（用户 2026-10-16 报的
 * 「删除了几条之后就一直转圈圈卡死」就是这个形状）。
 * 20 秒不是性能预算，是兜底：正常一趟远不到它，到点先把标志放开，让这一页至少能自己救自己。
 */
const LOAD_WATCHDOG_MS = 20_000;

/**
 * 在飞读取的序号。看门狗放开标志之后那一轮其实还挂着，所以「这一轮还做不做数」要单独记：
 * 晚到的那一份结果既不许把别人那一轮的 loading 关掉，也不许拿旧数据盖掉新一轮的数据。
 */
let loadSeq = 0;
let activeSeq = 0;

async function loadDownloadHistory() {
  // 刷新进行中直接忽略后续调用（节流窗口外仍可能连点），避免多条请求竞态互相覆盖
  if (isLoadingHistory.value) {
    return;
  }
  // 先过闸再动手：被那道闸吃掉的一次调用什么都不该做（清监听原先排在闸前面，于是「一次没发出去
  // 的刷新」也会把逐秒轮询停一遍 —— 眼下没有可停的，但把副作用留在早退那一支上是错的形状）
  clearWatchingMap();

  isLoadingHistory.value = true;
  const seq = ++loadSeq;
  activeSeq = seq;
  const watchdog = setTimeout(() => {
    if (activeSeq !== seq) return;
    isLoadingHistory.value = false;
    console.error(`[DownloadHistory] 读取下载历史超过 ${Math.round(LOAD_WATCHDOG_MS / 1000)} 秒没有返回，已放开界面`);
    useRuntimeStore().showSnakebar(i18nLoadTimeoutText(), { color: "error" });
  }, LOAD_WATCHDOG_MS);

  try {
    // 同上：整表读一次就是一次 background → offscreen 的往返，还要把全量记录结构化克隆
    // **两趟**（offscreen→background→options）传回来。直连 store 只要一趟。
    const history: ITorrentDownloadMetadata[] = await (await ptdIndexDb()).getAll("download_history");

    // 看门狗放开之后他可能又点了一次刷新，那一轮正在读更新的数据：这一轮的旧结果到此为止，
    // 既不盖数据也不动标志（标志已经归那一轮了）
    if (activeSeq !== seq) return;

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
    console.error("[DownloadHistory] 读取下载历史失败", e);
    // 已经过期的一轮不再报：界面上转着的是新一轮，这条错误只会把人指错地方
    if (activeSeq === seq) useRuntimeStore().showSnakebar(i18nLoadErrorText(), { color: "error" });
  } finally {
    clearTimeout(watchdog);
    if (activeSeq === seq) isLoadingHistory.value = false;
  }
}

/**
 * 删一条历史记录。
 *
 * 原先这里发的是 `deleteDownloadHistoryById` 消息，绕 background → offscreen 一跳，和本文件
 * 上面那条读走的不是同一条路：一次批量删除就是 N 个跨上下文往返，而每一个 delete 的写锁握在
 * **另一个上下文**手里，紧接着的那次整表读要排在同一张表的锁后面。改成直连之后，读写都只在
 * 这一个上下文里排队（扩展同源共库，见 `@/shared/indexdb` 的跨上下文可见性注释）。
 * offscreen 那份处理器留着 —— 它还在原生通信桥的白名单里，只是这一页不再经过它。
 */
export async function removeDownloadHistoryById(downloadHistoryId: TTorrentDownloadKey) {
  await (await ptdIndexDb()).delete("download_history", downloadHistoryId);
}

/** 非组件模块拿不到 useI18n 注入，按 configStore.lang 选双语文案，避免错误提示只给中文 */
function i18nLoadErrorText(): string {
  return useConfigStore().lang === "en" ? "Failed to load download history" : "加载下载历史失败";
}

/**
 * 看门狗那一条，和上面那条分开写：这一条的出路是「再点一次刷新」（引号里就是那颗键的界面真名），
 * 而「失败」那条是库真的报错了，重点也没用。两句合成一句会把人指到错的下一步。
 */
function i18nLoadTimeoutText(): string {
  return useConfigStore().lang === "en"
    ? "Loading download history timed out. Click 'Refresh download history list' to try again."
    : "读取下载历史超时，请再点一次「刷新下载记录列表」重试";
}

export const throttleLoadDownloadHistory = throttle(loadDownloadHistory, 1e3);

export interface IDownloadTagMeta {
  /**
   * i18n 键而不是文案本身：这是非组件模块，拿不到 useI18n，写死中文会让英文界面
   * 显示中文（AGENTS.md §3.5 零容忍）。由调用方用 t() 解析。
   */
  titleKey: string;
  icon: Component;
  /** antd Tag 的颜色字面量（预置名或 16 进制） */
  color: string;
}

export const downloadStatusMap: Record<ITorrentDownloadMetadata["downloadStatus"], IDownloadTagMeta> = {
  downloading: { titleKey: "DownloadHistory.status.downloading", icon: DownloadOutlined, color: "processing" },
  pending: { titleKey: "DownloadHistory.status.pending", icon: ClockCircleOutlined, color: "warning" },
  completed: { titleKey: "DownloadHistory.status.completed", icon: CheckCircleOutlined, color: "success" },
  failed: { titleKey: "DownloadHistory.status.failed", icon: CloseCircleOutlined, color: "error" },
};

/**
 * 「发起方式」这一列的三档。
 *
 * `unknown` 不是第三种发起方，而是**字段缺失**：v0.103.0 之前落库的存量记录、以及从备份整表
 * 导入的老数据，都没有这一项。之所以不猜：自动辅种与辅种任务页的手动发送共用同一个
 * `buildReseedAddTorrentOptions`，落下来的 `addTorrentOptions` 一字不差，反推只会把一半标错。
 * 存量条目本来也留不住 —— 它们绝大多数正是这一页要批量删掉的那批失败记录。
 */
export const downloadTriggerMap: Record<TDownloadTrigger | "unknown", IDownloadTagMeta> = {
  manual: { titleKey: "DownloadHistory.trigger.manual", icon: UserOutlined, color: "blue" },
  auto: { titleKey: "DownloadHistory.trigger.auto", icon: RobotOutlined, color: "purple" },
  unknown: { titleKey: "DownloadHistory.trigger.unknown", icon: QuestionCircleOutlined, color: "default" },
};

/** 记录里的 `trigger` 缺失时按「未记录」那一档画，其余原样取表 */
export function triggerMetaOf(trigger: ITorrentDownloadMetadata["trigger"]): IDownloadTagMeta {
  return downloadTriggerMap[trigger ?? "unknown"];
}
