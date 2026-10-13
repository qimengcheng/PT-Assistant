/// <reference types="chrome" />
/**
 * 站点等级提升之后的那场祝贺 —— 攒批与投递（判据在 `@/shared/levelUp.ts`，画面在
 * `src/options/components/LevelUpCelebration.vue`）。
 *
 * 为什么住后台而不是住在取数那一侧（offscreen）：offscreen document 里只有 `chrome.runtime`
 * 的消息子集，**没有** `chrome.storage`（`src/storage.ts:57-59` 记了这条官方限制，本仓库的
 * extStore 因此在 offscreen 里改走 SW 代理），也没有 `chrome.notifications`。
 * 在那儿投递两条通道都会**静默失败** —— 拿 `?.` 一调，什么都不发生，也没人报错。
 * 这儿是辅种进展通知一直在走的那条路，两个 API 都在。
 */
import { onMessage, sendMessage } from "@/messages.ts";
import { extStore } from "@/storage.ts";
import { levelUpNoticeMessage, levelUpTitle, type ILevelUpItem } from "@/shared/levelUp.ts";
import { isPluginPageVisible, pushLevelUpGreeting } from "@/shared/reseedPresence.ts";
import { openOptionsPage } from "./base.ts";

/**
 * 一轮刷新里多个站都升了级 → 攒成**一场**烟花，而不是 N 场（用户定下的通用取向：
 * 同一批里多个满足条件的合并成一条显示，先例是 v0.79.0 那张辅种进展卡）。
 *
 * 窗口给 1.5 秒：手动「刷新全部」是 N 条并行消息（`MyData/utils/lastUserData.ts`），
 * 而后台那条是 alarms 里的串行循环，两条路的到齐节奏不一样 —— 先到的那条不该独占一场。
 * 代价要说清：最后一个站升了级而它 1.5 秒内没同伴，祝贺就晚 1.5 秒出现，换的是不放空炮。
 */
const GREET_BATCH_MS = 1_500;
let buffer: ILevelUpItem[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;

onMessage("notifyLevelUp", ({ data: item }) => {
  buffer.push(item);
  if (timer !== undefined) return;
  // 1.5 秒这一档在 SW 的 30 秒空闲窗口以内，而且这条消息本身就是活动，不会被回收打断
  timer = setTimeout(() => {
    timer = undefined;
    void flush();
  }, GREET_BATCH_MS);
});

/**
 * 人在插件页面 → 交给界面放烟花；不在 → 浏览器系统通知（那种情况下没人看画面，
 * 放一场给谁看都是白费）。写 session 存储失败（配额那种极端情况）整批退到系统通知 ——
 * 不能因为选不了通道就不吭声。
 */
async function flush(): Promise<void> {
  const items = buffer;
  buffer = [];
  if (items.length === 0) return;
  const config = await extStore.getItem("config");
  const lang = config?.lang;
  try {
    if (await isPluginPageVisible()) {
      await pushLevelUpGreeting({ at: Date.now(), items });
      return;
    }
  } catch (e) {
    void sendMessage("logger", {
      msg: `Level up: 祝贺改走系统通知栏 (${e instanceof Error ? e.message : e})`,
    });
  }
  // 同一个 id：下一批再 create 是替换，不在通知栏堆一排
  chrome.notifications?.create("level-up", {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icon/128.png"),
    title: levelUpTitle(lang),
    message: levelUpNoticeMessage(items, lang),
  });
}

/**
 * 点这条祝贺 → 打开「我的数据」（那一页有每一站的等级，以及「升级进度」那张阶梯表）。
 *
 * ⚠️ `notifications.onClicked` 是**全局事件**、不按 id 分发，所以监听器必须自己认领前缀 ——
 * 不认领就会把别处的通知接走（辅种那条「辅种完成」曾被更新检查的监听器跳去 GitHub 下载页，
 * 用户 2026-10-12 报的，判据在防线⑫ `check-notification-ids.mjs`）。
 */
chrome.notifications?.onClicked.addListener((notificationId) => {
  if (notificationId !== "level-up") return;
  chrome.notifications?.clear(notificationId);
  openOptionsPage("/my-data");
});
