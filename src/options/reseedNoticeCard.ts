/**
 * 后台一轮写来的辅种进展 → 界面右上角那张通知卡片。
 *
 * 判据与文案都在 `src/shared/reseedNotice.ts`（那份能直接拿 Node 跑断言），这一层只管摆成什么样：
 * 一条任务时正文里已经写了任务名，所以没有明细行；多条时正文只说「N 个任务」，是哪几条在「详情」里。
 *
 * 2026-10-26 从 `notification` 换成 @zboson/ui 新加的 Notice：卡片挂在 App.vue 里那个
 * `<a-notice-group>` 上（同 id 覆盖、明细进详情弹窗这两条语义的实测出处写在 `./noticeHost.ts`）。
 * 换过来多出来的两件事是**悬停暂停倒计时**与各类型时长的本地设置；代价是明细从「卡片里直接列」
 * 变成「点详情才展开」—— Notice 的 `message` 只有一个纯文本节点、也没有插槽，多行展不开。
 *
 * 为什么单独成模块而不是写在 `App.vue` 的 setup 里：这段逻辑住在那儿就没法拿真代码验。
 */
import { openNoticeCard } from "@/options/noticeHost.ts";
import { reseedNoticeColor, reseedNoticeGroupDetails, reseedNoticeGroupText, type IReseedNoticeGroup } from "@/shared/reseedNotice.ts";

export function showReseedNoticeCard(group: IReseedNoticeGroup, lang: string | undefined): void {
  const { title, message } = reseedNoticeGroupText(group, lang);
  openNoticeCard({
    id: `reseed-${group.kind}`,
    type: reseedNoticeColor(group.kind),
    title,
    message,
    details: reseedNoticeGroupDetails(group, lang),
    duration: 8,
  });
}
