/**
 * 输入框对话框（原生 prompt 的替代品，绑定到 antdv 的 App 上下文）。
 *
 * 为什么不用原生 prompt()：MV3 扩展页面禁用了原生对话框（调用**静默返回 null**，
 * 不抛错、不显示任何 UI），功能看起来就是「点了没反应」。
 * 仓库里「复制搜索方案」就是这么静默失效的。
 *
 * 必须在 `<a-app>` 的祖先链**内、且在组件 setup 里调用**：`App.useApp()` 是 inject，
 * 拿不到上下文时默认值是 `{ modal: {} }`，调 `modal.confirm` 会直接 TypeError。
 * 模块作用域里调（没有当前实例）同样拿不到。
 * 上下文无关的实现在 ./appDialog.ts —— content 侧那两处在模块作用域触发，只能走那条路。
 */
import { App } from "antdv-next";
import { useI18n } from "vue-i18n";

import { makePromptInDialog } from "./appDialog.ts";

export function usePromptInDialog() {
  const { modal } = App.useApp();
  const { t } = useI18n();

  return { promptInDialog: makePromptInDialog(modal, t) };
}
