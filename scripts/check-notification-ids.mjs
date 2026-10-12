/**
 * 系统通知：每条都要有 id，且每个点击监听器都必须按 id 认领自己那几条。
 *
 * 防的静默失效：`chrome.notifications.onClicked` 是**全局事件** —— 谁 add 的监听器都会收到
 * 场上**所有**通知的点击，事件本身不按 id 分发。本仓库原先只有 `updateCheck` 那一个监听器，
 * 而它不看 `notificationId`，于是点「辅种完成」那条通知被它拿去开了更新包的下载链接
 * （用户 2026-10-12 报的：「辅种完成的通知点击后不应该跳到辅种任务吗？实际上跳到github下载页去了」）。
 * 不报错、不进 vue-tsc、不进构建 —— 只有点下去那一刻才知道。
 *
 * 两条判据：
 *  A. `notifications.create(id, …)` 必须传 id。匿名（第一参数直接是 `{`）的那条永远拿不到
 *     有意义的 id，任何监听器都认领不了它 —— 点了要么没反应，要么被别人的监听器接走。
 *  B. `notifications.onClicked.addListener(…)` 的处理器里，必须有一行**同时**点名形参
 *     （`notificationId` 之类）和比较（`startsWith(` / `.test(` / `===` / `!==` / `includes(`）。
 *     同族反例正是「处理器里压根不提 id」。
 *
 * 判据 B 的边界要说清：它看的是「同一行里既提到 id 又做了比较」，所以跨行写的认领
 * （`const mine =\\n  id.startsWith(...)`）会被它报出来 —— 那种改法要连这条一起重看，别顺手放宽。
 *
 * 用法：`node scripts/check-notification-ids.mjs`（默认扫 `src`，可传别的目录做夹具自检）
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SCAN = process.argv[2] ?? "src";
const EXTS = new Set([".ts", ".tsx", ".vue", ".js"]);

function* walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) yield* walk(p);
    else if (EXTS.has(path.extname(ent.name))) yield p;
  }
}

/** 注释里的反例不算；替换成等量空格以保住行号 */
const blank = (s) => s.replace(/[^\n]/g, " ");
const stripComments = (text) =>
  text.replace(/<!--[\s\S]*?-->/g, blank).replace(/\/\*[\s\S]*?\*\//g, blank).replace(/\/\/[^\n]*/g, blank);

/** A：`notifications?.create(` 后面第一个非空字符是 `{` ⇒ 没传 id */
const CREATE_NO_ID = /notifications\??\.create\(\s*\{/;
/** B：addListener 的形参名（`(notificationId) =>` / `notificationId =>` / `async (id, …)`） */
const LISTENER_PARAM = /notifications\??\.onClicked\.addListener\(\s*(?:async\s*)?\(?\s*([A-Za-z_$][\w$]*)/;
const CLAIM = /(startsWith\s*\(|\btest\s*\(|===|!==|includes\s*\()/;

const noId = [];
const unclaimed = [];
let files = 0;

for (const file of walk(path.join(ROOT, SCAN))) {
  files++;
  const rel = path.relative(ROOT, file).split(path.sep).join("/");
  const text = stripComments(fs.readFileSync(file, "utf8"));
  const lines = text.split("\n");
  const at = (idx) => text.slice(0, idx).split("\n").length;

  for (const m of text.matchAll(new RegExp(CREATE_NO_ID.source, "g"))) {
    noId.push(`${rel}:${at(m.index)}: 这条 create 没传 id，任何点击监听器都认领不了它`);
  }

  for (const m of text.matchAll(new RegExp(LISTENER_PARAM.source, "g"))) {
    const param = m[1];
    if (param === "function" || param === "async") continue;
    // 只看处理器开头那 600 个字符：认领自己那几条必然写在最前面（不认领的才会往后走）
    const body = text.slice(m.index, m.index + 600);
    const claimed = body.split("\n").some((line) => line.includes(param) && CLAIM.test(line));
    if (!claimed) {
      unclaimed.push(`${rel}:${at(m.index)}: 这个 onClicked 监听器不按 id 认领（形参 ${param} 没和任何比较出现在同一行）`);
    }
  }
}

if (noId.length + unclaimed.length > 0) {
  console.log(`FAIL：系统通知的 id 有 ${noId.length + unclaimed.length} 处问题\n`);
  for (const h of [...noId, ...unclaimed]) console.log("  " + h);
  console.log('\n  改法：create 一律传带前缀的 id；每个 onClicked 监听器开头写 if (!id.startsWith("自己的前缀")) return;');
  process.exitCode = 1;
} else {
  console.log(`PASS：扫了 ${files} 个文件，通知都有 id，且每个点击监听器都按 id 认领自己那几条`);
}
