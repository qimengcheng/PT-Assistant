/**
 * 站内信读取（我的数据页点未读数字 → 在扩展里读消息）。
 *
 * 只有实现了 getMessages 的 schema（目前 NexusPHP 系）能真读到；其余站点返回
 * `supported: false`，由界面给「在网页打开」的退路 —— 不能返回空列表冒充「你没有新消息」。
 */
import {
  EResultParseStatus,
  type ISiteMessageActionResult,
  type ISiteMessageContentResult,
  type ISiteMessagesResult,
} from "@ptd/site";

import { onMessage } from "@/messages.ts";
import { sanitizeSiteMessageError } from "@/shared/siteMessageError.ts";

import { getSiteInstance } from "./site.ts";
import { logger } from "./logger.ts";

function failNote(scene: string, error: unknown) {
  logger({ msg: `${scene} failed: ${error instanceof Error ? error.message : String(error)}` });
}

/**
 * 交给界面的那一句原因（清洗过，见 `@/shared/siteMessageError`）。
 * 日志里那一份仍是原样 —— 排障要看全，界面看清洗后的就够。
 */
function noteOf(error: unknown) {
  return { errorNote: sanitizeSiteMessageError(error) };
}

onMessage("getSiteMessages", async ({ data: siteId }): Promise<ISiteMessagesResult> => {
  try {
    const site = await getSiteInstance<"private">(siteId);
    if (!site.supportsMessages) {
      return { supported: false, status: EResultParseStatus.success, messages: [] };
    }
    return { supported: true, status: EResultParseStatus.success, messages: await site.getMessages() };
  } catch (error) {
    failNote(`getSiteMessages for ${siteId}`, error);
    return { supported: true, status: EResultParseStatus.parseError, messages: [], ...noteOf(error) };
  }
});

onMessage("getSiteMessageContent", async ({ data }): Promise<ISiteMessageContentResult> => {
  try {
    const site = await getSiteInstance<"private">(data.siteId);
    if (!site.supportsMessages) {
      return { supported: false, status: EResultParseStatus.success };
    }
    const content = await site.getMessageContent(data.messageId, data.url);
    return {
      supported: true,
      status: content === undefined ? EResultParseStatus.parseError : EResultParseStatus.success,
      content,
      // 读得到正文但内容为空这一档不算失败：那种站点会返回空串，报「失败」是假话
      ...(content === undefined ? noteOf(new Error("站点未返回正文")) : {}),
    };
  } catch (error) {
    failNote(`getSiteMessageContent for ${data.siteId}/${data.messageId}`, error);
    return { supported: true, status: EResultParseStatus.parseError, ...noteOf(error) };
  }
});

onMessage("deleteSiteMessages", async ({ data }): Promise<ISiteMessageActionResult> => {
  try {
    const site = await getSiteInstance<"private">(data.siteId);
    if (!site.supportsMessages) {
      return { supported: false, status: EResultParseStatus.success, handled: 0 };
    }
    return await site.deleteMessages(data.messageIds);
  } catch (error) {
    failNote(`deleteSiteMessages for ${data.siteId}`, error);
    return { supported: true, status: EResultParseStatus.unknownError, handled: 0, ...noteOf(error) };
  }
});
