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
 *   1. 版本号进位正确：feat 进次版本（x.Y+1.0），其余进修订号（x.y.Z+1）  ← 这条抓跳号
 *      （暂存版本号 == HEAD 自己那条时按 --amend 处理，基线换成 HEAD~1，见 checkStaged 处注释）
 *   2. 三处一致：package.json == commit message 里的版本号
 *   3. message 里的版本号必须存在且位于开头（前缀之后的第一段）
 *      （首行写 @next 时 2/3 由 --resolve 自己满足：算号 → 写 package.json → 替换占位符）
 *
 * 只管首行：提交消息的**正文**里出现别的版本号完全没关系，脚本不扫正文。
 * 首行则按「模型名的 ] 之后」锚定版本号，所以 `[X]-[Model 1.0.0] v0.22.17 …` 这种
 * 前缀里带三段式数字的模型名不会抢位（AGENTS.md §1.1 要求逐字照抄模型名，撞上是迟早的）。
 *
 * 判定依据只有 git 历史（`git log`），**从不读工作区的意图**：
 * 工作区的 package.json 可能正被别的会话预 bump，那不是「已发布版本」。
 *
 * 用法：
 *   node scripts/check-version.mjs                      # 自动判断：有暂存查暂存，否则查 HEAD
 *   node scripts/check-version.mjs --staged             # pre-commit 用
 *   node scripts/check-version.mjs --committed          # CI / 事后自检用
 *   node scripts/check-version.mjs --message-file <f>   # commit-msg 用，比对提交消息
 *   node scripts/check-version.mjs --guard --message-file <f>       # prepare-commit-msg 用，只拦不展开
 *   node scripts/check-version.mjs --resolve --message <文本>       # versioned-commit.mjs 用
 *   node scripts/check-version.mjs --next               # 只打印「下一个该用的修订号」，不校验
 *   node scripts/check-version.mjs --next --type feat    # 按 feat 进位，打印次版本号
 *
 * --resolve 的对外契约：stdout 只有展开后的消息本身（提示一律走 stderr），
 * 所以多行消息、结尾换行都能原样交给 git commit -m。没有 @next 时不改文件内容，
 * 但可能补一次 `git add -- package.json`（工作区的号已经等于消息里的号时）。
 *
 * --next 报的是「新开一条提交该用的号」，进位档位由 --type 决定（默认按非 feat，即 +0.0.1）。
 * 要 --amend 时不要用它 —— amend 沿用被改那条自己的版本号（HEAD 的 package.json），--next 会多给你一个。
 *
 * 为什么「按类型判进位」只能挂在 commit-msg 而不是 pre-commit：
 * pre-commit 阶段提交消息还没成形（.githooks/commit-msg 顶部就写了这条），拿不到 feat 这个词，
 * 所以它只能放宽成「修订号 +1 或 次版本 +1 都放行」，真正的档位比对放在能读到消息的
 * commit-msg 和 CI 的 --committed 上 —— 两者都仍在提交当场，漏不到历史里。
 *
 * 同理，「替你算号并写进 package.json」也只能放在调 git **之前**（scripts/versioned-commit.mjs），
 * 做不成纯 hook：pre-commit 里改索引能进提交对象，但那时 .git/COMMIT_EDITMSG 里还是上一条提交的
 * 旧内容，拿不到 feat；prepare-commit-msg 拿得到消息，此刻再改索引却进不去 —— tree 用的是更早
 * 读进内存的那份索引快照（实测 git 2.45.1，两条断言都在 check-version-test.sh 里）。
 * 所以 prepare-commit-msg 只当守卫：首行还躺着没展开的 @next 就拒收。
 * 首行写 @next 时走 --resolve：号由本脚本按类型词算出，同时写 package.json 和首行；
 * 写的是显式 vX.Y.Z 时 --resolve 不算号，只把工作区里已经是那个号却没暂存的 package.json 补上 add。
 *
 * 退出码：0 通过；1 有问题（错误信息打到 stderr）。
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

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

/**
 * 从提交消息首行里取版本号。
 *
 * 先按 AGENTS.md §1.1 的格式锚定：`] ` 之后的第一个 vX.Y.Z。
 * 直接取「行内第一个三段式数字」是会误判的 —— 前缀里的模型名本身就常带版本号
 * （`[OpenCode]-[Space Bunny Alpha 1.0.0] v0.22.17 …` 这种），那会把 1.0.0 当成提交版本号，
 * 于是一条完全合规的消息被以「两处不一致」拦下，而且报的数看着毫无道理。
 * 锚定失败再退回宽松匹配，兼容不带方括号前缀的消息（如 `v0.22.16 feat: x`）。
 */
