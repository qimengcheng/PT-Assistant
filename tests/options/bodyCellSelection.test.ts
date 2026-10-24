/**
 * 「`#bodyCell` 插槽把行首那颗复选框顶掉了」这一族的判据。
 *
 * 现象（用户 2026-10-24：「多选框怎么没有了」）：「我的数据」三张表带 `:row-selection`，
 * 表头那格有「选择全部」，**每一行的那一格却是空的** —— 40 行 0 颗复选框（台架读数，
 * `.tmp-build/bench-mydata/probe4.{html,mjs}`，挂的是没改过的真页面）。
 *
 * 机制（两处源码，都不是猜的）：
 *   `antdv-next@1.6.0` 的 `TableCell` —— `if (bodyCell && column) { const t = bodyCell({column,text,record}); … g = t }`：
 *   **插槽返回了东西就整格替换**，包括 antd 自己为勾选列渲染的那颗 checkbox；
 *   `vue` 的 `flattenChildren` —— 把注释节点滤掉、把组件 vnode 留下。
 *   于是同一句 `v-if` 写在页面上和写在子组件里，结果相反：
 *     · 页内一串 `<template v-if="column.key === …">`，全不命中 → 只剩注释 → 长度 0 → 复选框留着；
 *     · 页内 `<UserInfoCell />`（子组件自己渲染出注释也一样）→ 那是个组件 vnode → 长度 ≥1 → 复选框被顶掉。
 *   补一句「拿 `column.key` 挡一下」**救不回来**：勾选列也带 key，实测是 antd 内部生成的 `key-0`
 *   （台架 `probe5` 第三档量到的就是这一条）。名单必须按「我们声明过的那批 key」判。
 *
 * 所以这里钉三件事：① 全仓不许再出现「勾选列会拿到非注释返回」的那种 `#bodyCell`；
 * ② 「我的数据」那三张表各自的放行名单在位；③ 我们声明的列 key 不可能长得像 antd 内部生成的 `key-N`
 * （否则名单会反过来把勾选列吃掉，修过头）。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** 仓库根：走 fileURLToPath（`new URL().pathname` 会把空格转成 %20，本仓路径里就有空格） */
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

/**
 * 读源码文本做形状断言之前先归一换行符（本仓 `core.autocrlf`：仓库存 LF、工作区可能是 CRLF，
 * 而这里钉的是模板形状，不是换行符）。
 */
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8").replace(/\r\n/g, "\n");

/** 递归列出候选 .vue（只看会渲染表格的两块，别把 node_modules / 台架扫进来） */
function listVue(dirRel: string): string[] {
  const abs = join(repoRoot, dirRel);
  const out: string[] = [];
  for (const name of readdirSync(abs)) {
    const full = join(abs, name);
    if (statSync(full).isDirectory()) out.push(...listVue(join(dirRel, name)));
    else if (name.endsWith(".vue")) out.push(relative(repoRoot, full).replaceAll("\\", "/"));
  }
  return out;
}

/** 认「组件标签」：首字母大写（UserInfoCell / SiteFavicon），a-* 与原生标签是元素不是组件 */
const isComponentTag = (tag: string) => /^[A-Z]/.test(tag);

/** 从一段起始标签文本里判断它有没有自带 v-if / v-else-if / v-else */
function directivesOf(openTag: string) {
  return {
    vIf: /(^|\s)v-if=/.test(openTag),
    vElseIf: /(^|\s)v-else-if=/.test(openTag),
    vElse: /(^|\s)v-else(\s|=|>|$)/.test(openTag),
  };
}

/**
 * 切出一个 `<template #bodyCell …> … </template>` 块的内部文本（按标签深度配对，
 * 里面还会嵌 `<template v-if>` 子块，所以不能拿第一个 `</template>` 当结束）。
 */
