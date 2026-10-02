/**
 * 版本号守卫：把 AGENTS.md §1.2 / §1.3 的硬性约定变成能自动执行的检查。
 *
 * 为什么必须有它、而且必须挂在本地：
 * 这仓库有多个 agent 并行提交，版本号又是「手写进 commit message + package.json」，
 * 于是出现过这么一次：Qoder 把 package.json 预 bump 到 0.5.43 但**还没提交**，
 * 另一个 agent 把那个数当成「已经用掉的版本」改成 0.5.44 提交 ——
 * 0.5.43 就此成为永远不会被使用的死号，提交历史出现缺口。
 *
 * 为什么不只挂 CI：CI 只在 push 时跑。本地连提 5 次它一次都不触发，
 * 等 push 时历史已经定型，只能告诉你「曾经跳过 43」，那时重写 5 条提交
 * 比当场改麻烦得多。**能当场拦住的地方是本地 hook，不是 CI。**
 *
 * 三条断言（--staged 即「即将提交的内容」，--committed 即「已提交的 HEAD」）：
 *   1. 版本号连续：本次版本号 == 历史最大版本号 + 1   ← 这条直接抓住跳号
 *   2. 三处一致：package.json == commit message 里的版本号
 *   3. message 里的版本号必须存在且位于开头（前缀之后的第一段）
 *
 * 判定依据只有 git 历史（`git log`），**从不读工作区的意图**：
 * 工作区的 package.json 可能正被别的会话预 bump，那不是「已发布版本」。
 *
 * 用法：
 *   node scripts/check-version.mjs                      # 自动判断：有暂存查暂存，否则查 HEAD
 *   node scripts/check-version.mjs --staged             # pre-commit 用
 *   node scripts/check-version.mjs --committed          # CI / 事后自检用
 *   node scripts/check-version.mjs --message-file <f>   # commit-msg 用，比对提交消息
 *   node scripts/check-version.mjs --next               # 只打印「下一个该用的版本号」，不校验
 *
 * 退出码：0 通过；1 有问题（错误信息打到 stderr）。
 */
import { spawnSync } from "node:child_process";

function git(...args) {
  const r = spawnSync("git", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (r.error) throw new Error(`调用 git 失败：${r.error.message}`);
  if (r.status !== 0) return null;
  return r.stdout;
}

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};

// ---------------------------------------------------------------------------
// 版本号工具
// ---------------------------------------------------------------------------

/**
 * 取一行文本里的第一个版本号。
 * `v` 前缀可选：commit message 里是「v0.21.3」，package.json 里是「0.5.46」。
 */
function parseVer(text) {
  if (typeof text !== "string") return null;
  const m = /\bv?(\d+)\.(\d+)\.(\d+)\b/.exec(text);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

const fmt = (v) => `v${v[0]}.${v[1]}.${v[2]}`;
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const bumpPatch = (v) => [v[0], v[1], v[2] + 1];

/** 全部提交（当前分支）里出现过的最大版本号 */
function maxCommittedVersion(upto = "HEAD") {
  const log = git("log", upto, "--format=%s");
  if (log === null) return { max: null, entries: [] };
  const entries = [];
  let max = null;
  for (const line of log.split("\n")) {
    const v = parseVer(line);
    if (!v) continue;
    entries.push({ ver: v, subject: line });
    if (!max || cmp(v, max) > 0) max = v;
  }
  return { max, entries };
}

/**
 * 从某棵树里读 package.json 的 version。
 * ref 传 "" 表示读暂存区（index），传 "HEAD" 读已提交内容。
 */
function versionFrom(ref) {
  const out = git("show", `${ref}:package.json`);
  if (out === null) return null;
  try {
    const raw = /"version"\s*:\s*"([^"]+)"/.exec(out);
    return raw ? raw[1] : null;
  } catch {
    return null;
  }
}

const errors = [];
const ok = (msg) => console.log(`  ✓ ${msg}`);
const fail = (msg) => {
  errors.push(msg);
  console.error(`  ✗ ${msg}`);
};

