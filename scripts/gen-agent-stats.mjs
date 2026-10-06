#!/usr/bin/env node
/**
 * 从 git 提交历史生成「特别感谢」页的贡献量快照 src/options/data/agentStats.json。
 *
 * 为什么是快照而不是构建期现算：CI 的 build job 用 actions/checkout 默认 fetch-depth: 1，
 * 构建期跑 `git log` 只会看到 1 条提交，CI 出的包里榜单会是空的。
 * 所以数据在本地算好、随代码入库；提交历史变了就重跑本脚本。
 *
 *   node scripts/gen-agent-stats.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "src", "options", "data", "agentStats.json");

/**
 * 「批量/生成内容」的判定口径：这些路径的行是平移与安装产物，不是某个智能体写的代码。
 * 早期骨架一次就 +79381 行（340 个站点定义 + lockfile 等），全算进去榜单会被搬运量支配。
 * packages/** 整个是旧版零修改平移过来的（见 AGENTS.md §0），所以整片算批量；
 * 代价是后来在 packages 里的真改动也不进「手写」列。口径只在这一处定义，改这里等于改
 * 页面上所有「代码量」的含义（收紧到只排 definitions 时，WorkBuddy 手写从 22,585 涨回 41,658）。
 */
function isBulk(file) {
  return (
    file === "pnpm-lock.yaml" ||
    file.endsWith("-lock.yaml") ||
    file === "package-lock.json" ||
    file.startsWith("public/") ||
    file.startsWith("packages/")
  );
}

/**
 * 同一家模型被逐字照抄成几种写法（提交时写错的，负责人已确认都指同一个模型），
 * 不归一会虚出多行。Space Bunny 家族历史上出现过 4 种字面，一律归到 "Space Bunny"。
 */
const familyOf = (literal) =>
  /^space[ _-]?bunny\b/i.test(literal) ? "Space Bunny" : literal;

/**
 * 「模型平台 / 路由」的归属。git 前缀里只有 [智能体]-[模型]，**没有任何平台信息**，
 * 这一段完全按项目负责人给的口径写死：
 *  - Space Bunny 中除 WorkBuddy 自己那部分以外，实际都是经 OpenRouter 调用的；
 *  - 其中写成 "Space Bunny Free" 的那条，其实是 OpenCode 的 ZEN。
 * 这是**加记不是转移**：模型栏仍按模型本身统计，平台栏把同一批提交再记一次，
 * 所以平台栏的合计量不算进 totals，页面上也不该两栏相加。
 */
function platformOf(commit) {
  if (commit.model !== "Space Bunny") return null;
  if (commit.modelLiteral === "Space Bunny Free") return "ZEN";
  if (commit.agent === "WorkBuddy") return null;
  return "OpenRouter";
}

/**
 * 类型词是**可选**的：历史里有 `[X]-[Y] v0.16.4` 这种只到版本号就收尾的提交；
 * BOM 也要先剥 —— 真有一条 `﻿[DeepSeek Harness]-…` 带 U+FEFF 开头，
 * 早先判据写成 `\[[^\]]+\]-\[` 加 `^\[` 就会把它整条静默丢掉（131 条只认出 129 条）。
 */
const SUBJECT_RE = /^[\s\uFEFF]*\[([^\]]+)\]-\[([^\]]+)\]\s+v?(\d+\.\d+\.\d+)(?:\s+(\S+))?/;

const cmpVersion = (a, b) => {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2];
};

const git = (args) =>
  execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });

function parseCommits() {
  const raw = git(["log", "--no-merges", "--date=short", "--numstat", "--format=@@%h|%ad|%s"]);
  const list = [];
  let cur = null;

  for (const line of raw.split("\n")) {
    if (line.startsWith("@@")) {
      const body = line.slice(2);
      const i1 = body.indexOf("|");
      const i2 = body.indexOf("|", i1 + 1);
      const subject = body.slice(i2 + 1);
      const hit = SUBJECT_RE.exec(subject);
      cur = {
        hash: body.slice(0, i1),
        date: body.slice(i1 + 1, i2),
        subject,
        agent: hit?.[1]?.trim() ?? null,
        modelLiteral: hit?.[2]?.trim() ?? null,
        model: hit ? familyOf(hit[2].trim()) : null,
        version: hit?.[3] ?? null,
        type: hit?.[4]?.replace(/[：:]$/, "") ?? null,
        handAdd: 0,
        handDel: 0,
        bulkAdd: 0,
      };
      list.push(cur);
      continue;
    }
    if (!cur) continue;
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
    if (!m) continue;
    const add = m[1] === "-" ? 0 : Number(m[1]);
    const del = m[2] === "-" ? 0 : Number(m[2]);
    if (isBulk(m[3])) cur.bulkAdd += add;
    else {
      cur.handAdd += add;
      cur.handDel += del;
    }
  }
  return list;
}

/**
 * 按 pickKey 归组累计；partnerKey 提供对侧标签用的名字
 * （智能体记模型、模型与平台记智能体）。
 */
