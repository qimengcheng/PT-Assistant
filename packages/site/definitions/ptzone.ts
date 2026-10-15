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
   * PTzone 的搜索偶尔只回半页（下面第 4 条是用户实测），这一条**不是靠参数治好的**，
   * 这里的参数只说明"我们想问站点什么问题"。用户 2026-10-15 在自己浏览器里跑的四条，原话逐条抄：
   * - `?notnewword=1&search=<词>`（= 公共 schema 那份、也是本条改之前实际发的）
   *   →「确实只有3行，第三行还是只有一半」
   * - `?incldead=1&spstate=0&inclbookmarked=0&approval_status=&…&search_area=0&search_mode=0`
   *   →「这个地址就是正常的」（第 1 页 50 行、共 124）
   * - `?inclbookmarked=0&incldead=0&spstate=0&search_area=0&search=<词>&search_mode=0&page=0` →「这个是完整」
   * - `?search=<词>`（裸关键词，**不带 `notnewword`**）→「第一次只有2条半，但是刷新一下就好了」
   *
   * ⇒ 最后一条把「参数决定论」推翻了：**同一条地址会断也会完整**，所以「缺整套表单键」和
   * `notnewword=1` 都不是决定因素；能同时解释四条观察的只剩「站点这一头偶发地只 echo 到半页」
   * （慢/超时那一类；为什么偶发只有站点那侧的代码定得了，我们没有）。
   * 真正兜住它的是 **v0.105.9 那条自动重发**（NexusPHP 发现"末行比表头短"就再要一次），端到端实测在
   * `.tmp-build/bench-ptzone/retry.mjs`：第一次给半页 → 第二次 50 条、状态 success；两次都半页 →
   * 留 2 条并把状态写成「站点返回的页面在表格中途断开，结果不完整」；第一次就完整 → 不多发一次。
   *
   * 那这里还留 `incldead: 0` 做什么：写清「这一站要最宽那一档」。`incldead` 在 PTzone 的档位文字是
   * `0|包括斷種 / 1|活種 / 2|斷種`（与 NexusPHP 常见理解 1=包含断种**相反**，与本文件 `CategoryIncldead`
   * 一致），断种对辅种正是最有用的那一批（本地已有数据、站点却没人做种），所以绝不能按 `1` 发。
   * 上面第 3 条实测也证明发 `0` 并不更容易断。
   * 不发的东西也有交代：`notnewword=1` 是公共 schema 那份**故意**带的（让站点不要把关键词包进
   * `<b class=newword>`，好让解析拿到干净 HTML），撤掉它换不来完整页，所以留着；
   * 那 10 个空值 range 键（`size_begin=` 等）发与不发都是「全部」档（第 3、4 条一条带一条不带都正常），
   * 抄过来只会让人以为它们在起作用，所以不抄。
   * `keywordPath` 沿用 schema 的 `params.search`；IMDb 那条高级搜索词仍会在运行时把
   * `search_area` 改成 4（`SchemaMetadata.search.advanceKeywordParams`）。
   */
  search: {
    ...SchemaMetadata.search,
    requestConfig: {
      ...SchemaMetadata.search?.requestConfig,
      url: "/torrents.php",
      params: {
        notnewword: 1,
        incldead: 0,
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
