import { ref } from "vue";
import type { TSiteID } from "@ptd/site";

import { extStore } from "@/storage.ts";

/**
 * 站内信的「本地已读」记账（siteId → { msgid → 读的时间戳 }）。
 *
 * 模块级一份 ref，徽章和弹窗都读它：读完消息要让红数字当场掉下来，否则「点开读了」和
 * 「没读」看起来没区别。它**不改站点侧的已读状态**（那要每站一个带 authkey 的 POST，
 * 我们没有可验证的通用实现），下一次刷新用户信息时仍以站点给的 messageCount 为准。
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
    /** 该站已读的条数（messageCount 是未读数，两者相减就是徽章该显示的数字） */
    readCountOf(siteId: TSiteID): number {
      return Object.keys(readMap.value[siteId] ?? {}).length;
    },
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
    /** 站点侧报告「已经没有未读」时清掉该站记账，免得旧 msgid 永远占着 */
    async clearSite(siteId: TSiteID) {
      if (!readMap.value[siteId]) {
        return;
      }
      const next = { ...readMap.value };
      delete next[siteId];
      readMap.value = next;
      await extStore.setItem("siteMessageRead", next);
    },
  };
}
