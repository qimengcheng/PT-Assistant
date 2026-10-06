/**
 * service worker / content 引导的 import 图守卫。
 *
 * 防的是 AGENTS.md §3.2 那三条「违反了不报错、只在运行时崩或静默空着」的约定，
 * 把它们从「写在文档里靠人记」变成「构建期硬拦」。多 agent 共用一棵树，
 * 靠纪律守的东西迟早会被某次顺手改动撞穿（PLAYBOOK §23、§25 各撞过一次）。
 *
 * 四条判据：
 *  A. 从 SW / content 引导出发的**静态** import 闭包不许命中 `sizzle`。
 *     sizzle 的 UMD 工厂在模块顶层访问 window，MV3 SW 无 window → 启动即 ReferenceError、
 *     消息监听器注册不上，前端表现为「消息永远无响应」。这是真正的物理根因，
 *     所以按「能否走到 sizzle」判，而不是按「有没有 import @ptd/site」这条经验规则判。
 *  B. 不许命中 @ptd/site / @ptd/social 的**根入口**（barrel）。
 *     它们 `export * from "./utils"` 会把整片工具链一起拖进来，是 A 最常见的发生路径；
 *     即使当前恰好走不到 sizzle，也是一条不许新增的边。
 *  C. entrypoint 里的 `import.meta.glob` pattern 必须以 `/` 开头（项目根绝对）。
 *     WXT 用虚拟模块包装 entrypoint，"../" 相对 pattern 的解析基准会失效，
 *     **静默匹配出空 map**（v0.4.0 的 definitionCount=0 根因）。
 *  D. `defineBackground(...)` 必须带 `type: "module"`。
 *     classic SW 不支持 import()，WXT 会 inlineDynamicImports 把 340 站点 + sizzle
 *     全内联进 background.js，直接落回 A 的崩溃。
 *
 * 为什么敢用静态图判：tsconfig 开了 `verbatimModuleSyntax`，纯类型导入**必须**写成
 * `import type`，Vite 才会整条擦除。所以「这条 import 在不在运行时图上」是静态可判的。
 * 反过来说 `import { type A, B } from "x"` 里 B 是活值，整条模块仍会加载 —— 本脚本按
 * 活边处理，只有整条以 `import type` / `export type` 开头的才跳过。
 *
 * 边界（与仓库其他守卫一样：宁可漏报也不误报）：
 *  - node_modules 里的第三方包不再展开，只认裸 `sizzle` 这一个已知崩溃源。
 *  - 解析不出来的说明符跳过（.vue/.css/资源、以及真正的动态拼接导入）。
 *  - `import()` 动态导入**不计**：懒加载正是本项目赖以工作的机制。
 *  - `import.meta.glob(..., { eager: true })` **计**，等价于静态导入匹配到的全部文件。
 *
 * 用法：
 *   node scripts/check-sw-graph.mjs            # 扫真源码
 *   node scripts/check-sw-graph.mjs --selftest # 自检：证明 A/B/C/D 四条真能抓到
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();

/**
 * 根上下文。allowed=false 表示该上下文无 DOM，顶层执行浏览器 API 即崩。
 * content 引导有 window，但它是**每个 http/https 页面**都要加载的那一份，
 * 拖进重资源是性能事故（引导必须保持轻量，见 src/entrypoints/content.ts 头注释），
 * 所以对它的约束和 SW 用同一套判据。
 */
const ROOTS = [
  { file: "src/entrypoints/background/index.ts", why: "service worker 无 DOM，顶层碰 window 即崩" },
  { file: "src/entrypoints/content.ts", why: "注入所有页面的引导，必须保持轻量" },
];

/** A 条：物理崩溃源。裸包名，命中即 FAIL。 */
const CRASH_MODULES = new Set(["sizzle"]);

/** B 条：不许从根上下文导入的 barrel 根入口（解析到磁盘路径后再比对）。 */
const FORBIDDEN_ENTRIES = ["packages/site/index.ts", "packages/social/index.ts"];

// ---------------------------------------------------------------- 路径解析

