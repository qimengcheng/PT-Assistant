/**
 * 本地种子指纹索引（下载器侧）。
 *
 * 数据从哪来：qBittorrent 的 `sync/maindata` 一次就能拿到全部种子（适配器里已经
 * 是增量同步，扩展到几百个种子也不贵），所以「列表」这一步只有一个请求；
 * 真正贵的是每个种子还要一次 `/torrents/files` 算第 2 层指纹 —— 这部分是 O(n)，
 * 因此：
 *
 * - 用 PQueue 限流，避免几百个并发请求把本地 qBittorrent 打爆；
 * - 算完写进 IndexedDB，30 分钟内复用（用户改动了下载器可显式 refresh）。
 *
 * 索引里每条记的都是「判断该不该辅这个种子」需要的东西：tracker 主机名（→ 这个
 * 种子已经挂在哪个站上）、swarm 做种数（→ 冷门种辅了也没收益）、ratio/做种时间
 * 限制、以及三层指纹本身。
 */
import PQueue from "p-queue";
import { definitionList, getDefinedSiteMetadata, getHostFromUrl } from "@ptd/site";
import type { TSiteID } from "@ptd/site";

import { onMessage } from "@/messages.ts";
import { buildTitleSizeKey, computeFilesFingerprint } from "@/shared/fingerprint/index.ts";
import type { ILocalFingerprintIndex, ILocalTorrentFingerprintEntry } from "@/shared/fingerprint/index.ts";
import type { IMetadataPiniaStorageSchema } from "@/shared/types.ts";

import { logger } from "./logger.ts";
import { getDownloaderInstance } from "./download.ts";
import { ptdIndexDb } from "../adapter/indexdb.ts";
import { extStore } from "@/storage.ts";

/** 索引缓存有效期：30 分钟。改动下载器后可以显式 refresh */
const INDEX_TTL = 30 * 60 * 1000;

/** 单次构建最多处理多少个种子（防御性上限，避免极端配置把 offscreen 卡住） */
const MAX_TORRENTS = 2000;

/** 算第 2 层指纹时的并发数：本地 HTTP，压太高反而更慢 */
const FILE_LIST_CONCURRENCY = 8;

/** 主机名归一：小写、去 www.、去端口 */
export function normalizeTrackerHost(host: string): string {
  return host
    .trim()
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/:\d+$/, "")
    .replace(/\.$/, "");
}

/** 从各种形态的 tracker 字段里抽出主机名（不额外发请求，全部取自 sync/maindata） */
export function extractTrackerHosts(raw: unknown): string[] {
  const urls: string[] = [];

  if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;

    // qBittorrent: tracker 为当前 announce 的 tracker 地址
    if (typeof record.tracker === "string" && record.tracker) {
      urls.push(record.tracker);
    }
    // qBittorrent: magnet_uri 里带着完整 tracker 列表
    if (typeof record.magnet_uri === "string") {
      try {
        const query = new URLSearchParams(record.magnet_uri.split("?")[1] ?? "");
        urls.push(...query.getAll("tr"));
      } catch {
        // magnet 串不合法就算了，不影响其余字段
      }
    }
    // 其他客户端可能给的是数组
    for (const key of ["trackers", "tracker_list", "tracker_urls"]) {
      const value = record[key];
      if (Array.isArray(value)) {
        urls.push(...value.filter((item): item is string => typeof item === "string"));
      }
    }
  }

  const hosts = new Set<string>();
  for (const url of urls) {
    try {
      const host = getHostFromUrl(url);
      if (host) hosts.add(normalizeTrackerHost(host));
    } catch {
      // 不是合法 URL，跳过
    }
  }
  return Array.from(hosts);
}

/**
 * 主机名 → 站点 id 的映射。
 *
 * 只对**用户已添加的站点**建表：为了给一个 tracker 反查站点去 load 全部 340 个
 * 站点定义（每个都是一个动态 import 的 chunk）代价太大，而用户没添加的站点
 * 本来也不会出现在辅种场景里。
 */
let hostSiteMapCache: { map: Map<string, TSiteID>; builtAt: number } | null = null;

