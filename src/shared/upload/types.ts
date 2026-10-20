/**
 * 「转载发布」这条链上的数据形状。
 *
 * 这里的类型要同时喂三个上下文：offscreen（抓表单 / 提交）、options 页（渲染表单）、
 * background（只走消息，不碰实现）。所以全部是**可结构化克隆的纯数据** ——
 * 不许出现 Document / FormData / Blob，那两个东西过不了消息通道。
 *
 * 为什么不像站点定义那样把上传统一挂到 `ISiteMetadata` 上：上传页的字段是**页面给出的事实**
 * （选项 value、隐藏域、必填标记），不是站点作者的静态声明。同一个 NexusPHP 站在改版后
 * 字段会变，写进 340 个定义里等于要维护 340 份会过期的快照。这里改成**每次开对话框现抓**，
 * 站点改动自动被吸收，代价是多一次页面请求。
 */
import type { ITorrent, TSiteID } from "@ptd/site";

/** 上传页里一个 `<option>` */
export interface IUploadOption {
  value: string;
  label: string;
}

/**
 * 控件档位。只收上传页真正会用到的这几档：
 * - `select` / `radio`：分类维度（类型 / 来源 / 媒介 / 编码…），值由站点给定
 * - `text` / `textarea`：标题、副标题、简介、IMDb 链接
 * - `file`：种子本体（**永远由我们自己填**，不让用户选）
 * - `hidden`：站点自己的 token / 已选值，原样回传，界面上不显示
 * - `checkbox`：匿名发布那类单值勾选，值收成 "1" / ""
 */
export type TUploadFieldKind = "select" | "radio" | "text" | "textarea" | "file" | "hidden" | "checkbox";

export interface IUploadField {
  /** 表单字段名（`name`），提交时就是 FormData 的键 */
  name: string;
  kind: TUploadFieldKind;
  /** 表单里给这个字段看的文字（`td.rowhead` / `<label>` 的文本），取不到时退回 name */
  label: string;
  /** 页面本身标了必填（红 `*` 或 `required`）；页面没标就是 false，不猜 */
  required: boolean;
  options?: IUploadOption[];
  /** 页面给出的默认值（hidden 的 value、text 的 value、select 的 selected） */
  initialValue?: string;
}

export interface IUploadFormDescriptor {
  siteId: TSiteID;
  siteName: string;
  /** 抓表单的那一页（`upload.php`），排障时看它 */
  pageUrl: string;
  /** `<form action>` 解析后的绝对地址，提交打这里 */
  action: string;
  fields: IUploadField[];
  /**
   * 抓取过程里的非致命问题（页面里没找到表单、某个字段没 label、站点提示「你没有发布权限」）。
   * 界面上要原样显示出来 —— 静默返回一张空表单，人会以为站点改版了。
   */
  warnings: string[];
}

/**
 * 界面递给「定位源站那颗种子」的一行来源信息。
 *
 * 从「我的下载器」出发时手上只有下载器报回来的字段，**没有**源站条目号与下载链接 ——
 * 那两样要回到源站搜一次才拿得到（见 offscreen 的 `locateSourceTorrent`）。
 * `infoHash` 是这一路上唯一的硬判据：搜出来的候选必须与它一致，否则转出去的是另一颗种子。
 */
export interface ITransferSourceRow {
  /** 下载器 id（同一台里 `id` 才唯一） */
  downloaderId: string;
  /** 下载器里那条的 id（qB 是 hash、Transmission 是数字） */
  id: string | number;
  /** 下载器里这条的名字，同时是折搜索词的原料 */
  name: string;
  /** 字节 */
  totalSize: number;
  /** 下载器报的 tracker（announce 主机名或整条 URL），用来反查源站 */
  tracker: string;
  /** 下载器报的 infoHash（大写十六进制）；定位到的种子必须与它一致 */
  infoHash: string;
}

