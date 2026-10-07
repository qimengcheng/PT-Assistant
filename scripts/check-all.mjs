/**
 * 一次跑完全部静态/行为守卫，把「本地改完记得逐条跑那一串命令」这件靠人记的事
 * 换成一条 `pnpm check:all`。**CI 的 build job 调的就是本脚本**（不是 8 个独立 step），
 * 所以本地与 CI 跑的清单永远同一份 —— 见下面「清单从目录现取」。
 *
 * 为什么要聚合：这些守卫在 CI 上全跑，而 CI 只在 push 时触发（AGENTS.md §1.2 讲过
 * 本地攒几次提交它一次都不跑）。让人记住这一串命令的可靠性，等于没有防线——
 * check-fingerprint.mjs 在进 CI 之前就一直停在「靠人记得手动跑」的状态。
 *
 * 口径：**不 fail-fast**。一次把所有条跑完、末尾汇总，这样改错了的人一次就
 * 能看到自己触犯了哪几条，不用跑一条改一次再跑一条。任一条非零即本脚本非零。
 *
 * 不含 `pnpm compile` 与 `smoke-background.mjs`：前者是独立慢命令（实测约 18s，
 * vue-tsc 起进程占大头），后者需要构建产物、而本脚本的定位是「不必先构建就能跑」。
 * 真要完整自检，按 AGENTS.md §2.1 那三条一起走。
 *
 * ⚠️ 现取清单不懂**顺序**：CI 把本脚本放在 `pnpm compile` 之后、构建之前，那时还没有 dist/。
 * 将来若有守卫需要构建产物才能判，别只把它写进 scripts/ —— 它会被自动收进来在构建前假报错。
 * 那种守卫要单独给一步排到 `Build and package` 之后，并加进下面的 EXCLUDED。
 *
 * 用法：`pnpm check:all`（或 `node scripts/check-all.mjs`）
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const SCRIPTS_DIR = path.join(ROOT, "scripts");

/**
 * 守卫清单从 scripts/ 目录现取，不手抄：新增一条守卫就自动进聚合，而 CI 跑的就是本脚本，
 * 于是本地与 CI 两边不可能再各说一套（此前 CI 是 8 个独立 step 手抄的，新守卫进得来本地
 * 却进不来 CI —— 手抄正是这份清单要消灭的东西；AGENTS.md §3.4 也因为手抄过期过一回，
 * 结论是「别往文档里抄条数，以本脚本的输出为准」）。
 *
 * 但必须显式排除两个，两个都是实测踩出来的：
 *  - check-all.mjs 自身：它的名字也匹配 `check-*.mjs`，不排除就是 spawn 自己 → 递归爆开。
 *  - check-version.mjs：它判的是**暂存区 package.json 的版本号**（无参数时会按 amend
 *    口径去比对 HEAD/HEAD~1），跟代码对不对无关；混进来会让本命令的结果取决于
 *    「此刻 git 暂存了什么」这种没人会预期的状态。那是 .githooks 的职责。
 */
const SELF = "check-all.mjs";
const EXCLUDED = new Set([SELF, "check-version.mjs"]);

const GUARDS = fs
  .readdirSync(SCRIPTS_DIR)
  .filter((f) => /^check-.*\.mjs$/.test(f) && !EXCLUDED.has(f))
  .sort();

if (!GUARDS.length) {
  console.error("FAIL：scripts/ 下一条 check-*.mjs 都没找到，聚合逻辑本身坏了。");
  process.exit(1);
}

// --only=xxx,yyy 便于本地复现单条；不带就是全跑
const only = process.argv.find((a) => a.startsWith("--only="));
const wanted = only ? only.slice("--only=".length).split(",") : null;
const targets = GUARDS.filter((f) => !wanted || wanted.some((w) => f.includes(w)));

const results = [];
for (const file of targets) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(SCRIPTS_DIR, file)], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
  });
  const ms = Date.now() - t0;
  const code = r.status ?? 1;
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  const lastLine = out.split(/\r?\n/).filter(Boolean).pop() ?? "";
  results.push({ file, code, ms, lastLine, out });
  console.log(`${code === 0 ? "✓" : "✗"} ${file.padEnd(30)} ${ms} ms`);
  if (code !== 0) {
    // 失败时把整段原样打出来：这些脚本的 FAIL 输出自带具体文件与行号，
    // 只截一行等于把最有用的部分扔了。
    console.log(out.replace(/^/gm, "    "));
  }
}

const bad = results.filter((x) => x.code !== 0);
const total = results.reduce((s, x) => s + x.ms, 0);
console.log(`\n${"─".repeat(60)}`);
if (!bad.length) {
  console.log(`PASS：${results.length} 条守卫全绿（合计 ${(total / 1000).toFixed(1)}s）`);
  process.exit(0);
}
console.log(`FAIL：${bad.length}/${results.length} 条不通过 → ${bad.map((b) => b.file).join(", ")}`);
console.log("（上面已逐条打印失败详情；CI 的 verify→build 会再跑一遍同样这批。）");
process.exit(1);
