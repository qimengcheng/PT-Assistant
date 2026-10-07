/**
 * 守首页「最近更新」那份快照：它是**累积档案**，不是「最近 N 条」的滚动窗口。
 *
 * 为什么要脚本守：这份文案由会话逐条手写（AGENTS.md §3.7），而写它的会话看不到前面的
 * 会话写了什么 —— v0.29.1 到 v0.31.0 这五轮里，每轮都按当时那句「条数建议 6~9 版」
 * 把最旧的一条裁掉，五天丢了 5 条。丢了就只能凭提交主题重写成一段新文案，
 * 原文措辞永久回不来。2026-10-07 用户改成「历史的都要有，每次只处理新出的」。
 *
 * 三条判据，都不需要构建产物：
 *  1. 形状 —— 版本号 / 时间是 `YYYY-MM-DD HH:mm:ss` 全长时间戳 / 每桶至少一句话 /
 *     totals 不小于数组长度（界面按差值显示「另有 N 条未列出」）/ 从新到旧排 / 版本号不重。
 *  2. 不许删、不许改时间 —— 与 HEAD 里那一份比：版本号少一个就 FAIL；同一版本号的
 *     date 有任何改动也 FAIL（时间是那次提交的事实，不是措辞，重写文案不许顺手挪它）。
 *  3. 时间得是真的 —— 每个条目的 date 必须等于该版本号那条提交的本地时间。
 *     防的是凭印象写个「2 天前」上去。
 *
 * 第 3 条在浅克隆里自动降级：CI 的 build job 是默认 depth 1，只看得见 tip 那条，
 * 于是只核对得上一条，其余跳过并打印核对了几条，不会假报错。
 *
 * 自带 `--selftest`：把上面每条判据各注入一次必失败的写法，确认脚本真会 FAIL ——
 * 判据是纯函数（judge(doc, ctx)），所以注入全程在内存里做，**不碰工作区那份文件**。
 * 改判据前必须先跑它（这个仓库的守卫已经错过两回「判据被注释里的反例喂成假 PASS」）。
 *
 * 用法：
 *   node scripts/check-recent-updates.mjs              # 查工作区那份
 *   node scripts/check-recent-updates.mjs --selftest   # 先验判据自己还灵不灵
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const SNAPSHOT = "src/options/data/recentUpdates.json";
const DATE_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const VERSION_RE = /^\d+\.\d+\.\d+$/;

function cmpVersion(a, b) {
  const A = String(a).split(".").map(Number);
  const B = String(b).split(".").map(Number);
  return A[0] - B[0] || A[1] - B[1] || A[2] - B[2];
}

/**
 * 全部判据都在这里：只吃数据，不读盘、不调 git，所以 --selftest 能在内存里注入畸形。
 * ctx = { headEntries, commitDate, pkgVersion }，三者拿不到时传空数组 / 空 Map / null，
 * 对应的判据自然跳过。
 */
