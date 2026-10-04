import { computed, ref } from "vue";

import type { CTorrent } from "@ptd/downloader";
import { sendMessage } from "@/messages.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { useI18n } from "vue-i18n";

// ── module-level shared state ─────────────────────────────────────────────

/** Loaded torrent map keyed by clientId, shared between Index.vue and ClientStatusDialog.vue. */
export const torrents = ref<Record<string, CTorrent[]>>({});

/** Which downloader IDs are selected in the torrent filter (empty = all). */
export const selectedDownloaderIds = ref<string[]>([]);

/** Downloaders whose auto-refresh has been suspended due to ≥3 consecutive failures. */
export const suspendedDownloaders = ref(new Set<string>());

/** Global auto-refresh interval in seconds (0 = off). */
export const globalRefreshInterval = ref(0);

/** Whether auto-refresh is currently running. */
export const autoRefreshRunning = ref(false);

// private – not reactive, managed by the composable only
const refreshTimers = new Map<string, number>();

// ── composable ────────────────────────────────────────────────────────────

/**
 * Composable providing auto-refresh logic for the MyClient page.
 * All state is module-level and shared across component instances.
 */
export function useClientRefresh() {
  const { t } = useI18n();
  const metadataStore = useMetadataStore();
  const runtimeStore = useRuntimeStore();

  const enabledDownloaders = computed(() => metadataStore.getEnabledDownloaders);

  const activeDownloaderIds = computed(() =>
    selectedDownloaderIds.value.length > 0
      ? selectedDownloaderIds.value
      : enabledDownloaders.value.map((d) => d.id),
  );

  function clearDownloaderTimer(id: string) {
    const tid = refreshTimers.get(id);
    if (tid !== undefined) {
      clearTimeout(tid);
      refreshTimers.delete(id);
    }
  }

  /**
   * @param quiet 自动刷新失败时只报「已跳过」，手动刷新额外带上失败原因。
   */
  async function load(id: string, quiet: boolean): Promise<void> {
    try {
      const result = await sendMessage("getClientTorrents", id);
      torrents.value = { ...torrents.value, [id]: result };
    } catch (error) {
      const name = metadataStore.downloaders[id]?.name ?? id;
      // 一次失败就熔断：连不上的机器每轮都占着整次刷新（超时默认 10s，且像登录+列表
      // 这样的多次请求会叠加），不熔断的话用户每次点刷新都要重新等一个死地址。
      // 恢复入口在客户端状态弹窗的重试按钮（resumeDownloaderRefresh）。
      suspendedDownloaders.value.add(id);
      clearDownloaderTimer(id);
      runtimeStore.showSnakebar(
        quiet
          ? t("MyClient.autoRefresh.clientSuspended", { name })
          : t("MyClient.refreshFailed", {
              name,
              message: error instanceof Error ? error.message : String(error),
            }),
        { color: "error", timeout: 8000 },
      );
    }
  }

  async function loadSingleDownloader(id: string): Promise<void> {
    await load(id, false);
  }

  function scheduleDownloaderRefresh(id: string) {
    if (!autoRefreshRunning.value) return;
    if (suspendedDownloaders.value.has(id)) return;
    if (globalRefreshInterval.value <= 0) return;

    clearDownloaderTimer(id);
    const tid = window.setTimeout(async () => {
      await load(id, true);
      scheduleDownloaderRefresh(id);
    }, globalRefreshInterval.value * 1000);
    refreshTimers.set(id, tid);
  }

  function stopAllTimers() {
    for (const id of refreshTimers.keys()) {
      clearDownloaderTimer(id);
    }
    autoRefreshRunning.value = false;
  }

  /** 清空熔断名单并停表（关闭自动刷新时用；手动刷新不再清，否则熔断等于没做）。 */
  function resetRefreshState() {
    suspendedDownloaders.value = new Set();
  }

  /** 解除单台熔断并立刻重拉一次；仍然失败会再次熔断。 */
  async function resumeDownloaderRefresh(id: string) {
    suspendedDownloaders.value.delete(id);
    await load(id, false);
    if (autoRefreshRunning.value) {
      scheduleDownloaderRefresh(id);
    }
  }

  function startAutoRefresh() {
    if (globalRefreshInterval.value <= 0) return;
    autoRefreshRunning.value = true;
    for (const id of activeDownloaderIds.value) {
      scheduleDownloaderRefresh(id);
    }
  }

  function stopAutoRefresh() {
    stopAllTimers();
    resetRefreshState();
  }

  function toggleAutoRefresh() {
    if (autoRefreshRunning.value) {
      stopAutoRefresh();
    } else {
      startAutoRefresh();
    }
  }

  return {
    enabledDownloaders,
    activeDownloaderIds,
    loadSingleDownloader,
    clearDownloaderTimer,
    scheduleDownloaderRefresh,
    stopAllTimers,
    resetRefreshState,
    resumeDownloaderRefresh,
    startAutoRefresh,
    stopAutoRefresh,
    toggleAutoRefresh,
  };
}
