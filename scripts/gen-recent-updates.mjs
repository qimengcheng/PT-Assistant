/**
 * 生成首页「最近更新」的数据快照 → src/options/data/recentUpdates.json（随代码入库）。
 *
 * 为什么是快照而不是运行时去拉 GitHub Release：
 * 扩展跑在用户浏览器里，在线拉数要多一条 CORS/host 权限、断网就是空面板，
 * 而且 Release 正文是 Markdown、面向的是仓库读者不是产品用户。
 * 与 `gen-agent-stats.mjs` 同一套路：脚本算一次、结果入库、构建产物里直接 import。
 *
 * 版本号从**提交标题**里取，不读 tag：本仓库的硬规则是「一条提交一个版本号」
 * （AGENTS §1.2），而 tag 是 CI 事后打的 —— 本地/浅克隆环境里未必有，
 * 历史又被改写并强推过（旧 tag 一度指向不在链路上的提交）。提交标题是当场写下的，
 * 反而是这里唯一可靠的那份。
 *
 * 分两桶：`feat` 进「新增功能」，其余可见类型（fix / perf / style）进「优化与修复」。
 *
 * ⚠️ 首页是**产品界面**，不是变更日志：只进用户看得见的那部分。
 * 判据三层，缺一层就会把「版本号守卫」「CI 聚合 step」「合并重复 CSS 声明」这类工程内部动作
 * 摆到用户面前（它们曾经全都在列）：
 *   ① 类型白名单 feat/fix/perf/style —— ci/build/chore/docs/refactor/test/i18n/deps 以及
 *      认不出类型词的老提交一律不展示（这些改完界面上没有任何东西会变）；
 *   ② 内部范围黑名单 —— `feat(版本号守卫)` 是 feat，但用户看不见提交时算号这件事，照挡；
 *   ③ 没写 scope 时按描述里的工程词兜底 —— `style: 站点定义页合并重复的 CSS 声明` 走这条。
 * 三层都是**宁可漏放也不误杀**：判据只认 scope 和类型词这些结构化字段，不做语义猜测。
 * 想复核挡掉了什么，跑 `VERBOSE=1 node scripts/gen-recent-updates.mjs`。
 *
 * ⚠️ 全部走异步 spawn：本机 `spawnSync` / `execFileSync` 对任何可执行文件都返回
 *    EBUSY（连 git.exe 自己也起不来），同步 API 在这里一律不可用。
 *
 * 用法：node scripts/gen-recent-updates.mjs
 * 环境变量：
 *   COUNT   展示多少个版本（默认 8；挡掉工程内部条目后没有可见内容的版本不占名额）
 *   SCAN    往回扫多少个版本再截断（默认 40，保证过滤后仍凑得满 COUNT）
 *   MAX     每个桶最多列几条（默认 8，超出会带「等 N 条」的尾巴交给界面判）
 *   VERBOSE 非空时逐条打印被挡掉的提交和命中了哪层判据
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();
const OUT = path.join(ROOT, "src", "options", "data", "recentUpdates.json");

async function git(...args) {
  const { stdout } = await execFileAsync("git", args, { cwd: ROOT, maxBuffer: 16 * 1024 * 1024 });
  return stdout;
}

/** ① 类型白名单：这四类改完界面上真看得见东西 */
const VISIBLE_TYPES = new Set(["feat", "fix", "perf", "style"]);

/** ② 内部范围：这些 scope 指的是仓库自己的机制，不是用户会打开的那张界面 */
const INTERNAL_SCOPE = /守卫|版本号|CI|ci|tooling|工程|仓库|构建|打包|依赖|死码|清理|文档|测试|脚本|indexdb|sw-graph|守卫自检/;

/** ③ 没写 scope 时的兜底：描述里出现工程内部词汇就不进首页 */
const INTERNAL_TEXT = /CSS|代码|脚本|单测|回归|lint|重构|守卫|依赖|构建|打包|CI/;

const verbose = !!process.env.VERBOSE;
const dropped = [];

