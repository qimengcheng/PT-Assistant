/**
 * 获取站点图标的方法
 *
 * 我们不用很在意 Favicon 的本地缓存情况，因为这部分可以随时重新获取，所以直接用 localforage 就行了
 * 程序按照如下顺序获取Favicon：
 *   1. '../icons' 目录中是否存在对应 png 或 ico 文件 `${config.id}.${"png" | "ico"}`
       注意：1. 主要方便 以解压缩形式安装的用户覆写 以及部分教育网站点可能需要特殊方法访问的情况
            2. 此时，ISiteMetadata 中定义的 favicon 字段配置项不起作用，强制刷新缓存不起作用（本地硬配置优先）
 *   2. localforage 中已有的 base64 缓存（根据站点的 host 值）
 *   3. ISiteMetadata 中定义的 favicon 字段
 *   4. 请求网站首页，并从返回的html中解析所需要的 favicon 字段
 *   5. 使用 NO_IMAGE 替代
 *
 * special thanks to: https://github.com/spro/get-website-favicon/tree/master/lib/origin
 */

// 必须用 site 包自己的 axios 适配器而不是裸 axios：
// 1) 走 replaceUnsafeHeader，部分站点的首页需要覆盖 UA/Cookie 才能返回真实内容；
// 2) 走 Cloudflare 拦截重试；
// 3) 每个请求都显式带 timeout —— 图标是纯附加信息，不该拖住调用方。
// 原来全靠调用侧 Promise.race 兜底，那些 Promise 仍会一直挂着。
import { axios } from "./adapter.ts";
import type { ISiteMetadata } from "../types";

/** 图标请求是可有可无的附加信息，超时给得比正文请求更短 */
const FAVICON_TIMEOUT = 5e3;

/**
 * Blob → dataURL 的公共实现（消掉原先散落两处的副本与那条 FIXME）。
 * @param label 报错信息里用来区分调用方的场景
 */
export function blobToDataUrl(blob: Blob, label = "blob"): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("loadend", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error(`Error when parse ${label} Blob`));
      }
    });

    reader.readAsDataURL(blob);
  });
}

// from: https://stackoverflow.com/a/9967193/8824471
// from: http://proger.i-forge.net/%D0%9A%D0%BE%D0%BC%D0%BF%D1%8C%D1%8E%D1%82%D0%B5%D1%80/[20121112]%20The%20smallest%20transparent%20pixel.html
export const NO_IMAGE = "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACwAAAAAAQABAAACAkQBADs=";

const FAVICON_FROM_LINK = [
  "link[rel='icon' i][href]",
  "link[rel='shortcut icon' i][href]",
  "link[rel='apple-touch-icon' i][href]",
  "link[rel='apple-touch-icon-precomposed' i][href]",
  "link[rel='apple-touch-startup-image' i][href]",
  "link[rel='fluid-icon' i][href]",
  // "meta[name='msapplication-TileImage' i][content]"
];

interface IParsedFavicon {
  href: string;
  sizes: string | `${string}x${string}`;
  source: "manifest" | "link" | "favicon";
  blob?: Blob;
}

const remoteBetterFaviconOrder = [
  {
    key: "source", // favicon.ico - 2
    rank: (item: IParsedFavicon) => {
      const rule = ["favicon", "link", "manifest"].reverse();
      let rank = 0;
      for (const n in rule) {
        rank += rule[n] === item.source ? parseInt(n) : 0;
      }
      return rank;
    },
  },
  {
    // favicon.ico - 3
    key: "ext",
    rank: (item: IParsedFavicon) => {
      const rule = [/\.ico$/im, /\.png$/im, /\.jpg$/im, /\.svg$/im].reverse();
      let rank = 0;
      for (const n in rule) {
        rank += rule[n].test(item.href) ? parseInt(n) : 0;
      }
      return rank;
    },
  },
  {
    key: "sizes",
    rank: (item: IParsedFavicon) => {
      let rank = 0;
      if (!item.sizes) return rank;
      const wh = item.sizes.split("x");
      const size = parseInt(wh[0]);
      if (wh[0] != wh[1]) return rank;
      if (size > 24 && size < 40) {
        rank = 4;
      } else if (size > 36 && size < 90) {
        rank = 3;
      } else if (size > 88 && size < 260) {
        rank = 2;
      } else if (size > 15 && size < 26) {
        rank = 1;
      } else {
        rank = 0;
      }
      return rank;
    },
  },
].reverse();

