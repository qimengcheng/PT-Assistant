#!/usr/bin/env node
/**
 * 构建的唯一入口（`pnpm build` 指到这里）。
 *
 * 干三件事，都是为了「多会话共用一棵工作树，用户只认一个加载目录」：
 *
 * 1. **互斥锁** `.build-lock/`。真正会打架的不是产物目录（那个已经按会话隔离），
 *    而是三份共享状态：`.wxt/`（WXT 生成的类型，全仓唯一一份）、`node_modules/.vite/`
 *    （依赖预打包缓存）、系统 Temp 里 esbuild 的自删（PLAYBOOK §13 那个
 *    `Access is denied`，并行时概率翻倍）。锁只串行 build/zip，不管 `pnpm dev`（长跑）。
 * 2. **换指联接** `dist-verify` → 本次的 `dist-<会话>-<版本>/chrome-mv3`。
 *    Chrome 未打包扩展的 id 按加载路径算，每换一个新目录就得移除再加载、站点配置全丢；
 *    固定一个路径让用户只加载一次。联接用 Node 原生 junction（`fs.symlinkSync(..., "junction")`，
 *    不需要管理员权限；真符号链接需要，`cmd /c mklink` 则会被仓库路径里的空格咬掉）。
 * 3. **清理本会话旧快照**：只删 `dist-<本会话>-*` 里不是本次的那些，别的会话不碰。
 *
 * 会话标识与 CI：`PTD_SESSION` 没设时，**本地**默认按 `owner` 这个会话处理（人在 WebStorm / 终端里
 * 手跑构建，不该为了拿固定加载路径去配环境变量）；只有在 CI（`CI` / `GITHUB_ACTIONS` 为真）里
 * 才落回 WXT 默认的 `.output` 且不碰联接 —— CI 按 `.output/*.zip` 取包。
 * 想在本地复现 CI 那条路径：`CI=true pnpm build`。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCK_DIR = path.join(ROOT, ".build-lock");
const LINK_NAME = "dist-verify";
const LINK_PATH = path.join(ROOT, LINK_NAME);
const LOCK_TIMEOUT_MS = 20 * 60 * 1000;
const POLL_MS = 2000;

const isTruthyEnv = (v) => /^(true|1)$/i.test((v ?? "").trim());
const inCI = isTruthyEnv(process.env.CI) || isTruthyEnv(process.env.GITHUB_ACTIONS);
const rawSession = (process.env.PTD_SESSION ?? "").trim();
/** 没给会话名时的默认：本地算「用户自己」（owner），CI 保持 WXT 默认的 `.output`。 */
const sessionTag = rawSession || (inCI ? "" : "owner");
const pkgVersion = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;

function log(msg) {
  console.log(`[build-verify] ${msg}`);
}

/* ---------------- 1. 互斥锁 ---------------- */

function pidAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM 表示进程存在但没权限看；只有 ESRCH 才是真没了
    return e.code === "EPERM";
  }
}

function readLock() {
  try {
    return JSON.parse(fs.readFileSync(path.join(LOCK_DIR, "owner.json"), "utf8"));
  } catch {
    return null;
  }
}

function stealLock(owner, why) {
  log(`锁由 ${owner?.session ?? "?"} 持有，但 ${why} —— 接管`);
  fs.rmSync(LOCK_DIR, { recursive: true, force: true });
}

