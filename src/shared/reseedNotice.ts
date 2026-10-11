/**
 * 自动辅种那条链上的**五类**通知（四类进展 + 一类要人处理的「下载停滞」）：文案与时长格式化只有这一份。
 *
 * 为什么不走 i18n：service worker 里拿不到 `useI18n`（同 `background/utils/updateCheck.ts`
 * 的 `notifyText` 那条取舍）。而这一份文案有**两个出口** —— 用户不在插件页面时由后台弹
 * 浏览器通知，在插件页面时由界面右上角弹 notification 卡片。两处各写一遍，迟早分叉成
 * 「通知栏说的和界面说的不一样」，所以两边都读这里的 `reseedNoticeGroupText`。
 *
 * **一轮里同一类事件合成一条**：后台那一分钟的循环会翻好几条任务，同一类事件于是可能一次出好几条
 * （他 2026-10-11 的截图就是四条「辅种完成」并排堆着）。它们说的是同一件事，所以按 kind 合并，
 * 明细列在正文下面。`items.length === 1` 时**原样走单条那套文案** —— 合并不能把单条时验收过的措辞改掉。
 *
 * 本模块**不碰 chrome / 存储 / DOM**，能直接拿 Node 跑断言（`.tmp-build/reseed-notice-test.mjs`）。
 * 那两个存储键在 `src/shared/reseedPresence.ts`。
 */

export type TReseedNoticeKind =
  /** 基准那条已经交给下载器，开始下全量 */
  | "baseStarted"
  /** 基准下到一半（带预计剩余时间） */
  | "baseHalfway"
  /** 基准长时间没有进展（没源 / 限速成 0 那种），要人去看一眼 */
  | "baseStalled"
  /** 基准下完，并且把辅种那几条推给了下载器 */
  | "baseDone"
  /** 这个任务的辅种条目全部正常做种 */
  | "allSeeded";

/** 一条任务在某这一类事件里的明细 */
export interface IReseedNoticeItem {
  /** 任务标题（就是基准那一条的种子名） */
  title: string;
  /** baseHalfway / baseStalled：下载器报的 0~100 */
  progress?: number;
  /** baseHalfway：还要多久（秒）。下载器没报速度时给不出来，那一句就不写 */
  etaSec?: number;
  /** baseStalled：已经多久没有进展（秒） */
  stalledSec?: number;
  /** baseDone：这一批推过去几条 */
  count?: number;
}

/** 一条事件 = 一类 + 一条任务（单条文案吃这一份） */
export type TReseedNotice = IReseedNoticeItem & { kind: TReseedNoticeKind };

/** 同一轮里同一类事件的合并结果 */
export interface IReseedNoticeGroup {
  kind: TReseedNoticeKind;
  items: IReseedNoticeItem[];
}

/**
 * 后台一轮写进 session 存储的那一份（一类一组）。界面按它弹卡片，一类一张、同类替换不堆叠。
 */
export interface IReseedNoticeBatch {
  /**
   * 写入时刻。存储那条路只在**值变了**时才回调，而连续两轮的内容有可能一字不差
   * （同样的任务、同样的百分比）；这个时刻保证它仍算「新的一次通知」，不会静默丢掉。
   */
  at: number;
  groups: IReseedNoticeGroup[];
}

/** 界面卡片最多列几条明细，剩下的并成一句「另有 N 个任务」 */
export const RESEED_NOTICE_DETAIL_MAX = 3;

/** 界面卡片的类型档（浏览器通知没有这个概念，忽略即可） */
export function reseedNoticeColor(kind: TReseedNoticeKind): "success" | "info" | "warning" {
  if (kind === "baseDone" || kind === "allSeeded") return "success";
  // 「没有进展」是要人去处理的，不是进度播报 —— 和那几条进展通知一个颜色就会被当成同一类读掉
  return kind === "baseStalled" ? "warning" : "info";
}

