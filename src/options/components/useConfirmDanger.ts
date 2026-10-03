/**
 * 危险操作确认框。
 *
 * 为什么不用原生 confirm()：MV3 扩展页面禁用了原生对话框（调用会**静默返回 false**，
 * 不抛错、不显示任何 UI）。仓库里已经因此踩过好几次坑 —— 见 KeepUploadTask/Index.vue、
 * RestorePtppUserDataDialog.vue、SetBackup/RestoreDialog.vue 的注释。
 * 这里统一走 antdv 的 App 上下文 modal。
 *
 * 注意：必须在 App 上下文（app.use(App) 或 ConfigProvider 包裹）内使用，
 * 直接 import { Modal } 的静态方法拿不到 context、样式与 locale 会失效。
 */
import { App } from "antdv-next";
import { useI18n } from "vue-i18n";

export function useConfirmDanger() {
  const { modal } = App.useApp();
  const { t } = useI18n();

  /** 返回 Promise<boolean>：用户点确定 true，取消/关闭 false */
  function confirmDanger(content: string, okType: "danger" | "primary" = "danger"): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      modal.confirm({
        title: t("common.dialog.title.confirmAction"),
        content,
        okType,
        okText: t("common.dialog.ok"),
        cancelText: t("common.dialog.cancel"),
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
  }

  return { confirmDanger };
}