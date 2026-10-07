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
 *   ④ 提交正文里的 `- ` 明细（缩进成子列表）
 *
 * ④ 是 2026-10-06 补的：之前只取 `%s`（首行），于是「一次提交打包多件事」的
 * 版本在 Release 页只剩一行标题 —— v0.28.0 实到 12 条明细，页面只显示 1 条。
 * 正文没有 bullet 的提交（绝大多数）输出完全不变。
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
 *   REPO_URL         显式指定仓库根地址（默认读 origin remote，再兜底本仓库）
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

const execFileAsync = promisify(execFile);
const cwd = process.cwd();

async function git(...args) {
  const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 16 * 1024 * 1024 });
  return stdout;
}

/**
 * 取「上一个 release tag」，用来算本次更新内容的范围。
 *
 * ⚠️ 这里必须取 **HEAD 的祖先里最近的那个 tag**，不能取「全局版本号最大的 tag」。
 * 两者在版本号单调递增时碰巧一致，但只要存在下面任一情况就会算错：
 *   · 孤儿 tag（指向已被 force push 淘汰的旧历史）
 *   · 版本号与推送顺序不一致（回填历史版本、手工改号）
 * 那样选出来的 tag 与 HEAD 没有共同祖先，`git log <tag>..HEAD` 会把整条历史
 * 算成本次更新 —— 表现就是「本次更新里混着上一个版本的内容，范围也显示成
 * 一个不相干的版本号」。
 *
 * 用 `git describe --tags --abbrev=0 HEAD^`：
 *   --tags   兼容 lightweight tag（本仓库的 tag 都是 lightweight）
 *   HEAD^    排除自己 —— release 正在创建时 HEAD 上已经打好同名 tag 了，
 *            不排除会把自己当成「上一个」。
 */
async function findPrevTag() {
  if (process.env.PREV_TAG) return process.env.PREV_TAG.trim();
  try {
    const d = await git("describe", "--tags", "--abbrev=0", "HEAD^");
    return d.trim();
  } catch {
    // 首个提交没有 HEAD^，git describe 以非零码退出。
    // 注意这里必须吃掉异常而不是让它冒出去：execFileAsync 在非零退出时是**抛异常**
    // （不像 spawnSync 返回 null），漏掉就会让整个 release job 挂掉 —— 表现为
    // 首个版本既没有 tag 也没有 Release。首次发布没有「上一个 tag」是正常情况。
    return "";
  }
}

/**
 * 取仓库根地址，用于把短 hash 拼成可点的 commit 链接。
 * 优先 REPO_URL，其次 origin remote（兼容 git@github.com:o/r.git 与 https 两种写法），
 * 最后兜底本仓库硬编码地址。
 */
async function findRepoBaseUrl() {
  if (process.env.REPO_URL) return process.env.REPO_URL.trim().replace(/\/+$/, "");
  try {
    const remote = (await git("config", "--get", "remote.origin.url")).trim();
    const m = remote.match(/([^/:]+\/[^/]+?)(?:\.git)?$/);
    if (m) return `https://github.com/${m[1]}`;
  } catch {
    // 没有 origin（浅克隆/离线）时走兜底
  }
  return "https://github.com/qimengcheng/PT-Assistant";
}

let prevTag = await findPrevTag();
const repoBaseUrl = await findRepoBaseUrl();
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

// 有 tag 则取 tag..HEAD；没有 tag（首次发布）则取最近 N 条。
//
// 首次发布**不能**退回 `HEAD~N..HEAD`：首个提交没有 HEAD~N，git log 直接失败，
// 结果整份更新内容是空的。用 --max-count 就没有这个依赖 —— 只有 1 条提交时取 1 条，
// 正好把这个版本本身列出来。
//
// 记录之间用 `%x1e`（RS）分隔而不是靠默认换行：`%b` 是整段正文、自带换行，
// 用换行当记录边界会把一条提交拆成好几行。字段之间仍是 `%x1f`（US）。
const logArgs = prevTag
  ? ["log", `${prevTag}..HEAD`, "--no-merges", "--pretty=format:%h%x1f%s%x1f%b%x1e"]
  : ["log", `--max-count=${fallbackCount}`, "HEAD", "--no-merges", "--pretty=format:%h%x1f%s%x1f%b%x1e"];

let subjects = [];
try {
  subjects = (await git(...logArgs))
    .split("\x1e")
    .map((rec) => rec.replace(/^\s+/, "").trim())
    .filter(Boolean);
} catch (e) {
  console.error(`读取提交列表失败：${e.message}`);
}

