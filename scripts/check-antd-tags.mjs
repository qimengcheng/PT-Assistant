/**
 * 全仓扫描：把模板里写的 `a-*` 标签对着 antdv-next 的真实注册名表比一遍。
 *
 * 为什么需要：Vuetify 的 `v-list` / `v-stepper` 系列照搬成 `a-list` / `a-step` 时，
 * antdv-next 里根本没有这些组件（List 只有虚拟滚动的 `AListy`，Steps 走 `:items`），
 * 而 Vue 对未注册标签**只发一条 DEV 警告**就按原生未知元素渲染：带命名插槽
 * （`#extra`/`#avatar`）时 children 是对象、原生元素分支只吃数组，整块内容直接丢掉，
 * 页面表现为一片空白却还留着点击区域。生产包里没有任何提示。
 *
 * 注册名表不是手抄的：在 Node 里实跑一次全量 `install`，读 `app._context.components`
 * 得到权威的 139 个名字，避免「文档说存在」和「运行时真存在」再次对不上。
 *
 * 用法：`node scripts/check-antd-tags.mjs`（无需构建产物，CI 里跟 pnpm compile 前后都行）
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const ROOT = process.cwd();
const toUrl = (p) => "file:///" + path.join(ROOT, p).split(path.sep).join("/");

const { createApp } = createRequire(path.join(ROOT, "noop.js"))("vue");
const antd = await import(toUrl("node_modules/antdv-next/dist/index.js"));

const app = createApp({ render: () => null });
app.use(antd.install);
const registered = new Set(Object.keys(app._context.components));

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.name.endsWith(".vue")) out.push(p);
  }
  return out;
}

/** `a-list-item-meta` → `AListItemMeta`；`<ATable>` 这种 Pascal 写法原样返回 */
function toRegName(tag) {
  if (/^A[A-Z]/.test(tag)) return tag;
  if (/^a-[a-z][a-z0-9-]*$/.test(tag)) {
    return "A" + tag.slice(2).split("-").map((s) => s[0].toUpperCase() + s.slice(1)).join("");
  }
  return null;
}

const bad = new Map();
for (const file of walk("src")) {
  const raw = fs.readFileSync(path.join(ROOT, file), "utf8");
  // 只看模板，且先去掉注释（注释里讲「原来写的是 a-list」是合法的）
  const template = ((raw.match(/<template[^>]*>([\s\S]*)<\/template>/)?.[0] ?? "")).replace(
    /<!--[\s\S]*?-->/g,
    "",
  );
  for (const m of template.matchAll(/<([A-Za-z][A-Za-z0-9-]*)[\s/>]/g)) {
    const reg = toRegName(m[1]);
    if (!reg || !/^a-[a-z]/.test(m[1])) continue;
    if (!registered.has(reg)) {
      if (!bad.has(m[1])) bad.set(m[1], new Set());
      bad.get(m[1]).add(file.split(path.sep).join("/"));
    }
  }
}

console.log(`扫描 ${walk("src").length} 个 .vue，antdv-next 实际注册名 ${registered.size} 个`);
if (!bad.size) {
  console.log("PASS：没有发现 antdv-next 里不存在的 a-* 标签。");
  process.exit(0);
}
console.error("FAIL：以下 a-* 标签在 antdv-next 里不存在，会被当成原生未知元素渲染（内容静默丢失）：");
for (const [tag, files] of bad) console.error(`  ${tag} → ${[...files].join(", ")}`);
console.error("改法：换成普通 div + 样式（参考 SentToDownloaderDialog、HomeView 的处理），或改用存在的组件 API。");
process.exit(1);
