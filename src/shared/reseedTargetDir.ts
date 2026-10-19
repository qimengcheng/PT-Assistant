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
import { normalizeTorrentPath, parentTorrentPath } from "./reseedPath.ts";

/** qBittorrent `TorrentContentLayout` 的三个键名原文；认不出的串会被它静默退回 `Original` */
export type TReseedContentLayout = "Original" | "Subfolder" | "NoSubfolder";

export interface IReseedTargetDir {
  /** 要写进任务的保存路径 = 数据实际所在那个目录 */
  savePath: string;
  /** 配套的内容布局。只有 `NoSubfolder` 一种会被算出来，留着这个字段是为了界面上说得清 */
  contentLayout: TReseedContentLayout;
  /**
   * 这一档的目标目录是从「基准的 `content_path` 是个**文件**」推出来的（④）。
   * 写进任务后由 `pickBaseDataPath` 读，理由见 `IKeepUploadTaskLocalBase.contentIsFile`。
   */
  contentIsFile?: boolean;
}

/**
 * 基准那条的数据目录。四条判据，任何一条不过就返回 null（= 不改现状）：
 *
 * ① `contentPath` 拿不到（老客户端、别的下载器）→ null。这一条把整个机制限死在报得出它的下载器上。
 * ② `contentPath === savePath` → 数据直接摊在保存目录里（多文件种、没有顶层目录），
 *    目标就是 `savePath`。这一档**不需要文件清单**：单文件种不可能落在这里（它必然带一段文件名）。
 * ③ `contentPath` 是 `savePath` 的**直接子项**，且文件清单里每一条都以 `<那一段>/` 开头
 *    → 它确实是顶层目录，目标就是 `contentPath`。清单为空 / 缺一条不匹配 → null。
 * ④ 清单**只有那一条**，而 `contentPath` 逐字等于 `savePath` + 那一条相对路径 ⇒ 这是**单文件种**，
 *    `content_path` 指的是那个文件本身而不是目录，目标 = **它所在那一层**（把最后一段切掉）。
 *    那一条相对路径**可以带目录**：`子目录/文件` 那种打包（一个文件装在一个文件夹里）与不带目录的
 *    裸文件走的是同一条算式，切掉最后一段就各自得到 `savePath/子目录` 与 `savePath`。
 *    这一档 v0.111.0 整个漏了、v0.113.1 只补了不带目录那一半：用户 2026-10-19 第三屏就是剩下的那一半
 *    —— 基准是「一个 `.mp4` 装在同名文件夹里」（内容面板两行：文件夹 + 文件），要挂的那站是裸文件，
 *    判据返回 null 走老路 ⇒ 裸文件被放到**上一层**，盘上那份在里面的文件夹里 ⇒ 0% 丢失文件；
 *    而同一批里另一站恰好也带同名文件夹，按原始布局落下去反而对上了 —— 所以症状是「一批里坏一条」。
 *
 * 其余形状（`contentPath` 在 `savePath` 之外，比如分类管理把数据挪走了）一律 null：判不出就别动。
 *
 * ⚠️  ④ 与 ③ 的先后不是随便排的：④ 必须排在 ③ 那句 `every` 与「顶层目录不许再往里一层」那道守卫
 * **之前**，否则带子目录的单文件种先被它们判成 null。
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
  const tail = content.slice(base.length + 1);
  if (!tail) return null;

  const paths = (input.filePaths ?? []).map((item) => normalizeTorrentPath(item)).filter((item) => item !== "");
  if (paths.length === 0) return null;

  // ④ 单文件种：清单就那一条，而 `content_path` 逐字等于 `save_path` + 那一条相对路径。
  //     必须排在下面两道守卫之前 —— `子目录/文件` 那种打包会被它们判成 null。
  //     （写成一行：反证要能把这一行整行挪到那道守卫之后，两块就得连身体一起搬）
  if (paths.length === 1 && paths[0] === tail) return singleFileBase(contentPath);

  // 再往里一层（`a/b`）就不是「顶层目录」这一档了，判不出，交给 null
  if (tail.includes("/")) return null;
  if (!paths.every((item) => item.startsWith(`${tail}/`))) return null;

  return { savePath: contentPath, contentLayout: "NoSubfolder" };
}

/**
 * ④ 那一档的结论：目标 = `content_path` 里那个文件**所在那一层**（切掉最后一段文件名）。
 *
 * 裸文件打包时那一段就是整个 `content_path` 多出来的部分 ⇒ 切完正好是 `save_path`；
 * 文件装在子目录里时切完是 `save_path/子目录`。两种都**不能**直接用 `content_path` ——
 * 那是个文件名，当目录发下去，下载器会新建一个叫 `xxx.mkv` 的目录并把整条重下一遍。
 */
function singleFileBase(rawContentPath: string): IReseedTargetDir {
  return { savePath: parentTorrentPath(rawContentPath), contentLayout: "NoSubfolder", contentIsFile: true };
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
    ...(task.baseLocal
      ? {
          baseLocal: {
            ...task.baseLocal,
            savePath: dir.savePath,
            // ④ 那一档要把「基准的 content_path 是个文件」一起记下来：目录一致性那道判据手上只有
            // 两条路径，`…/目录/文件` 这个形状它自己分不开（理由见 `IKeepUploadTaskLocalBase`）
            ...(dir.contentIsFile ? { contentIsFile: true } : {}),
          },
        }
      : {}),
  };
}
