/**
 * 输入框对话框（原生 prompt 的替代品）。
 *
 * 为什么不用原生 prompt()：MV3 扩展页面禁用了原生对话框（调用**静默返回 null**，
 * 不抛错、不显示任何 UI），功能看起来就是「点了没反应」。
 * 仓库里「复制搜索方案」就是这么静默失效的。这里统一走 antdv App 上下文的 modal。
 *
 * 注意：必须在 App 上下文内使用（app.use(App) 或 ConfigProvider 包裹），
 * 否则拿不到 context，样式与 locale 会失效。
 */
import { App, Input } from "antdv-next";
import { h, type VNode } from "vue";
import { useI18n } from "vue-i18n";

export function usePromptInDialog() {
  const { modal } = App.useApp();
  const { t } = useI18n();

  /**
   * 返回 Promise<string | null>：确定返回输入值（去掉首尾空白，空串视为取消），取消/关闭返回 null。
   *
   * @param content 提示文案
   * @param defaultValue 输入框默认值
   */
  function promptInDialog(content: string, defaultValue = ""): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
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
        onOk: () => resolve(value.trim() || null),
        onCancel: () => resolve(null),
      });
    });
  }

  return { promptInDialog };
}