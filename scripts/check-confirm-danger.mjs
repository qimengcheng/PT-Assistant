/**
 * 确认框那颗键不许写 `okType: "danger"`（或模板里的 `ok-type="danger"`）。
 *
 * 防的静默失效：AGENTS §3.4 的硬口径是「删除 / 清空数据的按钮一律实心红」，而 antdv-next 的
 * 确认框把 legacy 的 `okType: "danger"` 只折成 `{ danger: true }`、**不给 type**
 * （`dist/modal/components/ConfirmOkBtn.js:16` → `_util/ActionButton.js:75` →
 * `dist/button/button.js:24` 的 `convertLegacyProps`）。于是 `mergedType` 停在 default，
 * 算出来是「白底 + 红描边 + 红字」（`button.js:65` 那条 `["danger", colorVariantPair[1]]`，
 * default 档的第二项就是 outlined）。不报错、不进 vue-tsc、class 里还带着
 * `.ant-btn-dangerous` —— 只看 class 甚至会以为已经对了。
 * 2026-10-11 用户就是指着「确认删除该辅种任务吗？」那张框报的。
 *
 * 正解：`okButtonProps: { type: "primary", danger: true }`（`ConfirmOkBtn` 把它 merge 在
 * legacy 映射之后，所以它说了算；`type` + `danger` 才走到 `["danger", "solid"]`）。
 *
 * 用法：`node scripts/check-confirm-danger.mjs`（在项目根目录跑）
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = ["src"];
const EXTS = new Set([".ts", ".tsx", ".vue", ".js"]);
/** 命中即 FAIL：antd 那个坏掉的 legacy 入口，两种拼法都算 */
const PATTERN = /\bokType\b|\bok-type\b/;

function* walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) yield* walk(p);
    else if (EXTS.has(path.extname(ent.name))) yield p;
  }
}

/**
 * 注释里的反例不算（第一版台架就栽在「注释里的字符串把判据喂成假 PASS」这类问题上）。
 * 替换成等量空格而不是删掉 —— 否则整份文件的行号会往前塌，报出来的行号指不到真位置
 * （第一版就是这么把 `appDialog.ts` 的第 51 行报成第 23 行的）。
 * 粗暴切掉 URL 里的 `//` 无所谓：这里只找 `okType`，截断字符串不可能凭空造出这个词。
 */
const blank = (s) => s.replace(/[^\n]/g, " ");
function stripComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, blank).replace(/\/\*[\s\S]*?\*\//g, blank).replace(/\/\/[^\n]*/g, blank);
}

const hits = [];
let files = 0;
for (const dir of SCAN_DIRS) {
  for (const file of walk(path.join(ROOT, dir))) {
    files++;
    const lines = stripComments(fs.readFileSync(file, "utf8")).split("\n");
    lines.forEach((line, i) => {
      if (PATTERN.test(line)) hits.push(`${path.relative(ROOT, file).split(path.sep).join("/")}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
  }
}

if (hits.length) {
  console.log(`FAIL：${hits.length} 处用了确认框的 legacy danger 入口（出来是红描边，不是实心红）\n`);
  for (const h of hits) console.log("  " + h);
  console.log('\n  改法：okButtonProps: { type: "primary", danger: true }');
  process.exitCode = 1;
} else {
  console.log(`PASS：扫了 ${files} 个文件，确认框那颗键没有走 legacy danger 入口`);
}
