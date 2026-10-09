/**
 * 「把 .torrent 算成一份可比对的验证信息」这一步，单独成模块只为了能在 Node 里直接跑断言
 * （`.tmp-build/keep-upload-torrent-verify-test.mjs`）：住在 download.ts 里时，它前面挂着
 * 站点实例 + axios，验它得起一整套网络桩。
 *
 * 这一步是辅种判定的源头，而它出过一次**静默**事故：`getRemoteTorrentFile` 当年只返回
 * `{ name, metadata, info }`，接口却把 `infoHash / files / pieces` 都声明好了，那句
 * `as ParsedTorrent` 把「一个字段都没带出来」在类型上糊掉（经过与量到的数字见 `packages/downloader/utils.ts`
 * 返回处那段注释）。所以这里配了断言，别再靠肉眼。
 */
import type { ParsedTorrent } from "@ptd/downloader/utils.ts";
import type { ITorrent } from "@ptd/site";

import type { ITorrentInfoForVerification } from "@/messages.ts";
import { buildTitleSizeKey, computeFilesFingerprint, samplePieces } from "@/shared/fingerprint/index.ts";

/**
 * 站点侧那一条种子的三层信息。
 *
 * rootName 用**种子内部名**（`info.name`），不是 `parsed.name` —— 后者是下载文件名
 * （站点常给成 `12345.torrent`）。parse-torrent 的 `files[].path` 是「种子名 + 相对路径」，
 * 实测 Windows 上是 `MovieDir\a.mkv`；`stripRootDirectory` 要按这个根名精确剥一层，
 * 才和下载器那边（qBittorrent `/torrents/files` 传的是 `fileList.name`）对得上。
 * 根名给错就一条都剥不掉，两边清单差一层目录，第 2 层永远判不相等。
 */
export async function buildTorrentInfoForVerification(
  parsed: ParsedTorrent,
  torrent: Pick<ITorrent, "title" | "size">,
): Promise<ITorrentInfoForVerification> {
  const info = parsed.info;
  const length = info.length ?? parsed.length ?? 0;
  const files = (parsed.files ?? []).map((file) => ({ path: file.path, length: file.length }));

  return {
    infoHash: parsed.infoHash ?? info.infoHash ?? "",
    name: info.name ?? "unknown",
    length,
    files,
    /**
     * 单文件 / 多文件**不在这里判**：实测 parse-torrent 会把单文件种也归一成
     * `files: [{ path: "<种子名>", length: 总长 }]`，所以在这儿看 `info.files` 永远是"多文件"。
     * 交给 `computeFilesFingerprint` 自己按清单条数折档 —— 下载器侧（qBittorrent `/torrents/files`）
     * 拿到的也是同一形状，两边才能算出同一个指纹。
     */
    filesFingerprint: await computeFilesFingerprint({ rootName: info.name, length, files }),
    // 第 3 层：piece 哈希抽样（权威但贵，所以只带抽样结果）
    piecesSample: samplePieces(parsed.pieces, { pieceLength: parsed.pieceLength }),
    // 第 1 层用站点标题（各站标题写法差异很大，归一化后跨站可比）
    titleKey: buildTitleSizeKey(torrent.title || parsed.name, torrent.size ?? parsed.length),
  };
}