function collect(commits, pickKey, partnerKey) {
  const rows = new Map();
  for (const c of commits) {
    const key = pickKey(c);
    if (!key) continue;
    if (!rows.has(key)) {
      rows.set(key, {
        commits: 0,
        feat: 0,
        handAdd: 0,
        handDel: 0,
        bulkAdd: 0,
        firstDate: "9999-12-31",
        lastDate: "",
        versions: new Set(),
        partners: new Map(),
      });
    }
    const row = rows.get(key);
    row.commits += 1;
    if (c.type && /^feat/i.test(c.type)) row.feat += 1;
    row.handAdd += c.handAdd;
    row.handDel += c.handDel;
    row.bulkAdd += c.bulkAdd;
    if (c.date < row.firstDate) row.firstDate = c.date;
    if (c.date > row.lastDate) row.lastDate = c.date;
    if (c.version) row.versions.add(c.version);
    const partner = partnerKey(c);
    if (partner) row.partners.set(partner, (row.partners.get(partner) ?? 0) + 1);
  }

  return [...rows.entries()]
    .sort((a, b) => b[1].commits - a[1].commits || b[1].handAdd - a[1].handAdd)
    .map(([name, r]) => {
      const versions = [...r.versions].sort(cmpVersion);
      return {
        name,
        commits: r.commits,
        feat: r.feat,
        handAdd: r.handAdd,
        handDel: r.handDel,
        bulkAdd: r.bulkAdd,
        firstDate: r.firstDate,
        lastDate: r.lastDate,
        versionFrom: versions[0] ?? "",
        versionTo: versions[versions.length - 1] ?? "",
        partners: [...r.partners.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([partnerName, count]) => ({ name: partnerName, count })),
      };
    });
}

const commits = parseCommits();

const agents = collect(commits, (c) => c.agent, (c) => c.model);
const models = collect(commits, (c) => c.model, (c) => c.agent);
const platforms = collect(commits, platformOf, (c) => c.agent);

// 认不出前缀的提交不会进榜单 —— 打印出来，免得再出现「131 条只认出 129 条」那种静默丢数
const unmatched = commits.filter((c) => !c.agent);

const totals = commits.reduce(
  (acc, c) => {
    acc.commits += 1;
    if (c.agent) acc.matched += 1;
    if (c.type && /^feat/i.test(c.type)) acc.feat += 1;
    acc.handAdd += c.handAdd;
    acc.handDel += c.handDel;
    acc.bulkAdd += c.bulkAdd;
    return acc;
  },
  { commits: 0, matched: 0, feat: 0, handAdd: 0, handDel: 0, bulkAdd: 0 },
);

const dates = commits.map((c) => c.date).sort();
const allVersions = [...new Set(commits.map((c) => c.version).filter(Boolean))].sort(cmpVersion);
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

const out = {
  _comment:
    "本文件由 `node scripts/gen-agent-stats.mjs` 从 git 历史生成，请勿手改；提交历史变了就重跑。",
  generatedAt: new Date().toISOString().slice(0, 10),
  headSha: git(["rev-parse", "--short", "HEAD"]).trim(),
  headVersion: pkg.version,
  span: {
    commits: totals.commits,
    matched: totals.matched,
    feat: totals.feat,
    firstDate: dates[0] ?? "",
    lastDate: dates[dates.length - 1] ?? "",
    versionFrom: allVersions[0] ?? "",
    versionTo: allVersions[allVersions.length - 1] ?? "",
  },
  totals: {
    handAdd: totals.handAdd,
    handDel: totals.handDel,
    bulkAdd: totals.bulkAdd,
  },
  agents,
  models,
  platforms,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n", "utf8");

console.log(
  `✓ ${OUT.replace(ROOT + "/", "")}｜提交 ${out.span.commits}（带前缀 ${out.span.matched}）` +
    `｜智能体 ${agents.length}｜模型 ${models.length}｜平台 ${platforms.length}`,
);
console.log(`  手写 +${totals.handAdd} / -${totals.handDel}｜批量平移 +${totals.bulkAdd}`);
if (unmatched.length) {
  console.warn(`  ⚠️ ${unmatched.length} 条提交没有 [智能体]-[模型] 前缀，未计入榜单：`);
  for (const c of unmatched) console.warn(`     ${c.hash} ${JSON.stringify(c.subject.slice(0, 70))}`);
}
for (const a of agents) {
  console.log(
    `  agent ${a.name.padEnd(20)} ${String(a.commits).padStart(3)} 次  feat ${String(a.feat).padStart(2)}  手写 +${String(a.handAdd).padStart(6)}  平移 +${a.bulkAdd}`,
  );
}
for (const m of models) {
  console.log(
    `  model ${m.name.padEnd(20)} ${String(m.commits).padStart(3)} 次  feat ${String(m.feat).padStart(2)}  手写 +${String(m.handAdd).padStart(6)}`,
  );
}
for (const p of platforms) {
  console.log(
    `  plat  ${p.name.padEnd(20)} ${String(p.commits).padStart(3)} 次  feat ${String(p.feat).padStart(2)}  手写 +${String(p.handAdd).padStart(6)}  ← ${p.partners.map((x) => `${x.name} ${x.count}`).join(", ")}`,
  );
}
