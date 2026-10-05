/**
 * 异步水合守卫：禁止在挂载钩子里命令式读取「靠 persistWebExt 异步水合」的 store 字段。
 *
 * 为什么需要这条：pinia 的 webExt 持久化只能异步 —— 取数走 `chrome.storage.local.get`，
 * 返回 Promise，水合完成前 store 里是**初始值**（对象是 `{}`、数组是 `[]`），不是 undefined。
 * 于是 `onMounted(() => { for (const k in metadataStore.sites) ... })` 这种写法不会报错、
 * 不会进 vue-tsc、不会进构建，只是**首屏空着**：它在水合完成之前跑完了，读到空对象。
 *
 * 这个形状在本仓库造成过一次真实事故：「我的数据」页要等 5 秒多才出表，根因就是有人为了绕开
 * 「onMounted 读到空」而手搓了一个 5 秒 debounce 去轮询存储 —— 症状被掩盖，代价变成了所有人
 * 都要等那个 debounce。守卫要拦的是**因**（钩子里命令式读异步 store），不是那个果。
 *
 * 正确写法两选一：
 *   1. `await store.$onReady()` 之后再读（一次性加载、加载后不再变的场景）；
 *   2. 用 `computedAsync` / `computed` 把表格数据做成**派生**的，水合一到自动重算（推荐，
 *      见 src/options/views/Overview/MyData/utils/lastUserData.ts）。
 *
 * 判定口径（宁可漏报也不误报，与另四条防线一致）：
 * - 只认 `persistWebExt: true` 或写成对象的 store。runtime store 走 sessionStorage 同步水合，
 *   不存在这个竞态，自动排除 —— 这份清单是扫源码得到的，不抄文档。
 * - 只看 onMounted / onBeforeMount 的回调体，外加**有限深度**的词法调用展开：钩子里常写成
 *   `onMounted(() => loadFullData())`，真正的读取在下面的函数里，不跟进这一层就会漏掉
 *   本仓库真实存在的那两处。跨文件调用、经变量间接转发的不追。
 * - 回调体（含展开到的函数体）里出现过 `$onReady` / `$ready` 就算已处理，放过。
 * - 观察器 / 定时器 / 事件监听这类**异步边界**的实参回调整段放过：那里的读取不在挂载路径上
 *   发生。但边界只包住实参本身，同一个钩子里边界之外的读取照报（MediaServerEntity 就是这么
 *   一次命中 83 行放过、96 行报出）。`$onReady` 写在延后回调里也不作数。
 * - 只把 `xxx.field` 记为「读状态」；`$save` / `$patch` / `$reset` 这类插件 API 前缀 `$` 的不算。
 * - getter 到底读没读 state 静态判不出来：纯透传的 `getSiteMetadata` 会被一起报出来。
 *   所以**它报出的每一条都要回源码核**，报干净不等于真干净。
 *
 * 用法：`node scripts/check-store-hydration.mjs`（有 FAIL 则非零退出）
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = ["src"];
const HOOK_RE = /\b(onBeforeMount|onMounted)\s*\(/g;
const MAX_INLINE_DEPTH = 3;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (/\.(vue|ts)$/.test(entry.name)) out.push(p);
  }
  return out;
}

/**
 * 去注释：模板注释、块注释、行注释里都可能写着示例代码，不去掉会误报。
 *
 * 必须**等长置空**而不是删掉 —— 删了之后剩下的文本下标就和原文件错位了，
 * 报出来的行号会指着别处（第一版就是这么把 onMounted 的行号报错 8 行的）。
 */
function stripComments(src) {
  const blank = (s) => s.replace(/[^\n]/g, " ");
  return src
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/^[ \t]*\/\/[^\n]*/gm, blank);
}

/** 从 openIdx 处的括号出发，返回其平衡区间（含首尾括号）。跳过字符串里的括号。 */
function balanced(src, openIdx) {
  const pairs = { "(": ")", "{": "}", "[": "]" };
  const closer = pairs[src[openIdx]];
  if (!closer) return null;
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipString(src, i, ch);
      continue;
    }
    if (src[i] === "//") {
      i = src.indexOf("\n", i);
      if (i < 0) break;
      continue;
    }
    if (ch === src[openIdx]) depth++;
    else if (ch === closer) {
      depth--;
      if (depth === 0) return { start: openIdx, end: i + 1 };
    }
  }
  return null;
}