const NOTICE_TITLES: Record<TReseedNoticeKind, { zh: string; en: string }> = {
  baseStarted: { zh: "辅种基准开始下载", en: "Reseed base downloading" },
  baseHalfway: { zh: "辅种基准下载过半", en: "Reseed base halfway" },
  baseStalled: { zh: "辅种基准下载停滞", en: "Reseed base stalled" },
  baseDone: { zh: "基准下载完成，正在辅种", en: "Base finished, reseeding" },
  allSeeded: { zh: "辅种完成", en: "Reseed done" },
};

/** 标题说的是**这件事是哪一类**，与这一轮里有几条无关 —— 所以合并前后用同一句 */
export function reseedNoticeTitle(kind: TReseedNoticeKind, lang: string | undefined): string {
  return lang === "zh_CN" ? NOTICE_TITLES[kind].zh : NOTICE_TITLES[kind].en;
}

/**
 * 把一段时长说成可读的话（「还需多久」和「已多久无进展」用的是同一套档位）。
 * 判据按档位走：不足 1 分钟 / N 分钟 / N 小时 M 分 / N 天 M 小时。
 * 不给「1.4 小时」这种小数 —— 通知栏里读一个小数还要心算，不如给整数档位。
 */
export function formatDurationSec(sec: number, zh: boolean): string {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  if (s < 60) return zh ? "不足 1 分钟" : "under a minute";
  const min = Math.round(s / 60);
  if (min < 60) return zh ? `${min} 分钟` : `${min} min`;
  const hours = Math.floor(min / 60);
  const restMin = min % 60;
  if (hours < 24) return zh ? (restMin ? `${hours} 小时 ${restMin} 分` : `${hours} 小时`) : `${hours}h ${restMin}m`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return zh ? (restHours ? `${days} 天 ${restHours} 小时` : `${days} 天`) : `${days}d ${restHours}h`;
}

/** 五条文案（单条事件用这一份；合并后的那一条走 `reseedNoticeGroupText`） */
export function reseedNoticeText(notice: TReseedNotice, lang: string | undefined): { title: string; message: string } {
  const zh = lang === "zh_CN";
  const { title, kind, progress, etaSec, stalledSec, count } = notice;

  if (kind === "baseStarted") {
    return zh
      ? { title: reseedNoticeTitle(kind, lang), message: `「${title}」已提交至下载器，待其下载完成后将自动开始辅种` }
      : {
          title: reseedNoticeTitle(kind, lang),
          message: `"${title}" was submitted to the downloader. Reseeding starts once it finishes.`,
        };
  }

  if (kind === "baseHalfway") {
    // 没有速度就没有 ETA，那半句整个不写 —— 编一个「预计未知」比少说一句更糟
    const eta = typeof etaSec === "number" && Number.isFinite(etaSec) ? (zh ? `，预计还需 ${formatDurationSec(etaSec, true)}` : `, about ${formatDurationSec(etaSec, false)} left`) : "";
    const pct = typeof progress === "number" ? Math.round(progress) : 50;
    return zh
      ? { title: reseedNoticeTitle(kind, lang), message: `「${title}」已下载 ${pct}%${eta}` }
      : { title: reseedNoticeTitle(kind, lang), message: `"${title}" is ${pct}% downloaded${eta}` };
  }

  if (kind === "baseStalled") {
    // 措辞说的是「无下载进展」，不是「一点没下」—— 判据看的是已下字节有没有变（见 planAutoReseed），
    // 下到 3% 停住那种同样会进来，写成「一点没下」就是另一句假话。
    const durSec = typeof stalledSec === "number" && Number.isFinite(stalledSec) ? stalledSec : undefined;
    // 拿不到时长时不编一个档位，也不用「很久」去补那半句（不成句），整句换成不需要数的写法。
    // 后台那条路永远给得出时长，这一支只是兜底。
    const when = zh
      ? durSec === undefined
        ? "已有一段时间无下载进展"
        : `已有 ${formatDurationSec(durSec, true)}无下载进展`
      : durSec === undefined
        ? "has made no progress for a while"
        : `has made no progress for ${formatDurationSec(durSec, false)}`;
    // 判据用 typeof 而不是真假值：他截图那一格就是 0%，`progress &&` 会把这条最该说的读数吞掉
    const pct = typeof progress === "number" ? (zh ? `，当前进度 ${Math.round(progress)}%` : `, at ${Math.round(progress)}%`) : "";
    return zh
      ? {
          title: reseedNoticeTitle(kind, lang),
          message: `「${title}」的基准${when}${pct}，请检查下载器是否存在可用来源`,
        }
      : {
          title: reseedNoticeTitle(kind, lang),
          message: `"${title}": the base ${when}${pct}. Check whether the torrent has any peers.`,
        };
  }

  if (kind === "baseDone") {
    return zh
      ? {
          title: reseedNoticeTitle(kind, lang),
          message: `「${title}」已完成下载，已推送 ${count ?? 0} 条辅种种子至下载器`,
        }
      : {
          title: reseedNoticeTitle(kind, lang),
          message: `"${title}" is complete. ${count ?? 0} reseed torrent(s) were sent to the downloader.`,
        };
  }

  return zh
    ? { title: reseedNoticeTitle(kind, lang), message: `「${title}」的全部条目均已正常做种` }
    : { title: reseedNoticeTitle(kind, lang), message: `"${title}": every torrent is seeding normally.` };
}

