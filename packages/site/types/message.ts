import type { EResultParseStatus } from "./base.ts";

/**
 * 一条站内信（列表项）。
 *
 * 目前只有 NexusPHP 系实现了取数（167/340 个站点定义，含国内绝大多数 PT 站）；
 * 其余 schema 的 `supportsMessages` 为 false，界面据此显示「暂不支持，去网页看」而不是空列表。
 */
export interface ISiteMessage {
  id?: string; // 站内信 id（NexusPHP 的 msgid），取正文与本地已读记账都靠它
  title: string;
  sender?: string;
  time?: number; // 解析得出的时间戳；站点只给相对时间（"x 天前"）时留空
  unread?: boolean;
  url?: string; // 站内原文地址，弹窗里「在网页打开」用
}

export interface ISiteMessagesResult {
  /** false = 该站的 schema 没实现信箱解析（不是「你没有新消息」，界面要分开显示） */
  supported: boolean;
  status: EResultParseStatus;
  messages: ISiteMessage[];
}

export interface ISiteMessageContentResult {
  supported: boolean;
  status: EResultParseStatus;
  /**
   * 纯文本正文。刻意不做 HTML 渲染：站内信是站点侧不可信内容，
   * 用 v-html 塞进选项页等于把 XSS 面开给站点（扩展页能调 chrome.* 消息）。
   */
  content?: string;
}
