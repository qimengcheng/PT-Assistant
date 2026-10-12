/**
 * 防线 ⑬：跑 ESLint（eslint 10 + eslint-plugin-vue 10 + typescript-eslint 8）。
 *
 * 为什么单开一条脚本而不是往 CI 里加一步：`scripts/check-all.mjs` 是现取 `check-*.mjs` 清单的，
 * 进来之后「本地有、CI 没有」这种漂移从结构上没了（AGENTS §3.4）。
 *
 * 判据分三档，分界线不是「规则严不严」，而是**这份代码谁写的**：
 *  1. **error 一律 FAIL**（全仓，包括 packages —— 配置里已经把上游那一片的会咬人规则降到 warn）。
 *  2. **我方代码（src / scripts / 根配置）连 warning 都不许留**。v0.90.9 起这份是 0 条：
 *     `no-explicit-any` 与 `ban-ts-comment` 已逐文件收口并升成 error，剩下那几条观感类
 *     （vue/attributes-order 等）也清干了。要留一处 `any` 就写行级 eslint-disable-next-line，
 *     并在上面把实测依据讲清楚（`TKonvaConfig` 是先例：改成 unknown 会断 13 条 vue-tsc）。
 *  3. **`packages/**` 是从上游平移过来的那一片**（不是「零修改」，实测 96 个文件有内容差异 ——
 *     见 README「架构决策」的站点定义行；这一档的真实理由是「不是我方写的，不做批量改写」），
 *     不能为了喂饱 linter 去改它，所以那一块按
 *     `scripts/eslint-packages-baseline.json` 里那份「每条规则多少条」的快照**只拦回涨**：
 *     涨了 FAIL，降了提示可以重录基线（重录：`node scripts/check-eslint.mjs --update-packages-baseline`）。
 *     为什么按规则分别记而不是记一个总数：清掉一条 `prefer-const` 会腾出额度，
 *     总数判据就放过一条新进的 `no-explicit-any`。
 *
 * 还有第 4 件事：**不报错 ≠ 跑到了**。这条自己也会被「配置炸了 / ignores 把 src 整个吞了」
 * 喂成假 PASS，所以除了数 error，还验 eslint 退出码可用、JSON 解得开、
 * `src` / `packages` / `scripts` 三块各至少有一个文件真被 lint 过。
 *
 * 用法：`node scripts/check-eslint.mjs`（在项目根目录跑）
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const BASELINE_PATH = path.join(ROOT, "scripts", "eslint-packages-baseline.json");
const bin = path.join(ROOT, "node_modules", "eslint", "bin", "eslint.js");

const run = spawnSync(process.execPath, [bin, ".", "--format=json"], {
  cwd: ROOT,
  encoding: "utf8",
  maxBuffer: 1 << 28,
});

// eslint 自己炸了（配置写错、插件取不到）时 stdout 是空的、退出码 2：那种情况必须报 FAIL，
// 不能因为「一条 error 都没有」而 PASS。
if (run.error) {
  console.log(`FAIL：起不了 eslint —— ${run.error.message}`);
  process.exit(1);
}
const stdout = run.stdout ?? "";
let results;
try {
  results = JSON.parse(stdout);
} catch {
  console.log(
    `FAIL：eslint 的输出解不开（退出码 ${run.status}）\n${(run.stderr ?? "").split("\n").slice(0, 6).join("\n")}`,
  );
  process.exit(1);
}

const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/");
const files = results.map((r) => rel(r.filePath));
const errors = results.flatMap((r) =>
  (r.messages ?? [])
    .filter((m) => m.severity === 2)
    .map((m) => `${rel(r.filePath)}:${m.line}:${m.column}  ${m.ruleId ?? "(无规则Id)"}\n      ${m.message}`),
);
const warnings = results.flatMap((r) =>
  (r.messages ?? [])
    .filter((m) => m.severity === 1)
    .map((m) => ({
      at: `${rel(r.filePath)}:${m.line}:${m.column}`,
      ruleId: m.ruleId ?? "(无规则Id)",
    })),
);

// 「真跑到了」的结构性判据：三块各至少一个文件。少一块 = ignores 或 files 配置把那一片吞了。
const covered = { src: 0, packages: 0, scripts: 0 };
for (const f of files) {
  for (const k of Object.keys(covered)) if (f === k || f.startsWith(`${k}/`)) covered[k]++;
}
const missing = Object.entries(covered).filter(([, n]) => n === 0).map(([k]) => k);

const isPkg = (w) => w.at.startsWith("packages/");
const ours = warnings.filter((w) => !isPkg(w));
const pkgWarnings = warnings.filter(isPkg);
const countByRule = (list) => {
  const m = new Map();
  for (const w of list) m.set(w.ruleId, (m.get(w.ruleId) ?? 0) + 1);
  return m;
};
const pkgByRule = countByRule(pkgWarnings);

if (process.argv.includes("--update-packages-baseline")) {
  const body = `${JSON.stringify(
    {
      _comment:
        "packages/**（上游平移件，不做批量改写）的 ESLint warning 基线，按规则分别记条数。" +
        "重录：node scripts/check-eslint.mjs --update-packages-baseline。判据在 check-eslint.mjs。",
      total: pkgWarnings.length,
      rules: Object.fromEntries([...pkgByRule.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))),
    },
    null,
    2,
  )}\n`;
  writeFileSync(BASELINE_PATH, body, "utf8");
  console.log(`已记录 packages 基线：${pkgWarnings.length} 条 warning，${pkgByRule.size} 条规则`);
  process.exit(0);
}

let baseline = null;
let baselineError = "";
try {
  baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
} catch (e) {
  baselineError = e.message;
}

console.log(
  `扫了 ${files.length} 个文件：${errors.length} 条 error、${warnings.length} 条 warning` +
    `（我方 ${ours.length} 条 / packages ${pkgWarnings.length} 条）`,
);
if (errors.length) {
  console.log("\n  error 明细：");
  for (const e of errors.slice(0, 40)) console.log("  " + e);
  if (errors.length > 40) {
    console.log(`  …另有 ${errors.length - 40} 条，跑 \`node ./node_modules/eslint/bin/eslint.js .\` 看全量`);
  }
}
if (ours.length) {
  console.log("\n  我方 warning 明细（这一档算失败）：");
  for (const w of ours.slice(0, 40)) console.log(`    ${w.at}  ${w.ruleId}`);
  if (ours.length > 40) console.log(`    …另有 ${ours.length - 40} 条`);
}

/**
 * packages 那一块的逐规则比对：涨了列出来，降了只提示。
 * 基线里没有的规则 = 一条新进的规则，同样按「涨」处理（缺省额度 0）。
 */
