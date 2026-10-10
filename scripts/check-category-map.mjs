/**
 * 分类统一口径（src/shared/category.ts）的行为断言。
 *
 * 为什么这条必须有：判据是「按数组顺序先命中的赢」的一串别名子串规则，改任何一条顺序或
 * 增删一个别名，都可能悄悄改变别的类别 —— 纪录片/电视剧（「纪录片」里有「剧」字）、
 * 动漫/电影（Anime Movies）、软件/游戏（PC Games）、综艺/电视剧（Variety TV）
 * 四对就是这么撞上的。这类回归 vue-tsc 和界面都不会报，只会让用户看到某一列默默归错类。
 *
 * 它还兜一件静态兜不到的：规范类别的界面标签是 `common.categoryKind.${kind}` **动态拼**的键，
 * check-locale-keys 只查字面 t("a.b.c")，拼出来的键它放行 —— 漏了某个 kind 的翻译，
 * 界面上渲染的是键路径本身（AGENTS §3.5 的零容忍项），所以在这里逐个 kind 核对两份语言包。
 *
 * 用法：`node scripts/check-category-map.mjs`（也被 check-all.mjs 自动收进聚合）
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  CATEGORY_KINDS,
  RULES,
  categorizeByRule,
  categorizeCategory,
  categoryKindLabelKey,
  categoryKindOf,
  compareCategory,
} from "../src/shared/category.ts";

let failed = 0;
let passed = 0;

function eq(name, actual, expected) {
  if (actual === expected) {
    passed++;
    return;
  }
  failed++;
  console.log(`  FAIL ${name}\n         期望 ${expected}，实际 ${actual}`);
}

/** 一批叫法必须全部折到同一个类别 */
function collapse(group, expected) {
  for (const raw of group) eq(`「${raw}」→ ${expected}`, categorizeByRule(raw), expected);
}

console.log("1) 同一类内容的不同写法要折到一起（用户 2026-10-07 截图里那六种「电影」写法）");
collapse(
  ["Movies", "Movies/电影", "电影/Movies", "电影", "Movies(电影)", "Movie(電影)", "电影*", "HD Movies", "Movie", "影片"],
  "movie",
);
collapse(["电视剧", "TV Series", "剧集", "美剧", "韩剧", "日剧", "连续剧", "网剧", "Drama", "TV Shows"], "tv");
collapse(["纪录片", "Documentary", "Documentaries", "Record"], "documentary");
collapse(["动漫", "动画", "番剧", "Anime", "Anime Series", "Anime Movies", "OVA", "Donghua Anime"], "anime");
collapse(["综艺", "综艺节目", "真人秀", "Variety", "Talk Show", "Reality"], "variety");
collapse(["音乐", "Music", "专辑", "单曲", "MV", "Audio"], "music");
collapse(["游戏", "遊戲", "Game", "Games", "PC Games", "Console Games"], "game");
collapse(["软件", "軟體", "Software", "App", "Apps"], "software");
collapse(["图书", "书籍", "杂志", "漫画", "小说", "E-Book", "ebook", "Magazine", "Manga"], "ebook");
collapse(["体育", "赛事", "Sport", "Sports", "Football", "WWE"], "sport");
collapse(["成人", "情色", "XXX", "Adult", "Porn"], "adult");
collapse(["儿童", "少儿", "Kids", "Baby"], "kids");
collapse(["教育", "教程", "Education", "Tutorial"], "edu");
collapse(["图片", "写真", "壁纸", "Photo", "Pictures"], "photo");

console.log("2) 不该误判的（词首匹配、以及顺序敏感的那几对）");
eq("HDTV 不算 tv（tv 前面是字母）", categorizeByRule("HDTV"), "other");
eq("MTV 不算 tv", categorizeByRule("MTV"), "other");
eq("Box Set 不算 photo", categorizeByRule("Box Set"), "other");
eq("Adventure 不算 adult（av 已因这个反例从别名里删掉）", categorizeByRule("Adventure"), "other");
eq("综艺 在 电视剧 之前：Variety TV 归综艺", categorizeByRule("Variety TV"), "variety");
eq("综艺 在 电视剧 之前：综艺剧集归综艺", categorizeByRule("综艺剧集"), "variety");
eq("空串 → other", categorizeByRule(""), "other");
eq("undefined → other", categorizeByRule(undefined), "other");
eq("没见过的写法不猜，归 other", categorizeByRule("Random Stuff 2026"), "other");