function acquireLock() {
  const waitedFrom = Date.now();
  let lastNotice = 0;
  for (;;) {
    try {
      fs.mkdirSync(LOCK_DIR);
      fs.writeFileSync(
        path.join(LOCK_DIR, "owner.json"),
        JSON.stringify({ session: sessionTag || "(CI: .output)", pid: process.pid, startedAt: new Date().toISOString() }, null, 2),
      );
      return () => {
        try {
          fs.rmSync(LOCK_DIR, { recursive: true, force: true });
        } catch {}
      };
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      const owner = readLock();
      if (owner && !pidAlive(owner.pid)) {
        stealLock(owner, "那个进程已经不在了（大概是构建中途被强杀）");
        continue;
      }
      const waited = Date.now() - waitedFrom;
      if (waited > LOCK_TIMEOUT_MS) {
        const why = owner && Date.now() - new Date(owner.startedAt).getTime() > 30 * 60 * 1000 ? "已经跑了 30 分钟以上，多半是卡死" : "仍在构建";
        stealLock(owner, why);
        continue;
      }
      if (Date.now() - lastNotice > 10_000) {
        lastNotice = Date.now();
        log(`等 ${owner?.session ?? "?"} 的构建，已 ${Math.round(waited / 1000)}s…`);
      }
      sleepSync(POLL_MS);
    }
  }
}

function sleepSync(ms) {
  const shared = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(shared), 0, 0, ms);
}

/* ---------------- 2. 构建 ---------------- */

function gitHead() {
  const r = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8", shell: true });
  return r.status === 0 ? r.stdout.trim() : null;
}

/* ---------------- 3. 联接与清理 ---------------- */

/**
 * 只删联接本身，绝不递归进目标（`rm -r` 一个 junction 会把产物一起删掉）。
 * 用 Node 原生 syscall：junction 在 libuv 里按符号链接处理，unlink/rmdir 都不跟随目标。
 */
function removeLink(p) {
  const st = fs.lstatSync(p);
  if (!st.isSymbolicLink() && st.isDirectory()) {
    // 真实目录：非空时 rmdirSync 会失败，那正是我们要的安全失败
    fs.rmdirSync(p);
    return;
  }
  try {
    fs.unlinkSync(p);
  } catch (e) {
    if (e.code !== "EPERM") throw e;
    fs.rmdirSync(p); // junction 走这条
  }
}

/**
 * junction 用 fs.symlinkSync(..., "junction")：libuv 直接建重解析点，
 * 不需要管理员权限（真符号链接需要），也不经过 `cmd /c mklink` —— 后者会被
 * 仓库路径里的空格咬掉（实测报「命令语法不正确」）。
 */
function repointLink(targetDir) {
  if (fs.existsSync(LINK_PATH) || fs.lstatSync(LINK_PATH, { throwIfNoEntry: false })) removeLink(LINK_PATH);
  fs.symlinkSync(targetDir, LINK_PATH, "junction");
  if (!fs.existsSync(path.join(LINK_PATH, "manifest.json"))) {
    throw new Error(`联接 ${LINK_NAME} 建好了但里面没有 manifest.json，目标：${targetDir}`);
  }
}

function pruneOldSessionDirs(keepDir) {
  // 必须严格匹配 `dist-<本会话>-<三段版本号>`。只用 startsWith(`dist-${sessionTag}-`) 会误删
  // 别人的目录 —— 本仓同时存在 `dist-qoder-0.22.22` 和 `dist-qoder-review-0.22.8`，
  // 后者是另一个会话（tag = qoder-review），不是本会话的旧快照。
  const ownDir = new RegExp(`^dist-${sessionTag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-\\d+\\.\\d+\\.\\d+$`);
  let removed = 0;
  for (const name of fs.readdirSync(ROOT)) {
    if (!ownDir.test(name)) continue;
    const full = path.join(ROOT, name);
    if (!fs.statSync(full).isDirectory()) continue;
    if (path.resolve(full) === path.resolve(keepDir)) continue;
    // 同名会话可能同时在跑两路（都用 `qoder` 这种标识），半小时内有动过的不碰
    if (Date.now() - fs.statSync(full).mtimeMs < 30 * 60 * 1000) {
      log(`保留 ${name}：30 分钟内动过，可能是同会话的另一路`);
      continue;
    }
    fs.rmSync(full, { recursive: true, force: true });
    removed++;
  }
  return removed;
}

/* ---------------- 主流程 ---------------- */

