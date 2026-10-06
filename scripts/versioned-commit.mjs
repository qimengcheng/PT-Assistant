#!/usr/bin/env node
/**
 * 带 @next 版本号展开的 git commit 包装（AGENTS.md §1.2）。
 *
 * 用法：git commit 的参数原样写在后面，只是首行版本号槽位改写成 @next：
 *   node scripts/versioned-commit.mjs -m "[Qoder]-[Qwen3.8-Flash] @next feat(搜索页): xxx"
 *
 * 它做三件事：按类型词算出该用的号 → 写 package.json 并**只** add 这一个路径 →
 * 用展开后的消息调 git commit。于是「该用哪个号」和「忘了 add package.json」
 * 都不再是人的活，而 pre-commit / commit-msg / CI 那三条校验照旧在提交当场复核。
 * 显式写 vX.Y.Z 时这里什么都不动，等价于直接 git commit。
 *
 * 为什么是包装命令而不是 hook（实测 git 2.45.1，断言见 scripts/check-version-test.sh）：
 *   pre-commit 改索引**能**进提交对象，但那时 .git/COMMIT_EDITMSG 里是上一条提交的旧消息，拿不到类型词；
 *   prepare-commit-msg 拿得到消息，此刻再改索引就**进不去**了 —— tree 用的是更早读进内存的那份快照。
 * 两头一夹，「算号 + 写 + add」只能放在调 git 之前做；.githooks/prepare-commit-msg 留一个
 * 「@next 没展开就当场拒收」的守卫，所以忘了走这里也不会留下半套状态。
 * 顺带一个 hook 拿不到的好处：包装命令看得见自己的 argv，所以能把 --amend 一并交给脚本判断，
 * 「amend 却不许改版本号」（AGENTS.md §1.6 硬约束 2）第一次有了当场拦得住的写法
 * ——hook 阶段判不出 amend，见 §1.2 那两条实测。
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const argv = process.argv.slice(2);

function git(...args) {
  const r = spawnSync("git", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
}

const top = (git("rev-parse", "--show-toplevel") ?? "").trim();
if (!top) {
  console.error("取不到仓库根目录（不在 git 仓库里？），versioned-commit 停下，请直接用 git commit。");
  process.exit(1);
}

// 只处理 -m / --message 传进来的消息。-F <文件>、编辑器、merge/squash 复用旧消息这些形态
// 都原样转发：占位符不会被展开，随后 prepare-commit-msg 的守卫当场拒收，不会静默提交。
const mi = argv.findIndex((a) => a === "-m" || a === "--message" || /^(-m|--message)=/.test(a));
const inline = mi < 0 ? null : /^(-m|--message)=(.*)$/s.exec(argv[mi]);
const rawMessage =
  mi < 0 ? null : inline ? inline[2] : argv[mi + 1];

function passthrough(reason) {
  if (reason) console.error(reason);
  const r = spawnSync("git", ["commit", ...argv], { cwd: top, stdio: "inherit" });
  if (r.error) {
    console.error(`调 git commit 失败：${r.error.message}`);
    process.exit(1);
  }
  process.exit(r.status ?? 1);
}

if (typeof rawMessage !== "string") {
  passthrough(
    "没看到 -m/--message 参数，versioned-commit 不展开 @next，直接交给 git commit。\n" +
      "  （-F 文件或编辑器里写的 @next 会被 prepare-commit-msg 拦下 —— 用 -m 传消息才会自动算号）",
  );
}

// 「除了版本号什么都没暂存」会留下一条只改 package.json 一行的提交。真犯过一次：文档改了却没
// git add，包装命令照样把号推进并提交 —— 「一个版本号对应一组完整、已定型的改动」是 §1.2 的硬规则，
// 而这里比裸 git commit 更容易犯，因为它自己就会暂存 package.json，git 那条「no changes」兜不住。
// --amend 跳过：改消息的 amend 本来就不该有新暂存内容（§1.6）。
if (!argv.includes("--amend") && !argv.includes("--allow-empty")) {
  const stagedOthers = (git("diff", "--cached", "--name-only") ?? "")
    .split("\n")
    .filter(Boolean)
    .filter((f) => f !== "package.json");
  if (stagedOthers.length === 0) {
    console.error(
      "暂存区里除了 package.json 什么都没有，这条提交只会推进版本号。\n" +
        "    先 git add <你改的文件>（逐文件点名，别 git add -A，见 AGENTS.md §1.4），版本号这次不动，\n" +
        "    重跑同一条命令它会按同样的基线重算。故意只要版本号一条就显式加 --allow-empty。",
    );
    process.exit(1);
  }
}

// 占位符怎么认、--amend 能不能用，判据全在 check-version.mjs 里（findNextSlot / --resolve）。
// 这里不重复一份正则：两处各写一遍迟早会漂开，漂开的代价是「包放过、脚本拦」这种没人能解释的组合。
const checker = join(top, "scripts", "check-version.mjs");
const resolved = spawnSync(
  process.execPath,
  [checker, "--resolve", ...(argv.includes("--amend") ? ["--amend"] : []), "--message", rawMessage],
  { cwd: top, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
);
if (resolved.error) {
  console.error(`调 check-version.mjs --resolve 失败：${resolved.error.message}`);
  process.exit(1);
}
process.stderr.write(resolved.stderr ?? "");
if (resolved.status !== 0) {
  console.error("@next 没能展开，这条提交不会发生（package.json 要么没动，要么已经写全并暂存）。");
  process.exit(resolved.status ?? 1);
}

// 重建参数：把 -m 的值换成展开后的消息，其余一律原样转发。
const nextArgv = [...argv];
if (inline) nextArgv[mi] = `-m=${resolved.stdout}`;
else nextArgv[mi + 1] = resolved.stdout;

const commit = spawnSync("git", ["commit", ...nextArgv], { cwd: top, stdio: "inherit" });
if (commit.error) {
  console.error(`调 git commit 失败：${commit.error.message}`);
  process.exit(1);
}
process.exit(commit.status ?? 1);
