import type { ISocialInformation, TSupportSocialSite$1 } from "@ptd/social";
import { getSocialSiteInformation, socialPageParserMatchesMap } from "@ptd/social";

import { onMessage } from "@/messages.ts";
import type { IConfigPiniaStorageSchema } from "@/shared/types.ts";

import { ptdIndexDb } from "../adapter/indexdb.ts";
import { logger } from "../utils/logger.ts";
import { extStore } from "@/storage.ts";

interface IGetSocialInformationOptions {
  force?: boolean;
  requireSummary?: boolean;
  requireMetadata?: boolean;
}

// 记录本次会话中已经因缺失字段联网重取过的 key，避免对源本身就不提供
// 简介/元数据的条目在每次调用时反复联网（绕过 cacheDay TTL）。
// offscreen 文档从不被关闭、SW 存活期间只增不减，所以必须设上限：
// 社交推荐每轮会遍历上百个条目，长期使用能累积到数万条。
const enrichmentAttemptedKeys = new Set<string>();
const ENRICHMENT_ATTEMPT_LIMIT = 2000;

function markEnrichmentAttempted(key: string) {
  if (enrichmentAttemptedKeys.size >= ENRICHMENT_ATTEMPT_LIMIT) {
    // FIFO 淘汰最早的一条（Set 保持插入顺序）
    const oldest = enrichmentAttemptedKeys.values().next().value;
    if (oldest !== undefined) {
      enrichmentAttemptedKeys.delete(oldest);
    }
  }
  enrichmentAttemptedKeys.add(key);
}

export async function getSocialInformation(
  site: TSupportSocialSite$1,
  sid: string,
  options: IGetSocialInformationOptions = {},
): Promise<ISocialInformation> {
  const configStoreRaw = (await extStore.getItem("config")) as IConfigPiniaStorageSchema;
  const socialInformationConfig = configStoreRaw.socialSiteInformation ?? {};

  const key = `${site}:${sid}`;
  let stored = await (await ptdIndexDb).get("social_information", key);

  const isExpired = stored && stored.createAt < Date.now() - 86400000 * (socialInformationConfig.cacheDay ?? 3);
  // 仅在本会话尚未因缺失字段重取过该 key 时才允许补取，避免源本身无数据时反复联网。
  const canRetryForMissingFields = !enrichmentAttemptedKeys.has(key);
  const isMissingRequiredSummary = canRetryForMissingFields && options.requireSummary && stored && !stored.summary;
  const isMissingRequiredMetadata =
    canRetryForMissingFields &&
    options.requireMetadata &&
    stored &&
    (!stored.releaseYear || !stored.region || !stored.genres?.length);

  const shouldMarkEnrichmentAttempted = isMissingRequiredSummary || isMissingRequiredMetadata;

  if (options.force || !stored || isExpired || shouldMarkEnrichmentAttempted) {
    stored = await getSocialSiteInformation(site, sid, socialInformationConfig);
    if (shouldMarkEnrichmentAttempted) {
      markEnrichmentAttempted(key);
    }
    if (stored && (stored.title !== "" || stored.poster !== "")) {
      await setSocialInformation(site, sid, stored);
    }
    logger({ msg: `getSocialInformation for ${site} with sid: ${sid}`, data: stored });
  }

  return stored as ISocialInformation;
}

onMessage("getSocialInformation", async ({ data: { site, sid } }) => await getSocialInformation(site, sid));

// content-script 引导的轻量预筛：social 包的正则聚合在本上下文已有完整依赖，
// 由这里判断后回传命中的社交站点名，引导无需携带 social 包（见 issue #1467）
/**
 * 社交站点匹配用的正则表，模块加载时预编译一次。
 *
 * 原来每次调用都对每个 pattern 执行 new RegExp(...) —— content-script 引导时
 * 每个页面导航都会走一次 matchSocialPage，SocialSitePage 里还会再来一次。
 */
const compiledSocialMatches = Object.entries(socialPageParserMatchesMap).flatMap(([socialSite, patternMatches]) =>
  patternMatches.map(([pattern]) => ({ site: socialSite as TSupportSocialSite$1, re: new RegExp(pattern, "i") })),
);

export function matchSocialPage(url: string): TSupportSocialSite$1 | null {
  return compiledSocialMatches.find(({ re }) => re.test(url))?.site ?? null;
}

onMessage("matchSocialPage", async ({ data: url }) => matchSocialPage(url));

export async function setSocialInformation(site: TSupportSocialSite$1, sid: string, val: ISocialInformation) {
  const key = `${site}:${sid}`;
  return await (await ptdIndexDb).put("social_information", val, key);
}

export async function deleteSocialInformation(site: TSupportSocialSite$1, sid: string) {
  const key = `${site}:${sid}`;
  return await (await ptdIndexDb).delete("social_information", key);
}

export async function clearSocialInformation() {
  return await (await ptdIndexDb).clear("social_information");
}

onMessage("clearSocialInformationCache", async () => {
  // 一并重置重取记录：缓存都清了，之前「取过也没有」的结论不再成立
  enrichmentAttemptedKeys.clear();
  await clearSocialInformation();
});