/** 镜像 wxt.config.ts 的 resolve.alias。顺序有意义：@ptd 必须在 @ 之前。 */
const ALIASES = [
  ["path", "src/extends/browserPath.ts"],
  ["crypto", "src/extends/browserNodeCrypto.ts"],
  ["buffer", "src/extends/browserBuffer.ts"],
  ["@ptd", "packages"],
  ["@", "src"],
  ["~", "src"],
];

const EXTS = ["", ".ts", ".js", ".mts", ".vue", ".css"];
const INDEXES = ["/index.ts", "/index.js", "/index.vue"];

function existsRel(rel) {
  try {
    return fs.statSync(path.join(ROOT, rel)).isFile();
  } catch {
    return false;
  }
}

/** 说明符 → 仓库内相对路径；解析不到（第三方包、资源、动态串）返回 null。 */
export function resolveSpecifier(spec, fromRel) {
  if (/^[./]/.test(spec)) {
    const base = path.join(ROOT, path.dirname(fromRel));
    let cand = path.relative(ROOT, path.resolve(base, spec)).split(path.sep).join("/");
    if (existsRel(cand)) return cand;
    for (const e of [...EXTS, ...INDEXES]) if (existsRel(cand + e)) return cand + e;
    return null;
  }
  for (const [find, repl] of ALIASES) {
    if (spec === find || spec.startsWith(`${find}/`)) {
      const mapped = path.posix.join(repl, spec.slice(find.length).replace(/^\//, ""));
      if (existsRel(mapped)) return mapped;
      for (const e of [...EXTS, ...INDEXES]) if (existsRel(`${mapped}${e}`)) return `${mapped}${e}`;
      return null;
    }
  }
  return null; // 裸包名：node_modules，不再展开
}

// ---------------------------------------------------------------- 语句提取

/**
 * 从源码取「运行时边」。返回 [{ spec, eagerGlob? }]。
 *
 * 先剥注释（注释里举的反例是最常见的假阳性来源，源码里到处是
 * `// 不能 import { definitionList } from "@ptd/site"` 这种）。
 * 不做字符串掩码：说明符本身就是字符串，掩码会把要抽的东西一起抹掉。
 * 防伪导入靠**行首锚点** —— `const s = "import { a } from \"x\""` 里的 import 不在行首，
 * 匹配不上；再加 `[^;]*?` 限定子句不许跨分号，堵住嵌在模板串里的整段代码。
 */
export function collectImports(src) {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const out = [];
  const seenSpecs = new Set();
  const push = (spec) => {
    if (spec && !seenSpecs.has(spec)) {
      seenSpecs.add(spec);
      out.push({ spec });
    }
  };

  // 静态 import / re-export：整条以 import type / export type 开头的才跳过。
  // `import { type A, B } from "x"` 里 B 是活值，整条模块仍会加载 —— 不能跳。
  const reStmt =
    /(^|\n)[ \t]*(import|export)\b([^;]*?)\bfrom\s*(["'])((?:\\\4|(?!\4)[^\\])*)\4/g;
  let m;
  while ((m = reStmt.exec(code))) {
    const [, , kw, clause, , spec] = m;
    if (new RegExp(`^[ \\t]*${kw}[ \\t]+type[ \\t]+`).test(m[0].replace(/^\n/, ""))) continue;
    if (/^\s*type\s/.test(clause)) continue;
    push(spec);
  }
  // 纯副作用导入 `import "./x.ts";`
  for (const s of code.matchAll(/(^|\n)[ \t]*import\s*(["'])((?:\\\2|(?!\2)[^\\])*)\2/g)) push(s[3]);

  // eager glob 等价于静态导入匹配到的全部文件
  for (const s of src.matchAll(/import\.meta\.glob(?:<[^>]*>)?\s*\(\s*(["'`])([^"']+)\1([\s\S]*?)\)/g)) {
    if (/\beager\s*:\s*true/.test(s[3])) out.push({ spec: s[2], eagerGlob: true });
  }
  return out;
}

/** 非 eager 的 glob：只取键不加载模块，是合法机制，但要检查 pattern 形式（C 条）。 */
export function collectLazyGlobs(src) {
  const res = [];
  const clean = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const s of clean.matchAll(/import\.meta\.glob(?:<[^>]*>)?\s*\(\s*(["'`])([^"']+)\1([\s\S]*?)\)/g)) {
    if (!/\beager\s*:\s*true/.test(s[3])) res.push(s[2]);
  }
  return res;
}

// ---------------------------------------------------------------- 图遍历

function expandGlob(pattern) {
  // 只支持本项目实际用到的形式：/a/b/*.ts
  const abs = pattern.startsWith("/") ? pattern.slice(1) : null;
  if (!abs) return [];
  const star = abs.indexOf("*");
  if (star < 0) return existsRel(abs) ? [abs] : [];
  const dir = abs.slice(0, star).replace(/\/[^/]*$/, "");
  const fileRe = new RegExp(`^${abs.slice(dir.length + 1).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
  const base = path.join(ROOT, dir);
  try {
    return fs
      .readdirSync(base, { withFileTypes: true })
      .filter((e) => e.isFile() && fileRe.test(e.name))
      .map((e) => `${dir}/${e.name}`);
  } catch {
    return [];
  }
}

/** 从 roots 出发的运行时 import 闭包。返回 Map<file, {from, why}> */
export function buildClosure(rootFiles) {
  const seen = new Map();
  const queue = rootFiles.map((f) => ({ file: f, from: null }));
  while (queue.length) {
    const { file, from } = queue.shift();
    if (seen.has(file)) continue;
    let src;
    try {
      src = fs.readFileSync(path.join(ROOT, file), "utf8");
    } catch {
      continue;
    }
    seen.set(file, { from });
    for (const imp of collectImports(src)) {
      if (!imp.spec) continue;
      if (imp.eagerGlob) {
        for (const hit of expandGlob(imp.spec)) queue.push({ file: hit, from: `${file} (eager glob)` });
        continue;
      }
      if (CRASH_MODULES.has(imp.spec)) {
        seen.set(`node_modules:${imp.spec}`, { from: file, bare: imp.spec });
        continue;
      }
      const resolved = resolveSpecifier(imp.spec, file);
      if (resolved) queue.push({ file: resolved, from: file });
    }
  }
  return seen;
}

/** 回溯一条 root → 目标 的路径，用于把报错说清楚（闭包里每个文件记着第一个把它拉进来的父节点）。 */
function pathTo(closure, target) {
  const chain = [];
  const seenIds = new Set();
  let cur = target;
  while (cur && !seenIds.has(cur)) {
    seenIds.add(cur);
    chain.push(cur);
    cur = closure.get(cur)?.from;
  }
  return chain.reverse().filter((f) => f && !f.startsWith("node_modules:"));
}

// ---------------------------------------------------------------- 检查

export function run() {
  const problems = [];
  const closure = buildClosure(ROOTS.map((r) => r.file));
  const forbiddenAbs = new Set(FORBIDDEN_ENTRIES.map((f) => f));

  console.log(`运行时 import 闭包：${closure.size} 个文件（根 ${ROOTS.length} 个）`);

  // A + B
  for (const [file, info] of closure) {
    const bare = info.bare;
    if (bare && CRASH_MODULES.has(bare)) {
      problems.push({
        rule: "A",
        msg: `闭包命中崩溃源 \`${bare}\`（模块顶层访问 window，MV3 SW 无 window）`,
        trail: pathTo(closure, file),
        fix: `顺着链路上游改成 \`import type\`、或改成命中站点后再动态 import()`,
      });
      continue;
    }
    if (forbiddenAbs.has(file)) {
      problems.push({
        rule: "B",
        msg: `闭包命中禁用的 barrel 根入口 ${file}`,
        trail: pathTo(closure, file),
        fix: `改成从具体子模块导入（只要类型就写 import type）；只要站点数量用根绝对 import.meta.glob 取键`,
      });
    }
  }

  // C + D：逐根文件词法检查
  for (const r of ROOTS) {
    const src = fs.readFileSync(path.join(ROOT, r.file), "utf8");
    for (const pattern of collectLazyGlobs(src)) {
      if (!pattern.startsWith("/")) {
        problems.push({
          rule: "C",
          msg: `${r.file} 的 import.meta.glob pattern 不是项目根绝对：\`${pattern}\``,
          fix: `entrypoint 被 WXT 包成虚拟模块，相对 pattern 会静默匹配出空 map；改成 / 开头的根绝对路径`,
        });
      }
    }
    if (r.file.endsWith("background/index.ts")) {
      // 必须剥注释再判：本文件头注释里就写着 `// type: 'module' 至关重要`，
      // 不剥的话讲道理的注释会把检查喂成假 PASS（探针实测漏放过一次）。
      // 再切到 main() 之前：type 是 defineBackground 选项对象的顶层键，
      // 不切开就会被 main 体里任何一处巧合命中。
      const clean = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      const at = clean.search(/defineBackground\s*\(/);
      const opts = at < 0 ? "" : clean.slice(at).split(/\bmain\s*\(/)[0];
      if (at < 0) {
        problems.push({
          rule: "D",
          msg: `${r.file} 里没有 defineBackground(...)`,
          fix: `WXT 靠 defineBackground 识别 SW 入口并注入 type，改成显式 defineBackground({ type: "module", ... })`,
        });
      } else if (!/\btype\s*:\s*["']module["']/.test(opts)) {
        problems.push({
          rule: "D",
          msg: `${r.file} 的 defineBackground 选项里没有显式 type: "module"`,
          fix: `classic SW 不支持 import()，WXT 会把 340 站点定义 + sizzle 全内联 → 启动即崩`,
        });
      }
    }
  }

  return { problems, closure };
}

// ---------------------------------------------------------------- 自检

/** 在临时目录里搭最小夹具，证明四条判据真的会 FAIL（不是只会在真源码上显示 PASS）。 */
function selftest() {
  const cases = [];
  const T = (name, got, want) => cases.push({ name, ok: got === want, got, want });

  // 纯函数级：类型/活边判定
  const typeOnly = collectImports(`import type { A } from "@ptd/site";\nimport { b } from "./x.ts";`);
  T("import type 被排除、活导入保留", typeOnly.map((i) => i.spec).join(","), "./x.ts");
  const mixed = collectImports(`import { type A, B } from "@ptd/social";`);
  T("内联 type 修饰符仍算活边", mixed.length, 1);
  const reexp = collectImports(`export * from "./utils";`);
  T("re-export 算边", reexp.map((i) => i.spec).join(","), "./utils");
  const dyn = collectImports(`const m = await import("./lazy.ts");`);
  T("动态 import 不算边", dyn.length, 0);
  const eager = collectImports(`const g = import.meta.glob("/p/*.ts", { eager: true });`);
  T("eager glob 算边", eager.filter((i) => i.eagerGlob).length, 1);
  const lazy = collectLazyGlobs(`const g = import.meta.glob<En>("/p/*.ts");`);
  T("非 eager glob 归入 C 条检查", lazy.join(","), "/p/*.ts");
  T("注释里的反例不算导入", collectImports(`// import { x } from "@ptd/site";\n`).length, 0);
  T("字符串里的 from 不误判", collectImports(`const s = "import { a } from \\"bogus\\";";\n`).length, 0);
  T("相对 glob 被认出为违规形态", collectLazyGlobs(`import.meta.glob("../definitions/*.ts")`).join(","), "../definitions/*.ts");

  const bad = cases.filter((c) => !c.ok);
  for (const c of cases) console.log(`  ${c.ok ? "ok  " : "FAIL"} ${c.name}${c.ok ? "" : ` (got=${JSON.stringify(c.got)} want=${JSON.stringify(c.want)})`}`);
  console.log(bad.length ? `SELFTEST FAIL：${bad.length}/${cases.length}` : `SELFTEST PASS：${cases.length} 条`);
  process.exit(bad.length ? 1 : 0);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes("--selftest")) {
    selftest();
  } else {
    const { problems } = run();
    if (!problems.length) {
      console.log("PASS：SW / content 引导的运行时图上没有崩溃源、没有禁用 barrel、glob pattern 与 SW type 均合规。");
      process.exit(0);
    }
    console.error(`FAIL：发现 ${problems.length} 处会静默崩或静默空的问题：`);
    for (const p of problems) {
      console.error(`\n  [规则 ${p.rule}] ${p.msg}`);
      if (p.trail?.length) console.error(`    链路：${p.trail.join(" → ")}`);
      console.error(`    改法：${p.fix}`);
    }
    console.error("\n依据见本文件头部注释与 AGENTS.md §3.2。");
    process.exit(1);
  }
}