export function judge(doc, ctx) {
  const problems = [];
  const stats = { count: 0, first: "-", last: "-", verified: 0 };
  const { headEntries = [], commitDate = new Map(), pkgVersion = null } = ctx ?? {};

  if (!doc || typeof doc !== "object") {
    return { problems: ["顶层不是对象"], stats };
  }
  if (!/^[0-9a-f]{7,40}$/.test(String(doc.headSha ?? ""))) {
    problems.push(`headSha 要的是 7~40 位十六进制提交号，现在是 ${JSON.stringify(doc.headSha)}`);
  }
  if (!DATE_RE.test(String(doc.generatedAt ?? ""))) {
    problems.push(
      `generatedAt 要的是完整时间戳 YYYY-MM-DD HH:mm:ss，现在是 ${JSON.stringify(doc.generatedAt)}`,
    );
  }
  if (!Array.isArray(doc.versions) || doc.versions.length === 0) {
    problems.push("versions 必须是非空数组");
    return { problems, stats };
  }

  const entries = doc.versions;
  const seen = new Map();
  for (const [i, u] of entries.entries()) {
    const at = `versions[${i}]${u && u.version ? ` (v${u.version})` : ""}`;
    if (!u || typeof u !== "object") {
      problems.push(`${at} 不是对象`);
      continue;
    }
    if (!VERSION_RE.test(String(u.version ?? ""))) {
      problems.push(`${at} 的 version 不是 X.Y.Z`);
      continue;
    }
    if (seen.has(u.version)) {
      problems.push(`${at} 版本号重复（v${u.version} 已出现在 versions[${seen.get(u.version)}]）`);
    } else {
      seen.set(u.version, i);
    }
    if (!DATE_RE.test(String(u.date ?? ""))) {
      problems.push(
        `${at} 的 date 要的是完整时间戳 YYYY-MM-DD HH:mm:ss（只有年月日不够），现在是 ${JSON.stringify(u.date)}`,
      );
    }
    for (const bucket of ["added", "improved"]) {
      const lines = u[bucket];
      if (!Array.isArray(lines)) {
        problems.push(`${at} 的 ${bucket} 不是数组`);
        continue;
      }
      lines.forEach((line, j) => {
        if (typeof line !== "string" || !line.trim()) problems.push(`${at} 的 ${bucket}[${j}] 是空句子`);
      });
    }
    for (const [bucket, total] of [
      ["added", "addedTotal"],
      ["improved", "improvedTotal"],
    ]) {
      const n = Array.isArray(u[bucket]) ? u[bucket].length : 0;
      if (typeof u[total] !== "number" || Number.isNaN(u[total])) {
        problems.push(`${at} 的 ${total} 不是数字`);
      } else if (u[total] < n) {
        problems.push(`${at} 的 ${total}(${u[total]}) 小于 ${bucket} 的条数(${n})，界面会算出「另有 -N 条未列出」`);
      }
    }
    const hasLine =
      (Array.isArray(u.added) && u.added.length > 0) || (Array.isArray(u.improved) && u.improved.length > 0);
    if (!hasLine) problems.push(`${at} 一句话都没有，界面上会是个只有版本号的空块`);
  }

  const list = entries.map((u) => String(u.version)).filter((v) => VERSION_RE.test(v));
  if (!list.every((v, i) => i === 0 || cmpVersion(list[i - 1], v) > 0)) {
    problems.push("versions 必须按版本号从新到旧排（界面直接按这个顺序渲染）");
  }
  if (pkgVersion && VERSION_RE.test(list[0] ?? "")) {
    if (cmpVersion(list[0], pkgVersion) > 0) {
      problems.push(`最新一条是 v${list[0]}，比 package.json 的 v${pkgVersion} 还新 —— 那个版本还不存在`);
    }
  }

  // —— 不许删 / 不许改时间：与 HEAD 那份比 ——
  const mine = new Map(entries.map((u) => [String(u.version), u]));
  for (const h of headEntries) {
    const v = String(h.version);
    if (!mine.has(v)) {
      problems.push(
        `v${v} 在 HEAD 的那份里有一条，现在没了 —— 这份是累积档案，只能往前加、不许裁（AGENTS.md §3.7）`,
      );
      continue;
    }
    if (h.date && String(mine.get(v).date) !== String(h.date)) {
      problems.push(
        `v${v} 的 date 被改了：HEAD 里是 ${h.date}，现在写成 ${mine.get(v).date} —— 时间是那次提交的事实，改措辞不许动它`,
      );
    }
  }

  // —— 时间得对得上提交 ——
  let verified = 0;
  for (const u of entries) {
    const real = commitDate.get(String(u.version));
    if (real === undefined) continue;
    verified++;
    if (u.date !== real) {
      problems.push(`v${u.version} 的 date 写成 ${u.date}，可那次提交是 ${real} —— 时间从 git log 取，不要凭印象`);
    }
  }

  return { problems, stats: { count: entries.length, first: list[0], last: list.at(-1), verified } };
}

/* ============================ 采集 ============================ */

