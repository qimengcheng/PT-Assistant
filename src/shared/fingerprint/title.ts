/**
 * 第 1 层指纹：归一化标题 + 大小。
 *
 * 特点：**不需要下载 .torrent**，站点列表页一次请求就能算出一批，所以它
 * 是唯一能用来做「粗筛候选」的层。但它太松 —— 同一部电影的不同压制、不同
 * 压制组会算出同一个 key —— 所以：
 *
 *   第 1 层命中 → 只算候选，绝不直接采信，也绝不据此排除任何东西。
 *
 * 归一化步骤：小写 → 去压制组尾标 → 去分辨率/编码 token → 分隔符归一。
 * 目标偏向「召回」（宁可多给候选），因为误召回只是多算一次第 2 层，
 * 而漏召回会直接丢掉一个真实的跨站辅种机会。
 */

/** 分隔符：空白、点、下划线、连字符、全角间隔号（归一成单个空格） */
const SEPARATOR_PATTERN = /[\s._\-+·・－—―]+/g;
/** 成对符号一律当成分隔符处理 */
const PAIRED_SYMBOL_PATTERN = /[\[\]［］()（）{}｛｝【】〔〕「」『』《》〈〉<>]/g;
/** 其余零散标点 */
const LOOSE_PUNCTUATION_PATTERN = /[,;:!?'"`~@#$%^&*=+|\\/]/g;

/** 结尾的 [Group] / （Group） / 【Group】 / {Group}，内容不含数字时才算压制组尾标 */
const TRAILING_BRACKET_GROUP = /[\[［(（{｛【《]\s*([^[\]］)）}｝】》\n]{1,40}?)\s*[\]］)）}｝】》]\s*$/;
/** 结尾的 -Group（不含数字），且前缀必须落在「像发布名」的语境里 */
const TRAILING_DASH_GROUP = /-\s*([^\s\-[\]]{1,15})\s*$/;
/** 4 位年份，用于判断 -Group 的前缀是否像发布名 */
const YEAR_PATTERN = /\b(19|20)\d{2}\b/;

/**
 * 分辨率 / 编码 / 片源 / 音频 / 附加说明 token。
 *
 * 全部小写、且会在分隔符归一之后按「整词」匹配（不会误伤 BladeRunner2049 里的 2049）。
 */
const NOISE_TOKENS = new Set<string>([
  // 分辨率与色彩
  "480p", "540p", "576p", "720p", "720i", "1080p", "1080i", "1440p", "2160p", "4k", "8k",
  "uhd", "fhd", "hd", "sd", "hdr", "hdr10", "hdr10+", "dolbyvision", "dv", "hfr", "hlg", "sdr", "pq",
  // 编码
  "x264", "x265", "h264", "h265", "hevc", "avc", "av1", "xvid", "divx", "mpeg2", "vp9",
  "hi10p", "10bit", "10bits", "8bit",
  // 片源
  "bluray", "bdrip", "brrip", "bdremux", "remux", "webrip", "webdl", "web", "dl", "hdtv", "hddvd",
  "uhdtv", "dvdrip", "dvdscr", "dvd", "hdrip", "hdcam", "cam", "amzn", "hmax",
  // 音频
  "dts", "truehd", "atmos", "ddp", "dd", "eac3", "ac3", "flac", "aac", "lpcm", "opus",
  // 附加说明
  "proper", "repack", "internal", "limited", "extended", "unrated", "remastered", "theatrical",
  "uncut", "multi", "subbed", "subs", "dubbed", "imax", "3d", "sbs",
  // 中文压制常见尾标
  "中字", "简繁", "简体", "繁体", "内嵌", "特效", "字幕组", "简体中字", "国语",
]);

/**
 * 带声道数后缀的音频 token（DD5、DDP5.1、EAC35、FLAC24 …）。
 *
 * 各站标题里这类写法五花八门，与其穷举不如按规则识别：音频关键字 + 可选的数字。
 */
const NOISE_TOKEN_PATTERN = /^(?:ddp|dd|eac3|eac-3|dts|aac|ac3|flac|truehd|lpcm|opus)\d*$/;

/**
 * 同样含声道数、但带小数点（`DDP 5.1` / `DTS-HD 7.1`）的写法。
 *
 * 必须在分隔符归一**之前**处理：归一会把 `DDP5.1` 拆成 `ddp5` + `1` 两个词，
 * 再怎么过滤也会剩下一个孤零零的 `1`。
 */
