/**
 * 辅种任务相关类型定义
 */

import type { TSiteID } from "@ptd/site";
import type { TDownloaderKey } from "./metadata.ts";
import type { CAddTorrentOptions } from "@ptd/downloader";

// 进度阶段与那一条的结论这两个类型，住在 `seedVerify.ts`（判据和它的类型在一起，那份能直接跑
// Node 断言）。这里**只 import type**：构建时整条擦除，不会把 views 目录拖进 service worker 的
// 运行时图（AGENTS §3.2 那条铁律）。抄第二份类型定义才是坑 —— 判据改档位时两边会静默分家。
import type { IReseedItemStatus, TReseedStage } from "@/options/views/Overview/KeepUploadTask/seedVerify.ts";

export type TKeepUploadTaskKey = string;

/**
 * 辅种任务中的种子项
 */
export interface IKeepUploadTaskItem {
  site: TSiteID; // 站点id
  title: string; // 标题
  subTitle?: string; // 副标题
  category?: string | number; // 分类（用于展开下载路径和标签模板）
  link: string; // 详情页链接
  url: string; // 种子下载链接
  size: number; // 大小
  seeders?: number; // 上传者数量
  leechers?: number; // 下载者数量
  /**
   * 这颗种子自己的 infoHash —— 回查下载器时用它当对账的键（`getClientTorrents` 那条列表里
   * 认的是 `CTorrent.infoHash`）。
   *
   * 建任务那一步就有这个值：每条子种子都要下载 .torrent 算三层指纹（`ITorrentInfoForVerification.infoHash`），
   * 不记下来就得再下一遍。**旧任务没有这一项**，界面上那一条会写「没记下 infoHash」而不是假装查过。
   */
  hash?: string;
  [key: string]: any; // 其他属性
}

/**
 * 辅种任务下载选项
 */
export interface IKeepUploadTaskDownloadOptions {
  downloaderId: TDownloaderKey; // 下载器id
  savePath?: string; // 保存路径
  clientName?: string; // 下载器名称（用于显示）
  addTorrentOptions?: Partial<CAddTorrentOptions>; // 其他下载选项
}

/**
 * 「基准种子在下载器里」时记下的那一条本地种子。
 *
 * 为什么要有这一块：只勾中一颗站点种子来辅种时，数据早就在下完的那颗种子里了，
 * 基准不是本任务的任何一条 items —— 任务里那一条要发的就是「拿已有数据去挂这一站」。
 * 没有这个标记的话，任务页会按老规矩把 items[0] 当基准再发一遍（那就是重复添加）。
 * 只存展示与对账要用的三样：hash 用来日后回查下载器，name/savePath 用来说清是哪条。
 */
export interface IKeepUploadTaskLocalBase {
  hash: string;
  name: string;
  savePath?: string;
}

/**
 * 「自动辅种」这条任务走到哪一步了 —— 后台每分钟醒一次，靠这一片判断「该发哪一步、发过没有」，
 * 所以它必须落盘：service worker 每 30 秒就被浏览器杀掉，内存里存不住任何东西。
 *
 * 只存**进度**和**去重用的数**：每一步都是「做过一次就不再做过」。
 * 两个例外是给人看的时间 —— `lastRunAt`（排查用）和 `completedAt`（列表里那一列「完成时间」）。
 */
export interface IKeepUploadTaskAutoState {
  /** 基准那条已经发出去的时刻。没有这一项 = 还没发过（下一轮就发） */
  baseSentAt?: number;
  /** 发基准失败过几次。失败不记 `baseSentAt`，靠这个数封顶重试次数，否则下载器没网时每分钟撞一次 */
  baseSendFails?: number;
  /**
   * 除基准外那些**整体**发完的时刻 —— 全部成功时才写，所以它现在的意思是「一批都发出去了」，
   * 不再是「这一批试过了」。逐条的去重看下面 `othersSent`。
   */
  othersSentAt?: number;
  /**
   * 逐条的「已经成功发出去」记录：键见 `reseedItemKey`（infoHash 小写，没记 hash 的退到标题），
   * 值是那一刻的时间戳。
   *
   * 为什么必须做到**逐条**：v0.65.7 之前只有上面那个整体标记，而发送那一圈是「一颗抛错就跳出整批」，
   * 于是一颗链接失效 / 站点接口报错的种子会把排在它后面的每一条永远挡住 —— 每分钟从同一颗重开，
   * 界面上永远是「下载器里没有」（他 2026-10-10 那一条 yemapt 就是这个形状）。
   */
  othersSent?: Record<string, number>;
  /** 上一次后台跑这一条的时刻（只为排查，判据不看它） */
  lastRunAt?: number;
  /**
   * 上一次走到「辅种完成」那一档（`stage === "done"`）的时刻，列表里「完成时间」那一列读它。
   * 离开那一档就清掉 —— 挂着旧时间却显示「辅种中」比空着更误导。
   */
  completedAt?: number;
  /** 上一次弹通知时「没辅种成功」的条数：条数没再变多就不重复轰炸 */
  notifiedWrong?: number;
  /** 后台折出来的进度阶段。界面上那一列在没人手动回查时读它，否则后台都在暂停种子了、页面还写「没查过」 */
  stage?: TReseedStage;
  /** infoHash（小写）→ 那一条的结论，同上 */
  statuses?: Record<string, IReseedItemStatus>;
}

/**
 * 辅种任务
 */
export interface IKeepUploadTask {
  id: TKeepUploadTaskKey; // 任务id
  time: number; // 创建时间
  title: string; // 任务标题（第一个种子的标题）
  /** 副标题：任务标题那一行下面显示的第二个标题，跟搜索结果那列同一个形状。旧任务没有这一项 */
  subTitle?: string;
  size: number; // 种子大小
  downloadOptions: IKeepUploadTaskDownloadOptions; // 下载选项
  items: IKeepUploadTaskItem[]; // 种子列表
  /** 有这一项 = 基准种子是下载器里已有的那条，不在 items 里 */
  baseLocal?: IKeepUploadTaskLocalBase;
  /**
   * 「自动辅种」开关（建任务那个弹窗里，默认开）。
   *
   * **判据写的是 `=== true` 而不是「不等于 false」**：旧任务没有这一项，
   * 按后者读会让所有存量任务在某天升级之后突然开始自动往下载器发种子 —— 那是替用户做主。
   */
  autoReseed?: boolean;
  /** 自动辅种走到哪一步了，见 `IKeepUploadTaskAutoState` */
  autoState?: IKeepUploadTaskAutoState;
}

/**
 * 辅种任务存储结构
 */
export type TKeepUploadTaskStorageSchema = Record<TKeepUploadTaskKey, IKeepUploadTask>;
