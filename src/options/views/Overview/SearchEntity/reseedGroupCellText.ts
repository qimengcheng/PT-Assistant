/**
 * 「可选的辅种组合」那一列显示什么字。
 *
 * 为什么单独成一个模块（同 `torrentStatusMeta.ts` 的先例）：判据写在 SFC 里就进不了 Node 断言，
 * 也就进不了反证 —— 而这一条坏得最难看的两半恰好都只在「各站报不报得出副标题」上才显形。
 *
 * 背景（用户 2026-11-06：「这一列全是英文，能不能有个开关切换显示副标题」）：主标题是发布名
 * （`All Wishes Come True 2026 2160p YK HQ WEB-DL …`），副标题才是各站自己填的那一行中文
 * （`沉默的荣耀/暗夜深海/破晓时分 | 全39集 | 导演: …`）。实测（`.tmp-build/bench-subtitle`，
 * 真解析器 + 两份真页源码）PTZone 那一页 50/50 条、LuckPT 12/12 条都报得出 —— 但那是
 * NexusPHP 那一族，不许当成「所有站都有」：整组一条都没报出时**退回主标题**，那一格不许空白。
 */

/** 一行结果里这一判据要吃的字段（`ISearchResultTorrent` 的结构子集，方便单测造夹具） */
export interface IReseedGroupTextRow {
  title?: unknown;
  subTitle?: unknown;
}

/** 只认「trim 完还有字」的串：缺字段 / null / 空串 / 纯空格都算这一站没报 */
function textOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * 「内容」那一列最终显示的文字。
 *
 * - 开关关掉 = 主标题，取组里第一条（各站自己写的名字，取第一条当「这一档是什么内容」，
 *   沿用这一屏原来的写法）。
 * - 开关打开 = 组内**第一条报得出副标题的**，不是固定取第一条：一组里各站解析能力不同，
 *   第一条恰好落在没报出的那一站就会让这一格空白。
 * - 整组都没报出副标题 = 退回主标题。
 */
export function reseedGroupCellText(rows: readonly IReseedGroupTextRow[], showSubtitle: boolean): string {
  const title = textOf(rows[0]?.title);
  if (!showSubtitle) return title;
  for (const row of rows) {
    const sub = textOf(row?.subTitle);
    if (sub) return sub;
  }
  return title;
}
