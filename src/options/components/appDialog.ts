/**
 * 确认框 / 输入框对话框的**上下文无关**实现。
 *
 * 为什么要拆出这一层：`useConfirmDanger` / `usePromptInDialog` 靠 `App.useApp()` 拿 modal，
 * 而 `useApp()` 内部是 `inject(AppContextKey, { modal: {} })` —— 只看组件的**祖先链**。
 * content script 的根组件（App.vue）没有 `<a-app>` 祖先，也挂不了（它自己就是根），
 * 于是那两处原生 confirm()/prompt() 的替代品在 content 里用不上。
 *
 * 所以把「弹什么、按钮文案、返回值语义」放在这里，两个入口各自喂自己那套 modal：
 * 选项页喂 App 上下文的 modal（见那两个 use* 文件），content 喂静态 Modal +
 * shadowRoot 容器（见 src/content-script/app/utils.ts）。
 */
import { Input } from "antdv-next";
import { h, type VNode } from "vue";

/** App 上下文的 modal 与静态 Modal 都满足这个形状 */
export interface IDialogModalApi {
  confirm(config: any): any;
}

export type TTranslate = (key: string) => string;

/**
 * makePromptInDialog 的返回形状，也给需要注入输入框能力的调用方做类型锚点。
 *
 * @param content 提示文案
 * @param defaultValue 输入框默认值
 * @param options.allowEmpty 空串是否算有效输入。默认 false（空串当取消，符合"改方案名"这类场景）；
 *   但下载器 `savePath`/`label` 的 `<...>` 占位符**允许替换成空**，那边必须传 true，
 *   否则用户清空输入会被误判成取消整个推送。
 */
export type TPromptInDialog = (
  content: string,
  defaultValue?: string,
  options?: { allowEmpty?: boolean },
) => Promise<string | null>;

/** 返回 Promise<boolean>：确定 true，取消/关闭 false */
export function makeConfirmDanger(modal: IDialogModalApi, t: TTranslate) {
  return function confirmDanger(content: string, okType: "danger" | "primary" = "danger"): Promise<boolean> {
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
  };
}

/**
 * 返回 Promise<string | null>：确定返回输入值（去首尾空白），取消/关闭返回 null。
 * 空串算不算有效输入由调用方的 allowEmpty 决定，见 TPromptInDialog。
 */
export function makePromptInDialog(modal: IDialogModalApi, t: TTranslate): TPromptInDialog {
  return (content, defaultValue = "", options) =>
    new Promise<string | null>((resolve) => {
      let value = defaultValue;

      modal.confirm({
        title: t("common.dialog.title.confirmAction"),
        content: (): VNode =>
          h("div", [
            h("p", { style: "margin-bottom: 8px" }, content),
            h(Input, {
              value,
              autofocus: true,
              "onUpdate:value": (v: string) => {
                value = v;
              },
            }),
          ]),
        okText: t("common.dialog.ok"),
        cancelText: t("common.dialog.cancel"),
        onOk: () => {
          const trimmed = value.trim();
          resolve(options?.allowEmpty ? trimmed : trimmed || null);
        },
        onCancel: () => resolve(null),
      });
    });
}
