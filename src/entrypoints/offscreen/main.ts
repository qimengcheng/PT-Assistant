/**
 * offscreen 文档：MV3 service worker 没有 DOM，而站点解析（DOMParser/sizzle）、
 * 页面信息抓取等能力需要完整 DOM 环境。本页由 background 通过 chrome.offscreen
 * API 创建（见 background/utils/offscreen.ts），作为各服务的消息处理器宿主。
 *
 * 平移自 PT-depiler src/entries/offscreen/offscreen.ts。
 */
import { onMessage } from "@/messages.ts";

import "./adapter/indexdb.ts";

import "./utils/logger.ts";
import "./utils/site.ts";
import "./utils/search.ts";
import "./utils/download.ts";
import "./utils/userInfo.ts";
import "./utils/socialInformation.ts";
import "./utils/socialRecommendations.ts";
import "./utils/keepUploadTask.ts";
import "./utils/fingerprint.ts";
import "./utils/backup.ts";

// 就绪门：必须放在所有业务模块 import 之后——ES module 按导入顺序执行，
// 走到这里时上面各模块顶层的 onMessage 注册已全部完成。
// background 新建 offscreen 后轮询 offscreenPing，收到 "pong" 才敢发业务消息，
// 否则「文档已创建但处理器还没注册」窗口内的消息会被静默丢弃。
// 消息 wrapper 的 handler 类型约定返回 Promise（与 defineExtensionMessaging 对齐）
onMessage("offscreenPing", () => Promise.resolve("pong"));
