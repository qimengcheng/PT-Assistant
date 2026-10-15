/**
 * 悬浮提示不许用浏览器原生的 `title`。
 *
 * 防的静默失效：`title` 看着像组件 prop，实际大多数组件根本没有这个 prop —— 它被
 * `inheritAttrs` 原样塞进 DOM，出的是**浏览器自己画的那层提示**。底色、字号、行宽、
 * 出现延迟都由系统定，页面控制不了，也不跟主题走。不报错、不进 vue-tsc、不进构建，
 * 只有鼠标移上去那一刻才看出来（防线 ④ 也不报：`title` 是合法的 HTML 属性）。
 *
 * 用户两次定过这条口径：2026-10-07「这个 title 的原生样式很难看，类似这样的全部用 popover
 * 组件替换」（当时只收了「长文本揭示」那一族，图标/短值的说明性 title 被留在外面），
 * 2026-10-15 指着辅种检测那两枚标记的浮层说「**所有**的悬浮提示都不要用原生的 title，
 * 原生的太丑了」—— 收窄的那半作废，现在全仓一律不许。
 *
 * 正解：`src/options/components/HoverTip.vue`（统一外壳，`a-popover` + 一份样式）。
 *
 * 判据的边界（要说清，别当成「报干净＝真干净」）：
 *  - 只看模板里的属性，不看 `<script>` / `<style>`；注释里的反例不算。
 *  - **放行**的 `title` 是那些「这个 prop 有别的用途」或「浮层由 antd 自己画」的组件，
 *    见 ALLOWED：`a-modal` / `a-card` / `a-alert` / `a-statistic` / `a-collapse-panel` /
 *    `a-menu-item-group` 的 title 是**标题文案**，`a-tooltip` / `a-popconfirm` 的 title
 *    是 antd 自己渲染的浮层，都不是原生提示。
 *  - ⚠️ `a-badge` 声明了 `title` prop，但它就是把它写成 DOM 的 title 属性 ⇒ 出的仍是
 *    原生提示，所以它**不在** ALLOWED 里。同类「声明了但落到 DOM」的 prop 要单独判，
 *    不能拿「组件有这个 prop」当放行依据。
 *  - 自定义组件（PascalCase 且不是图标）跳过：静态扫判不出它的根元素是谁，
 *    原生提示坏在组件内部（由它自己的 `:title` 落进 DOM），那种在组件定义处报。
 *
 * 用法：`node scripts/check-native-title.mjs`（默认扫 `src`）；
 * `--selftest` 拿一批已知正反例跑自己（改判据前必须先跑，防「一条都没扫到」的假 PASS）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const SCAN = process.argv[2] ?? "src";
const EXTS = new Set([".vue"]);

/** `title` 不是原生提示的那些组件（标题文案 / antd 自绘浮层） */
const ALLOWED = new Set([
  "a-modal",
  "a-card",
  "a-alert",
  "a-statistic",
  "a-collapse-panel",
  "a-menu-item-group",
  "a-tooltip",
  "a-popconfirm",
]);

function* walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) yield* walk(p);
    else if (EXTS.has(path.extname(ent.name))) yield p;
  }
}

