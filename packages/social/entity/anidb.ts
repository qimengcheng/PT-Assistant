import axios from "axios";
import Sizzle from "sizzle";
import { uniq } from "es-toolkit";

import { commonParseFactory } from "../utils";
import {
  type IFetchSocialSiteInformationConfig,
  type ISocialInformation,
  type ISocialSitePageInformation,
  type TSupportSocialSitePageParserMatches,
} from "../types";

const anidbUrlPattern = /(?:https?:\/\/)?(?:www\.)?anidb\.net\/(?:a|anime\/)(\d+)/;

export function build(id: string): string {
  return `https://anidb.net/anime/${id}`;
}

export const parse = commonParseFactory([anidbUrlPattern]);

function pageParser$1(doc: Document): ISocialSitePageInformation {
  return {
    site: "anidb",
    id: parse(doc.URL),
    titles: uniq(
      Sizzle("div.titles span[itemprop], label[itemprop]", doc)
        .map((x) => x.textContent)
        .filter(Boolean),
    ) as string[],
  };
}

export const pageParserMatches: TSupportSocialSitePageParserMatches = [[anidbUrlPattern, pageParser$1]];

export async function fetchInformation(
  id: string,
  config: IFetchSocialSiteInformationConfig = {},
): Promise<ISocialInformation> {
  const realId = parse(String(id));
  const resDict = {
    site: "anidb",
    id: realId,
    title: "",
    poster: "",
    ratingScore: 0,
    ratingCount: 0,
    createAt: 0,
  } as ISocialInformation;

  try {
    // 如果提供了 anidb 的 client 信息，则优先使用 anidb 的 API 获取信息
    if (config.socialSite?.anidb?.client) {
      // 我们默认 client 为 a-zA-Z 组成的字符串， clientver 默认为 1，如果 client 中包含了 /，则依次表示 client 和 clientver
      let client = config.socialSite.anidb.client;
      let clientver = 1;
      if (client.includes("/")) {
        const [clientName, clientVersion] = client.split("/");
        client = clientName;
        clientver = parseInt(clientVersion, 10);
      }

      // 只能是 http：AniDB 在 9001 上没有 TLS 监听（实测 5 个 anidb 域名在 9001 做 TLS
      // 握手全部无响应，同端口明文 GET 返回 200）；443 上那张 Let's Encrypt 证书的 SAN
      // 里没有 api.anidb.net，而带证书的 www.anidb.net:443 只有 Cloudflare 挑战页、没有
      // httpapi。所以「改 https 就能绕开 mixed content」这条路不存在。
      const apiReq = await axios.get("http://api.anidb.net:9001/httpapi", {
        params: { request: "anime", client, clientver, protover: 1, aid: realId },
        timeout: config.timeout ?? 10e3,
        responseType: "document",
      });
      resDict.title = uniq(
        Sizzle("titles > title", apiReq.data)
          .map((x) => x.textContent)
          .filter(Boolean),
      ).join(" / ");
      // ⚠️ textContent 可能带换行/空白（XML 节点排版），不 trim 就拼出一个
      // 带空格的非法 URL，海报直接裂图。
      const poster = Sizzle("picture", apiReq.data)[0]?.textContent?.trim();
      if (poster) {
        resDict.poster = "https://cdn.anidb.net/images/main/" + poster;
      }
      const ratingAnother = Sizzle("ratings permanent, temporary", apiReq.data)?.[0];
      if (ratingAnother) {
        resDict.ratingScore = parseFloat(ratingAnother.textContent ?? "0");
        resDict.ratingCount = parseInt(ratingAnother.getAttribute("count") ?? "0", 10);
      }
    } else {
      const htmlReq = await axios.get(build(realId), { timeout: config.timeout ?? 10e3, responseType: "document" });

      resDict.title = pageParser$1(htmlReq.data).titles.join(" / ");
      resDict.poster = Sizzle("meta[property='og:image'][content]", htmlReq.data)?.[0]?.getAttribute("content") ?? "";
      resDict.ratingScore = parseFloat(Sizzle('span[itemprop="ratingValue"]', htmlReq.data)?.[0]?.textContent ?? "0");
      resDict.ratingCount = parseInt(
        Sizzle('span[itemprop="ratingCount"]', htmlReq.data)?.[0]?.getAttribute("content") ?? "0",
        10,
      );
    }
  } catch (error) {
    console.warn(error);
  } finally {
    resDict.createAt = +Date.now();
  }

  return resDict;
}
