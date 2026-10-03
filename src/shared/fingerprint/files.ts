/**
 * 第 2 层指纹：文件清单指纹（主力判定层）。
 *
 *     fp = sha256( 排序后的 (相对路径:字节数) 列表 )
 *
 * 之所以跨站稳：`info.files` 里只有 `{length, path[]}`，不含任何站点 / 用户
 * 特定信息（private 标志、comment、created by 都在 info 之外），所以同一份数据
 * 在不同站点生成的 .torrent 里，文件清单是完全一致的。
 *
 * 两个规范化动作缺一不可：
 *
 * 1. **剥掉共同的顶层目录**：多文件种的 `path[0]` 是根目录名，而不同人打包
 *    可能起不同的名字（`Movie.2020` / `Movie.2020.1080p`）。
 * 2. **区分单文件 / 多文件**：单文件种没有 `info.files`，只有 `info.length`，
 *    两者绝不能塞进同一个指纹格式里 —— 否则「一个 40G 的单文件」和
 *    「一堆文件加起来 40G 的多文件种」会撞出同一个指纹。
 */

import { compareStrings, sha256Hex } from "./hash.ts";
import type { IFilesFingerprint, IFilesFingerprintInput, IFingerprintFileEntry, TFingerprintKind } from "./types.ts";

/** 指纹格式版本号：将来改算法时递增，避免老指纹和新指纹被误判成「不相等」 */
const FINGERPRINT_VERSION = "v2";

/** 行内分隔符（路径里理论上可以出现换行，用 NUL 分隔更安全） */
const FIELD_SEPARATOR = String.fromCharCode(0);
const LINE_SEPARATOR = "\n";

/** 把单条路径规范化：统一分隔符、去首尾 ./ 与 /、NFC 归一 */
function normalizeFilePath(path: string[] | string): string {
  const raw = Array.isArray(path) ? path.join("/") : String(path ?? "");
  return raw
    .normalize("NFC")
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .join("/");
}

/**
 * 剥离顶层目录。
 *
 * 只在**知道根目录名**时才剥，而且必须每一条路径都命中该前缀：
 *
 * - .torrent 侧的 `info.files[].path` 本来就不含根目录 → 不触发，天然对齐；
 * - 下载器侧（qBittorrent 的 `/torrents/files`）可能带根目录 → 命中则剥掉；
 *   万一某个客户端不带根目录，同样不触发。
 *
 * 之所以**不做**「所有条目共享的顶层目录就剥掉」这种泛化猜测：那会让
 * `根目录/extras/a.mkv` 和 `根目录/a.mkv` 两种不同布局算出同一个指纹，
 * 把「本地已有」误判出来 —— 这正是本项目最不能犯的错。猜错的方向必须是
 * 「判不出来」（假阴性，代价只是少辅一个种子），而不是「判成同一份数据」。
 */
function stripRootDirectory(entries: IFingerprintFileEntry[], rootName?: string): IFingerprintFileEntry[] {
  const root = normalizeFilePath(rootName ?? "");
  if (!root) {
    return entries;
  }

  const prefix = `${root}/`;
  if (!entries.every((entry) => entry.path.startsWith(prefix))) {
    return entries;
  }

  const stripped = entries.map((entry) => ({ path: entry.path.slice(prefix.length), size: entry.size }));
  // 剥完不能出现空路径，否则说明根目录名判断错了，保持原样更安全
  return stripped.every((entry) => entry.path) ? stripped : entries;
}

/** 规范化 + 排序文件清单（排序用 code unit 比较，不能用 localeCompare —— 结果依赖运行时 locale） */
export function normalizeFileEntries(input: IFilesFingerprintInput): IFingerprintFileEntry[] {
  const entries = (input.files ?? [])
    .map((file) => ({
      path: normalizeFilePath(file.path),
      size: Math.max(0, Math.round(file.length ?? 0)),
    }))
    .filter((entry) => entry.path.length > 0);

  entries.sort((a, b) => compareStrings(a.path, b.path) || a.size - b.size);
  return entries;
}

/** 把规范化后的清单拼成待哈希的规范串 */
function buildCanonicalText(kind: TFingerprintKind, entries: IFingerprintFileEntry[], totalSize: number): string {
  if (kind === "single") {
    return `${FINGERPRINT_VERSION}${FIELD_SEPARATOR}single${FIELD_SEPARATOR}${totalSize}`;
  }
  const lines = entries.map((entry) => `${entry.size}${FIELD_SEPARATOR}${entry.path}`);
  return [
    `${FINGERPRINT_VERSION}${FIELD_SEPARATOR}multi${FIELD_SEPARATOR}${entries.length}`,
    ...lines,
  ].join(LINE_SEPARATOR);
}

/**
 * 计算第 2 层指纹。
 *
 * @param input `info` 的等价物：`{ rootName, length, files }`
 * @returns 单文件种 / 多文件种各自独立的指纹
 */
export async function computeFilesFingerprint(input: IFilesFingerprintInput): Promise<IFilesFingerprint> {
  const entries = normalizeFileEntries(input);

  if (entries.length === 0) {
    // 单文件种：只用 info.length（名字不参与，名字在各站差异最大）
    const totalSize = Math.max(0, Math.round(input.length ?? 0));
    return {
      kind: "single",
      fileCount: 1,
      totalSize,
      fingerprint: await sha256Hex(buildCanonicalText("single", [], totalSize)),
    };
  }

  const stripped = stripRootDirectory(entries, input.rootName);
  const totalSize = stripped.reduce((sum, entry) => sum + entry.size, 0);

  return {
    kind: "multi",
    fileCount: stripped.length,
    totalSize,
    fingerprint: await sha256Hex(buildCanonicalText("multi", stripped, totalSize)),
  };
}

/** 仅在需要「逐条比对」时调用（例如找出缺了哪些文件） */
export function getNormalizedFileEntries(input: IFilesFingerprintInput): IFingerprintFileEntry[] {
  return stripRootDirectory(normalizeFileEntries(input), input.rootName);
}

/**
 * 两份文件清单的差异，用于「本地已有但缺文件」这类提示。
 *
 * 只在两边都是多文件种时有意义；单文件种请直接比大小。
 */
export function diffFileLists(
  source: IFilesFingerprintInput,
  target: IFilesFingerprintInput,
): { missing: IFingerprintFileEntry[]; extra: IFingerprintFileEntry[] } {
  const sourceEntries = getNormalizedFileEntries(source);
  const targetEntries = getNormalizedFileEntries(target);

  const targetMap = new Map(targetEntries.map((entry) => [entry.path, entry.size]));
  const sourceMap = new Map(sourceEntries.map((entry) => [entry.path, entry.size]));

  const missing = sourceEntries.filter((entry) => targetMap.get(entry.path) !== entry.size);
  const extra = targetEntries.filter((entry) => sourceMap.get(entry.path) !== entry.size);

  return { missing, extra };
}