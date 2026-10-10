/**
 * 种子分类的统一口径。
 *
 * 为什么要这一层：每个站点对同一类内容各叫各的 —— 同一次搜索里「电影」这一类能出现
 * Movies / Movies/电影 / 电影/Movies / Movies(电影) / Movie(電影) / 电影 六种写法，
 * 一列摆下来既没法扫读、也没法按它排序（拉丁的排前半、中文的排后半）。
 *
 * 做法是**规则 + 每站覆盖**两层，不是枚举表：
 *  - 规则（本文件 RULES）：把任意叫法折成一个规范类别。340 个站点、光站点自己声明的
 *    分类名就有 3200 多个，逐站逐条枚举维护不动，也不覆盖结果里现抓的写法。
 *  - 每站覆盖（ISiteUserConfig.categoryMap，用户在站点设置里填）：规则判错时按站点名纠正，
 *    优先级高于规则。它是纯用户数据，所以挂在用户配置上而不是站点定义上。
 *
 * ⚠️ 判定顺序 = RULES 数组顺序，先命中的赢，这不是随便排的：
 *  - 纪录片 在 电视剧 之前 ——「纪录片」里有「剧」字，反过来会被判成电视剧
 *  - 动漫 在 电视剧/电影 之前 —— Anime Series / Anime Movies 都该归动漫
 *  - 综艺 在 电视剧 之前 —— 同时带两类字样的叫法（Variety TV / 综艺剧集）归综艺
 * 顺序之外还有一道闸：括号里的**排除子句**（「不含…」）在匹配前整段删掉，见 EXCLUSION。
 * 判据在 scripts/check-category-map.mjs（自动进 check-all 聚合），改 RULES 前必跑。
 */

/** 规范类别。`other` 是兜底：判不出来的原样归到这里，不猜。 */
export type TCategoryKind =
  | "movie"
  | "tv"
  | "variety"
  | "anime"
  | "documentary"
  | "music"
  | "game"
  | "software"
  | "ebook"
  | "sport"
  | "kids"
  | "edu"
  | "photo"
  | "adult"
  | "other";

export const CATEGORY_KINDS: TCategoryKind[] = [
  "movie",
  "tv",
  "variety",
  "anime",
  "documentary",
  "music",
  "game",
  "software",
  "ebook",
  "sport",
  "kids",
  "edu",
  "photo",
  "adult",
  "other",
];

/** 界面标签走 i18n：`common.categoryKind.<kind>` */
export function categoryKindLabelKey(kind: TCategoryKind): string {
  return `common.categoryKind.${kind}`;
}

/**
 * 别名表。全小写；纯 ASCII 的按「词首」匹配（前面不能是字母或数字），含 CJK 的按子串匹配。
 * 词首而不是整词：站点写的是 Movies / Animes / Games，整词匹配会把复数漏掉；
 * 但也不能是裸子串，否则 HDTV 里的 tv 会被当成电视剧。
 */
/** 导出给判据脚本做结构断言（每个类别都得有别名、别名不跨类别重复）；界面不要用它 */
export const RULES: Array<{ kind: TCategoryKind; alias: string[] }> = [
  {
    kind: "documentary",
    alias: ["纪录片", "紀錄片", "record", "documentary", "documentaries", "docu"],
  },
  {
    kind: "variety",
    alias: ["综艺", "綜藝", "真人秀", "脱口秀", "谈话节目", "variety", "talkshow", "talk show", "reality"],
  },
  {
    kind: "anime",
    alias: [
      "动漫",
      "動畫",
      "动画",
      "番剧",
      "番組",
      "OVA",
      "OAD",
      "二次元",
      "anime",
      "animation",
      "cartoon",
      "donghua",
    ],
  },
  {
    kind: "adult",
    alias: ["成人", "情色", "三级", "xxx", "xsxxx", "adult", "porn", "erotic", "18+"],
  },
  {
    kind: "kids",
    alias: ["儿童", "兒童", "少儿", "少兒", "幼儿", "親子", "亲子", "kids", "kinder", "baby", "infant"],
  },
  {
    kind: "sport",
    alias: ["体育", "體育", "運動", "运动", "赛事", "球赛", "sport", "football", "soccer", "basketball", "wwe", "epl"],
  },
  {
    kind: "music",
    alias: ["音乐", "音樂", "歌曲", "专辑", "專輯", "单曲", "MV", "演唱会", "music", "audio", "album", "concert"],
  },
  {
    kind: "edu",
    alias: ["教育", "教程", "学习", "講座", "讲座", "课堂", "education", "tutorial", "course", "learn"],
  },
  {
    kind: "ebook",
    alias: [
      "图书",
      "圖書",
      "书籍",
      "書籍",
      "杂志",
      "雜誌",
      "期刊",
      "漫画",
      "漫畫",
      "电子书",
      "小說",
      "小说",
      "ebook",
      "e-book",
      "book",
      "magazine",
      "comic",
      "manga",
      "novel",
      "mobi",
      "epub",
    ],
  },
  {
    kind: "software",
    alias: ["软件", "軟體", "应用", "應用", "程序", "software", "app", "windows", "linux", "macos"],
  },
  {
    kind: "game",
    alias: ["游戏", "遊戲", "電玩", "game", "games", "ps4", "ps5", "xbox", "nintendo", "switch"],
  },
  {
    kind: "photo",
    alias: ["图片", "圖片", "写真", "寫真", "壁纸", "壁紙", "摄影", "攝影", "photo", "picture", "image"],
  },
  {
    kind: "movie",
    alias: ["电影", "電影", "影片", "影視", "影视", "movie", "movies", "film", "films", "cinema"],
  },
  {
    kind: "tv",
    alias: [
      "电视剧",
      "電視劇",
      "剧集",
      "劇集",
      "连续剧",
      "連續劇",
      "网剧",
      "網劇",
      "短剧",
      "短劇",
      "電視",
      "电视",
      "剧",
      "劇",
      "tv",
      "series",
      "drama",
      "episodes",
      "episode",
    ],
  },
];