function parseMsgVersion(text) {
  if (typeof text !== "string") return null;
  const anchored = /\]\s*v?(\d+\.\d+\.\d+)\b/.exec(text);
  return anchored ? parseVer(anchored[1]) : parseVer(text);
}

const fmt = (v) => `v${v[0]}.${v[1]}.${v[2]}`;
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const bumpPatch = (v) => [v[0], v[1], v[2] + 1];
const bumpMinor = (v) => [v[0], v[1] + 1, 0];

/**
 * 首行版本号槽位上的占位符：写了它，--auto 就替你算号并写进 package.json 和首行。
 *
 * 只认「版本号该在的位置」上的 @next，且要求它后面不接标识符字符 —— 因为 `@next` 在
 * JS 生态里是真实出现的字面量（Next.js 的 dist-tag、`@next/nuxt` 这类包名），
 * 让它触发「自动改文件」会把无关的提交消息改掉。
 */
const NEXT_TOKEN = "@next";
const NEXT_TAIL = String.raw`(?![\w./@-])`;

/** 返回占位符在这一行里的 [start, end)，没有则 null。锚定规则与 parseMsgVersion 同源。 */
function findNextSlot(line) {
  if (typeof line !== "string") return null;
  const anchored = new RegExp(String.raw`\]\s*${NEXT_TOKEN}${NEXT_TAIL}`).exec(line);
  if (anchored) {
    const start = anchored.index + anchored[0].indexOf(NEXT_TOKEN);
    return { start, end: start + NEXT_TOKEN.length };
  }
  if (new RegExp(String.raw`^${NEXT_TOKEN}${NEXT_TAIL}`).test(line)) {
    return { start: 0, end: NEXT_TOKEN.length };
  }
  return null;
}

/**
 * 从提交消息里取类型词：版本号右边第一个单词，`feat(搜索页)!: x` → feat。
 * 取不到返回 ""，按修订号处理 —— 历史里还有 `v0.22.15 root` 这种不带类型词的写法，
 * 认不出时宁可放行 +0.0.1，也不要拦住一条本意就是 fix 的提交。
 * 同样先按「模型名的 ] 之后」锚定，避开前缀里带三段式数字的模型名。
 * 版本号槽位上写 @next 也要能取到类型词，否则 --auto 无从决定进哪一档。
 */
function parseMsgType(text) {
  if (typeof text !== "string") return "";
  const slot = String.raw`(?:@next|v?\d+\.\d+\.\d+)`;
  const m =
    new RegExp(String.raw`\]\s*${slot}\s+([a-zA-Z][a-zA-Z-]*)`).exec(text) ||
    new RegExp(String.raw`(?:^|\s)${NEXT_TOKEN}\s+([a-zA-Z][a-zA-Z-]*)`).exec(text) ||
    new RegExp(String.raw`\bv?\d+\.\d+\.\d+\s+([a-zA-Z][a-zA-Z-]*)`).exec(text);
  return m ? m[1].toLowerCase() : "";
}

/** 进位档位：feat 进次版本（patch 归零），其余（fix/refactor/docs/style/ci/…）进修订号。 */
const isFeature = (type) => type === "feat";
const expectedBump = (max, type) => (isFeature(type) ? bumpMinor(max) : bumpPatch(max));

