/**
 * 全仓扫描：传给 `a-*` 组件的属性 / 插槽里，哪些是该组件**根本不认**的「死项」。
 *
 * 为什么需要这条防线：
 * `vue-tsc` 抓不到它（`a-tag` 的类型来自 `GlobalComponents` 声明，宽松且允许任意 attr），
 * `check-antd-tags.mjs` 也抓不到它（那条只查「标签名存不存在」）。
 * 而 antdv-next 的运行时是 `inheritAttrs` 默认行为：没声明的 prop 会被当普通 attr
 * 原样塞进根 DOM 元素，**不报错、不警告、生产环境完全静默**；没匹配的命名插槽则直接
 * 渲染成空。二者症状都是「写了等于没写」。
 * 典型就是 v0.20.3 修掉的 `a-tag :bordered`（Vue2/antd4 的 prop，antd5 早删了）、
 * `a-select` 的 options 用 `title` 键、`<a-collapse-panel #label>`（antdv-next 只有 `#header`）。
 *
 * 判定依据不是文档，是**运行时 + 类型产物**：
 *   - 组件名与 props：在 Node 里实跑一次全量 `install`，读 `app._context.components`；
 *   - 插槽：组件对象上没有 slots 运行时信息（slots 是渲染期产物），只能读 `dist` 下的 `.d.ts`，
 *     从 `declare const X: DefineSetupFnComponent<..., SlotsType<YSlots>>` 建立
 *     「组件名 → 插槽名」的映射，同样不抄文档。
 *
 * 四条自我约束（宁可漏报也不误报，否则这条防线会被人手动跳过）：
 *   1. 取不到 props / slots 声明的组件 → 整组件跳过，不报；
 *   2. HTML 全局属性（class/style/key/ref/enterkeyhint/...）走白名单，它们本来就该透传；
 *   3. 事件（`@x`）、指令（`v-x`）、动态参数（`:[x]`）不算 prop；
 *   4. 只扫 `src/**` 下的 `.vue`（仓库里只有少量 `.tsx`，不在本条防线覆盖面，脚本结尾会说明数量）。
 *
 * 用法：`node scripts/check-dead-props.mjs`（无需构建产物）
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const ROOT = process.cwd();
const toUrl = (p) => "file:///" + path.join(ROOT, p).split(path.sep).join("/");

const { createApp } = createRequire(path.join(ROOT, "noop.js"))("vue");
const { parse: parseSfc } = createRequire(path.join(ROOT, "noop.js"))("@vue/compiler-sfc");
const antd = await import(toUrl("node_modules/antdv-next/dist/index.js"));

const app = createApp({ render: () => null });
app.use(antd.install);
const registry = app._context.components;

/** 组件 prop 名（小写）集合；`null` 表示该组件的 props 取不到 → 不校验 */
const propCache = new Map();
function propNamesOf(regName) {
  if (propCache.has(regName)) return propCache.get(regName);
  const comp = registry[regName];
  const decl = comp?.props ?? comp?.__props;
  let set = null;
  if (decl) {
    const keys = Array.isArray(decl) ? decl : Object.keys(decl);
    if (keys.length > 0) set = new Set(keys.map((k) => k.toLowerCase()));
  }
  propCache.set(regName, set);
  return set;
}

// ---------------------------------------------------------------------------
// 插槽索引：只能从 d.ts 建。结构是
//   interface CollapsePanelSlots { default?: () => any; header?: () => any; ... }
//   declare const CollapsePanel: import("vue").DefineSetupFnComponent<
//       CollapsePanelProps, EmptyEmit, SlotsType<CollapsePanelSlots>, ...>;
// 先按 `declare const ` 切成块，块内不会串到下一个组件。
// ---------------------------------------------------------------------------
function walkFiles(dir, ext, out = []) {
  if (!fs.existsSync(path.join(ROOT, dir))) return out;
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(p, ext, out);
    else if (entry.name.endsWith(ext)) out.push(p);
  }
  return out;
}

const dtsFiles = walkFiles("node_modules/antdv-next/dist", ".d.ts");

