/**
 * 低分享率的两件界面出口：发送前的确认框、发送后的那条提示。
 *
 * 形状照抄 `@/options/components/appDialog.ts` 的工厂写法 —— 选项页喂 App 上下文的 modal，
 * content 喂静态 Modal + shadowRoot 容器。**文案与列表排版因此只有一份**，
 * 两边各写一遍迟早会分叉（一处改了措辞、另一处还留着旧话，是这仓库的老病）。
 *
 * 通知用 `notification`（右上角卡片）而不是 message：一批发出去之后页面正在忙别的，
 * 三秒就消失的 toast 等于没说。固定 key 让重复发送原地替换上一条，不堆叠。
 *
 * `formatSize` 由调用方注入：判据这一层要能拿 Node 直接跑断言，不能 import 选项页那套
 * （别名 `@/...` 在 Node 里根本解析不出来）。
 */
import { h, type VNode } from "vue";

import {
  formatRatioText,
  ratioMutedSites,
  type IRatioConfirmMute,
  type IRatioRow,
  type TRatioConfirmPolicy,
} from "./ratioGuard.ts";

/** App 上下文的 modal 与静态 Modal 都满足这个形状 */
export interface IRatioGuardModal {
  confirm(config: Record<string, unknown>): void;
}

/**
 * 静态 `notification` 与 `App.useApp()` 的 notification 都满足这个形状。
 *
 * 形参写 `Record<string, unknown>` 而不是 ArgsProps：这一层不许 import antdv（它要能拿 Node
 * 直接跑断言），而方法声明走的是双变参数检查，antd 那套 `(args: ArgsProps) => void` 照样能
 * 赋进来（实测：改成 Record 之后 vue-tsc 一条报错都没有）。原先这里写的是 any。
 */
export interface IRatioGuardNotify {
  warning(config: Record<string, unknown>): void;
}

/** 带插值的 t（vue-i18n 的 global.t 与组件里的 t 都满足） */
export type TRatioGuardTranslate = (key: string, named?: Record<string, string | number>) => string;

/**
 * 字节数的格式化。返回类型带 `number` 是照 `@/options/utils.ts` 那份 `formatSize` 抄的 ——
 * 它 catch 分支把原值交回去，所以声明成 `=> string` 会让两个调用点都得包一层转换。
 * 用处只有一个（拼进 `` `+…` ``），模板字符串自己会转成文本。
 */
export type TRatioGuardFormatSize = (bytes: number) => string | number;

/** 同一次会话里重复发送时，第二条换掉第一条而不是往下叠 */
const NOTICE_KEY = "low-ratio-send";

export interface IRatioGuardUi {
  /** 有「下完这批会低于 1」的站点时弹一次确认；用户不点头就返回 false，调用方应当什么都不发 */
  confirmDangerSites(rows: IRatioRow[]): Promise<boolean>;
  /** 发送之后给一条汇总提示；两档都没有内容就什么都不发 */
  notifyLowRatio(warn: IRatioRow[], unknown: IRatioRow[]): void;
}

/**
 * 站点名 + 这一批给它新记的下载量 + 判据那个数，排成一行。
 *
 * 样式全部走行内：确认框与通知都渲染在组件树之外（静态方法挂在 body / shadowRoot 的
 * 浮层宿主上），scoped 样式打不进去。
 *
 * 那个数标 `basis === "current"` 时挂一句「现状」—— 它是**没预估成的**那一类
 * （缺上传量/下载量，或这批里有条目报不出体积），不标就会被读成预估结果。
 */
function siteLine(row: IRatioRow, t: TRatioGuardTranslate, formatSize: TRatioGuardFormatSize): VNode {
  // 「现状」那个后缀自己带括号与空格，两种语言的间隔由文案本身控制
  const value = formatRatioText(row.ratio) + (row.basis === "current" ? t("common.ratioGuard.currentBasis") : "");
  return h(
    "div",
    { style: { display: "flex", justifyContent: "space-between", gap: "16px", lineHeight: "20px" } },
    [
      h("span", { style: { minWidth: "0", overflowWrap: "anywhere" } }, row.name),
      h(
        "span",
        { style: { fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", opacity: 0.65 } },
        [
          // 这一批在这个站要新记多少下载量 —— 那才是「为什么会掉这么多」的证据
          row.basis === "projected" && row.countedSize > 0
            ? h("span", { style: { marginRight: "8px" } }, `+${formatSize(row.countedSize)}`)
            : null,
          h("span", null, value),
        ],
      ),
    ],
  );
}

function siteList(
  rows: IRatioRow[],
  t: TRatioGuardTranslate,
  formatSize: TRatioGuardFormatSize,
): VNode {
  return h(
    "div",
    { style: { marginTop: "8px", maxHeight: "240px", overflowY: "auto" } },
    rows.map((row) => siteLine(row, t, formatSize)),
  );
}

export function makeRatioGuardUi(deps: {
  modal: IRatioGuardModal;
  notify: IRatioGuardNotify;
  t: TRatioGuardTranslate;
  formatSize: TRatioGuardFormatSize;
  /**
   * 重弹策略。三个都是**取数/写数的回调**而不是值：策略与那份「当天已确认」的记录住在 config store
   * （选项页与 content 侧共用同一份持久化配置），而这一层要能在 Node 里直接跑断言，
   * 不许 import store。三个都不传时按 `always` 走 —— 也就是 v0.84.0 起的老行为。
   */
  confirmPolicy?: () => TRatioConfirmPolicy;
  confirmMute?: () => IRatioConfirmMute | null | undefined;
  rememberConfirm?: (sites: string[]) => void;
}): IRatioGuardUi {
  const { modal, notify, t, formatSize } = deps;

  return {
    async confirmDangerSites(rows) {
      if (rows.length === 0) return true;

      /**
       * 「当天不再提示」只放过**今天真在这里确认过的那些站**：
       * 新冒出来的低分享率站照样拦，同一天里换了别的站也照样拦 —— 免的是重复问同一件事，
       * 不是把这道闸按天关掉。
       */
      const policy = deps.confirmPolicy?.() ?? "always";
      const muted = policy === "day" ? new Set(ratioMutedSites(deps.confirmMute?.())) : null;
      const ask = muted ? rows.filter((row) => !muted.has(row.site)) : rows;
      if (ask.length === 0) return true;

      const ok = await new Promise<boolean>((resolve) => {
        modal.confirm({
          title: t("common.ratioGuard.confirmTitle"),
          content: h("div", null, [h("div", t("common.ratioGuard.confirmBody")), siteList(ask, t, formatSize)]),
          okText: t("common.ratioGuard.confirmOk"),
          cancelText: t("common.dialog.cancel"),
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });
      if (ok && policy === "day") deps.rememberConfirm?.(ask.map((row) => row.site));
      return ok;
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
          warn.length > 0 ? siteList(warn, t, formatSize) : null,
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
