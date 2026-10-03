import axios from "axios";
import {
  IFetchSocialSiteInformationConfig,
  ISocialInformation,
  TSupportSocialSite,
  TSupportSocialSitePageParserMatches,
} from "./types.ts";

export * from "./types.ts";
export * from "./recommendations.ts";

// From https://github.com/ourbits/PtGen#usage
export const buildInPtGenApi = [
  { provider: "Github Pages", url: "https://ourbits.github.io/PtGen/<site>/<sid>.json" },
  { provider: "OurHelp CDN", url: "https://cdn.ourhelp.club/ptgen/<site>/<sid>.json" },
  { provider: "OurHelp API", url: "https://api.ourhelp.club/infogen?site=<site>&sid=<sid>" },
];

interface socialEntity {
  parse: (query: string) => string;
  build: (id: string) => string;
  pageParserMatches?: TSupportSocialSitePageParserMatches;
  transformPtGen?: (data: any) => ISocialInformation;
  fetchInformation: (id: string, config: IFetchSocialSiteInformationConfig) => Promise<ISocialInformation>;
}

export const socialContent = import.meta.glob<socialEntity>("./entity/*.ts", { eager: true });
export const socialEntityList = Object.keys(socialContent).map((value: string) => {
  return value.replace(/^\.\/entity\//, "").replace(/\.ts$/, "");
}) as TSupportSocialSite[];

export type TSupportSocialSite$1 = (typeof socialEntityList)[number];

const PtGenApiSupportSite: TSupportSocialSite$1[] = [] as const;

export const socialBuildUrlMap = {} as Record<TSupportSocialSite$1, socialEntity["build"]>;
export const socialParseUrlMap = {} as Record<TSupportSocialSite$1, socialEntity["parse"]>;
export const socialPageParserMatchesMap = {} as Record<TSupportSocialSite$1, TSupportSocialSitePageParserMatches>;

export function getSocialModule(site: TSupportSocialSite$1): socialEntity {
  return socialContent[`./entity/${site}.ts`];
}

for (const socialEntity of socialEntityList) {
  const socialModule = getSocialModule(socialEntity);

  socialBuildUrlMap[socialEntity] = socialModule.build;
  socialParseUrlMap[socialEntity] = socialModule.parse;

  if (socialModule.pageParserMatches) {
    socialPageParserMatchesMap[socialEntity] = socialModule.pageParserMatches;
  }

  if (socialModule.transformPtGen) {
    PtGenApiSupportSite.push(socialEntity);
  }
}

export async function getSocialSiteInformation(
  site: TSupportSocialSite$1,
  id: string,
  config: IFetchSocialSiteInformationConfig = {},
  // @ts-ignore
): Promise<ISocialInformation | undefined> {
  const socialModule = getSocialModule(site);
  const { preferPtGen = true, ptGenEndpoint = buildInPtGenApi[0].url, timeout = 5e3 } = config;

  if (preferPtGen && PtGenApiSupportSite.includes(site)) {
    console?.log("Use PtGen API to fetch social site information ", { site, id });

    const endpoints = [...new Set<string>([ptGenEndpoint, buildInPtGenApi.at(-1)!.url].filter(Boolean))];

    // 并发探测各PtGen 端点而不是串行 await：原来串行时两个端点各 5s 超时，
    // 最坏要等满 10s 才轮询到内置解析。
    const results = await Promise.allSettled(
      endpoints.map(async (endpoint) => {
        const ptGenUrl = endpoint.replace("<site>", site).replace("<sid>", id);
        const req = await axios.get(ptGenUrl, { timeout, responseType: "json" });
        const data = req.data as any;
        if (req.status !== 200 || data?.success === false) {
          throw new Error(`PtGen ${endpoint} responded unusable`);
        }
        return socialModule.transformPtGen!(data);
      }),
    );

    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        return result.value;
      }
      // 端点不可用是常态（站点没上 PtGen、网络抖动），记 debug 即可不该刷 error
      if (result.status === "rejected") {
        console.debug("[social] PtGen endpoint failed", site, result.reason);
      }
    }
  }

  // 如果没有使用 PtGen API 或者 PtGen API 获取失败，则使用内置的解析方法
  console?.log("Use build-in API to fetch social site information:", { site, id });
  return await socialModule.fetchInformation(id, config);
}
