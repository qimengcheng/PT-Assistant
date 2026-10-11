/**
 * 自动辅种那条链上的**四次**进展通知：文案与时长格式化只有这一份。
 *
 * 为什么不走 i18n：service worker 里拿不到 `useI18n`（同 `background/utils/updateCheck.ts`
 * 的 `notifyText` 那条取舍）。而这一份文案有**两个出口** —— 用户不在插件页面时由后台弹
 * 浏览器通知，在插件页面时由界面弹 snakebar。两处各写一遍，迟早分叉成
 * 「通知栏说的和界面说的不一样」，所以两边都读这里的 `reseedNoticeText`。
 *
 * 本模块**不碰 chrome / 存储 / DOM**，能直接拿 Node 跑断言（`.tmp-build/reseed-notice-test.mjs`）。
 * 那两个存储键在 `src/shared/reseedPresence.ts`。
 */

export type TReseedNoticeKind =
  /** 基准那条已经交给下载器，开始下全量 */
  | "baseStarted"
  /** 基准下到一半（带预计剩余时间） */
  | "baseHalfway"
  /** 基准下完，并且把辅种那几条推给了下载器 */
  | "baseDone"
  /** 这个任务的辅种条目全部正常做种 */
  | "allSeeded";

export interface IReseedNotice {
  kind: TReseedNoticeKind;
  taskId: string;
  /** 任务标题（就是基准那一条的种子名） */
  title: string;
  /** baseHalfway：下载器报的 0~100 */
  progress?: number;
  /** baseHalfway：还要多久（秒）。下载器没报速度时给不出来，那一句就不写 */
  etaSec?: number;
  /** baseDone：这一批推过去几条 */
  count?: number;
  /** 发出时刻：界面按它去重，避免同一件事弹两遍 */
  at: number;
}

/** snakebar 的颜色档位（浏览器通知没有这个概念，忽略即可） */
export function reseedNoticeColor(kind: TReseedNoticeKind): "success" | "info" {
  return kind === "baseDone" || kind === "allSeeded" ? "success" : "info";
}

/**
 * 把秒数说成人话。
 * 判据按档位走：不到 1 分钟 / N 分 / N 小时 M 分 / N 天 M 小时。
 * 不给「1.4 小时」这种小数 —— 通知栏里读一个小数还要心算，不如给整数档位。
 */
export function formatEtaSec(sec: number, zh: boolean): string {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  if (s < 60) return zh ? "不到 1 分钟" : "under a minute";
  const min = Math.round(s / 60);
  if (min < 60) return zh ? `${min} 分钟` : `${min} min`;
  const hours = Math.floor(min / 60);
  const restMin = min % 60;
  if (hours < 24) return zh ? (restMin ? `${hours} 小时 ${restMin} 分` : `${hours} 小时`) : `${hours}h ${restMin}m`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return zh ? (restHours ? `${days} 天 ${restHours} 小时` : `${days} 天`) : `${days}d ${restHours}h`;
}

/** 四条文案。`lang === "zh_CN"` 之外一律英文（与 config.lang 的取值域一致） */
export function reseedNoticeText(notice: IReseedNotice, lang: string | undefined): { title: string; message: string } {
  const zh = lang === "zh_CN";
  const { title, kind, progress, etaSec, count } = notice;

  if (kind === "baseStarted") {
    return zh
      ? { title: "辅种开始下载基准", message: `「${title}」已交给下载器，等它把全量下完就自动去辅种` }
      : {
          title: "Reseed base downloading",
          message: `"${title}" was handed to the downloader. Reseeding starts once it finishes.`,
        };
  }

  if (kind === "baseHalfway") {
    // 没速度就没 ETA，那一半句子直接不写 —— 编一个「预计未知」比少说一句更糟
    const eta = typeof etaSec === "number" && Number.isFinite(etaSec) ? (zh ? `，预计还要 ${formatEtaSec(etaSec, true)}` : `, about ${formatEtaSec(etaSec, false)} left`) : "";
    const pct = typeof progress === "number" ? Math.round(progress) : 50;
    return zh
      ? { title: "辅种基准下到一半", message: `「${title}」已下 ${pct}%${eta}` }
      : { title: "Reseed base halfway", message: `"${title}" is ${pct}% downloaded${eta}` };
  }

  if (kind === "baseDone") {
    return zh
      ? {
          title: "基准已下完，正在辅种",
          message: `「${title}」下完了，已把 ${count ?? 0} 条辅种种子推给下载器`,
        }
      : {
          title: "Base finished, reseeding",
          message: `"${title}" is complete. ${count ?? 0} reseed torrent(s) were sent to the downloader.`,
        };
  }

  return zh
    ? { title: "辅种完成", message: `「${title}」那几条现在都在正常做种` }
    : { title: "Reseed done", message: `"${title}": every torrent is seeding normally.` };
}

/**
 * 界面 snakebar 那一行：它只有正文一栏，所以把标题和正文拼成一句。
 * 分隔符按语言走（中文全角冒号、英文半角），这件事也放在这一份里，不让调用点自己拼 ——
 * 英文界面里出现「辅种完成：...」就是那批「英文模式还拼中文」的同类 bug。
 */
export function reseedNoticeLine(notice: IReseedNotice, lang: string | undefined): string {
  const { title, message } = reseedNoticeText(notice, lang);
  return lang === "zh_CN" ? `${title}：${message}` : `${title}: ${message}`;
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
