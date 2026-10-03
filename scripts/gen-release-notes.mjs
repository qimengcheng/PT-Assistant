/**
 * 生成 Release 更新内容（release notes）。
 *
 * 为什么不靠 GitHub 的 `generateReleaseNotes`：那是按 PR 自动拼的，
 * 本仓库的提交是「[agent]-[model] vX.Y.Z 描述」这种格式，自动拼出来的东西
 * 既冗长又缺「这次到底改了什么」的归纳。
 *
 * 做法：取「上一个 release tag → HEAD」之间的提交，解析出
 *   ① 哪个 agent 做的（用于分组，多个 agent 并行时能一眼看出各自负责什么）
 *   ② 版本号
 *   ③ 描述（去掉 [agent]-[model] vX.Y.Z 前缀后的部分）
 *
 * ⚠️ 全部走**异步** spawn：本机 `spawnSync` / `execFileSync` 对任何可执行文件都返回
 *    EBUSY（连 git.exe 自己也起不来），同步 API 在这里一律不可用。
 *
 * 用法：
 *   node scripts/gen-release-notes.mjs                # 打印到 stdout
 *   node scripts/gen-release-notes.mjs out.md         # 写入文件
 * 环境变量：
 *   PREV_TAG         显式指定起始 tag（默认自动找最大的 v* tag）
 *   FALLBACK_COUNT   没有 tag 时回溯多少条提交（默认 20）
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";

const execFileAsync = promisify(execFile);
const cwd = process.cwd();

async function git(...args) {
  const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 16 * 1024 * 1024 });
  return stdout;
}

/** 取上一个 release tag：按版本号倒序的第一个 vX.Y.Z */
async function findPrevTag() {
  if (process.env.PREV_TAG) return process.env.PREV_TAG.trim();
  const tags = (await git("tag", "--sort=-v:refname", "-l", "v[0-9]*")).trim();
  return tags.split("\n")[0] || "";
}

let prevTag = await findPrevTag();
const fallbackCount = process.env.FALLBACK_COUNT || "20";

// tag 必须真的存在（首次发布时仓库里一个 tag 都没有，或 PREV_TAG 写错），
// 否则 git log <tag>..HEAD 会失败、结果静默变成「本次没有提交」。
if (prevTag) {
  try {
    await git("rev-parse", "--verify", `${prevTag}^{commit}`);
  } catch {
    console.error(`起始 ref「${prevTag}」不存在，回退为「最近 ${fallbackCount} 条提交」`);
    prevTag = "";
  }
}

// 没有 tag（首次发布）时回溯最近 N 条；有 tag 则取 tag..HEAD
const range = prevTag ? `${prevTag}..HEAD` : `HEAD~${fallbackCount}..HEAD`;

let subjects = [];
try {
  subjects = (await git("log", range, "--no-merges", "--pretty=format:%h%x1f%s"))
    .split("\n")
    .filter(Boolean);
} catch (e) {
  console.error(`读取 ${range} 失败：${e.message}`);
}

/**
 * 把 `[agent]-[model] vX.Y.Z 描述` 拆成 { agent, version, desc, sha }；不匹配就整条当描述。
 *
 * desc 只取**第一句**：本仓库的提交标题里习惯把详细说明也写进去
 * （「…合并成单条流水线。① 版本升级：…② 合并：…」），
 * 整段搬进 Release 页面会没法读，遇到句号/分号即截断，硬上限 100 字符。
 */
function parse(line) {
  const sep = line.indexOf("\x1f");
  const sha = line.slice(0, sep);
  const raw = line.slice(sep + 1);
  const m = raw.match(/^\[([^\]]+)\]-\[[^\]]+\]\s*(v[\d.]+)\s*(.*)$/);
  if (!m) return { agent: "其他", version: "", desc: shorten(raw), sha };
  return { agent: m[1].trim(), version: m[2], desc: shorten((m[3] || "").trim()), sha };
}

function shorten(text) {
  if (!text) return "";
  const stop = text.search(/[。；;]/);
  let s = stop > 0 ? text.slice(0, stop) : text;
  if (s.length > 100) s = s.slice(0, 100).trimEnd() + "…";
  return s;
}

const items = subjects.map(parse);

// 按 agent 分组，组内保持时间倒序（git log 本身就是倒序）
const groups = new Map();
for (const it of items) {
  if (!it.desc) continue; // 只有版本号没有描述的（如空提交）跳过
  if (!groups.has(it.agent)) groups.set(it.agent, []);
  groups.get(it.agent).push(it);
}

const version = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
const out = [];

out.push(`## 更新内容`);
out.push("");
out.push(prevTag ? `范围：\`${prevTag}\` → \`v${version}\`` : `范围：最近 ${fallbackCount} 条提交（首次发布，尚无上一个 tag）`);
out.push("");

if (groups.size === 0) {
  out.push("_本次发布没有可归纳的提交。_");
} else {
  for (const [agent, list] of groups) {
    out.push(`### ${agent}`);
    out.push("");
    for (const it of list) {
      out.push(`- ${it.desc} \`${it.sha.slice(0, 7)}\``);
    }
    out.push("");
  }
}

// 附上产物信息，方便在 Release 页直接确认下的是哪个包
out.push("---");
out.push("");
out.push(`**产物**（\`v${version}\`）`);
out.push("");
out.push(`- \`PT-Assistant-${version}-chrome.zip\` —— Chrome / Edge 扩展`);
out.push(`- \`PT-Assistant-${version}-firefox.zip\` —— Firefox 扩展`);
out.push(`- \`PT-Assistant-${version}-sources.zip\` —— 源码包（Firefox Add-ons 审核必需）`);

const text = out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";

const outFile = process.argv[2];
if (outFile) {
  fs.writeFileSync(outFile, text, "utf8");
  console.error(`已写入 ${outFile}（${items.length} 条提交，${groups.size} 个 agent）`);
} else {
  process.stdout.write(text);
}
