/**
 * 下载器分类表（分类名 → 它真正的落盘目录）的按需取数。
 *
 * 为什么要有这一层：保存路径那一格允许写成 `category:电影`（qBittorrent 那条「用分类作为保存
 * 位置」的约定），而**它不是目录**。辅种有两处要拿它判「基准那份在不在任务目录」、还要拿它当
 * 移动目标 —— 不先翻成目录，前者会报一条假警告，后者会被下载器当场拒掉（用户 2026-10-11 点
 * 「把本地文件移到任务目录」报的 409 就是这么来的）。翻不出就老实回 null，调用方按「判不出」走，
 * 不许拿分类名冒充路径。判据在 `@/shared/reseedPath.ts`。
 *
 * 缓存按下载器、只在本次页面存活期内有效：换下载器自然换一个键，重开页面重取；新建分类是低频
 * 动作，而这两处每改一次路径就要判一次，不缓存会连着打好几趟网络。取失败**不**写进缓存 ——
 * 那种情况下一次还要真去取，不能把「这轮没连上」冻成「这台永远没有分类」。
 */
import { sendMessage } from "@/messages.ts";
import type { IClientCategory } from "@/shared/reseedPath.ts";

type TCategoryTable = Record<string, IClientCategory>;

const cache = new Map<string, TCategoryTable | null>();
const inflight = new Map<string, Promise<TCategoryTable | null>>();

export async function loadCategoryTable(downloaderId?: string | null): Promise<TCategoryTable | null> {
  if (!downloaderId) return null;
  if (cache.has(downloaderId)) return cache.get(downloaderId) ?? null;

  let pending = inflight.get(downloaderId);
  if (!pending) {
    pending = (async () => {
      try {
        const table = ((await sendMessage("getClientTorrentCategories", downloaderId)) as TCategoryTable | null) ?? null;
        cache.set(downloaderId, table);
        return table;
      } catch (e) {
        console.error("[reseed] 取分类表失败:", e);
        return null;
      } finally {
        inflight.delete(downloaderId);
      }
    })();
    inflight.set(downloaderId, pending);
  }
  return pending;
}
