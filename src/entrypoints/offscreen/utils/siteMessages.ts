/**
 * 站内信读取（我的数据页点未读数字 → 在扩展里读消息）。
 *
 * 只有实现了 getMessages 的 schema（目前 NexusPHP 系）能真读到；其余站点返回
 * `supported: false`，由界面给「在网页打开」的退路 —— 不能返回空列表冒充「你没有新消息」。
 */
import {
  EResultParseStatus,
  type ISiteMessageContentResult,
  type ISiteMessagesResult,
  type TSiteID,
} from "@ptd/site";

import { onMessage } from "@/messages.ts";

import { getSiteInstance } from "./site.ts";
import { logger } from "./logger.ts";

function failNote(scene: string, error: unknown) {
  logger({ msg: `${scene} failed: ${error instanceof Error ? error.message : String(error)}` });
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
    return { supported: true, status: EResultParseStatus.parseError, messages: [] };
  }
});

onMessage("getSiteMessageContent", async ({ data }): Promise<ISiteMessageContentResult> => {
  try {
    const site = await getSiteInstance<"private">(data.siteId);
    if (!site.supportsMessages) {
      return { supported: false, status: EResultParseStatus.success };
    }
    const content = await site.getMessageContent(data.messageId);
    return {
      supported: true,
      status: content === undefined ? EResultParseStatus.parseError : EResultParseStatus.success,
      content,
    };
  } catch (error) {
    failNote(`getSiteMessageContent for ${data.siteId}/${data.messageId}`, error);
    return { supported: true, status: EResultParseStatus.parseError };
  }
});
