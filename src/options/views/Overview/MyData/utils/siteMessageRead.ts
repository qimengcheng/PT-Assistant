import { ref } from "vue";
import type { TSiteID } from "@ptd/site";

import { extStore } from "@/storage.ts";

/**
 * 站内信的「本地已读」记账（siteId → { msgid → 读的时间戳 }）。
 *
 * **只管弹窗里那一行的置灰，不许参与任何计数。** 徽章那个数字一律显站点自己报的
 * `messageCount`：v0.31.0 起拿这份记账去减，而记账只增不减（没有任何地方清它），
 * 于是和站点横幅长期对不上 —— 站点写「你有2条新短讯」、徽章显 1，刷新也回不来。
 * 更要紧的是「读一条不影响站点侧」这个前提本身就是错的：读正文走的是列表页那条
 * viewmessage 链接的 GET，站点会顺手把它标成已读（LuckPT 真页对账：读前横幅 8 条、
 * 读后 7 条）。所以站点给的数里已经扣过了，再减一遍等于同一条扣两遍。
 */
const readMap = ref<Record<TSiteID, Record<string, number>>>({});

let loadStarted = false;

function ensureLoaded() {
  if (loadStarted) {
    return;
  }
  loadStarted = true;
  void extStore.getItem("siteMessageRead").then((stored) => {
    readMap.value = stored ?? {};
  });
}

/** 每站最多记这么多条，超了就丢最旧的（msgid 单调递增，按时间戳排序即可） */
const MAX_READ_IDS_PER_SITE = 500;

export function useSiteMessageRead() {
  ensureLoaded();

  return {
    isRead(siteId: TSiteID, messageId?: string): boolean {
      return !!messageId && readMap.value[siteId]?.[messageId] !== undefined;
    },
    async markRead(siteId: TSiteID, messageIds: string[]) {
      const current = { ...(readMap.value[siteId] ?? {}) };
      const now = Date.now();
      for (const id of messageIds) {
        if (id) {
          current[id] = now;
        }
      }

      const entries = Object.entries(current);
      const trimmed =
        entries.length > MAX_READ_IDS_PER_SITE
          ? Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, MAX_READ_IDS_PER_SITE))
          : current;

      readMap.value = { ...readMap.value, [siteId]: trimmed };
      await extStore.setItem("siteMessageRead", readMap.value);
    },
  };
}