/**
 * 把 `[agent]-[model] vX.Y.Z 描述` 拆成 { agent, version, desc, sha, details }；不匹配就整条当描述。
 *
 * desc 只取**第一句**：本仓库的提交标题里习惯把详细说明也写进去
 * （「…合并成单条流水线。① 版本升级：…② 合并：…」），
 * 整段搬进 Release 页面会没法读，遇到句号/分号即截断，硬上限 100 字符。
 */
function parse(record) {
  const [sha = "", raw = "", body = ""] = record.split("\x1f");
  const m = raw.match(/^\[([^\]]+)\]-\[[^\]]+\]\s*(v[\d.]+)\s*(.*)$/);
  const details = parseDetails(body);
  if (!m) return { agent: "其他", version: "", desc: shorten(raw), sha, details };
  return { agent: m[1].trim(), version: m[2], desc: shorten((m[3] || "").trim()), sha, details };
}

/**
 * 正文里以 `- ` / `* ` 开头的行才算明细；其它段落（背景说明、长句叙述）不进 Release，
 * 否则正文一长就把列表淹了。`#` 开头跳过，防 git 注释行漏进来。
 *
 * ⚠️ 必须把**续行并回上一条**：commit 正文里一条 bullet 常常写满 80 列再折行，
 * 只认 `- ` 开头那半句的话，输出会在句子中间被截掉（实测「……取到空快照」整段丢失）。
 */
function parseDetails(body) {
  const merged = [];
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (/^[-*]\s+\S/.test(line)) {
      merged.push(line.replace(/^[-*]\s+/, ""));
    } else if (merged.length > 0) {
      // 续行：只在上一条 bullet 还没写完时并入，正文首段的散句一律忽略。
      // 两端都是中日韩字符就不补空格 —— 中文正文折行处本来没有空格，
      // 硬加一个会在词中间留缝（实测「永久钉成 空白」）。
      const prev = merged[merged.length - 1];
      // 区间要含全角标点（，。（ U+FF00–U+FFEF）与 CJK 符号（U+3000–U+303F）：
      // 只写 \u4e00-\u9fff 的话「…两份同改），\n圆角…」这种断点会补出一个多余空格。
      const isCjkEdge = (ch) =>
        /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/u.test(ch);
      const joiner = isCjkEdge(prev.slice(-1)) && isCjkEdge(line[0]) ? "" : " ";
      merged[merged.length - 1] = prev + joiner + line;
    }
  }
  return merged.map((line) => shorten(line, 160)).filter(Boolean);
}

function shorten(text, max = 100) {
  if (!text) return "";
  const stop = text.search(/[。；;]/);
  let s = stop > 0 ? text.slice(0, stop) : text;
  if (s.length > max) s = s.slice(0, max).trimEnd() + "…";
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
      // 短 hash 渲染成「可点的代码片」：[`4022b76`](…/commit/4022b76)，
      // GitHub 上仍是灰底等宽样式，但能直接跳进该次提交（纯反引号代码片不可点）。
      out.push(`- ${it.desc} [\`${it.sha.slice(0, 7)}\`](${repoBaseUrl}/commit/${it.sha})`);
      for (const detail of it.details) out.push(`  - ${detail}`);
    }
    out.push("");
  }
}

// 附上产物信息，方便在 Release 页直接确认下的是哪个包。
//
// ⚠️ 只在**确实构建了产物**时才列。早期阶段（仓库里有 .ci/early 标记）CI 的 build
// job 是整个跳过的，压根没有 zip —— 但这段是无条件 push 的，于是 Release 页会列出
// 三个根本不存在的下载项，点进去 404。
const isEarlyStage = fs.existsSync(path.join(process.cwd(), ".ci", "early"));
if (!isEarlyStage) {
  out.push("---");
  out.push("");
  out.push(`**产物**（\`v${version}\`）`);
  out.push("");
  out.push(`- \`PT-Assistant-${version}-chrome.zip\` —— Chrome / Edge 扩展`);
  out.push(`- \`PT-Assistant-${version}-firefox.zip\` —— Firefox 扩展`);
  out.push(`- \`PT-Assistant-${version}-sources.zip\` —— 源码包（Firefox Add-ons 审核必需）`);
} else {
  out.push("---");
  out.push("");
  out.push("> 本次为早期阶段（工程化体系建立之前），未构建产物。");
}

const text = out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";

const outFile = process.argv[2];
if (outFile) {
  fs.writeFileSync(outFile, text, "utf8");
  console.error(`已写入 ${outFile}（${items.length} 条提交，${groups.size} 个 agent）`);
} else {
  process.stdout.write(text);
}