async function getFaviconFromUrl(url: string): Promise<Blob> {
  const baseUrl = new URL(url);

  const favicons: IParsedFavicon[] = [];

  // 1 / 2. 从首页 HTML 的 <link> 与 manifest 里解析图标。
  // ⚠️ 这一整趟是**尽力而为**，必须自己吞掉异常：首页拿不到（超时、CF 挑战、
  // 用户填的旧地址已经死了、`responseType:"document"` 被拒）都不该连带把下面
  // 那条 `/favicon.ico` 兜底一起废掉 —— 原实现这一句裸着 await，抛错就直接冒泡到
  // 调用方，于是「站点根目录明明有图标、首页却抓不到」的站点永远空白。
  try {
    const { data: doc } = await axios.get<Document>(url, { responseType: "document", timeout: FAVICON_TIMEOUT });

    FAVICON_FROM_LINK.forEach((selector) => {
      const element = doc.querySelector(selector) as HTMLLinkElement;
      if (element) {
        favicons.push({
          href: element.href,
          sizes: element.sizes?.toString() || "",
          source: "link",
        });
      }
    });

    const manifestElement = doc.querySelector('head link[rel="manifest" i]') as HTMLLinkElement;
    if (manifestElement) {
      const { data: manifest } = await axios.get<{
        icons: Record<"sizes" | "src" | "type", string>[];
      }>(manifestElement.href, { responseType: "json", timeout: FAVICON_TIMEOUT });

      manifest.icons.forEach(({ sizes, src }) => {
        favicons.push({
          href: src,
          sizes,
          source: "manifest",
        });
      });
    }
  } catch (e) {
    console.warn(`[favicon] 首页解析失败，继续试 /favicon.ico: ${url}`, (e as Error)?.message ?? e);
  }

  // 3. Default /favicon.ico
  try {
    const faviconIco = await axios.get<Blob>("/favicon.ico", {
      baseURL: baseUrl.origin,
      responseType: "blob",
      timeout: FAVICON_TIMEOUT,
    });
    // 只认 image/*：这条是最后一条兜底，判据写死成 `=== "image/x-icon"` 会把
    // 服务成 `image/vnd.microsoft.icon`（IE 时代的标准 MIME，nginx/CF 都会给）
    // 或 `image/png` 的站点一起丢掉。反过来，text/html 的错误页仍然进不来。
    if (faviconIco && faviconIco.data?.type?.startsWith("image/")) {
      favicons.push({
        href: "/favicon.ico",
        sizes: "",
        source: "favicon",
        blob: faviconIco.data,
      } as IParsedFavicon);
    }
  } catch (e) {}

  // 如果前面获取到足够的 favicons，我们需要比较下哪个更合适，并排序
  if (favicons.length > 0) {
    const rankedFavicons: Array<IParsedFavicon & { rank: number }> = favicons
      .map((icon) => {
        // 计算每一个favicon的评分
        let rank = 0;
        for (const x in remoteBetterFaviconOrder) {
          const order = remoteBetterFaviconOrder[x];
          if (order.rank) {
            rank += order.rank(icon) * Math.pow(10, parseInt(x));
          }
        }

        return {
          ...icon,
          rank,
        };
      })
      .sort((a, b) => (a.rank < b.rank ? 1 : -1));

    // 选择排序后第一个图标作为我们需要的图标
    for (let i = 0; i < rankedFavicons.length; i++) {
      const usedFavicons = rankedFavicons[i];
      if (usedFavicons.blob) {
        return usedFavicons.blob;
      } else {
        try {
          let faviconUrl = usedFavicons.href;
          if (faviconUrl.startsWith("//")) {
            faviconUrl = `${baseUrl.protocol}${faviconUrl}`;
          } else if (faviconUrl.startsWith("/")) {
            faviconUrl = `${baseUrl.origin}${faviconUrl}`;
          }

          const { data } = await axios.get(faviconUrl, { responseType: "blob", timeout: FAVICON_TIMEOUT });
          return data;
        } catch {}
      }
    }
  }

  throw new Error("Can't find any favicons from this site");
}

export type getFaviconMetadata = Required<Pick<ISiteMetadata, "id" | "urls">> & Pick<ISiteMetadata, "favicon">;

export async function getFavicon(site: getFaviconMetadata): Promise<string> {
  const { id: siteId, urls: siteUrls, favicon: siteFavicon } = site;

  // 1. 检查本地icons目录是否存在对应文件
  let checkLocalIconPaths = [`${siteId}.png`, `${siteId}.ico`, `${siteId}.svg`];

  if (siteFavicon) {
    if (siteFavicon.startsWith("data:image/")) {
      return siteFavicon; // base64直接返回就行了
    } else if (siteFavicon.startsWith("./")) {
      checkLocalIconPaths = [siteFavicon.replace(/^\.\//, ""), ...checkLocalIconPaths]; // 优先使用 已定义的 favicon
    }
  }

  for (const checkLocalIconPath of checkLocalIconPaths) {
    if (__RESOURCE_SITE_ICONS__.includes(checkLocalIconPath)) {
      return `/icons/site/${checkLocalIconPath}`;
    }
  }

  // 2. 检查网站是否有对应icon
  let faviconMeta;

  // 2.1 ISiteMetadata 中定义的 favicon 字段为一个链接
  if (siteFavicon && siteFavicon.startsWith("http")) {
    try {
      const configReq = await axios.get(siteFavicon, { responseType: "blob", timeout: FAVICON_TIMEOUT });
      faviconMeta = configReq.data;
    } catch {}
  }

  // 2.2 请求网站首页，并从返回的html中解析所需要的 favicon 字段
  if (!faviconMeta) {
    for (const url of siteUrls) {
      try {
        faviconMeta = await getFaviconFromUrl(url);
        break;
      } catch {}
    }
  }

  // 将请求结果转为 base64
  let faviconBase64;
  if (typeof faviconMeta !== "undefined") {
    faviconBase64 = await blobToDataUrl(faviconMeta, "favicon"); // 将 faviconMeta 转成 base64，并缓存
  }

  // 3. fallback 使用 NO_IMAGE 替代
  faviconBase64 ??= NO_IMAGE;

  return faviconBase64;
}