/** 纯 ASCII 别名走词首匹配；含 CJK 的走子串匹配 */
const ASCII_ONLY = /^[\x00-\x7f]+$/;

// 别名表里 ASCII 项是按人好读的大小写混写的（OVA / MV / XXX），而待判字符串是小写的：
// 匹配前统一压成小写，否则这类全大写别名一条都命中不了（判据里 OVA/MV 两条就是抓这个的）。
const MATCH_RULES = RULES.map((r) => ({
  kind: r.kind,
  alias: r.alias.map((a) => (ASCII_ONLY.test(a) ? a.toLowerCase() : a)),
}));

function hitAlias(rawLower: string, alias: string): boolean {
  if (ASCII_ONLY.test(alias)) {
    // 词首：前面不能是字母或数字（hdtv 不算 tv），但允许后面接东西（movies 算 movie）
    const at = rawLower.indexOf(alias);
    if (at < 0) return false;
    const before = at === 0 ? "" : rawLower[at - 1];
    return !/[a-z0-9]/.test(before);
  }
  return rawLower.includes(alias);
}

/**
 * 排除子句：括号里带「不含 / 不包括 / 除外」的那一段，声明的是这一类**不**包括什么，
 * 不是它是什么，所以折类前先整段删掉。
 * 真出事的样子：PTTime 的 `Movies(电影、电影短片(不含动漫))` —— 含 CJK 的别名走子串匹配，
 * 括号里那个「动漫」被 anime 认领（它又排在 movie 前面），一列里这部电影就显示成「动漫」。
 * 只认这三个多字标记：收进单个「无」会把 `FLAC(无损音乐)` 这类**类别词本来就在括号里**的写法削空。
 */
const EXCLUSION = /[(（][^)）]*(?:不含|不包括|除外)[^)）]*[)）]/g;

/** 规则层：任意叫法 → 规范类别；一条都不命中则 other */
export function categorizeByRule(raw: string): TCategoryKind {
  const s = String(raw ?? "").trim().toLowerCase().replace(EXCLUSION, "");
  if (!s) return "other";
  for (const { kind, alias } of MATCH_RULES) {
    if (alias.some((a) => hitAlias(s, a))) return kind;
  }
  return "other";
}

/**
 * 完整判据：先查该站点自己的覆盖表（用户填的，键是原样叫法），再走规则。
 * @param siteMap ISiteUserConfig.categoryMap
 */
export function categorizeCategory(raw: string, siteMap?: Record<string, string>): TCategoryKind {
  const key = String(raw ?? "").trim();
  const over = siteMap?.[key];
  if (over && (CATEGORY_KINDS as string[]).includes(over)) return over as TCategoryKind;
  return categorizeByRule(raw);
}

/** 一行的输入：原样叫法 + 该站点的覆盖表（没有就不传） */
export interface ICategoryCell {
  raw?: string | number;
  siteMap?: Record<string, string>;
}

/** 折成规范类别：站点覆盖优先，其次规则 */
export function categoryKindOf(cell: ICategoryCell): TCategoryKind {
  return categorizeCategory(String(cell.raw ?? ""), cell.siteMap);
}

/** 表格列排序用：同一类的排到一起，同类内再按原样叫法 */
export function compareCategory(a: ICategoryCell, b: ICategoryCell): number {
  const ka = categoryKindOf(a);
  const kb = categoryKindOf(b);
  if (ka !== kb) return CATEGORY_KINDS.indexOf(ka) - CATEGORY_KINDS.indexOf(kb);
  return String(a.raw ?? "").localeCompare(String(b.raw ?? ""), "zh-CN");
}