let grew = [];
let shrank = [];
if (baseline?.rules) {
  for (const [rule, n] of pkgByRule) {
    const cap = baseline.rules[rule] ?? 0;
    if (n > cap) grew.push({ rule, n, cap });
  }
  for (const [rule, cap] of Object.entries(baseline.rules)) {
    const n = pkgByRule.get(rule) ?? 0;
    if (n < cap) shrank.push(`${rule}: ${cap} → ${n}`);
  }
  grew.sort((a, b) => b.n - b.cap - (a.n - a.cap));
}

if (baseline && pkgWarnings.length !== baseline.total) {
  console.log(`\n  packages warning 合计 ${pkgWarnings.length} 条，基线记的是 ${baseline.total} 条`);
}
if (grew.length) {
  console.log("\n  packages 里比基线多的规则（回涨，算失败）：");
  for (const g of grew) console.log(`    ${g.rule}: ${g.n} 条 > 基线 ${g.cap} 条`);
}
if (shrank.length) {
  console.log(`\n  packages 里比基线少：${shrank.join("、")} —— 可以重录基线把它钉住`);
}

if (missing.length) {
  console.log(`\nFAIL：配置没把 ${missing.join(" / ")} 放进扫描范围 —— 一条防线扫不到东西就是假 PASS（见文件头第 4 档）`);
  process.exitCode = 1;
} else if (baselineError) {
  console.log(`\nFAIL：读不到 packages 基线 scripts/eslint-packages-baseline.json（${baselineError}）\n  那份文件是「上游件只拦回涨」这条判据的唯一真源，缺它等于这一档没门禁`);
  process.exitCode = 1;
} else if (errors.length) {
  console.log("\nFAIL：ESLint 有 error");
  process.exitCode = 1;
} else if (ours.length) {
  console.log("\nFAIL：我方代码（src / scripts / 根配置）还留着 warning —— 这一档 v0.90.9 起算失败");
  process.exitCode = 1;
} else if (grew.length) {
  console.log("\nFAIL：packages/** 的 warning 比基线多了 —— 上游件不该被我们改出新问题\n  确实是清掉了旧的又进新的，就跑 --update-packages-baseline 重录并在提交里说明");
  process.exitCode = 1;
} else {
  console.log("\nPASS：没有 error，我方 0 条 warning，packages 没有回涨");
}