// ---------------------------------------------------------------------------
// --next：只报「下一个该用的版本号」，不做任何校验，也不改文件
// ---------------------------------------------------------------------------
if (has("--next")) {
  const { max } = maxCommittedVersion();
  console.log(max ? fmt(bumpPatch(max)) : "v0.1.0");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// --message-file：commit-msg 阶段，提交消息文件已经写好
// ---------------------------------------------------------------------------
if (has("--message-file")) {
  const file = val("--message-file");
  let message = "";
  try {
    message = (await import("node:fs")).readFileSync(file, "utf8");
  } catch {
    console.error("读不到提交消息文件，交给人工判断。");
    process.exit(0);
  }
  // 注释行、diff 行不参与
  const subject = message.split("\n").find((l) => !l.startsWith("#")) ?? "";
  const inMsg = parseVer(subject);

  // 以「暂存区的 package.json」为准：那是这次提交真正会带上的内容
  const pkgVersion = versionFrom("");
  if (!pkgVersion) {
    fail("暂存区里读不到 package.json 的 version");
  } else if (!inMsg) {
    fail(
      `提交消息开头没有版本号。本次暂存的 package.json 是 ${pkgVersion}，` +
        `消息首行应写成「[agent名]-[模型名] v${pkgVersion} 类型: 描述」（见 AGENTS.md §1.1/§1.2）`,
    );
  } else if (pkgVersion !== fmt(inMsg).slice(1)) {
    fail(
      `版本号两处不一致：package.json 是 ${pkgVersion}，提交消息里是 ${fmt(inMsg)}。` +
        `三个「版本号」必须同进同出（AGENTS.md §1.3）`,
    );
  } else {
    ok(`提交消息版本号 ${pkgVersion} 与 package.json 一致`);
  }
}

// ---------------------------------------------------------------------------
// --staged：pre-commit 阶段，HEAD 还是上一条提交
// ---------------------------------------------------------------------------
const checkStaged = has("--staged") || (!has("--committed") && !has("--message-file"));

if (checkStaged) {
  const stagedVersion = versionFrom("");
  const { max } = maxCommittedVersion();

  if (!stagedVersion) {
    fail("暂存区里读不到 package.json 的 version");
  } else {
    const stagedVer = parseVer(stagedVersion);
    if (!stagedVer) {
      fail(`package.json 的 version「${stagedVersion}」不是 vX.Y.Z 格式`);
    } else if (!max) {
      ok(`历史里还没有任何版本号，本次 ${stagedVersion} 作为起点`);
    } else {
      const expected = bumpPatch(max);
      if (cmp(stagedVer, expected) !== 0) {
        fail(
          `版本号跳号：历史最大是 ${fmt(max)}，本次提交写的是 ${stagedVersion}，` +
            `按「一次工作一个版本号」应当是 ${fmt(expected)}。\n` +
            `    确认一下是不是把别的会话预 bump 的数当成了「已用过的版本」。\n` +
            `    不确定该用哪个号就查：git log --format=%s -20`,
        );
      } else {
        ok(`版本号连续：${fmt(max)} → ${stagedVersion}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// --committed：CI / 事后自检，校验 HEAD 这一条
// ---------------------------------------------------------------------------
const checkCommitted = has("--committed") || (has("--message-file") && has("--staged"));

if (checkCommitted && !checkStaged) {
  const subject = (git("log", "-1", "--format=%s") ?? "").trim();
  const inMsg = parseVer(subject);
  const pkgVersion = versionFrom("HEAD");
  const { max } = maxCommittedVersion("HEAD~1");

  if (!inMsg) fail(`HEAD 提交消息里没有版本号：${subject.slice(0, 60)}`);
  else if (!pkgVersion) fail("HEAD 的 package.json 里读不到 version");
  else if (pkgVersion !== fmt(inMsg).slice(1)) {
    fail(`HEAD 三处不一致：package.json=${pkgVersion}，提交消息=${fmt(inMsg)}`);
  } else if (max && cmp(inMsg, bumpPatch(max)) !== 0) {
    fail(
      `HEAD 版本号跳号：其父提交最大是 ${fmt(max)}，HEAD 是 ${fmt(inMsg)}，应当是 ${fmt(bumpPatch(max))}`,
    );
  } else {
    ok(`HEAD 版本号 ${fmt(inMsg)} 连续且三处一致`);
  }
}

if (errors.length > 0) {
  console.error(`\n版本号检查未通过（${errors.length} 项）。`);
  console.error("这条提交会被拦住。若确认判断有误，先改 package.json / 提交消息，或用 --no-verify 临时绕过（不建议）。");
  process.exit(1);
}
