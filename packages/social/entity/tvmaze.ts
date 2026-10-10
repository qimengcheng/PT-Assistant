import axios from "axios";
import {
  type IFetchSocialSiteInformationConfig,
  type ISocialInformation,
  type ISocialSitePageInformation,
  type TSupportSocialSitePageParserMatches,
} from "../types";
import { commonParseFactory } from "../utils.ts";

const tvmazeUrlPattern = /^(?:https?:\/\/)?(?:www\.)?tvmaze\.com\/shows\/(\d+)(?:\/[^\/]+)?\/?$/;

export function build(id: string): string {
  return `https://www.tvmaze.com/shows/${id}`;
}

export const parse = commonParseFactory([tvmazeUrlPattern]);

export const pageParserMatches: TSupportSocialSitePageParserMatches = [
  [
    tvmazeUrlPattern,
    (doc: Document): ISocialSitePageInformation => {
      const titles = [] as string[];
      const showName = doc.querySelector("h1.show-for-medium");
      if (showName) {
        titles.push(showName.textContent.trim());
      }
      return {
        site: "tvmaze",
        id: parse(doc.URL),
        titles,
      };
    },
  ],
];

interface ITVMazeApiResp {
  id: number;
  url: string;
  name: string;
  type: string;
  language: string;
  premiered: string | null;
  ended: string | null;
  rating: {
    average: number | null;
  };
  image: {
    medium: string | null;
    original: string | null;
  };
  externals: {
    tvrage: number | null;
    thetvdb: number | null;
    imdb: string | null;
  };
}

export async function fetchInformation(
  id: string,
  config: IFetchSocialSiteInformationConfig = {},
): Promise<ISocialInformation> {
  const realId = parse(String(id));
  const resDict = {
    site: "tvmaze",
    id: realId,
    title: "",
    poster: "",
    ratingScore: 0,
    // ratingCount: 0, // 网页存在该信息，但 API 未提供
    createAt: 0,
  } as ISocialInformation;

  try {
    // ⚠️ 用 realId 而不是形参 id：调用方传进来的是页面 URL（其它 5 个实体都先 parse），
    // 直接拼进 API 路径必然 404。
    const { data } = await axios.get<ITVMazeApiResp>(`https://api.tvmaze.com/shows/${realId}`, {
      timeout: config.timeout ?? 10e3,
      responseType: "json",
    });

    resDict.title = data.name;
    // ⚠️ image 对「无图剧集」是 null（这是它的正常响应，不是异常），
    // 直接 .medium 会连带把标题和评分一起丢掉 —— 整条信息全空。
    resDict.poster = data.image?.medium ?? data.image?.original ?? "";
    resDict.ratingScore = data.rating?.average ?? 0;
  } catch (error) {
    console.warn(error);
  } finally {
    resDict.createAt = +Date.now();
  }

  return resDict;
}
