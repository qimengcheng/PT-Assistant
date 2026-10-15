import Sizzle from "sizzle";
import { mergeWith, toMerged, omit } from "es-toolkit";
import { set } from "es-toolkit/compat";

import PrivateSite from "./AbstractPrivateSite";
import {
  EResultParseStatus,
  ETorrentStatus,
  type IElementQuery,
  type ILevelRequirement,
  type ISearchCategories,
  type ISearchEntryRequestConfig,
  type ISearchInput,
  type ISearchResult,
  type ISiteMessage,
  type ISiteMessageActionResult,
  type ISiteMetadata,
  type ITorrent,
  type ITorrentTag,
  type IUserInfo,
} from "../types";
import {
  createDocument,
  definedFilters,
  extractContent,
  parseSizeString,
  parseTimeToLiveToDate,
  parseValidTimeString,
  sizePattern,
  sleep,
} from "../utils";

export const CategoryIncldead: ISearchCategories = {
  name: "显示断种/活种？",
  key: "incldead",
  options: [
    { name: "全部", value: 0 },
    { name: "仅活种", value: 1 },
    { name: "仅断种", value: 2 },
  ],
  cross: false,
};

export const CategorySpstate: ISearchCategories = {
  name: "促销种子？",
  key: "spstate",
  options: [
    { name: "全部", value: 0 },
    { name: "普通", value: 1 },
    { name: "免费", value: 2 },
    { name: "2X", value: 3 },
    { name: "2X免费", value: 4 },
    { name: "50%", value: 5 },
    { name: "2X 50%", value: 6 },
    { name: "30%", value: 7 },
  ],
  cross: false,
};

export const CategoryInclbookmarked: ISearchCategories = {
  name: "显示收藏？",
  key: "inclbookmarked",
  options: [
    { name: "全部", value: 0 },
    { name: "仅收藏", value: 1 },
    { name: "仅未收藏", value: 2 },
  ],
  cross: false,
};

export const baseUserIdSelector: string[] = [
  /**
   * 优先使用 #info_block 中的链接，因为部分站点可能会在其他位置放置一个指向其他用户详情页的链接，导致获取到其他用户的 id 和 name
   * refs: https://github.com/xiaomlove/nexusphp/blob/3dae3aec8d8340d48f9bf544479aa4dac4456cb6/include/functions.php#L2706-L2710
   */
  "#info_block a[href*='userdetails.php'][href*='id=']:first",
  // 原PTPP使用的选择器
  "a[href*='userdetails.php'][class*='Name']:first",
  "a[href*='userdetails.php']:first",
];

export const baseTitleQuery: IElementQuery = {
  selector: [
    "a[href^='details.php?id='][title]:has(b)",
    "a[href*='details.php?id='][href*='hit']",
    "a[href*='hit'][title]",
    "a[href*='hit']:has(b)",
  ],
};

export const baseLinkQuery: IElementQuery = {
  selector: ['a[href*="download.php?id="]:has(> img[alt="download"])'],
  attr: "href",
} as const;

export function createUserBonusSelectorFn(bonusKeys: string[]): IElementQuery {
  const bonusRegExp = new RegExp(`(${bonusKeys.join("|")}).+?([\\d.]+)`);
  return {
    selector: [
      ...bonusKeys.map(
        (bonusKey) =>
          "td.rowhead" +
          // 防止 &nbsp; 影响
          bonusKey
            .split(" ")
            .map((x) => `:contains('${x}')`)
            .join("") +
          ` + td`,
      ),
      ...bonusKeys.map((bonusKey) => `td.rowfollow:contains('${bonusKey}')`),
    ],
    filters: [
      (query: string) => {
        query = query.replace(/,/g, "");
        if (bonusRegExp.test(query)) {
          query = query.match(bonusRegExp)![2];
          return parseFloat(query);
        } else if (/[\d.]+/.test(query)) {
          return parseFloat(query.match(/[\d.]+/)![0]);
        }
        return query;
      },
    ],
  };
}

const parseProgressElement = (element: HTMLElement) => {
  const progressElement = element.parentElement?.querySelector("div");
  if (!progressElement) return null;
  const progressTitle = progressElement.getAttribute("title");
  const parts = progressTitle?.split(" ");
  if (!parts || parts.length != 2) return null;
  const status = parts[0];
  const progress = parts[1];
  return { status: status, progress: progress };
};

/**
 * 处理 NexusPHP 中 DiffInSection 的 HnR，例如 [xx区: 0/0/10 yy区: 0/0/10 ...]
 * refs: https://github.com/xiaomlove/nexusphp/blob/php8/app/Repositories/HitAndRunRepository.php#L445
 * @param element HTMLElement，由选择器匹配到，选择器通常是 "#info_block a[href*='myhr.php']:last"
 */
