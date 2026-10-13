/**
 * 「用户此刻在不在插件页面」这一件事，以及**后台 → 界面**那两条投递通道
 * （辅种进展卡片、站点等级提升的祝贺）。
 *
 * 几个键都放 **session** 存储：它们说的是「此刻」，落盘反而有害 —— 存到 local 的话，
 * 下次开浏览器会读到一条上次关机前留下的陈旧真值（明明没人看页面却按「在页面里」处理，
 * 而那张祝贺卡会在几天后突然放一场烟花）。
 * session 不落盘、浏览器重启即清，正合这个语义。
 *
 * 为什么不用 `chrome.runtime.getContexts()`：它能告「有没有一个活的 options 页面」，
 * 告不出那个页面是不是前台 —— 用户把插件页留在后台标签里，就算不上「在插件页面」。
 * 也不用长连接端口：MV3 里一个常开的 port 会让 service worker 永远不空闲卸载。
 */
import { storage } from "wxt/utils/storage";

import type { IReseedNoticeBatch } from "./reseedNotice.ts";
import type { ILevelUpItem } from "./levelUp.ts";

/** 界面每 10 秒报一次「我还可见」 */
export const PRESENCE_PING_MS = 10_000;
/**
 * 后台认这个新鲜度：25 秒内报过就算人在页面里。
 * 三倍于心跳，够容忍一次被节流（后台标签里 setInterval 会被压到分钟级）或一次写入失败；
 * 页面是**直接关掉**的（没有 pagehide）时，最多多认 25 秒 —— 那 25 秒里用户会看到通知没弹到
 * 浏览器，但他人还在浏览器里，代价比反过来（人在看、通知却跑到系统通知栏）小。
 */
export const PRESENCE_FRESH_MS = 25_000;

const visibleAtItem = storage.defineItem<number>("session:optionsVisibleAt", { fallback: 0 });
const noticeItem = storage.defineItem<IReseedNoticeBatch | null>("session:reseedNotice", { fallback: null });

/** 后台判：这一趟通知该走界面还是走浏览器通知 */
export async function isPluginPageVisible(): Promise<boolean> {
  const at = await visibleAtItem.getValue();
  return typeof at === "number" && at > 0 && Date.now() - at < PRESENCE_FRESH_MS;
}

/** 后台写：把这一轮的进展（一类一组）交给界面去弹 */
export async function pushReseedNotice(batch: IReseedNoticeBatch): Promise<void> {
  await noticeItem.setValue(batch);
}

/**
 * 界面订阅：只在**变化**时回调，所以页面开着时不会把上次那一批重弹一遍。
 * 一次回调就是后台的一整轮 —— 合并成一条的工作在后台做完，这里不再逐条收。
 * 返回取消订阅的函数（组件卸载时调）。
 */
export function watchReseedNotice(cb: (batch: IReseedNoticeBatch) => void): () => void {
  return noticeItem.watch((value) => {
    if (value) cb(value);
  });
}

/** 一次祝贺：`at` 同 `reseedNotice` 的理由一样 —— 连续两批内容可能一字不差，没时刻就不回调 */
export interface ILevelUpGreeting {
  at: number;
  items: ILevelUpItem[];
}

const greetingItem = storage.defineItem<ILevelUpGreeting | null>("session:levelUpGreeting", { fallback: null });

/** 取数那侧（offscreen 的用户信息刷新）写：人在页面时把这一批交给界面放烟花 */
export async function pushLevelUpGreeting(greeting: ILevelUpGreeting): Promise<void> {
  await greetingItem.setValue(greeting);
}

/** 界面订阅：只在变化时回调，所以页面开着时不会把上次那场重放一遍 */
export function watchLevelUpGreeting(cb: (greeting: ILevelUpGreeting) => void): () => void {
  return greetingItem.watch((value) => {
    if (value && value.items.length > 0) cb(value);
  });
}

/**
 * 界面侧的心跳：可见就报时刻，转后台/关页面就立刻清零。
 * 返回停止函数（页面生命周期里其实不用停，留着是为了断言和复用时不泄漏）。
 */
export function startPresenceHeartbeat(): () => void {
  const beat = () => {
    if (document.visibilityState === "visible") void visibleAtItem.setValue(Date.now());
  };
  const goAway = () => {
    if (document.visibilityState !== "visible") void visibleAtItem.setValue(0);
  };
  beat();
  const timer = setInterval(beat, PRESENCE_PING_MS);
  document.addEventListener("visibilitychange", goAway);
  window.addEventListener("pagehide", goAway);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", goAway);
    window.removeEventListener("pagehide", goAway);
  };
}