const args = process.argv.slice(2);
// CI 直接跑 `pnpm exec wxt zip`，不经过本脚本；--wxt-cmd 只给本地 `pnpm zip` 用。
const cmdIdx = args.findIndex((a) => a.startsWith("--wxt-cmd="));
const wxtCmd = cmdIdx >= 0 ? args.splice(cmdIdx, 1)[0].slice("--wxt-cmd=".length) : "build";

/**
 * 直接 spawn wxt 的入口，不走 `pnpm exec`：本机的 pnpm 分发器是坏的
 * （报 `'...\pnpm\12.8.1\bin\..\node_modules\pnpm\pnpm' 不是内部或外部命令`），
 * 让构建脚本依赖它等于把构建也一起弄坏。等价于 pnpm exec 做的事。
 */
function runWxt() {
  // outDir 由 wxt.config.ts 读 PTD_SESSION 决定，所以这里要把推导出来的会话名传下去
  // （本地裸 build 时环境里本来没有这个变量，不传就会构建到 .output 去，联接也就指错了地方）。
  const env = { ...process.env, PTD_SESSION: sessionTag };
  const bin = path.join(ROOT, "node_modules", "wxt", "bin", "wxt.mjs");
  if (fs.existsSync(bin)) {
    return spawnSync(process.execPath, [bin, wxtCmd, ...args], { cwd: ROOT, stdio: "inherit", env });
  }
  return spawnSync("pnpm", ["exec", "wxt", wxtCmd, ...args], { cwd: ROOT, stdio: "inherit", shell: true, env });
}

const release = acquireLock();
let code = 1;
try {
  if (sessionTag && !rawSession) {
    log(`未设 PTD_SESSION，按 ${sessionTag} 构建（要复现 CI 那条 .output 路径就 CI=true pnpm build）`);
  }
  const r = runWxt();
  code = r.status ?? 1;
  if (code !== 0) {
    console.error(`[build-verify] 构建失败（退出码 ${code}），不动联接、不清理旧目录`);
  } else if (!sessionTag) {
    log("CI 路径：按 WXT 默认的 .output 构建（取包靠 .output/*.zip），跳过联接与清理");
  } else {
    const outRoot = path.join(ROOT, `dist-${sessionTag}-${pkgVersion}`);
    const loaded = path.join(outRoot, "chrome-mv3");
    if (!fs.existsSync(path.join(loaded, "manifest.json"))) {
      throw new Error(`构建说成功了，但 ${path.relative(ROOT, loaded)}\\manifest.json 不在 —— 检查 outDir 配置`);
    }
    fs.writeFileSync(
      // 写进 chrome-mv3 里面，用户顺着 dist-verify 就能直接打开它看是哪份。
      // 发布用的 zip 由 `wxt zip` 在本脚本之前产出、CI 也不走本脚本，所以不会混进包。
      path.join(loaded, "BUILDINFO.json"),
      JSON.stringify({ version: pkgVersion, session: sessionTag, gitHead: gitHead(), builtAt: new Date().toISOString(), args }, null, 2) + "\n",
    );
    repointLink(loaded);
    const removed = pruneOldSessionDirs(outRoot);
    log(`已换指 ${LINK_NAME} → dist-${sessionTag}-${pkgVersion}/chrome-mv3${removed ? `，清掉 ${removed} 个本会话旧快照` : ""}`);
    // 下面两行就是 AGENTS §2.2 要求报给用户的内容，直接抄。
    // 报的是联接而不是真身：真身目录会被下一次同会话构建的 pruneOldSessionDirs 删掉，
    // 用户若照真身路径去 Chrome 加载，扩展会在那一刻变成「找不到 manifest」。
    // 真身路径上面那行「已换指」里已经有，要排查时顺着它看即可。
    log(`验收加载路径：${LINK_PATH}`);
    log(`版本号：v${pkgVersion}`);
  }
} finally {
  release();
}
process.exit(code);
