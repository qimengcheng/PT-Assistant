/**
 * offscreen 文档：MV3 service worker 没有 DOM，而站点解析（DOMParser/sizzle）、
 * 页面信息抓取等能力需要完整 DOM 环境。本页由 background 通过 chrome.offscreen
 * API 创建（见 background/utils/offscreen.ts），作为各服务的消息处理器宿主。
 *
 * 平移自 PT-depiler src/entries/offscreen/offscreen.ts。
 */
import "./adapter/indexdb.ts";

import "./utils/logger.ts";
import "./utils/site.ts";
import "./utils/search.ts";
import "./utils/download.ts";
import "./utils/userInfo.ts";
import "./utils/socialInformation.ts";
import "./utils/socialRecommendations.ts";
import "./utils/keepUploadTask.ts";
import "./utils/backup.ts";