function bodyCellBodies(src: string): string[] {
  const bodies: string[] = [];
  const openRe = /<template\s+#bodyCell[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(src))) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < src.length && depth > 0) {
      const next = src.indexOf("<template", i);
      const close = src.indexOf("</template>", i);
      if (close === -1) break;
      if (next !== -1 && next < close) {
        // 只把成对的 <template …> 记一层；自闭合不会出现（template 必有子内容）
        depth += 1;
        i = src.indexOf(">", next) + 1;
        continue;
      }
      depth -= 1;
      i = close + "</template>".length;
    }
    if (depth !== 0) throw new Error(`#bodyCell 块的 template 标签没配对（${src.slice(start, start + 60)}…）`);
    bodies.push(src.slice(start, i - "</template>".length));
  }
  return bodies;
}

/** 自闭合/空元素：它们不产生配对的结束标签，深度不能跟着加一 */
const VOID_TAGS = new Set(["br", "hr", "img", "input", "slot"]);

/**
 * 找一个起始标签的结束 `>`：属性值里的 `>`（`v-if="a > b"`）不算。
 * 从 `<` 之后逐字符走，遇引号进字符串态。找不到返回 -1。
 */
function tagEnd(text: string, lt: number): number {
  let quote = "";
  for (let i = lt + 1; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ">") return i;
  }
  return -1;
}

/**
 * 扫描一份 .vue：返回「这一格里勾选列会收到非注释返回」的违规点。
 *
 * 判据口径（宁松勿紧，只在真会弄丢内置渲染的形状上报）：
 *   · `#bodyCell` 顶层出现**没有 v-if 的组件标签** → 违规（v0.99.4 那一次就是这个形状）；
 *   · 顶层出现 `v-else` → 违规（勾选列也会走到那一支，返回非注释内容）；
 *   · 顶层出现裸文本 / `{{ }}` → 违规（同一个道理，它给的是字符串）。
 * 带 `v-if="…column.key…"` 的组件、以及页内 `<template v-if>` 链（不命中只剩注释）都放行。
 * 文本只在**真顶层**（depth 0）才计 —— 子块里的文字是那条分支自己的内容，与勾选列无关。
 */
export function findBodyCellViolations(src: string): string[] {
  const bad: string[] = [];
  for (const body of bodyCellBodies(src)) {
    const stripped = body.replace(/<!--[\s\S]*?-->/g, "");
    let depth = 0;
    let i = 0;
    let textAtTop = "";
    while (i < stripped.length) {
      const lt = stripped.indexOf("<", i);
      if (lt === -1) {
        if (depth === 0) textAtTop += stripped.slice(i);
        break;
      }
      if (depth === 0) textAtTop += stripped.slice(i, lt);
      const gt = tagEnd(stripped, lt);
      if (gt === -1) break;
      if (stripped.startsWith("</", lt)) {
        depth = Math.max(0, depth - 1);
        i = gt + 1;
        continue;
      }
      const tagText = stripped.slice(lt, gt);
      const tagName = /^<([A-Za-z0-9_.-]+)/.exec(tagText)?.[1] ?? "";
      const selfClosing = tagText.endsWith("/") || VOID_TAGS.has(tagName);
      if (depth === 0 && tagName !== "template") {
        const d = directivesOf(tagText);
        if (isComponentTag(tagName) && !d.vIf && !d.vElseIf && !d.vElse) {
          bad.push(`顶层组件 <${tagName}> 没有 v-if 名单：勾选列会被它顶掉`);
        }
        if (d.vElse) bad.push(`顶层 <${tagName} v-else>：勾选列也会走到这一支`);
      }
      depth += selfClosing ? 0 : 1;
      i = gt + 1;
    }
    if (textAtTop.trim().length > 0) {
      bad.push(`顶层裸文本「${textAtTop.trim().slice(0, 20)}」：勾选列会收到这段文字`);
    }
  }
  return bad;
}

/** 这份文件有没有「antd 会自己插一列」的入口：勾选列与展开列都会被同一个插槽顶掉 */
const hasInjectedColumn = (src: string) =>
  /:row-selection/.test(src) || /:expandable/.test(src) || /expandedRowKeys/.test(src);

/** 全仓扫一遍，返回逐文件的违规清单（空数组 = 没有这种形状） */
export function scanRepo(): string[] {
  const offenders: string[] = [];
  for (const rel of [...listVue("src/options"), ...listVue("src/content-script")]) {
    const src = read(rel);
    if (!src.includes("#bodyCell") || !hasInjectedColumn(src)) continue;
    const found = findBodyCellViolations(src);
    if (found.length > 0) offenders.push(`${rel} → ${found.join("；")}`);
  }
  return offenders;
}