/** 注释里的反例不算；替换成等量空格以保住行号 */
const blank = (s) => s.replace(/[^\n]/g, " ");
const stripComments = (text) => text.replace(/<!--[\s\S]*?-->/g, blank).replace(/\/\*[\s\S]*?\*\//g, blank);

/** 认引号的标签扫描器：`v-if="a > b"` 里那个 `>` 不能把标签边界截断 */
const TAG = /<([A-Za-z][\w.-]*)((?:"[^"]*"|'[^']*'|[^>])*?)>/g;
const TITLE_ATTR = /(^|\s)(:|v-bind:)?title\s*=/;
const ICON_SUFFIX = /(Outlined|Filled|TwoTone)$/;

const hits = [];
let files = 0;

/** 扫一个目录，返回命中列表（selftest 也走同一条路，不抄第二份判据） */
function scanDir(root, dir) {
  const found = [];
  for (const file of walk(dir)) {
    files++;
    const rel = path.relative(root, file).split(path.sep).join("/");
    const full = fs.readFileSync(file, "utf8");
    // 只扫模板那一段：script 里的 `title: "…"` 是对象键，style 里的是 CSS
    const tplStart = full.indexOf("<template");
    if (tplStart < 0) continue;
    const text = stripComments(full.slice(tplStart));
    const headLines = full.slice(0, tplStart).split("\n").length - 1;
    const at = (idx) => headLines + text.slice(0, idx).split("\n").length;

    for (const m of text.matchAll(TAG)) {
      const tag = m[1];
      const attrs = m[2];
      if (ALLOWED.has(tag)) continue;
      // 自定义组件（不是 a-* 、不是原生元素、不是图标）跳过，见文件头那条边界
      if (/^[A-Z]/.test(tag) && !ICON_SUFFIX.test(tag) && tag !== "component") continue;
      const attr = TITLE_ATTR.exec(attrs);
      if (!attr) continue;
      found.push(`${rel}:${at(m.index)}: <${tag}> 的 ${attr[1] ? "绑定" : "静态"} title 会落进 DOM，出的是浏览器原生提示`);
    }
  }
  return found;
}

if (SCAN === "--selftest") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "native-title-"));
  const cases = [
    // [文件名, 内容, 期望命中数, 说明]
    ["a.vue", `<template><span :title="t('x')">a</span></template>`, 1, "原生元素上的绑定 title"],
    ["b.vue", `<template><a-tag title="x">a</a-tag></template>`, 1, "a-tag 上的静态 title（Tag 没这个 prop）"],
    ["c.vue", `<template><SyncOutlined :title="x" /></template>`, 1, "图标组件上的 title 落到 anticon 的 DOM"],
    ["d.vue", `<template><component :is="i" :title="x" /></template>`, 1, "动态组件上的 title"],
    ["e.vue", `<template><a-modal :title="x" /></template>`, 0, "a-modal 的 title 是标题文案"],
    ["f.vue", `<template><a-tooltip :title="x"><b/></a-tooltip></template>`, 0, "a-tooltip 的浮层由 antd 画"],
    ["g.vue", `<template><!-- <span :title="x">反例写在注释里 </span> --></template>`, 0, "注释里的反例不算"],
    ["h.vue", `<script setup>const c = { title: "x" };</script><template><b/></template>`, 0, "script 里的对象键不算"],
    [
      "i.vue",
      `<template><a-button v-if="a > 0" :title="x" @click="y"><b/:x="1" /></a-button></template>`,
      1,
      "属性值里带 > 和引号时标签边界不能切错",
    ],
    ["j.vue", `<template><MyTip :title="x" /></template>`, 0, "自定义组件跳过（判不出根元素）"],
  ];
  const fails = [];
  for (const [name, body, expect, why] of cases) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), body);
    const got = scanDir(dir, dir).length;
    if (got !== expect) fails.push(`${why}：期望 ${expect} 条，实扫 ${got} 条`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  if (fails.length) {
    console.log(`FAIL：判据自检 ${fails.length}/${cases.length} 条不对\n`);
    for (const f of fails) console.log("  " + f);
    process.exit(1);
  }
  console.log(`PASS：判据自检 ${cases.length} 条正反例全对（该报的报了、不该报的没报）`);
  process.exit(0);
}

hits.push(...scanDir(ROOT, path.join(ROOT, SCAN)));

if (hits.length > 0) {
  console.log(`FAIL：模板里有 ${hits.length} 处原生 title 悬浮提示\n`);
  for (const h of hits) console.log("  " + h);
  console.log('\n  改法：换成 <HoverTip :text="…"><原元素/></HoverTip>（src/options/components/HoverTip.vue）。');
  console.log("  提示文字本来就完整显示在旁边、title 只是重复一遍的，直接删掉那行属性。");
  process.exitCode = 1;
} else {
  console.log(`PASS：扫了 ${files} 个 .vue，模板里没有落到 DOM 的原生 title 悬浮提示`);
}
