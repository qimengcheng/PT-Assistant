/**
 * 后台一轮写来的辅种进展 → 界面右上角那张通知卡片。
 *
 * 判据与文案都在 `src/shared/reseedNotice.ts`（那份能直接拿 Node 跑断言），这一层只管摆成什么样：
 * 一条任务时正文里已经写了任务名，所以没有明细行；多条时正文只说「N 个任务」，是哪几条在「详情」里。
 *
 * 2026-10-26 从 `notification` 换成 @zboson/ui 新加的 Notice：卡片挂在 App.vue 里那个
 * `<a-notice-group>` 上（同 id 覆盖、明细进详情弹窗这两条语义的实测出处写在 `./noticeHost.ts`）。
 * 换过来多出来的是**悬停暂停倒计时**（实测：`dist/notice/Notice.js:59` 那条 rAF 循环在
 * `hovered` 时停摆，台架量到悬停 5 秒进度读数不动、移开 3998 ms 后自己收）。
 * 代价是明细从「卡片里直接列」变成「点详情才展开」—— Notice 的 `message` 只有一个纯文本节点、
 * 也没有插槽，多行展不开；那一份多行文本靠 `style.css` 里 `.ant-notice-modal-text` 才分行。
 *
 * ⚠️ 组件自己带一颗设置键（点开是「各类型停留时长」的抽屉），但**这颗卡片不受它影响**：
 * 实测 `dist/notice-group/NoticeGroup.js:91` 是 `config.duration ?? settings[type] ?? 5`，
 * 我们照旧显式传 8 秒（= 换组件前那张卡片的时长），于是设置那几档对本卡片永远读不到。
 * 要不要把它交给设置（success/info/warning 5 秒、error 10 秒、带详情的 30 秒），是一条用户可见的
 * 时长变化，没替他定 —— 见首页 v0.127.x 那条与 `./noticeHost.ts` 同一节。
 *
 * 为什么单独成模块而不是写在 `App.vue` 的 setup 里：这段逻辑住在那儿就没法拿真代码验。
 */
import { tOutside } from "@/options/i18nOutside.ts";
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
    // 组件那句默认值是硬编码中文，英文界面要我方给（见 noticeHost.ts 里那段）
    detailText: tOutside("common.noticeDetail"),
    duration: 8,
  });
}
