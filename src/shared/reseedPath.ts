/**
 * 辅种任务里「基准那份数据实际躺在哪个目录」与「这一批种子要挂到哪个目录」对不对得上。
 *
 * 为什么要单独判这一处：基准取自下载器（任务上的 `baseLocal`）时，那份数据本来就在盘上，
 * 发出去的每一条都带 `skip_checking`（判据见 `KeepUploadTask/sendOptions.ts`）—— 等于告诉下载器
 * 「数据不用查，盘上就有」。数据在 A 而任务目录是 B，下载器按 B 去找当然找不到，那一条要么当场
 * 报错、要么挂着 0 字节做种。用户 2026-10-11 报的就是这个形状：
 * 「本地已有，所以直接推了其他种子，但是失败了…原来是目录不一样，所以失败也是必然」。
 *
 * 三种判不出（一律返回 null，**宁可漏提示也不误报** —— 误报会让人去"修"一个根本没坏的东西）：
 * - 任务目录为空：那是「让下载器用它自己的默认」，我们不知道它会落到哪；
 * - 任务目录里有 `$torrent.title$` 这类宏：展开后每条各是一个目录，没法跟基准比；
 * - 基准那条没有 savePath：旧任务或下载器根本没报这个字段。
 */

/**
 * 发送时才展开的占位符：`$torrent.title$` / `$date:YYYY$` 这类宏，以及 `<...>` 那个
 * 「弹输入框现填」的写法（见 `SentToDownloaderDialog/utils.ts`）。两种都会让这一格在
 * 每条种子上展开成不同目录，没法拿来跟基准比。
 */
const PATH_PLACEHOLDER = /\$[^$]+\$|<\.{3}>/;

/**
 * 归一成一个可比较的形状：统一分隔符、折叠重复斜杠、去掉尾部斜杠。
 *
 * 折叠要放过开头的 `//`：那是 UNC 路径（`\\\\nas\\share` 归一后就是 `//nas/share`），
 * 折成 `/nas/share` 会把服务器名变成一个普通目录。
 */
export function normalizeTorrentPath(raw?: string | null): string {
  if (typeof raw !== "string") return "";

  const body = raw.trim().replace(/\\/g, "/");
  const unc = body.startsWith("//") ? "//" : "";
  let path = unc + body.slice(unc.length).replace(/\/{2,}/g, "/");
  while (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return path;
}

/**
 * 像 Windows 的路径（盘符或 UNC）：只有这一类按不区分大小写比。
 * Linux / 群晖 / QNAP 上 `/vol1/A` 与 `/vol1/a` 是两个目录，按同一个判就会把真不一致放过去。
 */
function isWindowsStylePath(path: string): boolean {
  return /^[a-zA-Z]:\//.test(path) || path.startsWith("//");
}

/** 两个目录是不是同一处。任一侧为空算「不同」（空串不是一个目录，判不出同一处） */
export function isSameTorrentPath(a?: string | null, b?: string | null): boolean {
  const left = normalizeTorrentPath(a);
  const right = normalizeTorrentPath(b);
  if (!left || !right) return false;
  if (isWindowsStylePath(left) && isWindowsStylePath(right)) return left.toLowerCase() === right.toLowerCase();
  return left === right;
}

export interface IReseedPathMismatch {
  /** 基准那份数据实际所在（下载器报的，或建任务时记下的那一份） */
  basePath: string;
  /** 这一批辅种种子的目标目录 */
  taskPath: string;
}

/**
 * 基准与任务目录不一致时返回那两条路径，一致或判不出返回 null。
 * 返回值里给的是**原样**（不是归一后的），界面上要显示用户/下载器写的那一份。
 */
export function detectBasePathMismatch(input: {
  basePath?: string | null;
  taskPath?: string | null;
}): IReseedPathMismatch | null {
  const { basePath, taskPath } = input;
  if (!basePath || !taskPath) return null;
  if (PATH_PLACEHOLDER.test(taskPath)) return null;
  return isSameTorrentPath(basePath, taskPath) ? null : { basePath, taskPath };
}
