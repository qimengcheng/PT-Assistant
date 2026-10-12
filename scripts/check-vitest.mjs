/**
 * 防线 ⑭：跑 Vitest（`tests` 目录下的 `.test.ts`）。
 *
 * 为什么做成一条 `check-*.mjs` 而不是往 CI 里单加一步：`scripts/check-all.mjs` 是去 `scripts/`
 * 现取清单的，进来之后「本地有、CI 没有」这种漂移从结构上没了（AGENTS §3.4）。它也不需要构建产物，
 * 所以排在构建之前不会假报错。
 *
 * 四条「报干净 ≠ 真跑到了」的判据，缺一条都会让这道门禁变成摆设：
 *  1. 起不来 vitest（依赖没装、配置写歪）→ FAIL。那种情况下 stdout 是空的、报告文件也不存在。
 *  2. 报告解不开 → FAIL。
 *  3. **报告里的测试文件数要等于磁盘上 `tests` 目录里 `.test.ts` 的个数** —— 否则 `include` 或别名
 *     写歪时会「0 个文件、0 条失败」，那是最像 PASS 的假 PASS。
 *  4. 被 skip / todo 掉的用例按 FAIL 报：留在那儿没人看，等于把那条判据悄悄撤了。
 *
 * 用法：`node scripts/check-vitest.mjs`（在项目根目录跑）
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const BIN = path.join(ROOT, "node_modules", "vitest", "vitest.mjs");
const REPORT = path.join(os.tmpdir(), `ptd-vitest-${process.pid}.json`);

/** 磁盘上有多少个测试文件 —— 拿它跟报告里的数目对，这是第 3 条判据的另一半 */
function countTestFiles(dir) {
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) n += countTestFiles(p);
    else if (e.name.endsWith(".test.ts")) n++;
  }
  return n;
}

const onDisk = countTestFiles(path.join(ROOT, "tests"));

if (!existsSync(BIN)) {
  console.log(`FAIL：找不到 vitest 入口（${path.relative(ROOT, BIN)}）—— devDependencies 里 vitest 装了、也 pnpm install 完了吗`);
  process.exit(1);
}

const run = spawnSync(process.execPath, [BIN, "run", "--reporter=json", `--outputFile=${REPORT}`], {
  cwd: ROOT,
  encoding: "utf8",
  maxBuffer: 1 << 26,
});

try {
  if (run.error) {
    console.log(`FAIL：起不了 vitest —— ${run.error.message}`);
    process.exit(1);
  }

  if (!existsSync(REPORT)) {
    // 退出码 1 但没出报告：多半是配置炸了 / 一个文件都没收集到，把那两边的输出留给你看
    console.log(`FAIL：vitest 没写出报告（退出码 ${run.status}）\n${(run.stdout ?? "").slice(0, 4000)}\n${(run.stderr ?? "").slice(0, 4000)}`);
    process.exit(1);
  }

  let rep;
  try {
    rep = JSON.parse(readFileSync(REPORT, "utf8"));
  } catch (e) {
    console.log(`FAIL：vitest 的报告解不开（${e.message}）`);
    process.exit(1);
  }

  const files = rep.testResults ?? [];
  const failed = files.filter((f) => f.status !== "passed");
  const pending = files.flatMap((f) => (f.assertionResults ?? []).filter((a) => a.status === "skipped" || a.status === "todo"));
  const total = rep.numPassedTests ?? 0;

  console.log(`跑了 ${files.length} 个测试文件、${total} 条用例（磁盘上 tests/ 有 ${onDisk} 个文件）`);

  let bad = false;
  if (files.length !== onDisk) {
    console.log(
      `FAIL：报告里 ${files.length} 个文件、磁盘上 ${onDisk} 个 —— 有测试文件没被收集到。` +
        `先查 vitest.config.ts 的 test.include 与别名（「0 个文件、0 条失败」是最像 PASS 的假 PASS）`,
    );
    bad = true;
  }
  for (const f of failed) {
    bad = true;
    console.log(`\nFAIL · ${path.relative(ROOT, f.name).split(path.sep).join("/")}`);
    for (const a of f.assertionResults ?? []) {
      if (a.status !== "failed") continue;
      console.log(`  · ${a.fullName}`);
      for (const m of a.failureMessages ?? []) console.log(`      ${String(m).split("\n")[0]}`);
    }
    if (f.message) console.log(`  文件级：${String(f.message).split("\n").slice(0, 3).join(" / ")}`);
  }
  if (pending.length) {
    bad = true;
    console.log(`FAIL：有 ${pending.length} 条被 skip/todo 的用例 —— 撤判据要走删用例或改判据，不是留一句 skip`);
    for (const a of pending.slice(0, 10)) console.log(`  · ${a.fullName}`);
  }
  // 用例自己全过了但进程非 0：那是 unhandled rejection / 未捕获错误（vitest 会照样打 Errors）
  if (!bad && run.status !== 0) {
    bad = true;
    console.log(`FAIL：用例全过但 vitest 退出码 ${run.status} —— 大概率是未处理的 rejection，看上面的 stderr`);
  }

  if (bad) process.exit(1);
  console.log(`PASS：${total} 条行为断言全过（防线 ⑭）`);
} finally {
  rmSync(REPORT, { force: true });
}
