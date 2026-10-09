/**
 * 辅种任务相关类型定义
 */

import type { TSiteID } from "@ptd/site";
import type { TDownloaderKey } from "./metadata.ts";
import type { CAddTorrentOptions } from "@ptd/downloader";

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
 * 辅种任务
 */
export interface IKeepUploadTask {
  id: TKeepUploadTaskKey; // 任务id
  time: number; // 创建时间
  title: string; // 任务标题（第一个种子的标题）
  size: number; // 种子大小
  downloadOptions: IKeepUploadTaskDownloadOptions; // 下载选项
  items: IKeepUploadTaskItem[]; // 种子列表
  /** 有这一项 = 基准种子是下载器里已有的那条，不在 items 里 */
  baseLocal?: IKeepUploadTaskLocalBase;
}

/**
 * 辅种任务存储结构
 */
export type TKeepUploadTaskStorageSchema = Record<TKeepUploadTaskKey, IKeepUploadTask>;
