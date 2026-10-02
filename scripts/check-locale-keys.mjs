/**
 * 全站 i18n 键守卫：模板/脚本里写的每一个字面 `t("a.b.c")`，必须在 zh_CN.json 与 en.json
 * 两边都能解析；两份 locale 的叶子键集合也必须对称。
 *
 * 为什么需要：vue-i18n 拿不到键时**不抛异常、不进 vue-tsc、不进构建**，而是把键路径本身
 * 当文案渲染出来 —— 用户界面上直接出现 `common.noData` 这种内部字符串，违反 AGENTS.md §3.5
 * （一切面向用户的显示必须是名称/文案，内部标识符零容忍）。v0.20.0 那批整站接入就是靠这条
 * 扫出 `ExportUserInfoDialog.vue` 引用了根本不存在的 `common.noData`。
 * 并行会话各自往 locale 里加键，一侧加了另一侧漏、或键名打错，都是静默的，所以要挂 CI。
 *
 * 只认「字符串后紧跟 `,` 或 `)`」的字面键：`t("perSiteK" + field)` 这种动态拼接的片段
 * 无法静态判定，必须放过，否则误报会把守卫刷成噪音。
 *
 * 用法：`node scripts/check-locale-keys.mjs`（有 FAIL 则非零退出）
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const FILES = { zh: "src/locales/zh_CN.json", en: "src/locales/en.json" };
const SCAN_DIRS = ["src"];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (/\.(vue|ts)$/.test(entry.name) && !p.split(path.sep).join("/").startsWith("src/locales/")) out.push(p);
  }
  return out;
}

const readLocale = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));

/** 逐级取值；任何一级不是对象就判为取不到 */
function resolve(obj, key) {
  let cur = obj;
  for (const part of key.split(".")) {
    if (cur === null || typeof cur !== "object" || !(part in cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

function leaves(obj, prefix = [], out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === "object" && !Array.isArray(v)) leaves(v, [...prefix, k], out);
    else out.push([...prefix, k].join("."));
  }
  return out;
}

/** 抠字面键：先去掉注释，再要求 t(" … " 后面紧跟 , 或 )  */
function collectUsedKeys() {
  const used = new Map();
  for (const dir of SCAN_DIRS) {
    for (const rel of walk(dir)) {
      const raw = fs.readFileSync(rel, "utf8");
      const stripped = raw
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^[ \t]*\/\/[^\n]*/gm, "");
      for (const m of stripped.matchAll(/(?:^|[^.\w$])t\(\s*["']([A-Za-z][\w.]*)["']\s*([,)])/g)) {
        const key = m[1];
        if (!key.includes(".")) continue; // 无命名空间的裸键不是本仓风格，单独审
        if (!used.has(key)) used.set(key, rel.split(path.sep).join("/"));
      }
    }
  }
  return used;
}

const zh = readLocale(FILES.zh);
const en = readLocale(FILES.en);
const used = collectUsedKeys();

const missing = [];
for (const [key, file] of used) {
  if (resolve(zh, key) === undefined) missing.push(`zh_CN.json 缺键  ${key}  <- ${file}`);
  if (resolve(en, key) === undefined) missing.push(`en.json 缺键      ${key}  <- ${file}`);
}

const zhLeaves = new Set(leaves(zh));
const enLeaves = new Set(leaves(en));
const asymmetric = [
  ...[...zhLeaves].filter((k) => !enLeaves.has(k)).map((k) => `仅 zh 有：${k}`),
  ...[...enLeaves].filter((k) => !zhLeaves.has(k)).map((k) => `仅 en 有：${k}`),
];

console.log(`扫描 src：${used.size} 个字面 i18n 键；zh 叶子 ${zhLeaves.size}、en 叶子 ${enLeaves.size}`);

if (missing.length) {
  console.error(`FAIL：${missing.length} 处引用解析不到，界面上会把键路径当文案显示出来：`);
  missing.forEach((x) => console.error("  " + x));
}
if (asymmetric.length) {
  console.error(`FAIL：两份 locale 键集合不对称（${asymmetric.length} 处）：`);
  asymmetric.forEach((x) => console.error("  " + x));
}
if (missing.length || asymmetric.length) process.exit(1);

console.log("PASS：所有字面 i18n 键在两侧都可解析，且两份 locale 键集合对称。");