/** 返回引号闭合处的下标（起始引号本身的下标传入） */
function skipString(src, i, quote) {
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === "\\") {
      j++;
      continue;
    }
    if (src[j] === quote) return j;
  }
  return src.length;
}

const files = walk(SCAN_DIRS[0]).concat(...SCAN_DIRS.slice(1).map((d) => walk(d)));
const read = (rel) => stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));
const lineOf = (src, idx) => src.slice(0, idx).split("\n").length;

// ---------------------------------------------------------------------------
// 1. 扫出「异步水合」的 store 名（persistWebExt 为 true 或对象）
// ---------------------------------------------------------------------------
const asyncStores = new Map(); // useXxxStore -> 定义处
for (const rel of files.filter((p) => /[\\/]stores[\\/][^\\/]+\.ts$/.test(p))) {
  const src = read(rel);
  for (const m of src.matchAll(/export const (use\w+Store)\s*=\s*defineStore\(/g)) {
    const open = m.index + m[0].length - 1;
    const span = balanced(src, open);
    const body = span ? src.slice(span.start, span.end) : "";
    if (/persistWebExt\s*:\s*(?:true|\{)/.test(body)) asyncStores.set(m[1], rel.split(path.sep).join("/"));
    if (/persistWebExt\s*:\s*false/.test(body) && asyncStores.has(m[1])) asyncStores.delete(m[1]);
  }
}

if (asyncStores.size === 0) {
  console.error("FAIL：一个 persistWebExt store 都没扫到，多半是 store 定义写法变了，守卫失效。");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 2. 逐个文件找挂载钩子里的命令式读取
// ---------------------------------------------------------------------------
/** 本文件里 `const foo = useXStore()` 绑定的局部变量名 */
function localBindings(src) {
  const names = new Set();
  for (const store of asyncStores.keys()) {
    for (const m of src.matchAll(new RegExp(`\\b(?:const|let|var)\\s+(\\w+)\\s*=\\s*${store}\\s*\\(\\s*\\)`, "g"))) {
      names.add(m[1]);
    }
  }
  return names;
}

/** 本文件里可调用的函数体：`function n(){}` / `const n = (…) => {…}` / `const n = (…) => 表达式` */
function functionBodies(src) {
  const map = new Map();
  for (const m of src.matchAll(/\b(?:async\s+)?function\s+(\w+)\s*\(/g)) {
    const brace = src.indexOf("{", src.indexOf(")", m.index));
    const span = brace >= 0 ? balanced(src, brace) : null;
    if (span) map.set(m[1], { start: span.start, end: span.end });
  }
  for (const m of src.matchAll(/\b(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g)) {
    const arrow = src.indexOf("=>", m.index + m[0].length - 2);
    const from = arrow + 2;
    const brace = src.indexOf("{", from);
    const paren = src.indexOf("(", from);
    let span = null;
    if (brace >= 0 && (paren < 0 || brace < paren)) span = balanced(src, brace);
    else {
      // 表达式体：截到行尾（够用，且刻意保守 —— 宁可少看也不多看）
      const eol = src.indexOf("\n", from);
      span = { start: from, end: eol < 0 ? src.length : eol };
    }
    if (span) map.set(m[1], { start: span.start, end: span.end });
  }
  return map;
}

const STORE_NAMES = [...asyncStores.keys()];
const HOOK_PRESENT = /\b(onBeforeMount|onMounted)\s*\(/;

/**
 * 异步边界：这些调用的实参回调不在挂载路径上执行（观察器触发时、定时器到点时、
 * 事件到达时），那时的读取不算「命令式在挂载时读」。不豁免的话守卫会长期误报，
 * 而一条经常误报的守卫只会被绕过 —— 宁可漏报，与其他四条防线同口径。
 * 反过来 `.forEach` / `.map` 这类同步回调**不在**清单里：它们在挂载当场就跑完了。
 */
const DEFER_RE =
  /\b(?:new\s+(?:Intersection|Resize|Mutation)Observer|(?:set|clear)(?:Timeout|Interval)|requestAnimationFrame|cancelAnimationFrame|add(?:Event)?EventListener|removeEventListener|watch(?:Effect|Debounced)?|once)\s*\(/g;

const findings = [];
let scannedHookSites = 0;

for (const rel of files) {
  const src = read(rel);
  if (!HOOK_PRESENT.test(src)) continue;
  const fns = functionBodies(src);

  /**
   * 一条正则同时覆盖两种写法：局部变量 `metadataStore.field` 与直接 `useMetadataStore().field`。
   * 属性位置用 `(?\!\$)` 排除插件 API（$save / $patch / $reset / $onReady）。
   */
  const parts = [
    ...[...localBindings(src)].map((v) => `\\b${v}\\s*\\.`),
    ...STORE_NAMES.map((s) => `\\b${s}\\s*\\(\\s*\\)\\s*\\.`),
  ];
  const readRe = new RegExp(`(?:${parts.join("|")})(?!\\$)(\\w+)`, "g");
  if (!src.match(readRe)) continue; // 本文件根本没有读过异步 store 的字段

  for (const hm of src.matchAll(HOOK_RE)) {
    const open = hm.index + hm[0].length - 1;
    const span = balanced(src, open);
    if (!span) continue; // 括号不配平（多半是跨文件误扫到的注释残留），放过
    scannedHookSites++;
    const hookSrc = src.slice(span.start, span.end);

    // 展开一层层词法调用：onMounted(() => loadFullData()) 真正的读取在下面那个函数里
    const seen = new Set([span.start]);
    const queue = [{ src: hookSrc, base: span.start, depth: 0 }];
    const blocks = [];
    while (queue.length) {
      const cur = queue.shift();
      blocks.push(cur);
      if (cur.depth >= MAX_INLINE_DEPTH) continue;
      for (const cm of cur.src.matchAll(/\b(\w+)\s*\(/g)) {
        const fn = fns.get(cm[1]);
        if (!fn || seen.has(fn.start)) continue;
        seen.add(fn.start);
        queue.push({ src: src.slice(fn.start, fn.end), base: fn.start, depth: cur.depth + 1 });
      }
    }

    // 异步边界先在 src 坐标系里圈出来，后面「读命」和「$onReady 已等待」都要按它筛：
    // 否则 `$onReady` 写在延后回调里也会被当成整个钩子已处理，那是一处新的静默漏报。
    const deferred = [];
    for (const b of blocks) {
      DEFER_RE.lastIndex = 0;
      for (const dm of b.src.matchAll(DEFER_RE)) {
        const argSpan = balanced(src, b.base + dm.index + dm[0].length - 1);
        if (argSpan) deferred.push([argSpan.start, argSpan.end]);
      }
    }
    const inDeferred = (abs) => deferred.some(([s, e]) => abs >= s && abs < e);

    const awaited = blocks.some((b) => {
      for (const m of b.src.matchAll(/\$onReady|\$ready/g)) {
        if (!inDeferred(b.base + m.index)) return true;
      }
      return false;
    });
    if (awaited) continue; // 已显式等待水合

    const hits = [];
    for (const b of blocks) {
      readRe.lastIndex = 0;
      for (const m of b.src.matchAll(readRe)) {
        const abs = b.base + m.index;
        if (inDeferred(abs)) continue;
        hits.push(`${m[0].replace(/\s+/g, "")}@${lineOf(src, abs)}`);
      }
    }
    if (hits.length === 0) continue;

    findings.push({
      file: rel.split(path.sep).join("/"),
      line: lineOf(src, hm.index),
      hook: hm[1],
      reads: [...new Set(hits)].slice(0, 6),
    });
  }
}

console.log(
  `异步水合 store：${asyncStores.size} 个（${[...asyncStores.keys()].join("、")}）；` +
    `扫到挂载钩子 ${scannedHookSites} 处`,
);

if (findings.length) {
  console.error(
    `FAIL：${findings.length} 处在挂载钩子里命令式读取异步水合的 store —— 水合完成前那些字段是初始值，` +
      `结果是静默的空界面：`,
  );
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  ${f.hook}() 读到 ${f.reads.join(", ")}`);
  }
  console.error(
    "\n  改法二选一：钩子里先 `await store.$onReady()` 再读；或者把这份数据改成派生的\n" +
      "  （computed / computedAsync，见 src/options/views/Overview/MyData/utils/lastUserData.ts），\n" +
      "  后者不需要等待，水合一到就自动重算。",
  );
  process.exit(1);
}

console.log("PASS：没有发现在挂载钩子里命令式读取异步水合 store 的地方。");
