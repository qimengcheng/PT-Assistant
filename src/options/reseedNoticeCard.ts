/**
 * 后台一轮写来的辅种进展 → 界面右上角那张 notification 卡片。
 *
 * 判据与文案都在 `src/shared/reseedNotice.ts`（那份能直接拿 Node 跑断言），这一层只管摆成什么样：
 * 一条任务时正文里已经写了任务名，所以没有明细行；多条时正文只说「N 个任务」，是哪几条列在下面。
 *
 * `key` 按 kind 给：同一个 kind 下一轮再来一次是**替换**当前这张卡片，而不是再堆一张 ——
 * 判据在 `@v-c/notification` 的 `open` 里（`findIndex((item) => item.key === config.key)` 命中就原地换掉）。
 *
 * 为什么单独成模块而不是写在 `App.vue` 的 setup 里：这段逻辑住在那儿就没法拿真代码验，
 * 而这次要改掉的正是「四条并排堆着」—— 得能在台架里把 `showReseedNoticeCard` 真调一次才算数。
 */
import { h } from "vue";
import { notification } from "antdv-next";

import { reseedNoticeColor, reseedNoticeGroupDetails, reseedNoticeGroupText, type IReseedNoticeGroup } from "@/shared/reseedNotice.ts";

export function showReseedNoticeCard(group: IReseedNoticeGroup, lang: string | undefined): void {
  const { title, message } = reseedNoticeGroupText(group, lang);
  const details = reseedNoticeGroupDetails(group, lang);
  notification[reseedNoticeColor(group.kind)]({
    key: `reseed-${group.kind}`,
    title,
    description:
      details.length === 0
        ? message
        : h(
            "div",
            { style: { overflowWrap: "anywhere" } },
            [h("div", message), ...details.map((line) => h("div", { style: { marginTop: "4px" } }, line))],
          ),
    duration: 8,
    placement: "topRight",
  });
}
