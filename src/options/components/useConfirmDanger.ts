/**
 * 危险操作确认框（绑定到 antdv 的 App 上下文）。
 *
 * 为什么不用原生 confirm()：MV3 扩展页面禁用了原生对话框（调用会**静默返回 false**，
 * 不抛错、不显示任何 UI）。仓库里已经因此踩过好几次坑 —— 见 KeepUploadTask/Index.vue、
 * RestorePtppUserDataDialog.vue、SetBackup/RestoreDialog.vue 的注释。
 *
 * 必须在 `<a-app>` 的祖先链内使用：`App.useApp()` 是 inject，拿不到上下文时默认值是
 * `{ modal: {} }`，调 `modal.confirm` 会直接 TypeError。
 * 上下文无关的实现在 ./appDialog.ts —— content script 没有 `<a-app>`，那边自己喂静态 Modal。
 */
import { App } from "antdv-next";
import { useI18n } from "vue-i18n";

import { makeConfirmDanger } from "./appDialog.ts";

export function useConfirmDanger() {
  const { modal } = App.useApp();
  const { t } = useI18n();

  return { confirmDanger: makeConfirmDanger(modal, t) };
}