async function buildHostSiteMap(): Promise<Map<string, TSiteID>> {
  if (hostSiteMapCache && Date.now() - hostSiteMapCache.builtAt < INDEX_TTL) {
    return hostSiteMapCache.map;
  }

  const map = new Map<string, TSiteID>();
  const metadata = (await extStore.getItem("metadata")) as IMetadataPiniaStorageSchema;
  const sites = metadata?.sites ?? {};

  for (const siteId of Object.keys(sites)) {
    const urls: string[] = [sites[siteId]?.url ?? ""];

    if (definitionList.includes(siteId)) {
      try {
        // getDefinedSiteMetadata 内部已经还原了 rot13 加密过的地址
        const siteMetadata = await getDefinedSiteMetadata(siteId);
        urls.push(...(siteMetadata.urls ?? []), ...(siteMetadata.legacyUrls ?? []));
      } catch (e) {
        logger({ msg: `buildHostSiteMap: failed to load metadata of ${siteId}`, level: "warn", data: String(e) });
      }
    }

    for (const url of urls.filter(Boolean)) {
      try {
        const host = normalizeTrackerHost(getHostFromUrl(url));
        if (host && !map.has(host)) {
          map.set(host, siteId);
        }
      } catch {
        // 忽略非法地址
      }
    }
  }

  hostSiteMapCache = { map, builtAt: Date.now() };
  return map;
}

/** 主机名 → 站点（一次构建，缓存复用） */
async function matchSitesByTrackerHosts(trackerHosts: string[]): Promise<TSiteID[]> {
  if (trackerHosts.length === 0) {
    return [];
  }
  const hostMap = await buildHostSiteMap();
  const sites = new Set<TSiteID>();
  for (const host of trackerHosts) {
    const site = hostMap.get(host);
    if (site) sites.add(site);
  }
  return Array.from(sites);
}

/** qBittorrent / 其他客户端的 ratio 限制：-2 用全局限制，-1 不限制 */
function readRatioLimit(raw: unknown): number {
  const value = (raw as Record<string, unknown> | undefined)?.ratio_limit;
  return typeof value === "number" ? value : -2;
}

function readSeedingTimeLimit(raw: unknown): number {
  const value = (raw as Record<string, unknown> | undefined)?.seeding_time_limit;
  return typeof value === "number" ? value : -2;
}

export interface IBuildLocalIndexOptions {
  /** 强制重建（忽略缓存） */
  refresh?: boolean;
  /** 最多处理多少个种子 */
  limit?: number;
}

/**
 * 正在构建中的索引（downloaderId → promise）。
 *
 * 辅种检测一次会为每个条目问一次「本地有没有」，并发起来会同时打出一堆
 * 同样的 O(n) 构建。这里按下载器去重，让后来的调用复用同一个 promise。
 */
const buildingIndexes = new Map<string, Promise<ILocalFingerprintIndex | null>>();

/**
 * 构建（或复用）某个下载器的本地指纹索引。
 */
export async function getLocalFingerprintIndex(
  downloaderId: string,
  options: IBuildLocalIndexOptions = {},
): Promise<ILocalFingerprintIndex | null> {
  if (!downloaderId) {
    return null;
  }

  if (!options.refresh) {
    const cached = (await (await ptdIndexDb).get("local_fingerprint", downloaderId)) ?? undefined;
    if (cached && Date.now() - cached.updatedAt < INDEX_TTL) {
      logger({ msg: `getLocalFingerprintIndex: hit cache for ${downloaderId}`, data: cached.updatedAt });
      return cached;
    }
  }

  const building = buildingIndexes.get(downloaderId);
  if (building) {
    return await building;
  }

  const task = buildLocalFingerprintIndex(downloaderId, options).finally(() => buildingIndexes.delete(downloaderId));
  buildingIndexes.set(downloaderId, task);
  return await task;
}

