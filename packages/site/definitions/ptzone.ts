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
   * 而 PTzone 对那一条地址**稳定只返回 3 行、且第 3 行是半行**（v0.105.9 的截断判据会把它报出来，
   * 但报出来不等于拿得全）。用户 2026-10-15 在自己的浏览器里跑了三条地址，实测原话逐条抄在这里：
   * - `torrents.php?notnewword=1&search=<词>` → 「确实只有3行，第三行还是只有一半」
   * - `torrents.php?incldead=1&spstate=0&inclbookmarked=0&approval_status=&size_begin=&…&search_area=0&search_mode=0`
   *   → 「这个地址就是正常的」（第 1 页 50 行、共 124）
   * - `torrents.php?inclbookmarked=0&incldead=0&spstate=0&search_area=0&search=<词>&search_mode=0&page=0`
   *   → 「这个是完整」
   *
   * ⇒ **截断是由请求本身决定、可复现的**，不是网络抖动；而两条正常的地址都①带整套表单键、
   * ②都不带 `notnewword`。到底是"缺表单键"还是"`notnewword=1`"触发的，这两条实验分不开
   * （要分只需再跑一条 `torrents.php?search=<词>`，裸关键词、不带 notnewword），
   * 所以这里一次满足两条：照抄表单键集合、去掉 `notnewword`。
   *
   * 值取哪一档：`incldead` 在 PTzone 的档位文字是 `0|包括斷種 / 1|活種 / 2|斷種`
   * （与 NexusPHP 常见理解 1=包含断种**相反**，也与本文件上面 `CategoryIncldead` 那套一致），
   * 第 2 条用的是 1=只要活种，而第 3 条实测**`0`（包括断种、最宽）同样完整** ——
   * 断种对辅种正是最有用的那一批（本地已有数据、站点却没人做种），所以取 `0`。
   * 另外 `keywordPath` 沿用 schema 的 `params.search`；IMDb 那条高级搜索词仍会在运行时把
   * `search_area` 改成 4（`SchemaMetadata.search.advanceKeywordParams`）。
   */
  search: {
    ...SchemaMetadata.search,
    requestConfig: {
      ...SchemaMetadata.search?.requestConfig,
      url: "/torrents.php",
      params: {
        incldead: 0,
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
