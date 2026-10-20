/**
 * 「设置 → 搜索设置项」的判据本体。
 *
 * 分成两半是故意的：
 * - **什么算命中、命中了怎么排**（纯函数，vitest 是 node 环境能直接断言）；
 * - **把界面上的一行读成一条记录**（要碰 DOM，只能靠选择器常量 + 源码文本断言钉住）。
 *
 * 索引**每次搜索现扫 DOM**，不在挂载时建一份留着 —— 这一页有一批设置项是被上一级开关按住
 * 就整个不渲染的（实测三处：`SitePageWindow.vue:50` 那 7 条要「启用内容脚本」开着、
 * `UserInfoWindow.vue:42` 那 6 格要「自动刷新用户信息」开着、`:82` 那一行要自动续期开着）。
 * 建一次索引就等于把「此刻渲染了什么」冻住，渲染一变就开始说假话。
 */

/** 一条可搜索的设置项。`label` 是界面上逐字显示的那句，不是 i18n 键 —— 跟着语言走是这条功能的要点。 */
export interface ISettingRow {
  label: string;
  /** 那一格自己的说明文字（`a-form-item` 的 extra）；没有就 undefined */
  hint?: string;
  /** 所在节的 key（`set-xxx` 里那个 xxx）；节自己那一条也填自己的 key */
  sectionKey: string;
  /** 节标题本身也算一条结果：搜「账号」就该能跳到「账号与流量」那一节 */
  kind: TSettingKind;
  /** 所在节在页面上的先后，用于「同分时按页面顺序排」 */
  sectionOrder: number;
  /** DOM 里的先后，同一节内的稳定序 */
  domOrder: number;
}

/** 读到的 DOM 行会带上可点击/可滚的那颗元素 */
export interface IDomSettingRow extends ISettingRow {
  el: HTMLElement;
}

export type TSettingRank = 0 | 1 | 2;

export type TSettingKind = "section" | "item";

export type TSettingHit<T extends ISettingRow = ISettingRow> = T & { rank: TSettingRank };

/**
 * 参与搜索的三类行容器（逐条在这台组件库里实测过类名）：
 * - `.switch-item`：开关那一格，标签在 `span.label`（九个窗口都这么写）；
 * - `.ant-form-item`：`a-form-item` 那一格，标签在 `.ant-form-item-label label`，
 *   说明在 `.ant-form-item-extra`（类名来自 `dist/form/FormItemInput.js:73` 的
 *   `${baseClassName}-extra`，baseClassName 是 `ant-form-item`）；
 * - `.group-title`：一节之内的分组标题，搜它能跳到那一组。
 */
export const ROW_SELECTOR = ".switch-item, .ant-form-item, .group-title";
export const LABEL_SELECTOR = ".label, .ant-form-item-label label";
export const HINT_SELECTOR = ".ant-form-item-extra";
/** 一节的外层：`data-key` 由 Index.vue 写，节标题在 `h2.set-section-title` */
export const SECTION_SELECTOR = ".set-section";
export const SECTION_TITLE_SELECTOR = ".set-section-title";

export function queryTokens(query: string): string[] {
  return query.trim().toLowerCase().replace(/\s+/g, " ").split(" ").filter(Boolean);
}

/**
 * 命中档位，数字越小越靠前：
 * 0 = 名称以第一个词开头（「自动」把「自动刷新用户信息」顶到最前）；
 * 1 = 名称里含全部词；
 * 2 = 只有说明文字含（搜「小时」能捞到间隔那一格，这是说明的意义所在）。
 * 任一个词在名称与说明里都找不到 → 不命中（多词是 AND，不是「整串必须连续」）。
 */
export function rankOf(row: ISettingRow, tokens: readonly string[]): TSettingRank | null {
  if (tokens.length === 0) return null;
  const label = row.label.trim().toLowerCase();
  const hint = (row.hint ?? "").trim().toLowerCase();
  if (!tokens.every((t) => label.includes(t) || hint.includes(t))) return null;
  if (label.startsWith(tokens[0])) return 0;
  if (tokens.every((t) => label.includes(t))) return 1;
  return 2;
}