/** 组件名 -> Set<slot 名>，启动时一次性建好 */
const slotIndex = new Map();
{
  /** 接口名 -> Set<slot 名> */
  const slotInterfaces = new Map();
  for (const file of dtsFiles) {
    const src = fs.readFileSync(path.join(ROOT, file), "utf8");
    for (const m of src.matchAll(/interface\s+(\w*Slots)\s*\{([\s\S]*?)\n\}/g)) {
      // 必须小写：插槽名是 camelCase（`labelRender`），而比较前名字统一走 normalize() 变小写
      const names = new Set([...m[2].matchAll(/^\s*(\w+)\??:/gm)].map((x) => x[1].toLowerCase()));
      if (names.size > 0) slotInterfaces.set(m[1], names);
    }
  }
  for (const file of dtsFiles) {
    const src = fs.readFileSync(path.join(ROOT, file), "utf8");
    // 按 `declare const ` 切成块，块内不会串到下一个组件的声明
    for (const block of src.split(/declare const /).slice(1)) {
      const compName = /^(\w+)/.exec(block)?.[1];
      const ifaceName = /SlotsType<(\w+)>/.exec(block)?.[1];
      const names = ifaceName ? slotInterfaces.get(ifaceName) : undefined;
      if (compName && names) slotIndex.set(compName, names);
    }
  }
}

/** 组件的 slot 名集合；`null` 表示取不到 slots 声明 → 该组件不校验插槽 */
function slotNamesOf(regName) {
  return slotIndex.get(regName.replace(/^A/, "")) ?? null;
}
/**
 * HTML 原生属性 / Vue 保留名：这些透传给组件是合法的，不算死属性。
 * `enterkeyhint` 在列：它是 HTML 标准全局属性（作用于内部 `<input>`），
 * `a-input-search enterkeyhint="search"` 就是靠透传生效的，不在组件 props 声明里。
 */
const PASS_THROUGH = new Set(
  (
    "class style key ref id role slot is lang dir title href target rel name src alt type draggable tabindex " +
    "enterkeyhint inputmode autocomplete autocapitalize spellcheck contenteditable accesskey"
  ).split(" "),
);

/** Vue 的 props 声明是 camelCase，模板里两种写法都能用（`data-source` / `dataSource`），比较前统一 */
function normalize(name) {
  return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase()).toLowerCase();
}

/** `a-list-item-meta` → `AListItemMeta`；`<ATable>` 这种 Pascal 写法原样返回 */
function toRegName(tag) {
  if (/^A[A-Z]/.test(tag)) return tag;
  if (/^a-[a-z][a-z0-9-]*$/.test(tag)) {
    return "A" + tag.slice(2).split("-").map((s) => s[0].toUpperCase() + s.slice(1)).join("");
  }
  return null;
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.name.endsWith(".vue")) out.push(p);
  }
  return out;
}

/**
 * 扫一遍 HTML，返回每个标签的 { name, attrsText, pos, closing, selfClosing }。
 * 自己写而不是用 `<[^>]*>`：属性值里可能带 `>`（`:title="a > b"`），正则会提前截断。
 */
function scanTags(html) {
  const out = [];
  let i = 0;
  while (i < html.length) {
    if (html[i] !== "<" || !/[A-Za-z/]/.test(html[i + 1] ?? "")) {
      i++;
      continue;
    }
    let j = i + 1;
    let quote = null;
    while (j < html.length) {
      const c = html[j];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") quote = c;
      else if (c === ">") break;
      j++;
    }
    const inner = html.slice(i + 1, j);
    const closing = inner.startsWith("/");
    const m = /^\/?([A-Za-z][A-Za-z0-9-]*)/.exec(inner);
    if (m) {
      const selfClosing = inner.trimEnd().endsWith("/");
      const body = selfClosing ? inner.trimEnd().slice(0, -1) : inner;
      const head = m[0].length;
      out.push({ name: m[1], attrsText: body.slice(head), pos: i, closing, selfClosing });
    }
    i = j + 1;
  }
  return out;
}

/**
 * 实测有效、但 d.ts 的 `XxxSlots` 里没声明的插槽（组件内部做了别名兼容）。
 * key 用**模板里的原始标签名**（栈里存的就是它）。每一条都必须在注释里
 * 写清验证方式，否则就是凭空放行。
 */
const SLOT_ALIAS = new Map([
  // antdv-next 的 TimelineItem 内部走 rc-timeline，`#label` 与 `#title`
  // 的 SSR 渲染输出逐字符相同（2026-10-04 实测），所以 d.ts 只声明 `title` 也认 `label`。
  ["a-timeline-item", new Set(["label"])],
]);

