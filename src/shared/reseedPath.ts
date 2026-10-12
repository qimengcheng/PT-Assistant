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

/**
 * qBittorrent 那一套「按分类落目录」的写法前缀。这一格存的不是目录而是分类名，
 * 真实目录由下载器决定。单一来源在这里：`SentToDownloaderDialog/categoryMatch.ts` 与
 * 辅种那三处判据都从这一处拿（`packages/downloader/entity/qBittorrent.ts` 的 `category_prefix`
 * 是零修改平移来的包内代码，不动它，靠 `reseed-path-test` 那条比对断言钉住两边同值）。
 */
export const CATEGORY_FOLDER_PREFIX = "category:";

/** 这一格是不是「分类」而不是目录 */
export function isCategorySavePath(raw?: string | null): boolean {
  return typeof raw === "string" && raw.trim().startsWith(CATEGORY_FOLDER_PREFIX);
}

/** 分类表里我们吃得下的那一点形状（`/torrents/categories` 的返回值子集，方便造夹具） */
export interface IClientCategory {
  savePath?: string | null;
}

/**
 * 把 `category:电影` 翻成它真正的目录。三种拿不出目录的情形一律回 null（= 判不出）：
 * - 分类表还没取到（`categories` 为 null/undefined）；
 * - 那个分类不存在（qBittorrent 在 add 时会自建一个没有目录的分类）；
 * - 分类的 savePath 是空串 —— 那表示「跟下载器的默认目录走」，而默认目录我们手上没有。
 */
export function resolveCategoryTaskPath(
  taskPath: string,
  categories?: Record<string, IClientCategory> | null,
): string | null {
  if (!categories) return null;
  const name = taskPath.trim().slice(CATEGORY_FOLDER_PREFIX.length).trim();
  if (!name) return null;
  const savePath = categories[name]?.savePath;
  return typeof savePath === "string" && savePath.trim() !== "" ? savePath : null;
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
 *
 * `taskPath` 是 `category:电影` 时先按 `categories` 翻成真实目录再比（翻不出就判不出，
 * 见 {@link resolveCategoryTaskPath}）。这一步不是可选的修饰：那一格存的本来就是分类名，
 * 拿它当目录去比会报出一条假的「目录不一致」，而拿它当目录发给下载器的
 * `setLocation` 会当场被拒（用户 2026-10-11 点「把本地文件移到任务目录」报的 409 就是这么来的）。
 * 翻出来的是真实目录，所以提示里显示的、以及移动要发的那一份，也都是真实目录。
 */
export function detectBasePathMismatch(input: {
  basePath?: string | null;
  taskPath?: string | null;
  categories?: Record<string, IClientCategory> | null;
}): IReseedPathMismatch | null {
  const { basePath, categories } = input;
  let taskPath = input.taskPath;
  if (!basePath || !taskPath) return null;
  if (PATH_PLACEHOLDER.test(taskPath)) return null;
  if (isCategorySavePath(taskPath)) {
    const resolved = resolveCategoryTaskPath(taskPath, categories);
    if (!resolved) return null;
    taskPath = resolved;
  }
  return isSameTorrentPath(basePath, taskPath) ? null : { basePath, taskPath };
}

/** 这条任务里「基准那份」与「这一批要挂到哪」两点，写成结构型好造夹具 */
export interface IBasePathBearer {
  baseLocal?: { hash?: string | null; savePath?: string | null; moveToTaskPath?: boolean } | null;
  downloadOptions?: { savePath?: string | null } | null;
}

/** 下载器列表里这一处用得上的两点 */
export interface ILiveTorrentPath {
  infoHash?: string | null;
  savePath?: string | null;
}

/**
 * 这一格任务目录**此刻判不判得出**（`detectBasePathMismatch` 返回 null 有两种意思，
 * 这里要的是「判得出且一致」那一种）：占位符展开后每条各是一个目录、分类名还没翻出真实目录，
 * 都属于「不知道」，不能当成「已经对上了」。
 */
function isTaskPathResolvable(
  taskPath?: string | null,
  categories?: Record<string, IClientCategory> | null,
): boolean {
  if (!taskPath || PATH_PLACEHOLDER.test(taskPath)) return false;
  return !isCategorySavePath(taskPath) || !!resolveCategoryTaskPath(taskPath, categories);
}

/**
 * 按下载器刚报的那份列表，把「基准那份数据此刻在哪」刷新一遍，返回**真的改过路径**的那几条
 * （写回存储归调用方）。
 *
 * 不刷的话，用户自己搬完文件、或刚点过那颗「把本地文件移到任务目录」已经落地，界面上那条
 * 「目录不一致」还会挂着 —— 拿一个建任务时记下的快照去判现在的事实，就是误报。
 * 「落地没有」**只有这一条判据**（路径变了、且按新路径确定地对上了），盯移动的那几趟不另判一套。
 * 注意「确定」那两个字：判不出（分类表还没取到 / 目录里带占位符）时**不清** `moveToTaskPath`，
 * 否则盯梢会把「不知道」报成「已搬到任务目录」。
 */
export function refreshBaseLocalPaths<T extends IBasePathBearer>(
  list: T[],
  torrents: ILiveTorrentPath[],
  categories?: Record<string, IClientCategory> | null,
): T[] {
  const dirty: T[] = [];
  for (const task of list) {
    if (!task.baseLocal) continue;
    const baseHash = String(task.baseLocal.hash ?? "").toLowerCase();
    const livePath = torrents.find((x) => String(x.infoHash ?? "").toLowerCase() === baseHash)?.savePath;
    if (!livePath || livePath === task.baseLocal.savePath) continue;
    task.baseLocal.savePath = livePath;
    const taskPath = task.downloadOptions?.savePath;
    const sameNow = !detectBasePathMismatch({ basePath: livePath, taskPath, categories });
    if (isTaskPathResolvable(taskPath, categories) && sameNow) delete task.baseLocal.moveToTaskPath;
    dirty.push(task);
  }
  return dirty;
}
