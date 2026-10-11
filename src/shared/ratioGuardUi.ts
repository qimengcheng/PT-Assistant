/**
 * 低分享率的两件界面出口：发送前的确认框、发送后的那条提示。
 *
 * 形状照抄 `@/options/components/appDialog.ts` 的工厂写法 —— 选项页喂 App 上下文的 modal，
 * content 喂静态 Modal + shadowRoot 容器。**文案与列表排版因此只有一份**，
 * 两边各写一遍迟早会分叉（一处改了措辞、另一处还留着旧话，是这仓库的老病）。
 *
 * 通知用 `notification`（右上角卡片）而不是 message：一批发出去之后页面正在忙别的，
 * 三秒就消失的 toast 等于没说。固定 key 让重复发送原地替换上一条，不堆叠。
 */
import { h, type VNode } from "vue";

import { formatRatioText, type IRatioRow } from "./ratioGuard.ts";

/** App 上下文的 modal 与静态 Modal 都满足这个形状 */
export interface IRatioGuardModal {
  confirm(config: any): any;
}

/**
 * 静态 `notification` 与 `App.useApp()` 的 notification 都满足这个形状。
 *
 * 形参写 `any` 而不是 ArgsProps：这一层不许 import antdv（它要能拿 Node 直接跑断言），
 * 而 `Record<string, unknown>` 喂给 `(args: ArgsProps) => void` 会被判不兼容 ——
 * 与上面 `IRatioGuardModal.confirm` 同一个取舍（见 appDialog.ts）。
 */
export interface IRatioGuardNotify {
  warning(config: any): void;
}

/** 带插值的 t（vue-i18n 的 global.t 与组件里的 t 都满足） */
export type TRatioGuardTranslate = (key: string, named?: Record<string, string | number>) => string;

/** 同一次会话里重复发送时，第二条换掉第一条而不是往下叠 */
const NOTICE_KEY = "low-ratio-send";

export interface IRatioGuardUi {
  /** 有分享率 < 1 的站点时弹一次确认；用户不点头就返回 false，调用方应当什么都不发 */
  confirmDangerSites(rows: IRatioRow[]): Promise<boolean>;
  /** 发送之后给一条汇总提示；两档都没有内容就什么都不发 */
  notifyLowRatio(warn: IRatioRow[], unknown: IRatioRow[]): void;
}

/**
 * 站点名与分享率排成一行。样式全部走行内：确认框与通知都渲染在组件树之外
 * （静态方法挂在 body / shadowRoot 的浮层宿主上），scoped 样式打不进去。
 */
function siteLine(row: IRatioRow): VNode {
  return h(
    "div",
    { style: { display: "flex", justifyContent: "space-between", gap: "16px", lineHeight: "20px" } },
    [
      h("span", { style: { minWidth: "0", overflowWrap: "anywhere" } }, row.name),
      h(
        "span",
        { style: { fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", opacity: 0.65 } },
        formatRatioText(row.ratio),
      ),
    ],
  );
}

function siteList(rows: IRatioRow[]): VNode {
  return h(
    "div",
    { style: { marginTop: "8px", maxHeight: "240px", overflowY: "auto" } },
    rows.map(siteLine),
  );
}

export function makeRatioGuardUi(deps: {
  modal: IRatioGuardModal;
  notify: IRatioGuardNotify;
  t: TRatioGuardTranslate;
}): IRatioGuardUi {
  const { modal, notify, t } = deps;

  return {
    confirmDangerSites(rows) {
      if (rows.length === 0) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => {
        modal.confirm({
          title: t("common.ratioGuard.confirmTitle"),
          content: h("div", null, [h("div", t("common.ratioGuard.confirmBody")), siteList(rows)]),
          okText: t("common.ratioGuard.confirmOk"),
          cancelText: t("common.dialog.cancel"),
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });
    },

    notifyLowRatio(warn, unknown) {
      if (warn.length === 0 && unknown.length === 0) return;

      notify.warning({
        key: NOTICE_KEY,
        duration: 8,
        placement: "topRight",
        // 标题这档叫 `title` 不叫 `message`（antdv-next dist/notification/interface.d.ts:36，
        // ArgsProps 里根本没有 message）；写错不报错、不进 vue-tsc（下面那个端口的形参是 any），
        // 整张卡片只剩图标和底色。
        title: warn.length > 0 ? t("common.ratioGuard.warnTitle") : t("common.ratioGuard.unknownOnlyTitle"),
        description: h("div", null, [
          warn.length > 0 ? h("div", t("common.ratioGuard.warnBody")) : null,
          warn.length > 0 ? siteList(warn) : null,
          unknown.length > 0
            ? h(
                "div",
                { style: { marginTop: warn.length > 0 ? "8px" : "0", opacity: 0.65 } },
                t("common.ratioGuard.unknownNote", { n: unknown.length }),
              )
            : null,
        ]),
      });
    },
  };
}
