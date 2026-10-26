/**
 * 低分享率检查（选项页侧）。
 *
 * 必须在 `<a-app>` 祖先链内、组件 setup 里调用 —— 与 `usePromptInDialog` 同一条理由：
 * `App.useApp()` 是 inject，模块作用域里调拿到的是 `{ modal: {} }`，弹框会当场 TypeError。
 * content 侧那两处在模块作用域触发，走 `src/content-script/app/utils.ts` 里的静态 modal 版。
 *
 * 判据与文案都不在这里，在 `@/shared/ratioGuard.ts` / `@/shared/ratioGuardUi.ts`，
 * 两个入口共用一份。
 */
import { App, notification } from "@zboson/ui";
import { useI18n } from "vue-i18n";
import type { ITorrent } from "@ptd/site";

import { formatSize } from "@/options/utils.ts";
import { useConfigStore } from "@/options/stores/config.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import { assessRatioBatch, fillRatioRowNames, ratioMuteAfterConfirm, type IRatioRisk } from "@/shared/ratioGuard.ts";
import { makeRatioGuardUi } from "@/shared/ratioGuardUi.ts";

export function useRatioGuard() {
  const { modal } = App.useApp();
  const { t } = useI18n();
  const metadataStore = useMetadataStore();
  const configStore = useConfigStore();

  const guard = makeRatioGuardUi({
    modal,
    notify: notification,
    t,
    formatSize,
    confirmPolicy: () => configStore.download.ratioConfirmPolicy,
    confirmMute: () => configStore.download.ratioConfirmMute,
    rememberConfirm: (sites) => {
      configStore.download.ratioConfirmMute = ratioMuteAfterConfirm(configStore.download.ratioConfirmMute, sites);
    },
  });

  /**
   * 一批种子 → 三档「下完这批之后的分享率」。
   *
   * 账户数读的是「上次取到的用户信息」那份缓存：这里不发请求、也不催刷新 ——
   * 发送那一刻去各站拉一遍用户信息会把发送本身拖成十几秒，而缓存陈旧最坏只是这一档
   * 提示得晚一点（预估只会偏乐观，不会误拦）。
   */
  async function assessRatioRisk(torrents: ITorrent[]): Promise<IRatioRisk> {
    const risk = assessRatioBatch(torrents, {
      accountFor: (site) => metadataStore.lastUserInfo[site],
      nameFor: (site) => metadataStore.siteNameMap[site] ?? "",
    });
    await fillRatioRowNames(risk, (site) => metadataStore.getSiteName(site));
    return risk;
  }

  return { guard, assessRatioRisk };
}
