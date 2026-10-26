/**
 * 「未知」那一格要不要多说一句、说哪一句。
 *
 * 为什么住在这份文件里而不是组件模板里：判据留在 SFC 里就进不了 Node 断言，也就进不了反证
 * （本仓记过一次：比较器抽出来才有 6 条用例和 6 处反证）。这一格看着只有两句话，
 * 但它挑的是「哪个值没进归一表」这条链上唯一对用户可见的一半。
 *
 * 背景：各家（或同一个家的新版本）报出一个归一表里没有的名字，`state` 就落 `unknown`，
 * 界面画成那颗灰色「未知」。qBittorrent 5.0 把 `pausedUP` / `pausedDL` 改名成
 * `stoppedUP` / `stoppedDL` 那一次，界面上出现的就是这种行 —— 而且因为操作列那颗暂停/恢复
 * 的 `v-if` 只认 downloading / seeding / paused / error，那一行**两颗键都没有**，
 * 用户只能指着两个字问「这是什么情况」，我们也只能靠猜。
 */
import { CTorrentState } from "@ptd/downloader/types.ts";

export interface IStateTip {
  /** i18n 键；由调用点翻译，这里不引 i18n 实例（模块级取 locale 是另一套写法） */
  key: string;
  /** 具名占位符参数 */
  args?: Record<string, string>;
}

/**
 * 只有归一表没命中那一档才有提示。
 *
 * 认得出的状态返回 null —— 那一档再说一遍等于把界面上已有的字重复一遍
 * （AGENTS §3.4「文字本来就完整显示在旁边就不许挂浮层」同一口径）。
 */
export function unknownStateTipOf(state: CTorrentState, stateRaw?: string): IStateTip | null {
  if (state !== CTorrentState.unknown) return null;
  // 逐字转的原文两头可能带空白（各家拼接习惯不一），空白串按「取不到」处理
  const text = typeof stateRaw === "string" ? stateRaw.trim() : "";
  return text
    ? { key: "MyClient.state.unknownRaw", args: { raw: text } }
    : { key: "MyClient.state.unknownNoRaw" };
}
