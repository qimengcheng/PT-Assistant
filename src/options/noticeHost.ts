/**
 * 界面右上角那张「通知卡片」的宿主。
 *
 * 为什么需要这一层：@zboson/ui 的 Notice / NoticeGroup 是**挂载式组件**（要写进模板、
 * 靠实例方法 `open()` 推通知），不像 `notification` 那样能从任意模块直接调。
 * 而发通知的是非组件模块（辅种进展那一路），拿不到 ref，所以由 App.vue 在挂载时
 * 把实例交进来，这里存一份。
 *
 * 「同一类通知再来一次是替换、不是叠一张」这个语义必须自己做：
 * 实测 `@zboson/ui/dist/notice-group/NoticeGroup.js:79-91` 的 `open()` 是**往列表里 push**
 * （只给缺 id 的补一个随机数），不像 `@v-c/notification` 的 `open` 按 `key` 原地换 ——
 * 所以这里先 `remove(id)` 再 `open({ id })`，让旧的 `key: reseed-<kind>` 语义原样保留。
 *
 * 明细行走「详情」弹窗而不是卡片正文：实测 `dist/notice/Notice.js:118` 把 `message`
 * 画成**一个纯文本节点**（且 Notice 没有任何插槽，`SlotsType<Record<string, never>>`），
 * 多条明细在卡片里展不开，而组件本身留了 `modalTitle` / `modalText` 那一档。
 */
import type { NoticeGroupRef, NoticeType } from "@zboson/ui";

/** 一张卡片：id 相同就覆盖上一张 */
export interface INoticeCard {
  id: string;
  type: NoticeType;
  title: string;
  message: string;
  /** 明细，逐条列在「详情」弹窗里；空数组等于不给详情链接 */
  details?: string[];
  /**
   * 「详情」那颗链接的文字。
   *
   * 必须我方给：组件里的默认值是**硬编码的中文**（实测 `dist/notice/Notice.js:91`
   * `props.detailText ?? "详情"`），它不吃 antd 的 locale —— 英文界面下界面上会漏出「详情」两个字
   * （台架 bench-notice2 的英文那一趟实测到的就是这个）。
   */
  detailText?: string;
  /**
   * 秒；0 = 不自动关。
   *
   * ⚠️ 传了它就等于绕开组件那颗「各类型停留时长」设置键 —— 实测
   * `dist/notice-group/NoticeGroup.js:91` 取的是 `config.duration ?? settings[...] ?? 5`，
   * 显式值排在最前。辅种那一条按「不许改动已验收过的 8 秒」显式给着，代价写在那页的注释里。
   */
  duration?: number;
}

let host: NoticeGroupRef | null = null;

/** 由 App.vue 在挂载时调用；卸载时传 null 收回，避免往已经不存在的实例里推 */
export function setNoticeHost(instance: NoticeGroupRef | null): void {
  host = instance;
}

export function openNoticeCard(card: INoticeCard): void {
  if (!host) {
    // 走到这里说明有人在 App.vue 挂载之前（或挂载失败之后）发通知。
    // console.error 刻意不进本扩展那条日志闸门，所以这声是真能听见的 —— 
    // 宁可乐出来，也不让一条通知静默丢掉（旧版 notification 是全局 API，不存在这个洞）。
    console.error("[PT-Assistant] 通知卡片宿主还没挂上，这条通知没画出来", card.id, card.title);
    return;
  }
  // 先撤同 id 的旧卡片，再开新的 —— 见文件头那条 open() 是 push 的实测
  host.remove(card.id);
  const details = card.details ?? [];
  host.open({
    id: card.id,
    type: card.type,
    title: card.title,
    message: card.message,
    duration: card.duration,
    // 两个字段都要非空，组件才画那颗「详情」链接（见 Notice 的 props 注释）
    modalTitle: details.length > 0 ? card.title : undefined,
    modalText: details.length > 0 ? details.join("\n") : undefined,
    detailText: card.detailText,
  });
}