/** 合并后的正文：说的是「这一轮有 N 条任务走到了这一步」，具体是哪几条由明细行列出 */
function groupSummary(kind: TReseedNoticeKind, total: number, zh: boolean): string {
  if (kind === "baseStarted") {
    return zh
      ? `${total} 个任务的基准已提交至下载器，待其下载完成后将自动开始辅种`
      : `The bases of ${total} tasks were submitted to the downloader. Reseeding starts once each of them finishes.`;
  }
  if (kind === "baseHalfway") {
    return zh
      ? `${total} 个任务的基准已下载过半`
      : `The bases of ${total} tasks are over halfway downloaded.`;
  }
  if (kind === "baseStalled") {
    return zh
      ? `${total} 个任务的基准长时间无下载进展，请检查下载器是否存在可用来源`
      : `The bases of ${total} tasks have made no download progress for a while. Check whether they have any peers.`;
  }
  if (kind === "baseDone") {
    return zh
      ? `${total} 个任务的基准已完成下载，对应的辅种种子已推送至下载器`
      : `The bases of ${total} tasks finished downloading; their reseed torrents were sent to the downloader.`;
  }
  return zh ? `${total} 个任务的全部条目均已正常做种` : `Every torrent of ${total} tasks is seeding normally.`;
}

/**
 * 一条明细：任务名 + 这一类用得上的那几个读数。
 *
 * 括号里只放**数字**，不重复正文那句话 —— 四条并排时读的是「哪几条、各卡在哪」，
 * 每条再来一句完整陈述就没人读了。没有读数的那两类（已开始、全部做种）就只留任务名。
 */
export function reseedNoticeItemLine(kind: TReseedNoticeKind, item: IReseedNoticeItem, lang: string | undefined): string {
  const zh = lang === "zh_CN";
  const named = zh ? `「${item.title}」` : `"${item.title}"`;
  const parts: string[] = [];

  if (kind === "baseHalfway") {
    const pct = typeof item.progress === "number" ? Math.round(item.progress) : 50;
    parts.push(zh ? `已下载 ${pct}%` : `${pct}% downloaded`);
    if (typeof item.etaSec === "number" && Number.isFinite(item.etaSec)) {
      parts.push(zh ? `预计还需 ${formatDurationSec(item.etaSec, true)}` : `about ${formatDurationSec(item.etaSec, false)} left`);
    }
  } else if (kind === "baseStalled") {
    const dur = typeof item.stalledSec === "number" && Number.isFinite(item.stalledSec) ? item.stalledSec : undefined;
    parts.push(
      zh
        ? dur === undefined
          ? "已有一段时间无下载进展"
          : `已有 ${formatDurationSec(dur, true)}无下载进展`
        : dur === undefined
          ? "no progress for a while"
          : `no progress for ${formatDurationSec(dur, false)}`,
    );
    if (typeof item.progress === "number") {
      parts.push(zh ? `当前进度 ${Math.round(item.progress)}%` : `at ${Math.round(item.progress)}%`);
    }
  } else if (kind === "baseDone") {
    parts.push(zh ? `已推送 ${item.count ?? 0} 条` : `${item.count ?? 0} reseed torrent(s) sent`);
  }

  if (parts.length === 0) return named;
  return zh ? `${named}（${parts.join("，")}）` : `${named} (${parts.join(", ")})`;
}