const PRE_NOISE_PATTERN = /\b(?:eac-?3|dts-?hd|truehd|lpcm|flac|aac|ddp|ac3|opus|dd|ch)\s*\d+(?:\.\d+)?\b/g;

/** 整词判定某个 token 是不是「分辨率 / 编码 / 片源 / 音频」这类无关信息 */
function isNoiseToken(word: string): boolean {
  return NOISE_TOKENS.has(word) || NOISE_TOKEN_PATTERN.test(word);
}

/** 判断标题里是否还留着「像发布名」的上下文（年份 / 分辨率 / 编码 token） */
function looksLikeReleaseTitle(prefix: string): boolean {
  if (YEAR_PATTERN.test(prefix)) return true;
  const words = prefix.split(SEPARATOR_PATTERN).filter(Boolean);
  for (let i = Math.max(0, words.length - 2); i < words.length; i++) {
    if (isNoiseToken(words[i] as string)) return true;
  }
  return false;
}

/** 去掉结尾的压制组尾标：先方括号形式（可叠加），再 -Group 形式 */
function stripReleaseGroup(title: string): string {
  let result = title;

  for (let i = 0; i < 2; i++) {
    const matched = TRAILING_BRACKET_GROUP.exec(result);
    // 内容带数字的多半是 [2020] / [1080p] 这类有效信息，不当压制组处理
    if (!matched || /\d/.test(matched[1] as string)) break;
    result = result.slice(0, matched.index);
  }

  const dashMatched = TRAILING_DASH_GROUP.exec(result);
  if (dashMatched) {
    const group = dashMatched[1] as string;
    const prefix = result.slice(0, dashMatched.index);
    // 「Spider-Man」这种不能被当成压制组剥掉：要求前缀本身像发布名
    if (!/\d/.test(group) && looksLikeReleaseTitle(prefix)) {
      result = prefix;
    }
  }

  return result;
}

/**
 * 归一化标题，得到第 1 层指纹的 key 片段。
 *
 * 返回空字符串表示标题里没有可用信息（调用方应据此退化为「只按大小比对」）。
 */
export function normalizeTitle(title: string | undefined | null): string {
  if (!title) return "";

  let result = String(title)
    .normalize("NFKC")
    .toLowerCase()
    .trim();

  if (!result) return "";

  // 1. 去压制组尾标（必须在分隔符归一之前做，否则 -Group 会先被拆成两个词）
  result = stripReleaseGroup(result);

  // 2. 去 `DDP5.1` 这类连写的声道标记（也必须在分隔符归一之前，否则会被拆成两个词）
  result = result.replace(PRE_NOISE_PATTERN, " ");

  // 3. 分隔符归一
  result = result
    .replace(PAIRED_SYMBOL_PATTERN, " ")
    .replace(SEPARATOR_PATTERN, " ")
    .replace(LOOSE_PUNCTUATION_PATTERN, " ")
    .replace(/\s+/g, " ")
    .trim();

  // 4. 去分辨率 / 编码 / 片源 / 音频 token（整词匹配）
  result = result
    .split(" ")
    .filter((word) => word && !isNoiseToken(word))
    .join(" ")
    .trim();

  return result;
}

/**
 * 第 1 层 key：`归一化标题|字节数`
 *
 * 站点列表页的一条 ITorrent 就能算出来（只要有 title 和 size）。
 */
export function buildTitleSizeKey(title: string | undefined | null, size: number | undefined | null): string {
  const normalizedTitle = normalizeTitle(title);
  const normalizedSize = Math.max(0, Math.round(size ?? 0));
  return `${normalizedTitle}|${normalizedSize}`;
}

/** 拆回 titleSizeKey 的两个部分 */
export function parseTitleSizeKey(key: string): { titleKey: string; size: number } {
  const index = key.lastIndexOf("|");
  if (index < 0) {
    return { titleKey: key, size: 0 };
  }
  return {
    titleKey: key.slice(0, index),
    size: Number.parseInt(key.slice(index + 1), 10) || 0,
  };
}

/** 只有大小、没有可用标题时的退化 key（证据强度更低，调用方需自行标注） */
export function buildSizeOnlyKey(size: number | undefined | null): string {
  return `|${Math.max(0, Math.round(size ?? 0))}`;
}