/** 全部提交（当前分支）里出现过的最大版本号 */
function maxCommittedVersion(upto = "HEAD") {
  const log = git("log", upto, "--format=%s");
  if (log === null) return { max: null, entries: [] };
  const entries = [];
  let max = null;
  for (const line of log.split("\n")) {
    const v = parseMsgVersion(line);
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
  if (!max) {
    console.log("v0.1.0");
  } else {
    console.log(fmt(expectedBump(max, val("--type") || "")));
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// @next 档：--resolve（包装命令用，真的算号并写文件）/ --guard（hook 用，只拦不展开）
//
// 存在的理由：手写号有两类已经发生过的事故 —— 「改了 package.json 但漏 git add」（AGENTS.md §1.3），
// 以及「把工作区里别人预 bump 的数当成已发布版本 +1」（本文件顶部）。让脚本从 git log 现算，
// 两类都没有入口。代价是 package.json 由脚本而不是人来改，所以每一处都出声。
//
// 为什么拆成两个模式、而不是让 hook 一把做完（实测，git 2.45.1，断言见 check-version-test.sh）：
//   pre-commit 里写 package.json + git add → 改动**会**进提交对象；
//   prepare-commit-msg 里做同样的事 → 索引变了（git show :package.json 认），提交对象**不认**，
//   因为那时 git 早已把索引读进内存，tree 用的是那份快照。
// 而类型词（feat / fix）只有到 prepare-commit-msg 才拿得到（pre-commit 阶段 .git/COMMIT_EDITMSG
// 里躺的是上一条提交留下的旧内容）。两头一夹：能写文件的阶段读不到消息，读得到消息的文件写了不算。
// 所以「算号 + 写 + add」放在提交之前的 scripts/versioned-commit.mjs 里做，
// hook 只留 --guard：看见没展开的 @next 就拦，免得直接 git commit 时留下半套状态。
// ---------------------------------------------------------------------------

/** 消息里版本号该在的那一行：第一条非空、非注释行。 */
function subjectOf(message) {
  const lines = message.split("\n");
  const i = lines.findIndex((l) => l.trim() !== "" && !l.startsWith("#"));
  return { lines, i, subject: i < 0 ? null : lines[i] };
}

/** 把首行的 @next 换成真号，返回换好的整条消息（没有占位符时原样返回）。 */
function substitute(subject, slot, nextVer) {
  return subject.slice(0, slot.start) + fmt(nextVer) + subject.slice(slot.end);
}

/**
 * 读工作区的 package.json，拿不到就停下 —— 号算错了顶多是拦下，写了一半没暂存才是
 * AGENTS.md §1.3 那个「三处不一致」事故的源头。返回 { top, pkgPath, pkgRaw, current }。
 */
function loadPkg(label) {
  const fsTop = (git("rev-parse", "--show-toplevel") ?? "").trim();
  if (!fsTop) {
    console.error(`仓库根目录取不到，${label} 没有落实。这条提交停下，请手写版本号。`);
    process.exit(1);
  }
  const pkgPath = `${fsTop}/package.json`;
  let pkgRaw = "";
  try {
    pkgRaw = readFileSync(pkgPath, "utf8");
  } catch {
    console.error(`读不到 ${pkgPath}，${label} 没有落实。`);
    process.exit(1);
  }
  const vm = /"version"(\s*:\s*)"([^"]*)"/.exec(pkgRaw);
  if (!vm) {
    console.error(`package.json 里找不到 "version" 字段，${label} 没有落实。`);
    process.exit(1);
  }
  return { top: fsTop, pkgPath, pkgRaw, current: vm[2] };
}

/**
 * 热点文件保护（AGENTS.md §1.4）：接下来这条 `git add -- package.json` 会把工作区里这个文件的
 * **全部**改动一起提交，而不只是版本号那一行。多会话共用一棵工作树时这可能带走别人的未提交改动，
 * 所以先比对「去掉版本号之后」是否还有差异。只出声，不拦：确有「同一条提交里既改依赖又进版本号」
 * 的正常用法，那属于人该看一眼的情况。
 */
function warnUnstagedExtras(pkgRaw) {
  const withoutVersion = (s) =>
    s.replace(/\r\n/g, "\n").replace(/"version"(\s*:\s*)"[^"]*"/, '"version"$1""');
  const stagedPkg = git("show", ":package.json");
  if (stagedPkg !== null && withoutVersion(stagedPkg) !== withoutVersion(pkgRaw)) {
    console.error(
      `  ! package.json 还有版本号以外的改动没暂存，自动 add 会把它们一并带进这一条提交。\n` +
        `    先确认是不是别的会话的未提交改动：git diff -- package.json`,
    );
  }
}

function gitAddPkg(top, nextStr) {
  const add = spawnSync("git", ["add", "--", "package.json"], { cwd: top, encoding: "utf8" });
  if (add.status !== 0) {
    console.error(
      `package.json 里的版本号 ${nextStr} 没能暂存（git add 失败：${(add.stderr || add.error || "").trim()}）。\n` +
        `    提交停下。手工 git add -- package.json 后重新提交即可。`,
    );
    process.exit(1);
  }
}

/** @next 档：写新版本号并暂存，返回改之前的号（只为了把话讲清楚）。 */
function stageVersion(label, nextStr) {
  const pkg = loadPkg(label);
  warnUnstagedExtras(pkg.pkgRaw);
  writeFileSync(pkg.pkgPath, pkg.pkgRaw.replace(/("version"\s*:\s*")([^"]*)(")/, `$1${nextStr}$3`));
  gitAddPkg(pkg.top, nextStr);
  return pkg.current;
}

/**
 * 显式写了 vX.Y.Z 的档：只在「工作区已经是这个号、只是没暂存」时补一次 add。
 * 号不一致时**不**改写 —— 场上同时有两个号，那是该由人决定的冲突，静默挑一个正好是 §1.3
 * 最容易被绕过去的形式；不一致由 commit-msg 用「两处不一致」报出来，那句话比这里补一句更准。
 */
function stageMatching(nextStr) {
  const pkg = loadPkg(NEXT_TOKEN);
  if (pkg.current !== nextStr) return false;
  warnUnstagedExtras(pkg.pkgRaw);
  gitAddPkg(pkg.top, nextStr);
  return true;
}

// --guard：prepare-commit-msg 用。首行还躺着没展开的 @next → 拦下。
// 走到这里说明没走 versioned-commit.mjs：此刻 git 已经把索引读进内存，
// 这个钩子再改 package.json 也进不了本次提交（实测见 check-version-test.sh），
// 所以只能拒收，不能补救。
if (has("--guard")) {
  const file = val("--message-file");
  let message = "";
  try {
    message = readFileSync(file, "utf8");
  } catch {
    console.error(`读不到提交消息文件 ${file}，无法确认 ${NEXT_TOKEN} 有没有展开，这条提交停下。`);
    process.exit(1);
  }
  const { subject } = subjectOf(message);
  if (subject && findNextSlot(subject)) {
    console.error(
      `首行的 ${NEXT_TOKEN} 没被展开：直接 git commit 时没人替你算号，也没人写 package.json。\n` +
        `  走包装命令（AGENTS.md §1.2）：\n` +
        `    node scripts/versioned-commit.mjs -m "<原消息>"`,
    );
    process.exit(1);
  }
  process.exit(0);
}

// --resolve：versioned-commit.mjs 用。把首行的 @next 换成真号，并把新号写进 package.json 且暂存。
// stdout 只有展开后的消息本身（给人看的都走 stderr），所以多行消息与结尾换行都能原样交给 git。
// --amend 由调用方带上来：hook 阶段判不出 amend，而包装命令看得见自己的 argv（见 §1.6）。
if (has("--resolve")) {
  const message = val("--message");
  if (typeof message !== "string") {
    console.error(`--resolve 需要 --message <文本>`);
    process.exit(2);
  }
  const { lines, i, subject } = subjectOf(message);
  const slot = subject ? findNextSlot(subject) : null;
  if (!slot) {
    // 没写占位符也要负责暂存：同一条命令对 @next 负责、对显式号不负责，§1.3 那个
    // 「改了 package.json 但漏 git add」就还在原地等犯。号本身不一致时不改写，见 stageMatching。
    const explicit = subject ? parseMsgVersion(subject) : null;
    if (explicit && stageMatching(fmt(explicit).slice(1))) {
      console.error(`  ✓ 已代为暂存 package.json（它的 version 正是消息里的 ${fmt(explicit)}）`);
    }
    process.stdout.write(message); // 消息原样交回，三条守卫照旧
    process.exit(0);
  }

  // 占位符的语义是「新开一条提交」，--amend 的语义是「替换已有那条」。放开就会把被替换
  // 那条的号顶成没有任何提交用过的死号，而那一刻的索引状态与一次正常提交无法区分，
  // pre-commit / commit-msg / CI 三条全都拦不住（AGENTS.md §1.2 末尾、§1.6 硬约束 2）。
  if (has("--amend")) {
    const head = (git("log", "-1", "--format=%s") ?? "").trim();
    console.error(
      `--amend 不许用 ${NEXT_TOKEN}（AGENTS.md §1.6 硬约束 2：amend 只改消息和内容，绝不改版本号）。\n` +
        `    HEAD 是：${head}\n` +
        `    把 HEAD 自己的 vX.Y.Z 逐字写进首行。真做成了新功能就新开一条 feat 进次版本，而不是 amend。`,
    );
    process.exit(1);
  }

  const type = parseMsgType(subject);
  const { max } = maxCommittedVersion("HEAD");
  const nextVer = max ? expectedBump(max, type) : [0, 1, 0];
  const oldVersion = stageVersion(NEXT_TOKEN, fmt(nextVer).slice(1));

  lines[i] = substitute(subject, slot, nextVer);
  process.stdout.write(lines.join("\n"));
  console.error(
    `  ✓ ${NEXT_TOKEN} → ${fmt(nextVer)}：类型词「${type || "未识别，按修订号"}」，` +
      `基线是历史最大 ${max ? fmt(max) : "（还没有任何版本号）"}；package.json 已从 ${oldVersion} 改写并暂存。\n` +
      `    一致性与进位档位仍由 commit-msg 在提交当场复核。`,
  );
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
  // 注释行、diff 行不参与。**只读首行**：正文里的版本号字面量不参与比对（见 parseMsgVersion）
  const subject = message.split("\n").find((l) => !l.startsWith("#")) ?? "";
  const inMsg = parseMsgVersion(subject);

  // 以「暂存区的 package.json」为准：那是这次提交真正会带上的内容
  const pkgVersion = versionFrom("");
  if (!pkgVersion) {
    fail("暂存区里读不到 package.json 的 version");
  } else if (!inMsg) {
    fail(
      `提交消息首行取不到版本号（要紧跟在模型名后的 ] 之后）。本次暂存的 package.json 是 ${pkgVersion}，` +
        `首行应写成「[agent名]-[模型名] v${pkgVersion} 类型: 描述」（见 AGENTS.md §1.1/§1.2）`,
    );
  } else if (pkgVersion !== fmt(inMsg).slice(1)) {
    fail(
      `版本号两处不一致：package.json 是 ${pkgVersion}，提交消息里是 ${fmt(inMsg)}。` +
        `三个「版本号」必须同进同出（AGENTS.md §1.3）`,
    );
  } else {
    ok(`提交消息版本号 ${pkgVersion} 与 package.json 一致`);

    /**
     * 进位档位校验，amend 时跳过。
     * 判据与 pre-commit 同一个：消息里的版本号 == HEAD 自己的版本号 ⇒ 认定这是在替换 HEAD。
     * 必须跳过的原因是 AGENTS.md §1.6 硬约束 2「amend 只改消息和内容，绝不改版本号」——
     * 此刻逼它按类型重算档位，等于当场要求造一个没人用过的号（改 feat 类型词去凑更糟，
     * 那是为了让守卫闭嘴而撒谎）。
     * 代价同 pre-commit：新开一条却重复用号在这里也会被放过，事后由 CI 的 --committed 认。
     */
    const headVer = parseMsgVersion((git("log", "-1", "--format=%s") ?? "").trim());
    if (headVer && cmp(headVer, inMsg) === 0) {
      console.log(
        `  · 消息版本号与 HEAD 相同（${fmt(headVer)}），按 git commit --amend 处理：不校验进位档位。` +
          `若这其实是一条新提交，说明你重复用了版本号（AGENTS.md §1.2）。`,
      );
    } else {
      const { max } = maxCommittedVersion("HEAD");
      if (!max) {
        ok(`历史里还没有任何版本号，本次 ${fmt(inMsg)} 作为起点`);
      } else {
        const type = parseMsgType(subject);
        const expected = expectedBump(max, type);
        if (cmp(inMsg, expected) !== 0) {
          fail(
            `进位档位不对：历史最大是 ${fmt(max)}，本次类型词是「${type || "未识别，按修订号"}」，` +
              `号写的是 ${fmt(inMsg)}，应当是 ${fmt(expected)}。\n` +
              `    feat 进次版本（${fmt(bumpMinor(max))}），fix / refactor / docs / style / ci 等进修订号（${fmt(bumpPatch(max))}）。\n` +
              `    改 package.json 和提交消息里的号，不要改类型词去凑数。`,
          );
        } else {
          ok(
            `进位档位正确：${fmt(max)} → ${fmt(inMsg)}（${isFeature(type) ? "feat 进次版本" : "进修订号"}）`,
          );
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// --staged：pre-commit 阶段，HEAD 还是上一条提交
// ---------------------------------------------------------------------------
const checkStaged = has("--staged") || (!has("--committed") && !has("--message-file"));

if (checkStaged) {
  const stagedVersion = versionFrom("");
  const headVersion = versionFrom("HEAD");

  /**
   * 「本次提交是替换 HEAD（--amend）还是追加新提交」，pre-commit 阶段判不出来：
   * 实测 git 不向 hook 暴露任何指示 --amend 的 GIT_* 变量，而此时 .git/COMMIT_EDITMSG
   * 里躺的是**上一条**提交留下的旧内容，两者都无法作信号。
   *
   * 退一步用版本号本身作判据：暂存版本号 == HEAD 自己的版本号 ⇒ 认定这是在 --amend HEAD，
   * 于是把基线换成 HEAD~1 —— 被替换掉的那条不该参与「历史最大」的计算，
   * 否则历史最大就是它自己，expected 变成 N+1，amend 永远被误报成跳号。
   *
   * 代价是「新开一条提交却重复用 HEAD 的号」这种真误用在这里会被放过。可接受，
   * 因为它是兜得住的那一类：amend 后 CI 的 --committed 拿 HEAD~1 作基线，
   * 而**事后**的历史里 amend 与重复用号是可区分的（前者只有一条 N），照样拦得下。
   * 这里刻意选「宁可放过一次、也不拦死 §1.6 要求的正常流程」，并显式出声说明。
   */
  const amendingHead = !!stagedVersion && stagedVersion === headVersion;
  const { max } = maxCommittedVersion(amendingHead ? "HEAD~1" : "HEAD");

  if (amendingHead) {
    console.log(
      `  · 暂存版本号与 HEAD 相同（${stagedVersion}），按 git commit --amend 处理：` +
        `基线取 HEAD~1。若这其实是一条新提交，说明你重复用了版本号（AGENTS.md §1.2）。`,
    );
  }

  if (!stagedVersion) {
    fail("暂存区里读不到 package.json 的 version");
  } else {
    const stagedVer = parseVer(stagedVersion);
    if (!stagedVer) {
      fail(`package.json 的 version「${stagedVersion}」不是 vX.Y.Z 格式`);
    } else if (!max) {
      ok(`历史里还没有任何版本号，本次 ${stagedVersion} 作为起点`);
    } else {
      /**
       * 这里只校验「是不是相邻的下一档」，不校验档位本身对不对。
       * 因为此刻提交消息还没成形，拿不到 feat 这个类型词 —— 档位由 commit-msg 那一段负责，
       * 它同样在提交当场，不会漏到历史里。
       */
      const candidates = [bumpPatch(max), bumpMinor(max)];
      const legal = candidates.some((c) => cmp(stagedVer, c) === 0);
      if (!legal) {
        fail(
          `版本号跳号：历史最大是 ${fmt(max)}，本次提交写的是 ${stagedVersion}，` +
            `按「一次工作一个版本号」应当是 ${fmt(candidates[0])}（修订号）或 ${fmt(candidates[1])}（feat 进次版本）。\n` +
            `    确认一下是不是把别的会话预 bump 的数当成了「已用过的版本」。\n` +
            `    不确定该用哪个号就查：node scripts/check-version.mjs --next --type <feat|fix>`,
        );
      } else {
        const which = cmp(stagedVer, bumpMinor(max)) === 0 ? "feat 档（次版本）" : "修订号档";
        ok(`版本号相邻：${fmt(max)} → ${stagedVersion}（${which}，档位由 commit-msg 按类型词复核）`);
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
  const inMsg = parseMsgVersion(subject);
  const pkgVersion = versionFrom("HEAD");
  const { max } = maxCommittedVersion("HEAD~1");

  if (!inMsg) fail(`HEAD 提交消息里没有版本号：${subject.slice(0, 60)}`);
  else if (!pkgVersion) fail("HEAD 的 package.json 里读不到 version");
  else if (pkgVersion !== fmt(inMsg).slice(1)) {
    fail(`HEAD 三处不一致：package.json=${pkgVersion}，提交消息=${fmt(inMsg)}`);
  } else if (max && cmp(inMsg, expectedBump(max, parseMsgType(subject))) !== 0) {
    fail(
      `HEAD 版本号进位不对：其父提交最大是 ${fmt(max)}，HEAD 是 ${fmt(inMsg)}，` +
        `类型词「${parseMsgType(subject) || "未识别，按修订号"}」应当是 ${fmt(expectedBump(max, parseMsgType(subject)))}` +
        `（feat 进次版本，其余进修订号）`,
    );
  } else {
    ok(`HEAD 版本号 ${fmt(inMsg)} 进位正确且三处一致`);
  }
}

if (errors.length > 0) {
  console.error(`\n版本号检查未通过（${errors.length} 项）。`);
  console.error("这条提交会被拦住。若确认判断有误，先改 package.json / 提交消息，或用 --no-verify 临时绕过（不建议）。");
  process.exit(1);
}