/** 与 git 无关的失败一律降级成「跳过这条判据」，不能因为环境判不出就当错 */
function git(args) {
  try {
    return execFileSync("git", args, {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

function collectCtx() {
  const notes = [];
  const headEntries = [];
  const headRaw = git(["show", `HEAD:${SNAPSHOT}`]);
  if (headRaw === null) {
    notes.push("读不到 HEAD 里的那份（无 git 或该路径尚未提交）→ 跳过「不许删」比对");
  } else {
    try {
      const headDoc = JSON.parse(headRaw);
      if (Array.isArray(headDoc.versions)) headEntries.push(...headDoc.versions);
    } catch {
      notes.push(`HEAD 里的那份不是合法 JSON → 跳过「不许删」比对`);
    }
  }

  const commitDate = new Map();
  const log = git(["log", "-z", "--reverse", "--date=iso-local", "--format=%ad\x1f%s"]);
  if (log === null) {
    notes.push("git log 不可用 → 跳过时间核对");
  } else {
    for (const rec of log.split("\0")) {
      if (!rec) continue;
      const [ad, subject = ""] = rec.split("\x1f");
      const m = /(?:^|\])\s*v?(\d+\.\d+\.\d+)\b/.exec(subject);
      if (m && !commitDate.has(m[1])) commitDate.set(m[1], ad.replace(/ [+-]\d{4}$/, ""));
    }
    if (commitDate.size === 0) notes.push("这次克隆里没有带版本号的提交（浅克隆 depth 1 就是这样）→ 时间核对自动降级");
  }

  let pkgVersion = null;
  try {
    pkgVersion = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version ?? null;
  } catch {
    notes.push("读不到 package.json → 跳过「最新一条不比现版本新」");
  }

  return { ctx: { headEntries, commitDate, pkgVersion }, notes };
}

/* ============================ selftest ======================= */

function selftest(doc, ctx) {
  const clone = () => JSON.parse(JSON.stringify(doc));
  const headVersions = ctx.headEntries.map((v) => String(v.version));
  const cases = [];

  const expect = (name, mutate, want) => cases.push({ name, mutate, want });

  expect("原样必须 PASS", (d) => d, null);

  if (headVersions.length) {
    expect(
      `裁掉 HEAD 里有的一条（v${headVersions.at(-1)}）`,
      (d) => {
        d.versions = d.versions.filter((v) => v.version !== headVersions.at(-1));
      },
      "累积档案",
    );
    expect(
      "整批丢掉 HEAD 里最前面那几条",
      (d) => {
        // 只丢一批、不能全丢：全丢会让 versions 变空数组，被「非空」那条先短道返回，
        // 于是这条注入测的就不再是「不许删」了（v0.32.0 之后 HEAD 就是整份档案，会全丢）。
        const drop = new Set(headVersions.slice(0, 5));
        d.versions = d.versions.filter((v) => !drop.has(v.version));
      },
      "累积档案",
    );
    // 改时间必须被抓：拿 HEAD 里第一条当靶子，把它的 date 换成别的日子。
    // 判据是「与 HEAD 完全不等」，所以这一步不依赖 commitDate，浅克隆里也照样测得到。
    const first = ctx.headEntries[0];
    if (first) {
      expect(
        `改已入库条目的时间（v${first.version}）`,
        (d) => {
          const hit = d.versions.find((v) => v.version === String(first.version));
          if (hit) hit.date = "2019-01-01 09:00:00";
        },
        "被改了",
      );
    }
  }

  expect(
    "date 退化成只有年月日",
    (d) => {
      d.versions[0].date = String(d.versions[0].date).slice(0, 10);
    },
    "完整时间戳",
  );
  expect(
    "addedTotal 小于数组条数",
    (d) => {
      const u = d.versions.find((v) => (v.added ?? []).length > 0) ?? d.versions[0];
      u.addedTotal = 0;
    },
    "另有 -N",
  );
  expect(
    "顺序从旧到新",
    (d) => {
      d.versions.reverse();
    },
    "从新到旧",
  );
  expect(
    "一条空文案",
    (d) => {
      const u = d.versions[3] ?? d.versions[0];
      u.added = [];
      u.addedTotal = 0;
      u.improved = [];
      u.improvedTotal = 0;
    },
    "空块",
  );
  expect(
    "版本号重复",
    (d) => {
      d.versions.splice(2, 0, JSON.parse(JSON.stringify(d.versions[2])));
    },
    "重复",
  );
  expect(
    "最新一条比 package.json 还新",
    (d) => {
      if (!ctx.pkgVersion) return;
      d.versions.unshift({ ...JSON.parse(JSON.stringify(d.versions[0])), version: "99.0.0" });
    },
    ctx.pkgVersion ? "还不存在" : null,
  );

  let verifiedAny = 0;
  for (const u of doc.versions) {
    if (ctx.commitDate.has(String(u.version))) verifiedAny++;
  }
  if (verifiedAny) {
    expect(
      "时间对不上提交",
      (d) => {
        const hit = d.versions.find((v) => ctx.commitDate.has(String(v.version)));
        hit.date = "2020-01-01 00:00:00";
      },
      "不要凭印象",
    );
  } else {
    console.log("（selftest：这份克隆里没有可核对的提交时间，跳过「时间对不上提交」那条注入）");
  }

  let ok = 0;
  for (const c of cases) {
    const d = clone();
    c.mutate(d);
    const res = judge(d, ctx);
    const probs = res.problems ?? res;
    if (c.want === null) {
      const clean = probs.length === 0;
      if (clean) ok++;
      console.log(`${clean ? "ok  " : "FAIL"}  ${c.name} → 期望 PASS，实际 ${probs.length} 处：${probs[0] ?? ""}`);
      continue;
    }
    const hit = probs.some((p) => p.includes(c.want));
    if (hit) ok++;
    console.log(`${hit ? "ok  " : "FAIL"}  ${c.name} → exit 应有 FAIL 且命中「${c.want}」，实际 ${probs.length} 处：${probs[0] ?? ""}`);
  }
  console.log(`\n自检 ${ok}/${cases.length} 条判据按预期动作`);
  process.exit(ok === cases.length ? 0 : 1);
}

/* ============================== main ========================= */

const raw = fs.existsSync(path.join(ROOT, SNAPSHOT))
  ? fs.readFileSync(path.join(ROOT, SNAPSHOT), "utf8")
  : null;

if (raw === null) {
  console.error(`FAIL：找不到 ${SNAPSHOT}（本脚本要从仓库根跑）`);
  process.exit(1);
}

let doc;
try {
  doc = JSON.parse(raw);
} catch (e) {
  console.error(`FAIL：${SNAPSHOT} 不是合法 JSON：${e.message}`);
  process.exit(1);
}

const { ctx, notes } = collectCtx();

if (process.argv.includes("--selftest")) {
  selftest(doc, ctx);
}

const { problems, stats } = judge(doc, ctx);

for (const n of notes) console.log(`（${n}）`);
console.log(
  `条目 ${stats.count} 条，覆盖 v${stats.last} → v${stats.first}；对上提交时间的 ${stats.verified} 条`,
);

if (problems.length) {
  console.error(`\nFAIL：${problems.length} 处`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log("\nPASS：形状、时间戳、累积不删、与提交时间都对得上。");