/** 空查询返回空表：调用方据此决定「显示结果」还是「显示目录」 */
export function searchSettingRows<T extends ISettingRow>(
  rows: readonly T[],
  query: string,
): TSettingHit<T>[] {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return [];
  const hits: TSettingHit<T>[] = [];
  for (const row of rows) {
    const rank = rankOf(row, tokens);
    if (rank !== null) hits.push({ ...row, rank });
  }
  hits.sort((a, b) => a.rank - b.rank || a.sectionOrder - b.sectionOrder || a.domOrder - b.domOrder);
  return hits;
}

/** 给界面把命中的片段切出来加底色：`[{text,hit}]`，不命中时整段是一个 plain */
export interface ISettingSegment {
  text: string;
  hit: boolean;
}

export function splitHighlight(text: string, query: string): ISettingSegment[] {
  const lower = text.toLowerCase();
  const ranges: [number, number][] = [];
  for (const token of queryTokens(query)) {
    let at = lower.indexOf(token);
    while (at >= 0) {
      ranges.push([at, at + token.length]);
      at = lower.indexOf(token, at + token.length);
    }
  }
  if (ranges.length === 0) return text ? [{ text, hit: false }] : [];
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  // 合并重叠/相接的区间：两个词撞在同一处时不能切成两段同色
  const merged: [number, number][] = [];
  for (const [start, end] of ranges) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }

  const out: ISettingSegment[] = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) out.push({ text: text.slice(cursor, start), hit: false });
    out.push({ text: text.slice(start, end), hit: true });
    cursor = end;
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor), hit: false });
  return out;
}

/**
 * DOM 那一侧：把 `box` 里的每一节与每一格读成一条记录。
 * 只认叶子那一层（`querySelector(ROW_SELECTOR)` 不为空的整格跳过）—— 万一以后出现
 * 「表单项里套表单项」，不挡就会同一条出现两次。
 *
 * 节自己也算一条（标题读进来）：搜「账号」应当能跳到「账号与流量」那一节，
 * 而那一节里恰好没有名字含「账号」的格子。
 */
export function readSettingRows(box: HTMLElement, sectionOrder: Readonly<Record<string, number>>): IDomSettingRow[] {
  const out: IDomSettingRow[] = [];
  const sections = Array.from(box.querySelectorAll<HTMLElement>(SECTION_SELECTOR));
  const orderOf = new Map<string, number>();
  sections.forEach((section, index) => {
    const key = section.dataset.key ?? "";
    orderOf.set(key, sectionOrder[key] ?? index);
    const title = clean(section.querySelector<HTMLElement>(SECTION_TITLE_SELECTOR)?.textContent);
    if (title) out.push({ label: title, sectionKey: key, kind: "section", sectionOrder: orderOf.get(key)!, domOrder: -1, el: section });
  });

  box.querySelectorAll<HTMLElement>(ROW_SELECTOR).forEach((el, domOrder) => {
    if (el.querySelector(ROW_SELECTOR)) return;
    const section = el.closest<HTMLElement>(SECTION_SELECTOR);
    const key = section?.dataset.key ?? "";
    const labelEl = el.matches(LABEL_SELECTOR) ? el : el.querySelector<HTMLElement>(LABEL_SELECTOR);
    const label = clean(labelEl?.textContent ?? el.textContent ?? "");
    if (!label) return;
    const hint = clean(el.querySelector<HTMLElement>(HINT_SELECTOR)?.textContent ?? "");
    out.push({
      label,
      hint: hint || undefined,
      sectionKey: key,
      kind: "item",
      sectionOrder: orderOf.get(key) ?? 0,
      domOrder,
      el,
    });
  });
  return out;
}

/** 界面上读来的文字：折行与连续空白压掉，否则「自动刷新\n 用户信息」搜不到 */
function clean(text: string | undefined | null): string {
  return (text ?? "").trim().replace(/\s+/g, " ");
}
