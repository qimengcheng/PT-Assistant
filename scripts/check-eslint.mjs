/**
 * 防线 ⑬：跑 ESLint（eslint 10 + eslint-plugin-vue 10 + typescript-eslint 8），只 gate error。
 *
 * 为什么单开一条脚本而不是往 CI 里加一步：`scripts/check-all.mjs` 是现取 `check-*.mjs` 清单的，
 * 进来之后「本地有、CI 没有」这种漂移从结构上没了（AGENTS §3.4）。
 *
 * 判据口径（冷接入，故意留了口子）：
 *  - **error 才算失败，warning 不算**。`@typescript-eslint/no-explicit-any` 一类在存量代码里是
 *    424 条，把它们当失败等于让「装 linter」这条提交先去改 424 处与功能无关的东西。
 *    要收口就逐条升 error，升之前先看它报多少处。
 *  - `packages/**` 是上游零修改平移件，那一块的 error 在配置里逐条降到 warn（原因写在
 *    `eslint.config.mjs` 的注释里），不然门禁红的原因是「我们刚装了个 linter」，不是上游坏了。
 *  - **不报错 ≠ 跑到了**：这条自己也会被「配置炸了 / ignores 把 src 整个吞了」喂成假 PASS，
 *    所以下面除了数 error，还验三件事 —— eslint 退出码可用、JSON 解得开、
 *    `src` / `packages` / `scripts` 三块各至少有一个文件真被 lint 过。
 *
 * 用法：`node scripts/check-eslint.mjs`（在项目根目录跑）
 */
import { spawnSync } from "node:child_process";
import path from "node:path";

const ROOT = process.cwd();
const bin = path.join(ROOT, "node_modules", "eslint", "bin", "eslint.js");

const run = spawnSync(process.execPath, [bin, ".", "--format=json"], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 });

// eslint 自己炸了（配置写错、插件取不到）时 stdout 是空的、退出码 2：那种情况必须报 FAIL，
// 不能因为「一条 error 都没有」而 PASS。
if (run.error) {
  console.log(`FAIL：起不了 eslint —— ${run.error.message}`);
  process.exitCode = 1;
  process.exit(1);
}
const stdout = run.stdout ?? "";
let results;
try {
  results = JSON.parse(stdout);
} catch {
  console.log(`FAIL：eslint 的输出解不开（退出码 ${run.status}）\n${(run.stderr ?? "").split("\n").slice(0, 6).join("\n")}`);
  process.exitCode = 1;
  process.exit(1);
}

const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/");
const files = results.map((r) => rel(r.filePath));
const errors = results.flatMap((r) => (r.messages ?? []).filter((m) => m.severity === 2).map((m) => `${rel(r.filePath)}:${m.line}:${m.column}  ${m.ruleId ?? "(无规则Id)"}\n      ${m.message}`));
const warnings = results.flatMap((r) => (r.messages ?? []).filter((m) => m.severity === 1));

// 「真跑到了」的结构性判据：三块各至少一个文件。少一块 = ignores 或 files 配置把那一片吞了。
const covered = { src: 0, packages: 0, scripts: 0 };
for (const f of files) {
  for (const k of Object.keys(covered)) if (f === k || f.startsWith(`${k}/`)) covered[k]++;
}
const missing = Object.entries(covered).filter(([, n]) => n === 0).map(([k]) => k);

const TOP = 8;
const byRule = new Map();
for (const w of warnings) byRule.set(w.ruleId ?? "(无规则Id)", (byRule.get(w.ruleId ?? "(无规则Id)") ?? 0) + 1);

console.log(`扫了 ${files.length} 个文件：${errors.length} 条 error、${warnings.length} 条 warning（warning 不算失败）`);
if (errors.length) {
  console.log("\n  error 明细：");
  for (const e of errors.slice(0, 40)) console.log("  " + e);
  if (errors.length > 40) console.log(`  …另有 ${errors.length - 40} 条，跑 \`node ./node_modules/eslint/bin/eslint.js .\` 看全量`);
}
const ranked = [...byRule.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP);
if (ranked.length) {
  console.log("\n  warning 最多的几项（这些是留着逐步收口的，不当门禁）：");
  for (const [k, n] of ranked) console.log(`    ${String(n).padStart(4)}  ${k}`);
}

if (missing.length) {
  console.log(`\nFAIL：配置没把 ${missing.join(" / ")} 放进扫描范围 —— 一条防线扫不到东西就是假 PASS（见文件头第 3 条）`);
  process.exitCode = 1;
} else if (errors.length) {
  console.log("\nFAIL：ESLint 有 error");
  process.exitCode = 1;
} else {
  console.log("\nPASS：ESLint 没有 error");
}
