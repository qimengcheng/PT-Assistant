/**
 * 组件之外取 i18n 文案的统一入口。
 *
 * 背景：页面里的 `t()` 来自 `useI18n()`，只能在 setup / 组件内拿；而 `stores/`、`utils/`
 * 这些模块也要给用户一句提示 —— 写死中文就会让英文界面显示中文（AGENTS.md §3.5 零容忍项）。
 *
 * 说清一件事：直接调 `i18n.t(key)` 也是能用的（本仓 SearchEntity/utils/search.ts 一直这么写，
 * `i18n` 就是 i18nInstance.global 那个 Composer）。这层壳的理由只有两条：给「消息还没挂上去」
 * 的早期路径一个不抛的出口，以及让后来人有一个搜得动的名字，而不是每处各挑一种写法。
 *
 * locale 是 `main.ts` 里 `watchEffect` 同步的**活值**，所以这里每次现取 ——
 * 切语言之后紧接着的调用就能拿到新语种，不像 setup 顶层常量那样要重开页面才变。
 * （DownloadHistory/utils.ts 的 `i18nLoadErrorText` 是更早的另一套：按 useConfigStore().lang
 * 手选一份双语常量。这次没顺手把它并过来，免得一批提交里混两件事。）
 */

import { i18n } from "@/options/plugins/i18n.ts";

/**
 * 取键的当前译文；取不到时回退到键本身（与 vue-i18n 的缺键行为一致，
 * 便于在界面上一眼看出漏配，而不是静默显示空白）。
 *
 * @param key i18n 键
 * @param named 具名占位符参数，如 `{ name }`
 */
export function tOutside(key: string, named?: Record<string, unknown>): string {
  try {
    return i18n.t(key, named as never) as unknown as string;
  } catch (e) {
    // 键不存在时 vue-i18n 会把键路径本身返回（不是抛异常）；这里 catch 只兜
    // 「实例还没挂载消息」这类早期路径，那种情况同样退回键，便于发现漏注册。
    console.warn(`[i18nOutside] translate failed for "${key}"`, e);
    return key;
  }
}
