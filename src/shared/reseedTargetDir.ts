/**
 * 辅种时「新副本要落到哪一个目录、qBittorrent 的内容布局选哪一档」（纯判据，不碰下载器）。
 *
 * 为什么要有这一处（用户 2026-10-19：「那两个暂停的是你通过一键辅种加进来的，但是无法通过校验，
 * 这是因为他们自带的文件夹名称不同，但是文件夹里的内容是相同的…需要选到已有的那个不同名的文件夹
 * 作为目标，并且在内容布局上选择不创建子文件夹才行」）：
 * 同一份内容在不同站上打包的**顶层目录名常常不一样**（他那一屏就是
 * `Toy Story 4 2019 BluRay …mUHD-FRDS` 对 `玩具总动员4.ToyStory.4.2019…mUHD-FRDS`）。
 * 只要新副本还按「原始」布局落盘，下载器就会在保存目录里**另起一个以新种子命名的空目录**，
 * 数据一条也认不出来 —— 表现为 0% 已停止，而盘上那 18.96 GiB 就在隔壁。
 *
 * 正解是他说的那两半：**目标定成数据实际所在那个目录** + **不创建子文件夹**（把新种子自带的
 * 顶层目录剥掉）。两个条件缺一不可：只换目录不换布局，会在里面再套一层；只换布局不换目录，
 * 文件会散到上一层去。
 *
 * 难点全在「content_path 到底是不是一个目录」。qBittorrent 那一格是这么定义的
 * （逐字抄自它 `src/base/bittorrent/torrent.h` 的注释）：
 * - 多文件种 = 顶层目录本身；
 * - **单文件种 = 那个文件的绝对路径**。
 * 把后者当成目录发给下载器，它会新建一个叫 `xxx.mkv` 的**目录**并把整条内容重新下一遍 ——
 * 那比现在这个 0% 坏得多。所以拿不到文件清单、或者清单不指向同一个顶层目录时一律返回 null，
 * 让这一条走改之前的老路（宁可辅不上，不许替他造一份重复数据）。
 */
import type { IKeepUploadTask } from "./types/storages/keepUploadTask.ts";
import { normalizeTorrentPath } from "./reseedPath.ts";

/** qBittorrent `TorrentContentLayout` 的三个键名原文；认不出的串会被它静默退回 `Original` */
export type TReseedContentLayout = "Original" | "Subfolder" | "NoSubfolder";

export interface IReseedTargetDir {
  /** 要写进任务的保存路径 = 数据实际所在那个目录 */
  savePath: string;
  /** 配套的内容布局。只有 `NoSubfolder` 一种会被算出来，留着这个字段是为了界面上说得清 */
  contentLayout: TReseedContentLayout;
}

/**
 * 基准那条的数据目录。四条判据，任何一条不过就返回 null（= 不改现状）：
 *
 * ① `contentPath` 拿不到（老客户端、别的下载器）→ null。这一条把整个机制限死在报得出它的下载器上。
 * ② `contentPath === savePath` → 数据直接摊在保存目录里（多文件种、没有顶层目录），
 *    目标就是 `savePath`。这一档**不需要文件清单**：单文件种不可能落在这里（它必然带一段文件名）。
 * ③ `contentPath` 是 `savePath` 的**直接子项**，且文件清单里每一条都以 `<那一段>/` 开头
 *    → 它确实是顶层目录，目标就是 `contentPath`。清单为空 / 缺一条不匹配 → null。
 * ④ 同样是直接子项，但清单**只有那一条、且它就是这一段文件名**（不带目录）→ 这是**单文件种**，
 *    `content_path` 指的是那个文件本身而不是目录，数据摊在 `savePath` 里 → 目标就是 `savePath`。
 *    这一档 v0.111.0 漏了：它被 ③ 那句「每条都在 `<顶层目录>/` 下」挡掉（裸文件名没有那段前缀），
 *    于是照旧走老路，在保存目录旁边另起一个以新种子命名的空目录（用户 2026-10-19 第二屏：
 *    同一份 20.09 GiB 的 `.mkv`，一条以文件打包、一条以目录打包，「一个有目录一个没有目录」）。
 *    名字必须逐字对上才认：对不上就是「不知道这是哪个文件」，照旧不动。
 *    已知没覆盖的一档：以 `子目录/文件` 打包的单文件种（那一条带斜杠）落不进 ④，被上面那道
 *    「再往里一层」守卫判成 null —— 判不出就不动，与改之前一样。
 *
 * 其余形状（`contentPath` 在 `savePath` 之外，比如分类管理把数据挪走了）一律 null：判不出就别动。
 *
 * ⚠️  与 ④ 的先后不是随便排的：④ 必须排在 ③ 那句 `every` **之前**，否则单文件种先被它判成 null。
 */
export function reseedTargetDirOf(input: {
  savePath?: string | null;
  contentPath?: string | null;
  /** 下载器报的文件相对路径（**含**顶层目录那一段，qBittorrent 报的就是这个形状） */
  filePaths?: readonly (string | null | undefined)[] | null;
}): IReseedTargetDir | null {
  const savePath = (input.savePath ?? "").trim();
  const contentPath = (input.contentPath ?? "").trim();
  if (!savePath || !contentPath) return null;

  const base = normalizeTorrentPath(savePath);
  const content = normalizeTorrentPath(contentPath);
  if (!base || !content) return null;

  if (content === base) return { savePath, contentLayout: "NoSubfolder" };

  if (!content.startsWith(`${base}/`)) return null;
  const rootFolder = content.slice(base.length + 1);
  // 再往里一层（`a/b`）就不是「顶层目录」这一档了，判不出，交给 null
  if (!rootFolder || rootFolder.includes("/")) return null;

  const paths = (input.filePaths ?? []).map((item) => normalizeTorrentPath(item)).filter((item) => item !== "");
  if (paths.length === 0) return null;
  // ④ 单文件种：清单里就那一条，而且它的名字正好是 `content_path` 多出来的那一段（不带目录）
  if (paths.length === 1 && paths[0] === rootFolder) return { savePath, contentLayout: "NoSubfolder" };
  if (!paths.every((item) => item.startsWith(`${rootFolder}/`))) return null;

  return { savePath: contentPath, contentLayout: "NoSubfolder" };
}

/**
 * 把算出来的那一档写进任务：目录、`baseLocal.savePath`（界面与「目录不一致」那条判据读的就是它）、
 * 以及发送时会被原样铺开的 `addTorrentOptions.advanceAddTorrentOptions.contentLayout`。
 *
 * 三个地方一起改，不是顺手多写两处：任务页那行「基准在 X / 任务目录是 Y」的提示读的是
 * `baseLocal.savePath`，只改 `downloadOptions.savePath` 会让它当场变成一句假话。
 * 传 null 时原样返回 —— 判不出就不动，别写一个空布局进去。
 */
export function applyReseedTargetDir(task: IKeepUploadTask, dir: IReseedTargetDir | null): IKeepUploadTask {
  if (!dir) return task;
  const advance = task.downloadOptions.addTorrentOptions?.advanceAddTorrentOptions ?? {};
  return {
    ...task,
    downloadOptions: {
      ...task.downloadOptions,
      savePath: dir.savePath,
      addTorrentOptions: {
        ...task.downloadOptions.addTorrentOptions,
        advanceAddTorrentOptions: { ...advance, contentLayout: dir.contentLayout },
      },
    },
    ...(task.baseLocal ? { baseLocal: { ...task.baseLocal, savePath: dir.savePath } } : {}),
  };
}