/**
 * 原生 HTML 标签：栈里跳过它们，栈顶才等于「最近的组件祖先」。
 * 少了这份清单，`<a-modal><FilterCheckboxSection><template #item>` 会因为
 * `FilterCheckboxSection` 不入栈而把它的插槽算到外层 `a-modal` 头上。
 * 宁可多列几个（把不确定的当 HTML）——那只会漏报，不会误报。
 */
const HTML_TAGS = new Set(
  (
    "html head body div span p a ul ol li dl dt dd table thead tbody tfoot tr td th " +
    "form label input textarea select option optgroup button fieldset legend output " +
    "img br hr h1 h2 h3 h4 h5 h6 header footer nav aside main section article " +
    "strong em b i s u small mark code pre blockquote abbr cite q sub sup kbd samp var " +
    "figure figcaption video audio canvas svg path g circle rect line polyline text " +
    "details summary dialog menu iframe object embed map area datalist progress meter " +
    "picture source track template"
  ).split(" "),
);

/**
 * 从属性串里取出「作为 prop / 插槽传下去的名字」。
 * 返回 `[{ kind: "prop" | "slot", name }]`；事件、指令、`.prop` 修饰符、动态参数全滤掉。
 *
 * 必须是**逐 token 消费**而不是一条正则扫全串：`prop="a === true"` 这种值里含裸标识符，
 * 正则扫不出「值」的边界，会把 `a` 当成下一个属性名，整个脚本的结论全是噪音。
 */
function parseAttrs(attrsText) {
  const out = [];
  const isSpace = (c) => c === " " || c === "\n" || c === "\t" || c === "\r";
  const isNameChar = (c) => /[A-Za-z0-9_-]/.test(c);
  let i = 0;
  const n = attrsText.length;

  while (i < n) {
    while (i < n && isSpace(attrsText[i])) i++;
    if (i >= n) break;

    // 动态参数 `:[foo]` / `v-bind:[foo]`：方括号里的内容不是属性名（编译期才确定）
    if (attrsText[i] === "[") {
      i++;
      while (i < n && attrsText[i] !== "]") {
        if (attrsText[i] === '"' || attrsText[i] === "'") {
          const q = attrsText[i++];
          while (i < n && attrsText[i] !== q) i++;
        }
        i++;
      }
      i++;
      continue;
    }

    const prefix = ":@#.".includes(attrsText[i]) ? attrsText[i++] : "";
    let name = "";
    while (i < n && isNameChar(attrsText[i])) name += attrsText[i++];
    if (!name) {
      i++; // 认不出的字符（`/`、`<` 等），跳过
      continue;
    }

    // 名字与 `=` 之间允许空白
    let j = i;
    while (j < n && isSpace(attrsText[j])) j++;

    const emit = () => {
      if (prefix === "@" || prefix === ".") return; // 事件 / .prop 修饰符
      if (name.startsWith("v-") || name.startsWith("v:")) return; // 指令
      out.push({ kind: prefix === "#" ? "slot" : "prop", name });
    };

    // 无值属性：`<template #label>`、`ghost`、`show-icon` 都属于这一类，
    // 值隐含为 true。**必须照常收下** —— 早先这里是 continue，把它们全丢了，
    // 结果所有插槽与所有静态无值 prop 都没被校验过。
    if (attrsText[j] !== "=") {
      emit();
      continue;
    }

    // 消费掉整个值，否则值里的裸标识符会被当成下一个属性名
    i = j + 1;
    while (i < n && isSpace(attrsText[i])) i++;
    if (attrsText[i] === '"' || attrsText[i] === "'") {
      const q = attrsText[i++];
      while (i < n && attrsText[i] !== q) i++;
      i++;
    } else {
      while (i < n && !isSpace(attrsText[i])) i++;
    }

    emit();
  }
  return out;
}

const files = walk("src");
/** key: `${文件}|${标签}|${类别}${名字}` → Set<行号> */
const findings = new Map();
let checked = 0;
let checkedSlots = 0;
let skippedNoProps = 0;

const addFinding = (key, line) => {
  if (!findings.has(key)) findings.set(key, new Set());
  findings.get(key).add(line);
};