/**
 * 提交标题的习惯是把详细说明也写进去，太长就没法读，这里截到 100 字符。
 * 只在 `。` 处截，不在 `；` 处截 —— 本仓库不少标题是「修了 A；并补了 B」两件事，
 * 分号切开会首页上就只剩前半件（`gen-release-notes.mjs` 那侧仍按它的口径走，两边用途不同）。
 */
function shorten(text) {
  if (!text) return "";
  const stop = text.search(/。/);
  let s = stop > 0 ? text.slice(0, stop) : text;
  if (s.length > 100) s = s.slice(0, 100).trimEnd() + "…";
  return s;
}

const SEP = "\x1f";
const lines = (await git("log", "--no-merges", "--date=short", `--pretty=format:%ad${SEP}%s`, "-n", "600"))
  .split("\n")
  .filter(Boolean);

/** 版本号 → { version, date, added[], improved[] }；git log 本身是时间倒序，先到的是新版本 */
const byVersion = new Map();

for (const line of lines) {
  const at = line.indexOf(SEP);
  const date = line.slice(0, at);
  const subject = line.slice(at + 1);

  const m = subject.match(/^\[[^\]]+\]-\[[^\]]+\]\s*v(\d+\.\d+\.\d+)\s*(.*)$/);
  if (!m) continue; // 不带版本号/前缀的提交（别人的、或守卫漏过的）不进首页

  const [, version, rest] = m;
  const typed = rest.match(/^([a-zA-Z]+)(\([^)]*\))?!?:\s*(.*)$/);
  const type = typed ? typed[1].toLowerCase() : "";
  const scope = typed && typed[2] ? typed[2].slice(1, -1) : "";
  const desc = shorten(typed ? typed[3] : rest);
  if (!desc) continue;

  // 首页只放用户看得见的那部分，三层判据见文件头
  let reason = "";
  if (!typed) reason = "认不出类型词";
  else if (!VISIBLE_TYPES.has(type)) reason = `类型 ${type}`;
  else if (INTERNAL_SCOPE.test(scope)) reason = `内部范围 (${scope})`;
  else if (!scope && INTERNAL_TEXT.test(desc)) reason = "无 scope 且描述是工程内部事项";
  if (reason) {
    dropped.push({ version, reason, subject: rest });
    continue;
  }

  let bucket = byVersion.get(version);
  if (!bucket) {
    bucket = { version, date, added: [], improved: [] };
    byVersion.set(version, bucket);
  }
  (type === "feat" ? bucket.added : bucket.improved).push(desc);
}

const count = Number(process.env.COUNT || 8);
const max = Number(process.env.MAX || 8);
const scan = Number(process.env.SCAN || 40);
const versions = [...byVersion.values()]
  .sort((a, b) => cmp(b.version, a.version))
  // 挡完之后可能整版都没有可见条目，这种版本不占名额，所以先扫 scan 个再截 count
  .slice(0, scan)
  .filter((v) => v.added.length || v.improved.length)
  .slice(0, count)
  .map((v) => ({
    version: v.version,
    date: v.date,
    added: v.added.slice(0, max),
    addedTotal: v.added.length,
    improved: v.improved.slice(0, max),
    improvedTotal: v.improved.length,
  }));

function cmp(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

const headSha = (await git("rev-parse", "--short", "HEAD")).trim();
const out = {
  // 只给日期不给时间戳：这份快照随代码入库，精确到秒会让每次重新生成都产生无意义 diff
  generatedAt: new Date().toISOString().slice(0, 10),
  headSha,
  versions,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n", "utf8");

const items = versions.reduce((n, v) => n + v.addedTotal + v.improvedTotal, 0);
console.log(
  `✓ src/options/data/recentUpdates.json｜${versions.length} 个版本 / ${items} 条（新增 ${versions.reduce((n, v) => n + v.addedTotal, 0)}、优化 ${versions.reduce((n, v) => n + v.improvedTotal, 0)}）｜挡掉 ${dropped.length} 条工程内部提交｜截至 ${headSha}`,
);

if (verbose) {
  console.log("\n被挡掉的提交（首页不展示）：");
  for (const d of dropped) {
    console.log(`  ${d.version.padEnd(9)} ${d.reason.padEnd(28)} ${d.subject.slice(0, 80)}`);
  }
}