/** 标题 + 正文。一条任务时**与单条文案一字不差**，多条时才换成汇总句 */
export function reseedNoticeGroupText(group: IReseedNoticeGroup, lang: string | undefined): { title: string; message: string } {
  const zh = lang === "zh_CN";
  if (group.items.length === 1) return reseedNoticeText({ kind: group.kind, ...group.items[0] }, lang);
  return { title: reseedNoticeTitle(group.kind, lang), message: groupSummary(group.kind, group.items.length, zh) };
}

/**
 * 明细行（最多 `RESEED_NOTICE_DETAIL_MAX` 条，剩下的并成一句）。
 * 只有一条任务时返回空数组 —— 那条任务名正文里已经写了，再列一遍是新 bug。
 */
export function reseedNoticeGroupDetails(group: IReseedNoticeGroup, lang: string | undefined): string[] {
  if (group.items.length <= 1) return [];
  const zh = lang === "zh_CN";
  const lines = group.items.slice(0, RESEED_NOTICE_DETAIL_MAX).map((item) => reseedNoticeItemLine(group.kind, item, lang));
  const rest = group.items.length - lines.length;
  if (rest > 0) lines.push(zh ? `另有 ${rest} 个任务` : `${rest} more task${rest > 1 ? "s" : ""}`);
  return lines;
}

/** 浏览器系统通知那一条的正文：通知栏没有「明细区」，只能把汇总和明细拼成一段多行文本 */
export function reseedNoticeGroupMessage(group: IReseedNoticeGroup, lang: string | undefined): string {
  const { message } = reseedNoticeGroupText(group, lang);
  const details = reseedNoticeGroupDetails(group, lang);
  return details.length === 0 ? message : `${message}\n${details.join("\n")}`;
}

/**
 * 从下载器报的那一条算还要多久（秒），给不出就返回 undefined。
 *
 * 不用各家客户端自己那个 eta 字段：`CTorrent` 归一化之后没有它（只有 raw 里有，
 * 而 raw 的形状每家的驱动都不一样），并且归一层已经给了更基本的三样 —— 总大小、
 * 已下字节、当前速度。速度为 0（没连上 peer、限速中）时**不猜**：那种情况下任何
 * 数字都是假的，界面/通知里就少说那半句。
 */
export function estimateEtaSec(torrent: {
  totalSize?: number;
  totalDownloaded?: number;
  downloadSpeed?: number;
  progress?: number;
  isCompleted?: boolean;
}): number | undefined {
  if (!torrent || torrent.isCompleted) return undefined;
  const speed = Number(torrent.downloadSpeed);
  if (!Number.isFinite(speed) || speed <= 0) return undefined;
  const size = Number(torrent.totalSize);
  const done = Number(torrent.totalDownloaded);
  let remain: number;
  if (Number.isFinite(size) && size > 0 && Number.isFinite(done) && done >= 0 && done <= size) {
    remain = size - done;
  } else if (Number.isFinite(size) && size > 0 && Number.isFinite(Number(torrent.progress))) {
    remain = size * (1 - Math.min(100, Math.max(0, Number(torrent.progress))) / 100);
  } else {
    return undefined;
  }
  if (remain <= 0) return 0;
  const sec = remain / speed;
  // 下载器偶尔回一个几小时以外的怪值（速度刚跳变、字节数还没更新），超过一天就当不可信
  return Number.isFinite(sec) && sec <= 86400 * 2 ? Math.round(sec) : undefined;
}