for (const file of files) {
  const posixFile = file.split(path.sep).join("/");
  const raw = fs.readFileSync(path.join(ROOT, file), "utf8");
  // 用 @vue/compiler-sfc 取顶层 <template> 块：自己用 indexOf("</template>") 找边界会被
  // 嵌套的 `<template #xxx>` 提前截断，导致一整个组件的模板扫不全（插槽几乎全被漏掉）。
  const { descriptor, errors } = parseSfc(raw, { filename: posixFile });
  if (!descriptor.template) continue;
  if (errors.length) continue;
  // `content` 是去掉外层 <template> 标签后的内容，`loc.start.line` 是它在原文件里的行号
  // 注释用等长空白替换（保留所有换行）：直接删掉会让后面每一行的行号都前移，
  // 报错指向错误的行，等于没有行号。
  const template = descriptor.template.content.replace(/<!--[\s\S]*?-->/g, (m) =>
    m.replace(/[^\n]/g, " "),
  );
  const lineOffset = descriptor.template.loc.start.line - 1;
  // 组件开标签栈：插槽名写在 `<template #xxx>` 上，必须靠父子关系才知道属于哪个组件。
  // `<template>` 自己不入栈 —— 它的内容在语义上属于插槽，不属于父组件的 DOM 层级。
  // 入栈的不止 `a-*`：自定义组件（FilterCheckboxSection 等）也必须占位，
  // 否则它的插槽会被错算到外层 antd 组件头上。
  const stack = [];

  for (const tag of scanTags(template)) {
    const line = lineOffset + template.slice(0, tag.pos).split("\n").length;

    if (tag.name === "template" && !tag.closing) {
      const parent = stack[stack.length - 1];
      // 父是自定义组件 → 它接不转发插槽静态不可判定，跳过
      if (!parent || !parent.knownSlots) continue;
      const alias = SLOT_ALIAS.get(parent.name);
      for (const { kind, name } of parseAttrs(tag.attrsText)) {
        if (kind !== "slot") continue;
        const norm = normalize(name);
        checkedSlots++;
        if (norm === "default" || parent.knownSlots.has(norm)) continue;
        if (alias?.has(norm)) continue;
        addFinding(`${posixFile}|${parent.name}|slot #${name}`, line);
      }
      continue;
    }

    if (HTML_TAGS.has(tag.name)) continue;
    if (tag.closing) {
      if (stack.length) stack.pop();
      continue;
    }

    const isAnt = /^a-/.test(tag.name);
    const reg = toRegName(tag.name);
    const knownProps = isAnt ? propNamesOf(reg) : null;
    const knownSlots = isAnt ? slotNamesOf(reg) : null;
    if (isAnt && !knownProps && !knownSlots) skippedNoProps++;
    else if (isAnt) checked++;

    if (isAnt) {
      for (const { kind, name } of parseAttrs(tag.attrsText)) {
        if (kind === "slot") continue; // 插槽在子 <template> 上，不在组件自身标签上
        if (!knownProps) continue;
        const norm = normalize(name);
        if (PASS_THROUGH.has(norm) || knownProps.has(norm)) continue;
        addFinding(`${posixFile}|${tag.name}|${name}`, line);
      }
    }
    if (!tag.selfClosing) stack.push({ name: tag.name, knownSlots });
  }
}

console.log(
  `扫描 ${files.length} 个 .vue，校验 ${checked} 处 a-* 标签用法与 ${checkedSlots} 处插槽` +
    (skippedNoProps ? `，跳过 ${skippedNoProps} 处（props 与 slots 都取不到声明，不校验）` : ""),
);

if (!findings.size) {
  console.log("PASS：没有发现传给 a-* 组件的死属性或死插槽。");
  process.exit(0);
}

console.error("FAIL：以下属性 / 插槽 antdv-next 对应组件并不认识，运行时静默失效（写了等于没写）：");
for (const [key, lines] of findings) {
  const [file, tag, what] = key.split("|");
  console.error(`  ${file}:${[...lines].sort((a, b) => a - b).join(",")}  <${tag} ${what}>`);
}
console.error(
  "改法：① 查 node_modules/antdv-next/dist/<组件>/<组件>.d.ts 里真实的 props / Slots；" +
    "② 若属性已废弃，换成现役 API 并核对视觉是否变化；" +
    "③ 确实要透传的 HTML 属性会走脚本白名单，不会出现在这里。",
);
process.exit(1);
