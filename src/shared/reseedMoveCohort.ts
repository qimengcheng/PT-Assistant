/**
 * 「把本地文件移到任务目录」这一颗开关，除了基准之外还要带上哪几条种子。
 *
 * 为什么需要这一份（用户 2026-10-14）：同一份内容在 qBittorrent 里往往是**好几条**种子
 * （每个站一条，13 条副本共用同一个文件夹）。基准那条一搬，盘上那个文件夹就跟着走了，
 * 其余那几条还指着旧目录 ⇒ 第二天开下载器一排「丢失文件」。原先两处调用点都只发基准那一条
 * （`KeepUploadTask/Index.vue` 的 `moveLocalBaseToTaskPath`、`KeepUploadDialog.vue` 的同名函数），
 * 所以"以后一起改"这件事得有一个地方说清"哪些算相关"。
 *
 * 判据是**同一个目录 + 同一个种子名**这两条合起来：qBittorrent 落盘是 `savePath/<种子名>/`，
 * 所以这两条同时相等就意味着它们指向盘上同一个文件夹 —— 也就是会被这一次搬运带走的那一份。
 *
 * 两条刻意的取舍：
 * - **不比大小**。`CTorrent.totalSize` 与指纹索引里的 `size` 在两边含义不同（后者可能是"已选
 *   大小"，见 `src/shared/fingerprint/types.ts` 的 `size` / `totalSize` 两行注释），比了会把
 *   真副本判没。同目录同名已经足够定位那个文件夹。
 * - **只认指向旧目录的**。同一个父目录下放着别的种子（`savePath` 相同但种子名不同）不进来 ——
 *   那些的内容在各自的子文件夹里，这次搬运不会碰到它们。
 *
 * 这一条判据在模板里、也在消息往返里，vue-tsc / ESLint 都看不见它坏没坏，所以搬到这里，
 * 由 `tests/shared/reseedMoveCohort.test.ts` 钉住。
 */
import { isSameTorrentPath, normalizeTorrentPath } from "./reseedPath.ts";

/** 下载器列表里这一处用得上的几点（`CTorrent` 与指纹索引条目都能映射过来） */
export interface ICohortTorrent {
  /** 这条种子在下载器里的 infoHash */
  hash: string;
  /** 种子名（qBittorrent 的落盘子文件夹就是它） */
  name?: string;
  /** 这条种子此刻所在的目录 */
  savePath?: string;
}

export interface IRelocateCohort {
  /**
   * 要一起改目录的那几条，**基准排在最前**。
   *
   * 顺序不能反：真正被搬走的是基准那一条的存储（它已完成，下载器会挪文件），后面那几条只是
   * 把落点改到新目录。基准必须成功，否则发送那道闸永远不放行。
   */
  hashes: string[];
  /** 其中不属于这一条任务的条数（既不是基准、也不在 items 里）—— 界面按这个数说清"顺带搬了别的" */
  outsideTaskCount: number;
}

const normHash = (raw?: string | number | null) => String(raw ?? "").trim().toLowerCase();

/**
 * @param input.torrents 该下载器当前的全部种子
 * @param input.baseHash 基准那条的 infoHash
 * @param input.oldPath  基准搬之前所在那个目录（`detectBasePathMismatch` 的 `basePath`）
 * @param input.newPath  这一批要挂到的目录（同上的 `taskPath`，已翻成真实目录）
 * @param input.itemHashes 这条任务里其余各条记着的 infoHash（没记的跳过）
 */
export function pickRelocateCohort(input: {
  torrents: readonly ICohortTorrent[];
  baseHash: string;
  oldPath: string;
  newPath: string;
  itemHashes?: readonly (string | number | null | undefined)[];
}): IRelocateCohort {
  const baseHash = normHash(input.baseHash);
  const only = { hashes: baseHash ? [baseHash] : [], outsideTaskCount: 0 };

  // 判不出就不牵连：目录缺一个（含只有一串空格的）、两个本来就相同、列表没拿到，都退回只搬基准
  if (
    !baseHash ||
    !normalizeTorrentPath(input.oldPath) ||
    !normalizeTorrentPath(input.newPath) ||
    isSameTorrentPath(input.oldPath, input.newPath)
  ) {
    return only;
  }

  const base = input.torrents.find((x) => normHash(x.hash) === baseHash);
  if (!base) return only;

  const itemHashes = new Set((input.itemHashes ?? []).map(normHash).filter(Boolean));

  /** 去重：同一份列表里理论上不会有两条同 hash，但下载器报重复时不该把同一个 setLocation 发两遍 */
  const cohort = new Set<string>();
  for (const torrent of input.torrents) {
    const hash = normHash(torrent.hash);
    if (!hash || hash === baseHash || cohort.has(hash)) continue;
    if (!isSameTorrentPath(torrent.savePath, input.oldPath)) continue;

    const sameContentFolder = !!torrent.name && torrent.name === base.name;
    if (!sameContentFolder && !itemHashes.has(hash)) continue;

    cohort.add(hash);
  }

  let outsideTaskCount = 0;
  for (const hash of cohort) if (!itemHashes.has(hash)) outsideTaskCount += 1;

  return { hashes: [baseHash, ...cohort], outsideTaskCount };
}