const MYDATA = "src/options/views/Overview/MyData/Index.vue";

describe("全仓：带 row-selection 的表格里，#bodyCell 不许把勾选列顶掉", () => {
  it("扫过的文件数不是 0（配置写歪时「一条违规都没有」是假 PASS）", () => {
    const files = [...listVue("src/options"), ...listVue("src/content-script")];
    expect(files.length).toBeGreaterThan(100);
  });

  it("候选面不为空：确实有若干文件同时带 #bodyCell 与 :row-selection", () => {
    const scanned = [...listVue("src/options"), ...listVue("src/content-script")].filter((rel) => {
      const src = read(rel);
      return src.includes("#bodyCell") && hasInjectedColumn(src);
    });
    expect(scanned.length).toBeGreaterThanOrEqual(8);
  });

  it("现在全仓没有一处这种形状", () => {
    expect(scanRepo()).toEqual([]);
  });

  it("反例：一个不带名单的顶层组件会被认出来（这条不空转）", () => {
    const broken = `<a-table :row-selection="r"><template #bodyCell="{ column, record }">
      <UserInfoCell :column="column" :record="record" />
    </template></a-table>`;
    expect(findBodyCellViolations(broken)).toHaveLength(1);
  });

  it("正例：带 v-if 名单的组件、页内 v-if 链都不报（子块里的文字不算顶层）", () => {
    const guarded = `<template #bodyCell="{ column, record }">
      <UserInfoCell v-if="cellColumnKeys.has(String(column.key))" :column="column" />
    </template>`;
    const inlineChain = `<template #bodyCell="{ column, record }">
      <template v-if="column.key === 'name'"><span>a</span></template>
      <template v-else-if="column.key === 'date'"><span>b</span></template>
    </template>`;
    expect(findBodyCellViolations(guarded)).toEqual([]);
    expect(findBodyCellViolations(inlineChain)).toEqual([]);
  });

  it("反例：顶层 v-else 也报（那一支勾选列同样走得到）", () => {
    const withElse = `<template #bodyCell="{ column, record }">
      <span v-if="column.key === 'name'">a</span>
      <span v-else>b</span>
    </template>`;
    expect(findBodyCellViolations(withElse)).toHaveLength(1);
  });

  it("反例：顶层裸文本 / 插值也报", () => {
    expect(findBodyCellViolations(`<template #bodyCell="{ record }">{{ record.name }}</template>`)).toHaveLength(1);
  });

  it("属性值里的 > 不把标签切断（v-if=\"a > b\" 那种写法仍能认出名单）", () => {
    const gtInAttr = `<template #bodyCell="{ column, record }">
      <UserInfoCell v-if="cellColumnKeys.has(String(column.key)) || column.width > 0" :column="column" />
    </template>`;
    expect(findBodyCellViolations(gtInAttr)).toEqual([]);
  });
});

describe("「我的数据」这一页的放行名单", () => {
  const src = read(MYDATA);

  it("三张表都给了名单，一处不漏（每张表的 #bodyCell 都带 v-if）", () => {
    expect(bodyCellBodies(src)).toHaveLength(3);
    const guarded = src.match(/<UserInfoCell\n\s+v-if="cellColumnKeys\.has\(String\(column\.key\)\)"/g) ?? [];
    expect(guarded).toHaveLength(3);
  });

  it("名单就是从这份表头派生的，不是手抄一份字符串", () => {
    expect(src).toMatch(
      /const cellColumnKeys = computed\(\(\) => new Set\(tableHeader\.value\.map\(\(header\) => header\.key\)\)\)/,
    );
  });

  it("我们声明的列 key 不可能长得像 antd 内部生成的 key-N（否则名单反过来吃掉勾选列）", () => {
    const keys = [...src.matchAll(/\bkey:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(10);
    expect(keys.filter((k) => /^key-\d+$/.test(k))).toEqual([]);
  });
});
