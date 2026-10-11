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
import { App, notification } from "antdv-next";
import { useI18n } from "vue-i18n";
import type { ITorrent } from "@ptd/site";

import { useMetadataStore } from "@/options/stores/metadata.ts";
import { summarizeRatioRisk, type IRatioRisk, type IRatioRow } from "@/shared/ratioGuard.ts";
import { makeRatioGuardUi } from "@/shared/ratioGuardUi.ts";

export function useRatioGuard() {
  const { modal } = App.useApp();
  const { t } = useI18n();
  const metadataStore = useMetadataStore();

  const guard = makeRatioGuardUi({ modal, notify: notification, t });

  /**
   * 一批种子 → 三档站点。分享率读的是「上次取到的用户信息」那份缓存：
   * 这里不发请求、也不催刷新 —— 发送那一刻去各站拉一遍用户信息会把发送本身拖成十几秒，
   * 而缓存陈旧最坏只是这一档没提示（不会误拦）。
   *
   * 站点名两步取（同 `SiteName.vue:59`）：先查 `siteNameMap`，没命中再异步走
   * `getSiteName`（它会读站点定义，未添加的站也有真名）。直接 `?? site` 会把内部 id
   * 画进界面，那是 AGENTS.md §3.5 的零容忍项 —— `KeepUploadDialog.vue:1332` 的注释
   * 就是为同一件事写的。补名字只发生在**真要画出来**的那两档（未取到那一档只报个数），
   * 所以不会为一整批发 N 次异步取数。
   */
  async function assessRatioRisk(torrents: Array<Pick<ITorrent, "site">>): Promise<IRatioRisk> {
    const rows: IRatioRow[] = [];
    for (const torrent of torrents) {
      const site = torrent.site;
      if (!site) continue;
      rows.push({
        site,
        name: metadataStore.siteNameMap[site] ?? "",
        ratio: metadataStore.lastUserInfo[site]?.ratio,
      });
    }

    const risk = summarizeRatioRisk(rows);
    for (const row of [...risk.danger, ...risk.warn]) {
      if (!row.name) row.name = await metadataStore.getSiteName(row.site);
    }
    return risk;
  }

  return { guard, assessRatioRisk };
}