/** 一次「回源站把这颗种子认出来」的请求（判据与理由见 `ITransferSourceRow`） */
export interface ITransferSourceLocateRequest {
  /** 源站 id（由 tracker 反查得来，认不出时由人自己选） */
  siteId: TSiteID;
  /** 下载器里这条的名字，折成搜索词 */
  name: string;
  /** 字节，候选粗筛的大小基准 */
  totalSize: number;
  /** 必须与它逐字相等才算认出；下载器没报就认不出，见 offscreen 的报错文案 */
  infoHash: string;
}

/**
 * 从源站详情页抓到的简介素材。
 *
 * 只剩「源站页面原样给出的事实」这三样：简介 HTML、截图地址、mediainfo 文本。
 * **不含生成的 mediainfo 与截图** —— 扩展拿不到媒体文件本体，也没有 ffmpeg，
 * 本地拼出来的技术参数是假的，目标站会按伪造处理（见 `upload/description.ts` 的注释）。
 */
export interface ISourceDescription {
  /** 简介区清洗后的 HTML，图片与链接已绝对化；源站没有简介区时为空串 */
  descrHtml: string;
  /** 从简介或 `<pre>` 里抽出的 mediainfo 原文；没有就是 undefined，不造 */
  mediaInfo?: string;
  /** 简介里的截图绝对 URL，按出现顺序去重后保留 */
  screenshots: string[];
  /** 简介里指向的 IMDb 条目号（`tt1234567`） */
  imdbId?: string;
  /** 简介里指向的豆瓣条目号 */
  doubanId?: string;
  /** 详情页地址，排障与「去源站看看」都用它 */
  pageUrl: string;
  /**
   * 抓取时的非致命问题：没有简介区、截图被防盗链、只抓到 BBCode 形式的文本简介…
   * 界面原样显示 —— 静默返回空简介，人会以为源站本来就没写。
   */
  warnings: string[];
}

/** 一次「去源站详情页抓简介」的请求 */
export interface ISourceDescriptionRequest {
  /** 源站 id（必须是已添加的站点，offscreen 靠它建带 cookie 的实例） */
  siteId: TSiteID;
  /** 定位到的那颗种子，用它的 `url` 找详情页 */
  torrent: ITorrent;
}

/**
 * 提交前在目标站查重：同一颗种子（同一 infoHash）是不是已经有人在那边发过。
 *
 * 判据与「定位源站那一颗」完全相同（infoHash 逐字相等），只有「查不到」的语义不同：
 * 在这里查不到**不等于没有** —— 目标站可能改过标题、分类不同、搜索分词不同，
 * 所以 `note` 是必读的，界面上不能把它渲染成一句「可以放心发」。
 * 查重本身失败（未登录 / 站点报错）不抛错，也走 `note`：**查不动不等于重复**，
 * 拿它挡住人发种子比让站点自己拒收更糟。
 */
export interface ITransferDuplicateCheck {
  /** 目标站已存在 infoHash 完全相同的种子 */
  duplicated: boolean;
  /** 命中的那一颗在目标站的标题（原样给人看，便于人自己核对是不是同一部片子） */
  title?: string;
  /** 命中的那一颗在目标站的详情页绝对地址 */
  url?: string;
  /** `duplicated=false` 时的说明：查过哪些词、卡在哪一步。有它不代表安全 */
  note?: string;
}

/** 一次转种提交 */
export interface ITransferUploadRequest {
  siteId: TSiteID;
  /** 源站那颗种子，用来取 `.torrent` 与标题 */
  torrent: ITorrent;
  /** 字段名 → 值。没出现在这里的字段按页面默认值（或空）提交 */
  values: Record<string, string>;
  /** 是否保留源站写在 `info.source` 里的站标（默认保留，见 cleanTorrent 的注释） */
  keepSourceTag?: boolean;
}

export interface ITransferUploadResult {
  ok: boolean;
  /** 给人看的一句话结论 */
  message: string;
  /** 成功时目标种子的详情页（页面里能解析出来才有） */
  url?: string;
  /** 失败时回一段页面正文摘要，用来判断是「重复种子」还是「没权限」 */
  detail?: string;
}
