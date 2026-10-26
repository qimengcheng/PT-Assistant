/**
 * 确认框 / 输入框对话框的**上下文无关**实现。
 *
 * 为什么要拆出这一层：`useConfirmDanger` / `usePromptInDialog` 靠 `App.useApp()` 拿 modal，
 * 而 `useApp()` 内部是 `inject(AppContextKey, { modal: {} })` —— 只看组件的**祖先链**，
 * 拿不到上下文时默认值是 `{ modal: {} }`，调 `modal.confirm` 会直接 TypeError。
 *
 * ⚠️ content 侧用不上 App 上下文版，**原因不是「没有 `<a-app>` 祖先」** ——
 * content-script/app/App.vue:334 本身就渲染了 `<a-app>`，SentToDownloaderDialog 就挂在它里面，
 * 用的正是 App 上下文版（见 antd-lite.ts 里的 `App` 注册项）。
 * 真正的原因是那两处在**模块作用域**被调用，没有「当前组件实例」，inject 无从谈起。
 *
 * 所以把「弹什么、按钮文案、返回值语义」放在这里，两个入口各自喂自己那套 modal：
 * 选项页喂 App 上下文的 modal（见那两个 use* 文件），content 喂静态 Modal +
 * shadowRoot 容器（见 src/content-script/app/utils.ts）。
 */
import { Input } from "@zboson/ui";
import { h, type VNode } from "vue";

/** App 上下文的 modal 与静态 Modal 都满足这个形状 */
export interface IDialogModalApi {
  confirm(config: Record<string, unknown>): void;
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

/**
 * 返回 Promise<boolean>：确定 true，取消/关闭 false。
 *
 * okText 默认「完成」，但**破坏性操作要按动作给**（删除就写删除）—— 这个确认框的标题是
 * 「确认操作」，按钮再写「完成」等于把动作信息全丢了。
 *
 * ⚠️ 危险档**不能只给 `okType: "danger"`**：确认框那颗键走的是
 * `dist/modal/components/ConfirmOkBtn.js:16` → `ActionButton` → `convertLegacyProps`
 * （`dist/button/button.js:24`），那个 legacy 映射把 `"danger"` 只折成 `{ danger: true }`、
 * **不给 type** —— 于是 `mergedType` 停在 default，算出来是「红描边 + 红字」（实测：白底、
 * `border-color` 红、字红），不是全站口径要的实心红（AGENTS §3.4）。
 * 所以这里直接给最终那两个 prop：`{ type: "primary", danger: true }` 才走到
 * `button.js:65` 那条 `["danger", "solid"]`。
 * 形参因此叫 `tone` 而不是 `okType` —— 全仓 `src/` 里不许再出现那个词，
 * 有它就是在用坏掉的那条入口。判据在 ESLint（v0.90.5 起；原 `check-confirm-danger.mjs` 已撤）：
 * 脚本侧 `no-restricted-syntax` 选 `Property[key.name='okType']`，模板侧
 * `vue/no-restricted-static-attribute` + `vue/no-restricted-v-bind`。
 *
 * `content` 也收 VNode（不只是字符串）：确认框有时要把**将要发生什么**逐条摆出来给人看，
 * 只给一句总结等于让人在没看到内容的情况下批一次条（一键辅种一次就是几十条任务）。
 * 传 VNode 时给的那份必须是**组件**而不是页面里 `h()` 拼的一堆节点 —— `modal.confirm` 在另一棵
 * 组件树里渲染，页面里的 scoped 样式选不到它（只有组件自己的 scoped 样式跟着走）。
 * `width` 是给这种清单留的：确认框默认 416（`ConfirmDialog.js` 的 `width = 416`），
 * 装得下一句话，装不下一条上百字符的种子名。
 */
export function makeConfirmDanger(modal: IDialogModalApi, t: TTranslate) {
  return function confirmDanger(
    content: string | VNode,
    tone: "danger" | "primary" = "danger",
    okText: string = t("common.dialog.ok"),
    width?: number,
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      modal.confirm({
        title: t("common.dialog.title.confirmAction"),
        content,
        width,
        okButtonProps: tone === "danger" ? { type: "primary", danger: true } : { type: "primary" },
        okText,
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