console.log("2b) 括号里的「不含 / 不包括 / 除外」是排除子句，不是类别词（用户 2026-10-10 截图：Free Guy 显示成动漫）");
eq("Movies(电影、电影短片(不含动漫)) 归电影", categorizeByRule("Movies(电影、电影短片(不含动漫))"), "movie");
eq("整族都修掉：电视剧(…(不含综艺、动漫)) 归电视剧", categorizeByRule("电视剧(电视剧、电视系列剧(不含综艺、动漫))"), "tv");
eq("排除子句里的词不许反过来赢：综艺(不含纪录片)", categorizeByRule("综艺(不含纪录片)"), "variety");
eq("主名自己在外层时不受影响：动漫(不含三次元)", categorizeByRule("动漫(不含三次元)"), "anime");
eq("全角括号 + 空格也照删：免费（不含 VIP）", categorizeByRule("免费（不含 VIP）"), "other");
// 反证：标记表只收「不含/不包括/除外」这三个多字串。收进单个「无」，下面这条括号里
// 唯一的类别词会被整段削掉，判成 other —— 这类写法（无损/无删减）在音乐类里很常见。
eq("括号里才是类别词时不许削：FLAC(无损音乐)", categorizeByRule("FLAC(无损音乐)"), "music");

console.log("3) 站点覆盖优先于规则，且非法值要回落");
const siteMap = { "电视剧": "movie", "综艺": "not_a_kind" };
eq("本站把「电视剧」标成 movie 时按站点走", categorizeCategory("电视剧", siteMap), "movie");
eq("覆盖值不是合法类别时回落到规则", categorizeCategory("综艺", siteMap), "variety");
eq("覆盖表没有这一条时走规则", categorizeCategory("电影", siteMap), "movie");
eq("无覆盖表等价于纯规则", categorizeCategory("电影"), "movie");

console.log("4) 排序：同类必须排到一起（组间顺序 = CATEGORY_KINDS 顺序：电影→电视剧→纪录片）");
const rows = ["电影", "TV Series", "Movies(电影)", "纪录片", "美剧", "Movie"];
const sorted = [...rows].sort((a, b) => compareCategory({ raw: a }, { raw: b }));
eq(
  "三条「电影」相邻、两条电视剧相邻，纪录片在后",
  JSON.stringify(sorted),
  JSON.stringify(["电影", "Movie", "Movies(电影)", "美剧", "TV Series", "纪录片"]),
);
eq(
  "带站点覆盖时按覆盖后的类别聚堆（本站把「电视剧」标成 movie）",
  JSON.stringify(
    [...rows].sort((a, b) =>
      compareCategory({ raw: a, siteMap: { 电视剧: "movie" } }, { raw: b, siteMap: { 电视剧: "movie" } }),
    ),
  ),
  JSON.stringify(["电影", "Movie", "Movies(电影)", "美剧", "TV Series", "纪录片"]),
);
eq("categoryKindOf 与 compareCategory 用的是同一套判据", categoryKindOf({ raw: "Movies/电影" }), "movie");

console.log("5) 别名表自身：每个类别都得有别名列，且别名不跨类别重复");
const owner = new Map();
for (const { kind, alias } of RULES) {
  eq(`${kind} 至少有一条别名`, alias.length > 0, true);
  for (const a of alias) {
    if (owner.has(a)) eq(`别名「${a}」不跨类别重复（已在 ${owner.get(a)}）`, kind, owner.get(a));
    else owner.set(a, kind);
  }
}
eq(
  "除 other 外每个类别都在 RULES 里",
  CATEGORY_KINDS.filter((k) => k !== "other").every((k) => RULES.some((r) => r.kind === k)),
  true,
);
eq("other 不出现在 RULES 里（它是兜底，不是判据）", RULES.some((r) => r.kind === "other"), false);

console.log("6) 动态拼的 i18n 键必须在两侧都存在（check-locale-keys 看不见这种键）");
function leaf(obj, dotted) {
  return dotted.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), obj);
}
for (const locale of ["zh_CN", "en"]) {
  const doc = JSON.parse(fs.readFileSync(path.join(process.cwd(), `src/locales/${locale}.json`), "utf8"));
  for (const kind of CATEGORY_KINDS) {
    const key = categoryKindLabelKey(kind);
    const v = leaf(doc, key);
    eq(`${locale} 有 ${key}`, typeof v === "string" && v.trim().length > 0, true);
  }
}

console.log(`\n${failed ? "FAIL" : "PASS"}：分类统一口径断言 ${passed} 条通过、${failed} 条失败`);
process.exit(failed ? 1 : 0);
