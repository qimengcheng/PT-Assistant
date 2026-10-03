/**
 * content 侧 antd 按需注册的一致性校验。
 *
 * 干什么：
 *  1. 从 `src/entrypoints/content-app.ts` 出发做 import 闭包（含 content 复用的 options 组件）；
 *  2. 抽出闭包内每个 SFC 模板里出现的 `a-*` 标签，映射成 antd 的全局注册名；
 *  3. 在 Node 里实跑 `src/content-script/antd-lite.ts` 清单中每个组件的 `install()`，
 *     拿到「按需注册实际会产生哪些名字」；
 *  4. 比对：模板用到但按需清单没注册的 → FAIL 并非零退出（这类漏注册在线上表现为
 *     Vue 把标签当原生元素渲染：无样式、slot 静默失效，很难在站点页面上看出来）。
 *
 * 为什么不用静态 grep 就够了：antdv-next 的父组件 install 会连带注册子组件
 * （Menu → AMenuItem/ASubMenu/AMenuDivider，Table → ATableColumn/ATableSummary…），
 * 只对照 import 名字会误报；而且 `a-list` 这类标签在 antdv-next 里根本不存在
 * （只有 AListy），需要权威名单而不是猜。
 *
 * 用法：`node scripts/check-content-antd-lite.mjs`（在项目根目录跑）
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const ROOT = process.cwd();
const ENTRY = "src/content-script/app/init.ts";
const LITE_FILE = "src/content-script/antd-lite.ts";
const toUrl = (p) => "file:///" + path.join(ROOT, p).split(path.sep).join("/");

const require_ = createRequire(path.join(ROOT, "noop.js"));
const { createApp } = require_("vue");
const antd = await import(toUrl("node_modules/antdv-next/dist/index.js"));

// —— 1) 权威名单：实跑全量 install，看它到底注册了哪些组件名 ——
const fullApp = createApp({ render: () => null });
fullApp.use(antd.install);
const fullNames = new Set(Object.keys(fullApp._context.components));

// —— 2) import 闭包 ——
const alias = (s) => s.replace(/^@\//, "src/").replace(/^~\//, "src/").replace(/^@ptd\//, "packages/");
function resolveSpec(spec, fromFile) {
  if (/\?(inline|url|raw)/.test(spec) || /\.(css|scss|less)$/.test(spec)) return null;
  let p = spec.startsWith(".")
    ? path.relative(ROOT, path.resolve(ROOT, path.dirname(fromFile), spec))
    : alias(spec);
  p = p.split(path.sep).join("/").split("?")[0];
  if (!p.startsWith("src/") && !p.startsWith("packages/")) return null;
  for (const c of [
    p,
    p + ".ts",
    p + ".vue",
    p + ".tsx",
    p + ".js",
    path.join(p, "index.ts"),
    path.join(p, "index.vue"),
    path.join(p, "index.tsx"),
  ]) {
    try {
      if (fs.statSync(path.join(ROOT, c)).isFile()) return c;
    } catch {}
  }
  return null;
}

/** `a-list-item-meta` → `AListItemMeta`；已经是 Pascal 形式的原样返回 */
function toRegName(tag) {
  if (/^A[A-Z]/.test(tag)) return tag;
  if (/^a-[a-z][a-z0-9-]*$/.test(tag)) {
    return "A" + tag.slice(2).split("-").map((s) => s[0].toUpperCase() + s.slice(1)).join("");
  }
  return null;
}

const strip = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/<!--[\s\S]*?-->/g, "");

const seen = new Set();
const queue = [ENTRY];
const used = new Map();
const nonexistent = new Map();

while (queue.length) {
  const file = queue.shift();
  if (seen.has(file)) continue;
  seen.add(file);
  const raw = fs.readFileSync(path.join(ROOT, file), "utf8");
  const isVue = file.endsWith(".vue");
  const template = strip(
    isVue ? (raw.match(/<template[^>]*>([\s\S]*)<\/template>/)?.[0] ?? "") : raw,
  );
  for (const m of template.matchAll(/<([A-Za-z][A-Za-z0-9-]*)[\s/>]/g)) {
    const reg = toRegName(m[1]);
    if (!reg) continue;
    if (fullNames.has(reg)) {
      if (!used.has(reg)) used.set(reg, new Set());
      used.get(reg).add(file);
    } else if (/^a-[a-z]/.test(m[1])) {
      if (!nonexistent.has(m[1])) nonexistent.set(m[1], new Set());
      nonexistent.get(m[1]).add(file);
    }
  }
  for (const m of strip(raw).matchAll(/(?:\bfrom|import)\s*\(?\s*["']([^"']+)["']/g)) {
    const r = resolveSpec(m[1], file);
    if (r && !seen.has(r)) queue.push(r);
  }
}

// —— 3) 实跑按需清单 ——
const liteSrc = fs.readFileSync(path.join(ROOT, LITE_FILE), "utf8");
const liteComponents = (liteSrc.match(/const usedComponents = \[([\s\S]*?)\] as const/)?.[1] ?? "")
  .replace(/\/\/[^\n]*/g, "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const liteApp = createApp({ render: () => null });
for (const name of liteComponents) {
  const component = antd[name];
  if (!component) {
    console.error(`FAIL：antdv-next 根入口没有导出 ${name}`);
    process.exit(1);
  }
  if (typeof component.install !== "function") {
    console.error(`FAIL：${name} 没有 install（应像 StyleProvider 那样单独 app.component 注册）`);
    process.exit(1);
  }
  component.install(liteApp);
}
if (/app\.component\("AStyleProvider", StyleProvider\)/.test(liteSrc)) {
  liteApp.component("AStyleProvider", antd.StyleProvider);
}
const liteNames = new Set(Object.keys(liteApp._context.components));

// —— 4) 比对 ——
const missing = [...used.keys()].filter((n) => !liteNames.has(n));

console.log(`闭包文件 ${seen.size} 个，模板用到 antd 组件 ${used.size} 个`);
console.log(
  `按需清单 ${liteComponents.length} 个父组件 → 实际注册 ${liteNames.size} 个名字（全量 install 是 ${fullNames.size} 个）`,
);

if (nonexistent.size) {
  console.log("\n提示：以下 a-* 标签在 antdv-next 里并不存在（全量 install 也注册不出来），与本次改动无关：");
  for (const [tag, files] of nonexistent) {
    console.log(`  ${tag} → ${[...files].map((f) => f.replace(/^src\//, "")).join(", ")}`);
  }
}

if (missing.length) {
  console.error("\nFAIL：按需清单缺项，content 里这些标签会被当成原生元素渲染：");
  for (const name of missing) {
    console.error(`  ${name} ← ${[...used.get(name)].map((f) => f.replace(/^src\//, "")).join(", ")}`);
  }
  console.error(`\n请到 ${LITE_FILE} 补上对应组件后重跑本脚本。`);
  process.exit(1);
}
console.log("\nPASS：content 闭包里的每个 a-* 标签都能解析。");