export const parseSectionedHitAndRunElement = (element: HTMLElement) => {
  const textContent = element.textContent || "";
  const preWarningCount = [...textContent.matchAll(/\s(\d+)\//g)]
    .map((m) => parseInt(m[1] || "0", 10)) // m[1] 是捕获组
    .filter(Number.isFinite)
    .reduce((acc, val) => acc + val, 0);

  const fontElements = element.querySelectorAll("font[color*='red']") ?? [];
  const unsatisfiedCount = Array.from(fontElements)
    .map((e) => parseInt(e.textContent?.trim() || "0", 10))
    .filter(Number.isFinite)
    .reduce((acc, val) => acc + val, 0);

  return { hnrPreWarning: preWarningCount || 0, hnrUnsatisfied: unsatisfiedCount || 0 };
};

/**
 * Create an element processor to extract a cleaned subtitle string from a torrent title element.
 *
 * This factory returns a function which, given an HTMLElement that belongs to a title row,
 * will inspect its parent's innerHTML, split on "<br>", and take the last fragment as the
 * subtitle HTML. It then removes any nodes matching `removeSelectors` from that fragment
 * before returning the cleaned text content. If no subtitle fragment is found, it returns
 * an empty string.
 *
 * @param removeSelectors - Array of CSS selectors to remove from the subtitle fragment. Defaults to [].
 *                          Each selector will be used with querySelectorAll on a temporary container.
 * @param self - When true (default) remove the matched element itself; when false remove its parent element instead.
 * @returns A function that accepts the matched title element and returns the cleaned subtitle string.
 */
export const subTitleRemoveExtraElement =
  (removeSelectors: string[] = [], self: boolean = true) =>
  (element: HTMLElement) => {
    const testSubTitle = element.parentElement!.innerHTML.split("<br>");
    if (testSubTitle && testSubTitle.length > 1) {
      const subTitleHtml = testSubTitle[testSubTitle.length - 1];

      // 移除 removeSelectors 的内容
      const div = document.createElement("div");
      div.innerHTML = subTitleHtml;
      for (const removeSelectorsKey of removeSelectors) {
        div.querySelectorAll(removeSelectorsKey).forEach((el) => (self ? el : el.parentElement!).remove());
      }
      return extractContent(div.innerHTML).trim();
    }
    return "";
  };

/**
 * From:
 * - https://github.com/xiaomlove/nexusphp/blob/ee30a70cb9e81628ca6721883aaddab58f789891/app/Models/User.php#L61-L68
 * - https://github.com/xiaomlove/nexusphp/blob/ee30a70cb9e81628ca6721883aaddab58f789891/config/allconfig.php#L20-L51
 */
export const xiaomloveDefaultUserLevelRequirements: ILevelRequirement[] = [
  {
    id: 1,
    name: "Peasant",
    privilege:
      "被降级的用户，他们有30天时间来提升分享率，否则他们会被踢。不能发表趣味盒内容;不能申请友情链接;不能上传字幕。",
  },
  {
    id: 2,
    name: "User",
    privilege: "新用户的默认级别。只能在每周六中午12点至每周日晚上11点59分发布种子。",
  },
  {
    id: 3,
    name: "Power User",
    interval: "P4W",
    seedingBonus: 40000,
    downloaded: "50GB",
    ratio: 1.05,
    privilege:
      "得到一个邀请名额;可以直接发布种子;可以查看NFO文档;可以查看用户列表;可以请求续种;可以发送邀请;" +
      "可以查看排行榜;可以查看其它用户的种子历史(如果用户隐私等级未设置为”强”);可以删除自己上传的字幕。",
  },
  {
    id: 4,
    name: "Elite User",
    interval: "P8W",
    seedingBonus: 80000,
    downloaded: "120GB",
    ratio: 1.55,
    privilege: "Elite User及以上用户封存账号后不会被删除。",
  },
  {
    id: 5,
    name: "Crazy User",
    interval: "P15W",
    seedingBonus: 150000,
    downloaded: "300GB",
    ratio: 2.05,
    privilege: "得到两个邀请名额;可以在做种/下载/发布的时候选择匿名模式。",
  },
  {
    id: 6,
    name: "Insane User",
    interval: "P25W",
    seedingBonus: 250000,
    downloaded: "500GB",
    ratio: 2.55,
    privilege: "可以查看普通日志。",
  },
  {
    id: 7,
    name: "Veteran User",
    interval: "P40W",
    seedingBonus: 400000,
    downloaded: "750GB",
    ratio: 3.05,
    isKept: true,
    privilege: "得到三个邀请名额；可以查看其它用户的评论、帖子历史。Veteran User及以上用户会永远保留账号。",
  },
  {
    id: 8,
    name: "Extreme User",
    interval: "P60W",
    seedingBonus: 600000,
    downloaded: "1024GB",
    ratio: 3.55,
    isKept: true,
    privilege: "可以更新过期的外部信息；可以查看Extreme User论坛。",
  },
  {
    id: 9,
    name: "Ultimate User",
    interval: "P80W",
    seedingBonus: 800000,
    downloaded: "1536GB",
    ratio: 4.05,
    isKept: true,
    privilege: "得到五个邀请名额。",
  },
  {
    id: 10,
    name: "Nexus Master",
    interval: "P100W",
    seedingBonus: 1000000,
    downloaded: "3072GB",
    ratio: 4.55,
    isKept: true,
    privilege: "得到十个邀请名额。",
  },
  {
    id: 100,
    groupType: "vip",
    name: "VIP",
    nameAka: ["贵宾", "贵宾(VIP)"],
    privilege: "和Nexus Master拥有相同权限并被认为是精英成员。免除自动降级。",
  },
  {
    id: 200,
    groupType: "manager",
    name: "Retiree",
    nameAka: ["养老族", "养老族(Retiree)"],
    privilege: "退休后的管理组成员。",
  },
  {
    id: 201,
    groupType: "manager",
    name: "Uploader",
    nameAka: ["发布员", "发布员(Uploader)"],
    privilege: "专注的发布者。免除自动降级；可以查看匿名用户的真实身份。",
  },
  {
    id: 202,
    groupType: "manager",
    name: "Moderator",
    nameAka: ["总版主", "总版主(Moderator)"],
    privilege:
      "可以查看管理组信箱、举报信箱；管理趣味盒内容、投票内容；可以编辑或删除任何发布的种子；可以管理候选；可以管理论坛帖子、用户评论；" +
      "可以查看机密日志；可以删除任何字幕；可以管理日志中的代码、史册；可以查看用户的邀请记录；可以管理用户帐号的一般信息。" +
      "不能管理友情链接、最近消息、论坛版块；不能将种子设为置顶或促销；不能查看用户IP或Email等机密信息；不能删除账号。",
  },
  {
    id: 203,
    groupType: "manager",
    name: "Administrator",
    nameAka: ["管理员", "管理员(Administrator)"],
    privilege: "除了不能改变站点设定、管理捐赠外，可以做任何事。",
  },
  {
    id: 204,
    groupType: "manager",
    name: "Sysop",
    nameAka: ["维护开发员", "维护开发员(Sysop)"],
    privilege: "网站开发/维护人员，可以改变站点设定，不能管理捐赠。",
  },
  {
    id: 205,
    groupType: "manager",
    name: "Staff Leader",
    nameAka: ["主管", "主管(Staff Leader)"],
    privilege: "网站主管，可以做任何事。",
  },
];

export const defaultUserLevelRequirements = xiaomloveDefaultUserLevelRequirements.map((level) => {
  return omit(level, ["bonus"]);
}) as ILevelRequirement[];

/**
 * NexusPHP 模板默认配置，对于大多数NPHP站点都通用
 * @protected
 */
export const SchemaMetadata: Pick<
  ISiteMetadata,
  "version" | "schema" | "type" | "timezoneOffset" | "search" | "list" | "userInfo" | "detail"
> = {
  version: 0,
  schema: "NexusPHP",
  type: "private",
  timezoneOffset: "+0800", // NPHP 一般都是国内用，时区多为 +0800
  search: {
    keywordPath: "params.search",
    /**
     * 翻页规则，由用户 2026-10-15 给的那一页 PTzone 真页源码定死（不靠上游仓库猜）：
     * 结果共 124 条、每页 50 条，那一页的分页条 `<p class="nexus-pagination">` 写的是
     * `当前 <b>1 - 50</b> | <a href="?…&page=1"><b>51 - 100</b></a> | <a href="?…&page=2"><b>101 - 124</b></a>`
     * ⇒ **`page` 是 0 基**：不带（或 `page=0`）= 第一页，`page=1` = 第二页。
     * 这一族的 169 个站点定义共用这条规则；个别改版站如果不一样，要它自己的定义里覆盖。
     */
    pagination: { param: "page", firstPageIndex: 0 },
    requestConfig: {
      url: "/torrents.php",
      params: { notnewword: 1 },
    },
    advanceKeywordParams: {
      imdb: {
        requestConfigTransformer: ({ requestConfig: config }) => {
          set(config!, "params.search_area", 4); // params "&search_area=4"
          return config!;
        },
      },
    },
    selectors: {
      // row 等信息由 transformSearchPage 根据搜索结果自动生成
      link: baseLinkQuery, // 种子下载链接
      url: {
        ...baseLinkQuery,
        filters: [
          { name: "querystring", args: ["id"] },
          { name: "prepend", args: ["/details.php?id="] },
        ],
      }, // 种子页面链接
      id: {
        ...baseLinkQuery,
        filters: [{ name: "querystring", args: ["id"] }],
      },
      title: {
        ...baseTitleQuery,
        text: "",
        elementProcess: (element) => {
          return (element.getAttribute("title") || element.textContent || "").trim();
        },
      },
      subTitle: {
        ...baseTitleQuery,
        text: "",
        elementProcess: subTitleRemoveExtraElement(["a, span, img"], true),
      },
      progress: {
        ...baseTitleQuery,
        elementProcess: (element) => {
          const parsedProgress = parseProgressElement(element);
          if (!parsedProgress) return "0";
          return parseFloat(parsedProgress.progress);
        },
      },
      status: {
        ...baseTitleQuery,
        text: ETorrentStatus.unknown,
        elementProcess: (element) => {
          const parsedProgress = parseProgressElement(element);
          if (!parsedProgress) return ETorrentStatus.unknown;
          switch (parsedProgress.status) {
            case "leeching":
              return ETorrentStatus.downloading;
            case "seeding":
              return ETorrentStatus.seeding;
            case "inactivity":
              return parsedProgress.progress == "100%" ? ETorrentStatus.completed : ETorrentStatus.inactive;
          }
          return ETorrentStatus.unknown;
        },
      },
      category: {
        text: "Other",
        selector: ["a:first"],
        elementProcess: (element: HTMLElement) => {
          let category = "Other";
          const categoryImgAnother = element.querySelector("img:nth-child(1)"); // img:first
          if (categoryImgAnother) {
            category = categoryImgAnother.getAttribute("title") || categoryImgAnother.getAttribute("alt") || category;
          } else {
            return element.textContent || category;
          }

          return category.trim();
        },
      },
      time: {
        text: 0,
        elementProcess: (element: HTMLElement) => {
          let time: number | string = 0;
          try {
            const AccurateTimeAnother = element.querySelector("span[title], time[title]");
            if (AccurateTimeAnother) {
              time = AccurateTimeAnother.getAttribute("title")!;
            } else {
              time = extractContent(element.innerHTML.replace("<br>", " "));
            }

            if (time.match(/\d+[分时天月年]/g)) {
              time = parseTimeToLiveToDate(time);
            } else {
              time = parseValidTimeString(time);
            }
          } catch (e) {
            console.error("[NexusPHP] 解析发布时间失败，该条留空", e);
          }
          return time as number;
        },
      },
      ext_douban: {
        selector: ["span[data-doubanid]", "a[href*='douban.com']"],
        elementProcess: (element: HTMLAnchorElement | HTMLSpanElement) => {
          if (element.tagName.toLowerCase() === "span") {
            return element.dataset.doubanid || "";
          } else if (element.tagName.toLowerCase() === "a") {
            return (element as HTMLAnchorElement).getAttribute("href") || "";
          }
          return "";
        },
        filters: [{ name: "extDoubanId" }],
      },
      ext_imdb: {
        selector: ["span[data-imdbid]", "a[href*='imdb.com']"],
        elementProcess: (element: HTMLAnchorElement | HTMLSpanElement) => {
          if (element.tagName.toLowerCase() === "span") {
            return element.dataset.imdbid || "";
          } else if (element.tagName.toLowerCase() === "a") {
            return (element as HTMLAnchorElement).getAttribute("href") || "";
          }
          return "";
        },
        filters: [{ name: "extImdbId" }],
      },
      tags: [
        { name: "H&R", selector: "img.hitandrun", color: "black" },
        { name: "Free", selector: "img.pro_free", color: "blue" },
        { name: "2xFree", selector: "img.pro_free2up", color: "green" },
        { name: "2xUp", selector: "img.pro_2up", color: "lime" },
        { name: "2x50%", selector: "img.pro_50pctdown2up", color: "light-green" },
        { name: "30%", selector: "img.pro_30pctdown", color: "indigo" },
        { name: "50%", selector: "img.pro_50pctdown", color: "deep-orange-darken-1" },
      ],
    },
  },

  list: [
    {
      urlPattern: ["/torrents.php", "/special.php"],
    },
  ],

  detail: {
    urlPattern: ["/details.php"],

    selectors: {
      title: {
        selector: ["h1#top", "html > body > title"],
        switchFilters: {
          "h1#top": [
            (title: string) => {
              // ^(.+?)   .+$
              let titleMatch = title.match(/^(.+?) +.+$/);
              if (titleMatch && titleMatch.length >= 2) {
                return titleMatch[1].trim();
              }
              return title;
            },
          ],

          "html > body > title": [
            (title: string) => {
              // {siteName} :: 种子详情 "{torrentName}" - Powered by NexusPHP
              let titleMatch = title.match(/"(.+)" - Powered by NexusPHP$/);
              if (titleMatch && titleMatch.length >= 3) {
                return titleMatch[2].trim();
              }
              return title;
            },
          ],
        },
      },
      link: {
        selector: [
          'a[href*="download.php?id="][href*="&downhash="]',
          'a[href*="download.php?id="][href*="&passkey="]',
          'a[href*="download.php?downhash="]',
          // 如果上面三个都没拿到，则尝试使用nphp默认的下载链接selector
          'a[href*="download.php?id="]',
        ],
        attr: "href",
      },
    },
  },

  userInfo: {
    /**
     * 我们认为NPHP站的 id 的情况永远不变（实质上对于所有站点都应该是这样的）
     * 部分 NPHP 站点允许修改 name，所以 name 不能视为不变 ！！！
     */
    pickLast: ["id"],
    selectors: {
      // "page": "/index.php",
      id: {
        selector: baseUserIdSelector,
        attr: "href",
        filters: [{ name: "querystring", args: ["id"] }],
      },

      // "page": "/userdetails.php?id=$user.id$",
      name: {
        selector: baseUserIdSelector,
      },
      messageCount: {
        text: 0,
        selector: "td[style*='background: red'] a[href*='messages.php']",
        filters: [
          (query: string | number) => {
            const queryMatch = String(query || "").match(/(\d+)/); // query 有时会直接传入 0
            return queryMatch && queryMatch.length >= 2 ? parseInt(queryMatch[1]) : 0;
          },
        ],
      },
      uploaded: {
        text: 0,
        selector: [
          "td.rowhead:contains('传输') + td",
          "td.rowhead:contains('傳送') + td",
          "td.rowhead:contains('Transfers') + td",
          "td.rowfollow:contains('分享率')",
        ],
        filters: [
          (query: string) => {
            const queryMatch = query.replace(/,/g, "").match(/(上[传傳]量|Uploaded).+?([\d.]+ ?[ZEPTGMK]?i?B)/);
            return queryMatch && queryMatch.length === 3 ? parseSizeString(queryMatch[2]) : 0;
          },
        ],
      },
      trueUploaded: {
        text: 0,
        selector: [
          "td.rowhead:contains('传输') + td",
          "td.rowhead:contains('傳送') + td",
          "td.rowhead:contains('Transfers') + td",
          "td.rowfollow:contains('分享率')",
        ],
        filters: [
          (query: string) => {
            const queryMatch = query
              .replace(/,/g, "")
              .match(/((?:实际|真实)上传量|(?:實際|真實)上傳量|(?:Real|Actual) Uploaded).+?([\d.]+ ?[ZEPTGMK]?i?B)/);
            return queryMatch && queryMatch.length === 3 ? parseSizeString(queryMatch[2]) : 0;
          },
        ],
      },
      downloaded: {
        text: 0,
        selector: [
          "td.rowhead:contains('传输') + td",
          "td.rowhead:contains('傳送') + td",
          "td.rowhead:contains('Transfers') + td",
          "td.rowfollow:contains('分享率')",
        ],
        filters: [
          (query: string) => {
            const queryMatch = query.replace(/,/g, "").match(/(下[载載]量|Downloaded).+?([\d.]+ ?[ZEPTGMK]?i?B)/);
            return queryMatch && queryMatch.length === 3 ? parseSizeString(queryMatch[2]) : 0;
          },
        ],
      },
      trueDownloaded: {
        text: 0,
        selector: [
          "td.rowhead:contains('传输') + td",
          "td.rowhead:contains('傳送') + td",
          "td.rowhead:contains('Transfers') + td",
          "td.rowfollow:contains('分享率')",
        ],
        filters: [
          (query: string) => {
            const queryMatch = query
              .replace(/,/g, "")
              .match(/((?:实际|真实)下载量|(?:實際|真實)下載量|(?:Real|Actual) Downloaded).+?([\d.]+ ?[ZEPTGMK]?i?B)/);
            return queryMatch && queryMatch.length === 3 ? parseSizeString(queryMatch[2]) : 0;
          },
        ],
      },
      levelName: {
        selector: [
          "td.rowhead:contains('等级') + td > img",
          "td.rowhead:contains('等級')  + td > img",
          "td.rowhead:contains('Class')  + td > img",
        ],
        attr: "title",
      },
      isDonor: {
        text: false,
        selector: ["h1:has(img[src^='pic/flag']) img[alt='Donor']"],
        elementProcess: () => true,
      },
      bonus: createUserBonusSelectorFn([
        // 官方语言包
        // refs: https://github.com/search?q=repo%3Axiaomlove%2Fnexusphp+row_karma_points+path%3A%2F%5Elang%5C%2F%2F&type=code
        "魔力值",
        "Karma Points",
        // "Karma Poeng",
        // "Punti Karma",
        // "Pontos de Karma",
        // "Karma body",
        // "Karma Punten",
        // "Punkty Karmy",
        // "Karma Punkte",
        // "Karma Pisteet",
        // "Очки Кармы",
        // "Puncte Karma",
        // "Πόντοι Κάρμα",
        // "Karma Poäng",
        // "カルマポイント",

        // 特殊站点适配（此处仅保留因历史原因遗留的适配，其他请在站点配置中覆写）
        // "麦粒", // nwsuaf6 ( dead )
        "星焱", // tmpt
        "魅力值",
        "沙粒",

        // 回落 fallback
        "魔力",
      ]),
      seedingBonus: createUserBonusSelectorFn(["做种积分", "Seeding Points", "做種積分", "保种积分"]),
      joinTime: {
        selector: ["td.rowhead:contains('加入日期') + td", "td.rowhead:contains('Join'):contains('date') + td"],
        filters: [
          (query: string) => {
            query = query.split(" (")[0];
            return parseValidTimeString(query);
          },
        ],
      },
      hnrPreWarning: {
        // example: H&R: 2/1/5
        text: 0,
        selector: ["#info_block a[href*='myhr.php']:last"],
        filters: [
          (query: string | number) => {
            const queryMatch = String(query || "").match(/\d+/);
            return queryMatch && queryMatch.length >= 1 ? parseInt(queryMatch[0]) : 0;
          },
        ],
      },
      hnrUnsatisfied: {
        text: 0,
        selector: ["#info_block a[href*='myhr.php']:last"],
        filters: [
          (query: string | number) => {
            const queryMatch = String(query || "").match(/\d+\s*\/\s*(\d+)/);
            return queryMatch && queryMatch.length >= 2 ? parseInt(queryMatch[1]) : 0;
          },
        ],
      },

      bonusPerHour: {
        selector: [
          "#outer td[rowspan]",
          "div:contains('你当前每小时能获取'):last",
          "div:contains('You are currently getting'):last",
          "div:contains('你當前每小時能獲取'):last",
        ],
        filters: [{ name: "parseNumber" }],
      },

      lastAccessAt: {
        selector: [
          "td.rowhead:contains('最近动向') + td",
          "td.rowhead:contains('最近動向') + td",
          "td.rowhead:contains('Last Action') + td",
        ],
        filters: [{ name: "split", args: ["(", 0] }, { name: "parseTime" }],
      },

      /**
       * 如果指定 seeding 和 seedingSize，则会尝试从 "/userdetails.php?id=$user.id$" 页面获取，
       * 否则将使用方法 parseUserInfoForSeedingStatus 进行获取
       *
       */
      // seeding: { }
      // seedingSize: { }
    },
    process: [
      {
        requestConfig: { url: "/index.php", responseType: "document" },
        fields: ["id"],
      },
      {
        requestConfig: { url: "/userdetails.php", responseType: "document" },
        assertion: { id: "params.id" },
        fields: [
          "name",
          "messageCount",
          "uploaded",
          "trueUploaded",
          "downloaded",
          "trueDownloaded",
          "levelName",
          "bonus",
          "seedingBonus",
          "joinTime",
          "seeding",
          "seedingSize",
          "hnrUnsatisfied",
          "hnrPreWarning",
          "lastAccessAt",
          "isDonor",
        ],
      },
      {
        requestConfig: { url: "/mybonus.php", responseType: "document" },
        fields: ["bonusPerHour", "seedingBonusPerHour"],
      },
    ],
    /**
     * donorConfig 配置捐赠者（黄星）的特殊权限
     * - isAccountKept: false（NexusPHP 默认黄星不免疫不活跃）
     * - bonusPerHourMultiplier: 2（NexusPHP 默认时魔 2 倍） 站点配置中，如果能直接使用 selector 选出正确的时魔，则此系数应设为 1
     */
    donorConfig: {
      isAccountKept: false,
      bonusPerHourMultiplier: 2,
    },
  },
};

/**
 * 像绝对时间的文本（`2026-10-01 13:50:50` / `10-01-2026`）。
 * 信箱列表里用它挑出"哪一格/哪个 title 是时间"：皮肤常把绝对时间放 title、文字给相对时间。
 */
const isDateTimeText = (text: string): boolean => /\d{4}-\d{2}-\d{2}|\d{2}-\d{2}-\d{4}/.test(text);

/** 解析那一页时发现「末尾一行比表头短」记下的现场（行数 / 那半行有几格 / 表头有几格） */
type ITailCut = { rowCount: number; cells: number; headCells: number };

export default class NexusPHP extends PrivateSite {
  protected guessSearchFieldIndexConfig(): Record<string, string[]> {
    return {
      author: ['a[href*="sort=9"]'], // 发布者
      comments: ["img.comments"], // 评论数
      completed: ["img.snatched"], // 完成数
      leechers: ["img.leechers"], // 下载数
      seeders: ["img.seeders"], // 种子数
      size: ["img.size"], // 大小
      time: ["img.time"], // 发布时间 （仅生成 selector， 后面会覆盖）
    } as Record<keyof ITorrent, string[]>;
  }

  /**
   * 上面那一轮**一个都没认出来**时，改用表头格子里的文字（含 img 的 alt/title）再认一次。
   *
   * 为什么需要：`img.size` 这一族 class 是皮肤的一部分，不少站把标记换成了纯文字表头或只留
   * `alt`（1PTBar 那一屏：大小/做种/下载/完成/评论/发布于 六列全空，而靠**文字**匹配的
   * 「分类」列正常 —— 用户 2026-10-15 的截图）。LuckPT 那次是同一族的第三种形状（挪进了
   * `td[data-col]`），那一站走的是站点级 override。
   *
   * 歧义不靠别名顺序压，靠配对规则压：一个格子命中两个以上字段、或一个字段被两个格子命中，
   * 这一轮就都不指派（见 `transformSearchPage` 里那条互斥判据）。所以最坏情况是「仍然认不出」，
   * 不会把某一列指派到隔壁那一格。
   *
   * 刻意不含 `author`：它的判据是 `a[href*="sort=9"]` 那根链接，文字「发布者/上传」与
   * 「下载」「上传时间」这几格撞得更凶。
   */
  protected guessSearchFieldTextConfig(): Record<string, RegExp> {
    return {
      size: /大小|\bsize\b/i,
      seeders: /做种|种子数|seeders?\b/i,
      leechers: /下载|leechers?\b/i,
      completed: /完成|snatched|completed/i,
      comments: /评论|回复|comments?\b/i,
      time: /发布|加入时间|上传时间|\btime\b|\badded\b/i,
    };
  }

  protected get customTagsLocaterSelector(): string {
    return "table.torrentname";
  }

  /**
   * 上一次解析的那一页是不是「断在某一行的中间」。null = 没发现断点。
   *
   * 为什么要记这一笔：站点（或它前面那层代理）把响应掐断时，浏览器照常把已经收到的那半行
   * 留在表里，于是解析器看到的是「一张少了后面几十行的表」，一路成功 ——
   * 界面上就是「站点自己 124 条、插件只有 3 条，而状态写成功」，
   * 其中最后一条只有标题，大小/做种/下载/完成/评论/发布于 全空（它根本没有那些格）。
   * 判据与复现见 .tmp-build/bench-ptzone（PTZone 真页 + 三种截法，用户 2026-10-15）。
   */
  protected searchPageTailCut: ITailCut | null = null;

  /**
   * 「发现断点就重发」一共允许发几次（含第一次）。
   *
   * 为什么是 3 而不是 2：用户 2026-10-15 在同一站点上给了两个相反方向的实测 ——
   * 「第一次只有 2 条半，但是刷新一下就好了」（⇒ 重发有用）和
   * 「我从一个新的标签页打开也是只有两行半」（⇒ 一次重发不够，偶发不能按"每次都能碰上一次"来赌）。
   * 每次重发之间隔 1s，最坏多花 2s，只发生在"这一页确实断了"那一条路上，完整的页一次就返回。
   */
  protected searchPageTailCutAttempts = 3;

  public override async getSearchResult(
    keywords?: string,
    searchEntry: ISearchEntryRequestConfig = {},
  ): Promise<ISearchResult> {
    const cutAttempts: { result: ISearchResult; cut: ITailCut }[] = [];

    for (let attempt = 0; attempt < this.searchPageTailCutAttempts; attempt += 1) {
      if (attempt > 0) await sleep(1000);
      this.searchPageTailCut = null;
      const result = await super.getSearchResult(keywords, searchEntry);
      // 没记断点 = 这一趟拿到的是完整页（或压根没走到表格，如未登录/无结果），照原样返回
      const cut = this.searchPageTailCut;
      if (!cut) return result;
      cutAttempts.push({ result, cut });
    }

    // 几次都断：留着条目最多的那一次（后面那次的行数少不代表站点信息更少），
    // 再把这一站标成不完整 —— 不能让手里这几条冒充整页结果
    const best = cutAttempts.reduce((a, b) => (b.result.data.length > a.result.data.length ? b : a));
    this.searchPageTailCut = best.cut;
    best.result.status = EResultParseStatus.parseError;
    best.result.statusMsg = "i18n.truncatedSearchPage";
    return best.result;
  }

  public override async transformSearchPage(
    doc: Document | object | any,
    searchConfig: ISearchInput,
  ): Promise<ITorrent[]> {
    const { keywords, searchEntry, requestConfig } = searchConfig;

    // 返回是 Document 的情况才自动生成 row 选择器以及其他属性的选择器
    if (doc instanceof Document) {
      // 如果配置文件没有传入 search 的选择器，则我们自己生成
      const legacyTableSelector = "table.torrents:last";

      // 对于NPHP，一般来说，表的第一行应该是标题行，即 `> tbody > tr:nth-child(1)` ，但是也有部分站点为 `> thead > tr`
      const legacyTableHasThead = Sizzle(`${legacyTableSelector} > thead > tr`, doc).length > 0;

      const rowsWereGuessed = !searchEntry!.selectors!.rows;
      if (rowsWereGuessed) {
        searchEntry!.selectors!.rows = {
          // 对于有thead的站点，认为 > tbody > tr 均为种子信息，而无 thead 的站点则为 > tbody > tr:gt(0)
          selector: `${legacyTableSelector} > tbody > tr` + (legacyTableHasThead ? "" : ":gt(0)"),
        };
      }

      // 开始遍历我们的head行，并设置其他参数
      const headSelector =
        legacyTableSelector + (legacyTableHasThead ? " > thead > tr > th" : " > tbody > tr:eq(0) > td");
      const headAnother = Sizzle(headSelector, doc) as HTMLElement[];

      // ── 截断判据（只在我们自己建 rows 那一族上挂）──
      // 认的形状很窄：**只有末尾那一行比表头短、其余行都齐**。
      // 这一种只可能是响应流断在行中间（浏览器把没收完的那半行照常留在表里）；
      // 整表行行都短是另一回事（那一站的表头与数据本就不是一套），不在这里出声，
      // 免得把 134 个共用这一段的站点里本来能用的搜索误判成失败。
      const headCellCount = headAnother.length;
      if (rowsWereGuessed && headCellCount >= 2 && searchEntry!.selectors!.rows) {
        searchEntry!.selectors!.rows.filter = (rows: HTMLElement[]) => {
          if (!Array.isArray(rows) || rows.length < 2) {
            return rows;
          }
          const cellCountOf = (row: HTMLElement) => Sizzle("> td", row).length;
          const lastRow = rows[rows.length - 1];
          const lastRowCells = cellCountOf(lastRow);
          if (lastRowCells >= headCellCount) {
            return rows;
          }
          if (rows.slice(0, -1).some((row) => cellCountOf(row) < headCellCount)) {
            return rows;
          }
          this.searchPageTailCut = { rowCount: rows.length, cells: lastRowCells, headCells: headCellCount };
          // 那半行没有 id、没有下载链接，摆在列表里就是一条点不动的假种子，取掉
          return rows.slice(0, -1);
        };
      }
      // 第一轮认上了哪些字段、各认在哪一格：第二轮只补没认上的那些，且不跟已占掉的格子抢
      const assignedAt = new Map<string, number>();
      headAnother.forEach((element, elementIndex) => {
        // 比较好处理的一些元素，都是可以直接获取的
        let updateSelectorField;
        if (/(cat|类型|類型|分类|分類|Тип)/gi.test(element.innerText)) {
          updateSelectorField = "category";
        } else {
          for (const [dectField, dectSelector] of Object.entries(this.guessSearchFieldIndexConfig())) {
            for (const dectFieldElement of dectSelector) {
              if (Sizzle(dectFieldElement, element).length > 0) {
                updateSelectorField = dectField;
                break;
              }
            }
          }
        }

        if (updateSelectorField) {
          assignedAt.set(updateSelectorField, elementIndex);
          // @ts-ignore
          searchEntry.selectors[updateSelectorField] = toMerged(
            {
              selector: [`> td:eq(${elementIndex})`],
            },
            // @ts-ignore
            searchEntry.selectors[updateSelectorField] || {},
          );
        }
      });

      // ── 第二轮：只补第一轮**一列都没认出来**的那几列，改读表头的文字（含 img 的 alt/title）──
      // 为什么要有这一轮：`img.size` 那一族 class 属于皮肤，皮肤换成纯文字表头或只留 alt 时，
      // 大小/做种/下载/完成/评论/发布于 六列会一起没被指派（界面上是空白，而靠文字认的「分类」列正常
      // —— 1PTBar 就是这个形状，用户 2026-10-15）。
      // 判据是「格子 ↔ 字段」的互斥配对：一格顶两个字段、或一字段被两格顶到，两边都不指派。
      // 所以最坏情况仍然是「认不出、那一列空着」，不会把隔壁那一列指派错（那才是真会读出错数据的方向）。
      const pendingFields = Object.entries(this.guessSearchFieldTextConfig()).filter(
        ([field]) => !assignedAt.has(field),
      );
      if (pendingFields.length > 0 && searchEntry?.selectors) {
        const headTextOf = (element: HTMLElement): string => {
          const text = element.innerText || element.textContent || "";
          // 不只查 img：有的皮肤把说明挂在 `<a title>` 或 `<span title>` 上
          const marks = Array.from(element.querySelectorAll("[alt], [title]"));
          const alts = marks
            .map((mark) => `${mark.getAttribute("alt") ?? ""} ${mark.getAttribute("title") ?? ""}`)
            .join(" ");
          return `${text} ${alts}`;
        };
        const claimedIndexes = new Set<number>(assignedAt.values());
        const cellHits: { index: number; fields: string[] }[] = [];
        headAnother.forEach((element, elementIndex) => {
          if (claimedIndexes.has(elementIndex)) return;
          const headText = headTextOf(element);
          const fields = pendingFields.filter(([, pattern]) => pattern.test(headText)).map(([field]) => field);
          if (fields.length > 0) cellHits.push({ index: elementIndex, fields });
        });

        const fieldHitCount = new Map<string, number>();
        for (const hit of cellHits) {
          for (const field of hit.fields) fieldHitCount.set(field, (fieldHitCount.get(field) ?? 0) + 1);
        }

        // 动态键（字段名是字符串）在这里收窄一次类型，不用 `@ts-ignore`：
        // packages 那一档的 warning 按基线只拦回涨，多两条 CI 就红（AGENTS §2.1）
        const selectors = searchEntry.selectors as Record<string, object>;
        for (const hit of cellHits) {
          if (hit.fields.length !== 1) continue;
          const [field] = hit.fields;
          if (fieldHitCount.get(field) !== 1) continue;
          selectors[field] = toMerged({ selector: [`> td:eq(${hit.index})`] }, selectors[field] ?? {});
        }
      }
    }

    // !!! 其他一些比较难处理的，我们把他 hack 到 parseWholeTorrentFromRow 中 !!!
    return await super.transformSearchPage(doc, { keywords, searchEntry, requestConfig });
  }

  public override async getUserInfoResult(lastUserInfo: Partial<IUserInfo> = {}): Promise<IUserInfo> {
    let flushUserInfo = await super.getUserInfoResult(lastUserInfo);

    // 导入用户做种信息
    if (
      flushUserInfo.status === EResultParseStatus.success &&
      (typeof flushUserInfo.seeding === "undefined" || typeof flushUserInfo.seedingSize === "undefined")
    ) {
      await this.sleepAction(this.metadata.userInfo?.requestDelay);
      flushUserInfo = (await this.parseUserInfoForSeedingStatus(flushUserInfo)) as IUserInfo;
    }

    // 导入用户发布信息
    if (flushUserInfo.status === EResultParseStatus.success && typeof flushUserInfo.uploads === "undefined") {
      await this.sleepAction(this.metadata.userInfo?.requestDelay);
      flushUserInfo = (await this.parseUserInfoForUploads(flushUserInfo)) as IUserInfo;
    }

    // 处理捐赠者的特殊配置
    if (flushUserInfo.status === EResultParseStatus.success) {
      const donorConfig = this.metadata.userInfo?.donorConfig;
      if (flushUserInfo.isDonor === true && typeof flushUserInfo.bonusPerHour === "number") {
        const bonusPerHourMultiplier = donorConfig?.bonusPerHourMultiplier ?? 1;
        flushUserInfo.bonusPerHour *= bonusPerHourMultiplier;
      }
    }

    return flushUserInfo;
  }

  /**
   * 鉴于NexusPHP这里使用ajax交互，如果强行指定 responseType: 'document' ，
   * 由于返回字段并不是 valid-html, 此时会解析失败（即 data = undefined ），
   * 所以此处不指定 responseType，而是返回文本形式的 string，交由 getUserSeedingStatus
   * 生成 Document
   *
   * @param userId
   * @param type
   * @protected
   */
  protected async requestUserSeedingPage(userId: number, type: string = "seeding"): Promise<string | null> {
    const { data } = await this.request<string>({
      url: "/getusertorrentlistajax.php",
      params: { userid: userId, type },
    });
    return data || null;
  }

  protected async parseUserInfoForSeedingStatus(flushUserInfo: Partial<IUserInfo>): Promise<Partial<IUserInfo>> {
    const userId = flushUserInfo.id as number;
    const userSeedingRequestString = await this.requestUserSeedingPage(userId);

    let seedStatus = { seeding: 0, seedingSize: 0 };
    if (userSeedingRequestString && userSeedingRequestString?.includes("<table")) {
      const userSeedingDocument = createDocument(userSeedingRequestString);
      /**
       * #1060 HUDBT 等站点可能存在 seeding table 中也有 "xx | xx" 的文本，但并非我们需要的做种和做种大小信息
       * 所以需要找到和 table 平级的 div 中包含 " | " 的文本，才认为是我们需要的做种和做种大小信息
       * https://github.com/xiaomlove/nexusphp/blob/09b785902f5da87de7fa45dd5409eee37f78bc89/public/getusertorrentlistajax.php#L357-L358
       */
      const divSeeding = Sizzle("div:has( ~ table) > div:contains(' | ')", userSeedingDocument);
      if (divSeeding.length > 0 && divSeeding[0].textContent) {
        const seedingText = divSeeding[0].textContent.split("|");
        seedStatus.seeding = definedFilters.parseNumber(seedingText[0]);
        seedStatus.seedingSize = definedFilters.parseSize(seedingText[1]);
      } else {
        const trAnothers = Sizzle("table:last tr:not(:eq(0))", userSeedingDocument);
        if (trAnothers.length > 0) {
          seedStatus.seeding = trAnothers.length;

          // 根据自动判断应该用 td.rowfollow:eq(?)
          let sizeIndex = 2;
          const tdAnothers = Sizzle("> td", trAnothers[0]);
          for (let i = 0; i < tdAnothers.length; i++) {
            if (sizePattern.test((tdAnothers[i] as HTMLElement).innerText)) {
              sizeIndex = i;
              break;
            }
          }

          trAnothers.forEach((trAnother) => {
            const sizeSelector = Sizzle(`td:eq(${sizeIndex})`, trAnother)[0] as HTMLElement | undefined;
            // ⚠️ 一行缺格（站点改版）时这里取到 undefined，原先直接 `.innerText` 抛
            // TypeError —— 这一条才是真会崩的那条。
            // 顺带换成 textContent：本文件这层既可能是站点真实页面的 document，也可能是
            // fetch 回来交给 DOMParser 的文档，后者不保证有渲染树，textContent 不依赖排版。
            //（实测过 innerText 在 DOMParser 文档里并非「不存在」，但它在 display:none/
            // 未排版时按规范退化成 textContent 的变体，读法比 textContent 多一层不确定。）
            if (!sizeSelector) return;
            const sizeText = (sizeSelector.textContent ?? "").trim();
            if (!sizeText) return;
            seedStatus.seedingSize += parseSizeString(sizeText);
          });
        }
      }
    }

    flushUserInfo = mergeWith(flushUserInfo, seedStatus, (objValue, srcValue) => {
      return typeof srcValue === "undefined" ? objValue : srcValue;
    });

    return flushUserInfo;
  }

  protected async parseUserInfoForUploads(flushUserInfo: Partial<IUserInfo>): Promise<Partial<IUserInfo>> {
    const userId = flushUserInfo.id as number;
    const userUploadsRequestString = await this.requestUserSeedingPage(userId, "uploaded");
    flushUserInfo.uploads = 0;

    if (
      // 先按关键字匹配
      userUploadsRequestString &&
      /<b>\d+<\/b>(条记录| records|條記錄)|No record.|没有记录|沒有記錄/.test(userUploadsRequestString)
    ) {
      flushUserInfo.uploads = Number(userUploadsRequestString.match(/<b>(\d+)<\/b>(条记录| records|條記錄)/)?.[1] ?? 0);
    } else if (userUploadsRequestString && userUploadsRequestString?.includes("<table")) {
      // 未匹配到关键字，则从表格中解析
      const userUploadsDocument = createDocument(userUploadsRequestString);
      const divSeeding = Sizzle("div:has( ~ table) > div:contains(' | ')", userUploadsDocument);
      if (divSeeding.length > 0 && divSeeding[0].textContent) {
        const seedingText = divSeeding[0].textContent.split("|");
        flushUserInfo.uploads = definedFilters.parseNumber(seedingText[0]);
      } else {
        const trAnothers = Sizzle("table:last tr:not(:eq(0))", userUploadsDocument);
        flushUserInfo.uploads = trAnothers.length;
      }
    }

    return flushUserInfo;
  }

  protected override parseTorrentRowForTags(
    torrent: Partial<ITorrent>,
    row: Element | Document,
    searchConfig: ISearchInput,
  ): Partial<ITorrent> {
    super.parseTorrentRowForTags(torrent, row, searchConfig);

    // 新版 NPHP 支持自定义的tag
    const customTags = row.querySelectorAll(
      `${this.customTagsLocaterSelector} span[style*='background-color'][style*='color'][title]`,
    );
    if (customTags.length > 0) {
      const tags: ITorrentTag[] = torrent.tags || [];
      customTags.forEach((element) => {
        const htmlElement = element as HTMLElement;
        const tagName = htmlElement.textContent;
        let tagColor = htmlElement.style.backgroundColor;

        // 处理渐变色 linear-gradient(45deg, rgb(248, 87, 86), rgb(249, 166, 95)) 的情况，取第一个非白色的 rgb 颜色作为标签颜色
        if (tagColor === "" && htmlElement.style.backgroundImage?.startsWith("linear-gradient")) {
          const gradientMatch = htmlElement.style.backgroundImage.match(/rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)/g);

          if (gradientMatch && gradientMatch.length > 0) {
            for (const rgb of gradientMatch) {
              // 简单的过滤掉白色
              if (rgb.trim() !== "rgb(255, 255, 255)") {
                tagColor = rgb.trim();
                break;
              }
            }
          }
        }

        if (tagName && tagColor) {
          tags.push({ name: tagName, color: tagColor });
        }
      });

      torrent.tags = tags;
    }

    return torrent;
  }

  public override async getTorrentDownloadLink(torrent: ITorrent): Promise<string> {
    // 如果没有 link 属性，则尝试以 (url->)id->link 的方式生成
    if (!torrent.link) {
      if (!torrent.id && torrent.url) {
        const urlMatch = torrent.url.match(/[?&]id=(\d+)/);
        if (urlMatch && urlMatch.length >= 2) {
          torrent.id ??= urlMatch[1];
        }
      }

      if (torrent.id) {
        const mockRequestConfig = torrent.url?.startsWith("http") ? { url: torrent.url } : { baseURL: this.url };
        torrent.link = this.fixLink(`/download.php?id=${torrent.id}`, mockRequestConfig);
      }
    }

    // 对 NPHP 站点，如果前端拖拽功能发来的种子链接是 details.php?id=123 的形式，
    if (torrent.link && torrent.link.includes("/details.php")) {
      torrent.link = torrent.link.replace(/details\.php\?id=(\d+)/, "download.php?id=$1").replace(/&hit=1/, ""); // hit=1 是为了统计下载次数
    }

    return super.getTorrentDownloadLink(torrent);
  }

  // ===== 站内信（我的数据页点未读数字那条路）=====

  /** 信箱页地址：站点定义没填就走 NexusPHP 的默认路径 */
  protected get messageUrl(): string {
    return this.metadata.message?.url ?? "/messages.php";
  }

  public override get supportsMessages(): boolean {
    return true;
  }

  protected resolveSiteUrl(path: string): string {
    return path.startsWith("http") ? path : new URL(path, this.url).href;
  }

  /**
   * 读信箱列表。
   *
   * 判据是「这一行有没有指向单条正文的链接」。参数名各分支不统一：内核经典写法是
   * `messages.php?action=viewmessage&id=123`（2026-10-07 拿 LuckPT 真实信箱页核过，
   * 整页搜不到 `msgid` 三个字），也有变体用 `msgid` —— 两种都认。
   * v0.31.0 那版只认 `msgid`，于是所有站一条都读不出，界面退成「信箱页一条都没读到」。
   */
  public override async getMessages(): Promise<ISiteMessage[]> {
    const { data } = await this.request<string>({ url: this.messageUrl });

    if (typeof data !== "string" || !data) {
      return [];
    }

    const doc = createDocument(data);
    const messages: ISiteMessage[] = [];

    /**
     * 逐条**链接**去定位它自己那一行（`closest("tr")`），不是逐行去找链接：
     * 信箱页外层还有一整包裹住全站的 `<tr><td id="outer">`，按行走时那张大行
     * 会把所有消息当成"一行"、只吐出第一条（拿 LuckPT 真实页面跑仓库这份代码实测到的）。
     */
    const visited = new Set<HTMLTableRowElement>();
    for (const link of Sizzle("a[href*='viewmessage'], a[href*='msgid']", doc) as HTMLAnchorElement[]) {
      const row = link.closest("tr");
      if (!row || visited.has(row)) {
        continue;
      }
      visited.add(row);

      const title = extractContent(link.textContent ?? "");
      if (!title) {
        continue;
      }

      const cellList = Sizzle("td", row) as HTMLElement[];
      // 发讯者：用户发来的信带 user.php 链接，系统信是纯文本（LuckPT 那一列就是「系统」），
      // 所以链接取不到时退到主题格的下一格 —— 但挡掉长得像日期的，那种是列序不同的日期格。
      const senderNode = Sizzle("a[href*='user.php']", row)[0];
      const titleCellIndex = cellList.findIndex((td) => td.contains(link));
      const nextCellText =
        titleCellIndex >= 0 && Sizzle("input", cellList[titleCellIndex + 1] ?? doc.body).length === 0
          ? extractContent(cellList[titleCellIndex + 1]?.textContent ?? "")
          : "";
      // 时间：皮肤常把绝对时间放在 title 上、文字给相对时间
      // （LuckPT 是 `<span title="2026-10-01 13:50:50">6天4时前</span>`），所以 title 优先、文字兜底。
      const timeText =
        (Sizzle("span[title], td[title]", row) as HTMLElement[])
          .map((el) => el.getAttribute("title") ?? "")
          .find((text) => isDateTimeText(text)) ??
        cellList.map((td) => extractContent(td.textContent ?? "")).find((text) => isDateTimeText(text)) ?? "";
      const parsedTime = timeText ? parseValidTimeString(timeText) : undefined;

      messages.push({
        id: (link.href.match(/[?&](?:msgid|id)=(\d+)/) ?? [])[1],
        title,
        sender: senderNode
          ? extractContent(senderNode.textContent ?? "")
          : nextCellText && !isDateTimeText(nextCellText)
            ? nextCellText
            : undefined,
        time: typeof parsedTime === "number" ? parsedTime : undefined,
        // 未读标记三种都见过：整行 class 带 unread、状态格里带 unread 的图标、标题被 <b> 包着
        unread:
          /unread/i.test(row.className) ||
          Sizzle("[class*='unread']", row).length > 0 ||
          Sizzle("b", link).length > 0,
        url: this.resolveSiteUrl(link.getAttribute("href") ?? this.messageUrl),
      });
    }

    return messages;
  }

  /**
   * 读单条正文。**优先直接取列表页给的那条链接**：action 名（viewmessage / view）、
   * 参数名（id / msgid）、要不要 pop=1 各分支都不一样，而列表里那条链接一定是该站认的写法。
   * 没带 url 时才按经典写法拼一次参数（例如调用方只有 id）。
   */
  public override async getMessageContent(messageId: string, url?: string): Promise<string | undefined> {
    const { data } = url
      ? await this.request<string>({ url })
      : await this.request<string>({
          url: this.messageUrl,
          params: { action: "viewmessage", id: messageId },
        });

    if (typeof data !== "string" || !data) {
      return undefined;
    }

    const doc = createDocument(data);

    /**
     * 内核 messages.php?action=viewmessage 的正文是「独占一行的那一格」：
     * 表头是 自 / 日期 两列，正文行只有一个 td 且 colspan=2，最后一行又是 移至 / 删除 两列。
     * 判据取结构而不是 class —— 皮肤会改 class，colspan 是排版本身，改了就塌。
     * 真页核过：LuckPT 2026-10-01 那条「国庆节福利」（整页只有一处 colspan）。
     */
    const bodyCell = (Sizzle("tr", doc) as HTMLTableRowElement[])
      .map((tr) => Array.from(tr.children).filter((c) => c.tagName === "TD") as HTMLTableCellElement[])
      .find((tds) => tds.length === 1 && Number(tds[0].getAttribute("colspan") ?? "1") > 1)?.[0];
    if (bodyCell) {
      return extractContent(bodyCell.textContent ?? "").trim();
    }

    // 新版内核把正文放在 td.text。必须排掉外层布局格：真页上 `<td id="nav_block" class="text">`
    // 也带这个 class，而它装的是「欢迎回来 + 流量统计」那一整块 —— 不排就是之前那副坏样子。
    const direct = (Sizzle("td.text", doc) as HTMLTableCellElement[])
      .filter((td) => !td.querySelector("td"))
      .map((td) => extractContent(td.textContent ?? "").trim())
      .find((text) => text.length > 0);
    if (direct) {
      return direct;
    }

    // 连那一行的 colspan 都被改掉时的兜底：在所有「叶子格」里取最长的。
    // 必须排掉两类：包着别的 td 的外层布局格（不排就会拿到整页文本 —— 之前界面里
    // 那副「导航 + 欢迎回来 + 流量统计」的坏样子就是它），以及带表单控件的操作格
    //（「移至 收件箱 [删除] [转发短讯]」比很多正文还长）。
    const fallback = (Sizzle("td", doc) as HTMLTableCellElement[])
      .filter((td) => !td.querySelector("td, form, input, select, button"))
      .map((td) => extractContent(td.textContent ?? "").trim())
      .sort((a, b) => b.length - a.length)[0];

    // 8 个字符是挡住「自 / 日期 / 系统」这类表头与发件人名的下限，不是正文长度上限
    return fallback && fallback.length >= 8 ? fallback : undefined;
  }

  /**
   * 批量删除。**从信箱页现读现拼**，不写死 action / 参数名：找到那几条的复选框 →
   * 取它的 `name`（各分支叫 `delchecked[]` 还是别的都不一定）和它所在 `<form>` 的
   * action/method，再把表单里其余字段（`returnto`、某些皮肤自带的 authkey、下拉的当前项）
   * 一并照抄提交 —— 跟取正文用列表给的那条链接是同一个理由：**页面自己给的就是该站认的写法**，
   * 凭 NexusPHP 印象写死会让所有站都点不动（v0.31.0 那次写死 `msgid` 就是这么翻车的）。
   *
   * 一页上常同时挂着「删除」和「移至回收站」两套复选框，所以先挑 action 里带 delete 的那个表单；
   * 挑不到、但第一个表单的 action 明显是 move/restore 这类**不是删除**的动作时，宁可返回
   * supported:false 也不发这一枪 —— 删不动要说出来，不能报「已删除」。
   */
  public override async deleteMessages(messageIds: string[]): Promise<ISiteMessageActionResult> {
    const wanted = new Set(messageIds);
    if (wanted.size === 0) {
      return { supported: true, status: EResultParseStatus.success, handled: 0 };
    }

    const { data } = await this.request<string>({ url: this.messageUrl });
    if (typeof data !== "string" || !data) {
      return { supported: false, status: EResultParseStatus.parseError, handled: 0 };
    }

    const doc = createDocument(data);
    const boxes = (Sizzle("input[type='checkbox']", doc) as HTMLInputElement[]).filter((input) =>
      wanted.has(input.value),
    );
    if (boxes.length === 0) {
      return { supported: false, status: EResultParseStatus.parseError, handled: 0 };
    }

    const formOf = (input: HTMLInputElement) => input.closest("form");
    const isDeleteForm = (form: HTMLFormElement | null) =>
      !!form && /delete|remove|del\b/i.test(`${form.getAttribute("action") ?? ""} ${form.getAttribute("name") ?? ""}`);
    const isMoveForm = (form: HTMLFormElement | null) =>
      !!form && /move|restore|undelete/i.test(`${form.getAttribute("action") ?? ""} ${form.getAttribute("name") ?? ""}`);

    const chosen =
      boxes.find((input) => isDeleteForm(formOf(input))) ??
      (isMoveForm(formOf(boxes[0])) ? undefined : boxes[0]);
    const form = chosen ? formOf(chosen) : null;
    const field = chosen?.name;
    if (!form || !field) {
      return { supported: false, status: EResultParseStatus.parseError, handled: 0 };
    }

    const actionUrl = this.resolveSiteUrl(form.getAttribute("action") || this.messageUrl);
    const method = (form.getAttribute("method") || "post").toLowerCase() === "get" ? "get" : "post";
    const body = new URLSearchParams();
    const handled = new Set<string>();

    for (const el of Sizzle("input, select, textarea", form) as HTMLElement[]) {
      const name = el.getAttribute("name");
      if (!name) {
        continue;
      }
      if (el.tagName === "SELECT") {
        const selected = (el as HTMLSelectElement).selectedOptions?.[0];
        if (selected) {
          body.append(name, selected.value);
        }
        continue;
      }
      const input = el as HTMLInputElement;
      const type = (input.type || "text").toLowerCase();
      if (type === "checkbox") {
        // 浏览器只会带上勾上的复选框，这里同样只带用户挑中的那几条
        if (name === field && wanted.has(input.value)) {
          body.append(name, input.value);
          handled.add(input.value);
        }
        continue;
      }
      if (type === "submit" || type === "button" || type === "reset" || type === "image") {
        continue;
      }
      body.append(name, input.value ?? "");
    }

    if (handled.size === 0) {
      return { supported: false, status: EResultParseStatus.parseError, handled: 0 };
    }

    await this.request<string>(
      method === "get"
        ? { url: actionUrl, params: body }
        : {
            url: actionUrl,
            method: "post",
            data: body,
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
          },
    );

    return { supported: true, status: EResultParseStatus.success, handled: handled.size };
  }
}