async function buildLocalFingerprintIndex(
  downloaderId: string,
  options: IBuildLocalIndexOptions,
): Promise<ILocalFingerprintIndex | null> {
  const downloader = await getDownloaderInstance(downloaderId);
  if (!downloader) {
    logger({ msg: `getLocalFingerprintIndex: downloader ${downloaderId} not found`, level: "warn" });
    return null;
  }

  const startedAt = Date.now();
  // 一次 sync/maindata 拿到全部种子
  const torrents = (await downloader.getAllTorrents()).slice(0, options.limit ?? MAX_TORRENTS);
  const queue = new PQueue({ concurrency: FILE_LIST_CONCURRENCY });

  let unresolved = 0;
  const entries = await Promise.all(
    torrents.map((torrent) =>
      queue.add(async (): Promise<ILocalTorrentFingerprintEntry> => {
        const raw = torrent.raw as Record<string, unknown> | undefined;
        const size = Math.max(0, Math.round(torrent.totalSize ?? 0));
        const trackerHosts = extractTrackerHosts(raw);
        const sites = await matchSitesByTrackerHosts(trackerHosts);

        const entry: ILocalTorrentFingerprintEntry = {
          hash: torrent.infoHash,
          name: torrent.name,
          size,
          totalSize: Math.max(0, Math.round((raw?.total_size as number) ?? torrent.totalSize ?? 0)),
          progress: torrent.progress,
          isCompleted: torrent.isCompleted,
          state: String(raw?.state ?? torrent.state ?? ""),
          savePath: torrent.savePath,
          label: torrent.label,
          trackerHosts,
          sites,
          // 第 1 层：列表页就能算的粗筛 key
          titleKey: buildTitleSizeKey(torrent.name, size),
          ratioLimit: readRatioLimit(raw),
          seedingTimeLimit: readSeedingTimeLimit(raw),
          seedsInSwarm: typeof raw?.num_complete === "number" ? raw.num_complete : undefined,
          leechersInSwarm: typeof raw?.num_incomplete === "number" ? raw.num_incomplete : undefined,
          category: torrent.label,
          dateAdded: torrent.dateAdded,
          ratio: torrent.ratio,
        };

        // 第 2 层：文件清单指纹（客户端不支持 FileList 时为 null，退化到第 1 层）
        try {
          const fileList = await downloader.getTorrentFileList(torrent);
          if (fileList?.files?.length) {
            entry.files = await computeFilesFingerprint({
              rootName: fileList.name,
              length: fileList.length,
              // 适配器侧用 size 命名（与 /torrents/files 的字段一致），指纹侧统一成 length
              files: fileList.files.map((file) => ({ path: file.path, length: file.size })),
            });
          } else if (typeof fileList?.length === "number" && fileList.length > 0) {
            // 单文件种：没有 info.files，退回用总长度
            entry.files = await computeFilesFingerprint({ length: fileList.length });
          } else {
            unresolved++;
          }
        } catch (e) {
          unresolved++;
          logger({ msg: `getTorrentFileList failed for ${torrent.infoHash}`, level: "warn", data: String(e) });
        }

        return entry;
      }),
    ),
  );

  const index: ILocalFingerprintIndex = {
    downloaderId,
    clientType: downloader.config.type,
    clientName: downloader.config.name,
    updatedAt: Date.now(),
    totalTorrents: torrents.length,
    unresolved,
    entries,
  };

  logger({
    msg: `getLocalFingerprintIndex: built for ${downloaderId} in ${Date.now() - startedAt}ms`,
    data: { totalTorrents: index.totalTorrents, unresolved: index.unresolved },
  });

  await (await ptdIndexDb).put("local_fingerprint", index, downloaderId);
  return index;
}

export async function clearLocalFingerprintIndex(downloaderId?: string): Promise<void> {
  if (downloaderId) {
    await (await ptdIndexDb).delete("local_fingerprint", downloaderId);
  } else {
    await (await ptdIndexDb).clear("local_fingerprint");
  }
  hostSiteMapCache = null;
}

onMessage("getLocalFingerprintIndex", async ({ data: { downloaderId, refresh } }) => {
  return await getLocalFingerprintIndex(downloaderId, { refresh });
});

onMessage("clearLocalFingerprintIndex", async ({ data }) => {
  await clearLocalFingerprintIndex(data?.downloaderId);
});