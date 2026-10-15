/**
 * @JackettDefinitions https://github.com/Jackett/Jackett/blob/master/src/Jackett.Common/Definitions/ptzone.yml
 * @PTPPDefinitions https://github.com/pt-plugins/PT-Plugin-Plus/blob/dev/resource/sites/ptzone.xyz/config.json
 * @PDSDefinitions https://github.com/mantou568/pre-dessert-sites/blob/main/site_config/sites/ptzone.json
 * @PTMDefinitions https://github.com/JustLookAtNow/pt_mate/blob/master/assets/sites/ptzone.json
 */
import type { ISiteMetadata } from "../types";
import { SchemaMetadata, xiaomloveDefaultUserLevelRequirements } from "../schemas/NexusPHP";

export const siteMetadata: ISiteMetadata = {
  ...SchemaMetadata,

  version: 1,
  id: "ptzone",
  name: "PTzone",
  description: "分享地带！",
  tags: ["影视", "综合"],
  timezoneOffset: "+0800",

  collaborator: ["xusky0328"],

  type: "private",
  schema: "NexusPHP",

  urls: ["uggcf://cgmbar.klm/"],
  favicon: "./_default_nexusphp.png",

  /**
   * ⚠️ 这里把参数逐个写全，是因为公共那份 `SchemaMetadata.search` 只带 `notnewword=1`，
   * 而 PTzone 对那一条地址**稳定只返回 3 行、且第 3 行是半行**（用户 2026-10-15 实测：
   * `torrents.php?notnewword=1&search=<词>` 出 3 行，站点自己搜索表单那条完整地址出 50 行/共 124）。
   * 结果就是插件比站点少一大截，还被那半行冒充成一条种子（v0.105.9 的截断判据会把它报出来）。
   *
   * 下面这份就是**站点自己那张表单发出去的参数**，逐个照抄：
   * - `incldead` 在 PTzone 的档位文字是 `0|包括斷種 / 1|活種 / 2|斷種`，站点默认给的是 `1`＝**只要活种**，
   *   与 NexusPHP 常见理解（1=包含断种）相反，所以这条会**看不到断种**；
   *   换回 `0`（= 我们此前不带参数时的实际语义，最宽）能不能拿全页，目前没有实测，
   *   要验就只改这一个数：断种能否回来取决于它。
   * - 那些空值参数（`size_begin=` 等）是站点表单本来就发的，照抄，不是猜的。
   * - `keywordPath` 沿用 schema 的 `params.search`；IMDb 那条高级搜索词仍会在运行时把
   *   `search_area` 改成 4（`SchemaMetadata.search.advanceKeywordParams`）。
   */
  search: {
    ...SchemaMetadata.search,
    requestConfig: {
      ...SchemaMetadata.search?.requestConfig,
      url: "/torrents.php",
      params: {
        incldead: 1,
        spstate: 0,
        inclbookmarked: 0,
        approval_status: "",
        size_begin: "",
        size_end: "",
        seeders_begin: "",
        seeders_end: "",
        leechers_begin: "",
        leechers_end: "",
        times_completed_begin: "",
        times_completed_end: "",
        added_begin: "",
        added_end: "",
        search_area: 0,
        search_mode: 0,
      },
    },
  },

  category: [
    {
      name: "分类",
      key: "cat",
      options: [
        { value: 401, name: "Movies(电影)" },
        { value: 402, name: "TV Series(电视剧)" },
        { value: 403, name: "TV Shows(综艺)" },
        { value: 404, name: "Documentaries(纪录片)" },
        { value: 405, name: "Animations(动漫)" },
        { value: 406, name: "Music(音乐)" },
        { value: 407, name: "Sports(体育)" },
        { value: 408, name: "HQ Audio(音乐)" },
        { value: 410, name: "Software(软件)" },
        { value: 411, name: "Games(游戏)" },
        { value: 409, name: "Others(其它)" },
      ],
      cross: { mode: "append" },
    },
    {
      name: "媒介",
      key: "medium",
      options: [
        { value: 1, name: "Blu-ray" },
        { value: 2, name: "HD DVD" },
        { value: 3, name: "Remux" },
        { value: 4, name: "WEB-DL" },
        { value: 5, name: "HDTV" },
        { value: 6, name: "DVDR" },
        { value: 7, name: "Encode" },
        { value: 8, name: "CD" },
        { value: 9, name: "Track" },
        { value: 10, name: "UHD" },
      ],
      cross: { mode: "append" },
    },
    {
      name: "编码",
      key: "codec",
      options: [
        { value: 1, name: "H.264" },
        { value: 2, name: "VC-1" },
        { value: 3, name: "MPEG-2" },
        { value: 4, name: "MPEG-4" },
        { value: 5, name: "Other" },
        { value: 6, name: "H.265" },
      ],
      cross: { mode: "append" },
    },
    {
      name: "音频编码",
      key: "audiocodec",
      options: [
        { value: 1, name: "FLAC" },
        { value: 2, name: "APE" },
        { value: 3, name: "DTS" },
        { value: 4, name: "MP3" },
        { value: 5, name: "OGG" },
        { value: 6, name: "AAC" },
        { value: 7, name: "Other" },
        { value: 8, name: "AC3" },
        { value: 10, name: "DTS-HD MA" },
        { value: 11, name: "DD/AC3" },
        { value: 12, name: "DDP/EAC3" },
        { value: 13, name: "DTS-HD" },
        { value: 14, name: "TrueHD" },
        { value: 15, name: "WAV" },
      ],
      cross: { mode: "append" },
    },
    {
      name: "分辨率",
      key: "standard",
      options: [
        { value: 1, name: "1080p" },
        { value: 2, name: "1080i" },
        { value: 3, name: "720p" },
        { value: 4, name: "SD" },
        { value: 5, name: "8K" },
        { value: 6, name: "4K" },
      ],
      cross: { mode: "append" },
    },
    {
      name: "制作组",
      key: "team",
      options: [
        { value: 1, name: "HDS" },
        { value: 2, name: "CHD" },
        { value: 3, name: "MySiLU" },
        { value: 4, name: "WiKi" },
        { value: 5, name: "Other" },
        { value: 6, name: "PTZWeb" },
      ],
    },
  ],

  levelRequirements: [...xiaomloveDefaultUserLevelRequirements],
};
