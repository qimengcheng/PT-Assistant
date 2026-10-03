/**
 * 第 3 层：piece 哈希抽样（权威，但贵）。
 *
 * `info.pieces` 里每 20 字节是一个 piece 的 SHA1，这才是内容的真实哈希，
 * 跟命名、目录结构、私有标志全都无关。但代价不小：100 GB 的种子 ≈ 2.5 万个
 * piece ≈ 500 KB，整份比对太重，所以实际做法是**抽样**：
 *
 *     取前 N 个 + 后 N 个 piece 做哈希
 *
 * 注意 piece 哈希依赖 piece length，不同人上传同一份数据可能算出不同的
 * piece length（于是 piece 总数不同、抽样位不对齐），所以抽样比对时
 * piecesNum 对不上只能判 inconclusive，不能判 mismatch。
 */

import { compareStrings } from "./hash.ts";
import type { IPieceSample, TPieceCompareResult } from "./types.ts";

/** 单个 piece 哈希的字节数（SHA1） */
const PIECE_HASH_LENGTH = 20;

/** 默认抽样规模：头尾各 16 个，约 1.3 KB 十六进制 */
export const DEFAULT_PIECE_SAMPLE_SIZE = 16;

/**
 * 把 pieces 转成 hex 数组。
 *
 * 两种输入都兼容：
 * - `string[]`：已经是 hex（parse-torrent 的 `info.pieces` 就是这种，元素形如 40 字符 hex）
 * - `string`：原始二进制串（latin1，每 20 字节一个 SHA1），按字节切分后转 hex
 */
export function piecesToHexList(pieces: string[] | string | undefined | null): string[] {
  if (!pieces) {
    return [];
  }

  if (Array.isArray(pieces)) {
    return pieces.filter((piece) => typeof piece === "string" && piece.length > 0).map((piece) => piece.toLowerCase());
  }

  const raw = String(pieces);
  const list: string[] = [];
  for (let offset = 0; offset + PIECE_HASH_LENGTH <= raw.length; offset += PIECE_HASH_LENGTH) {
    let hex = "";
    for (let i = 0; i < PIECE_HASH_LENGTH; i++) {
      hex += (raw.charCodeAt(offset + i) & 0xff).toString(16).padStart(2, "0");
    }
    list.push(hex);
  }
  return list;
}

/**
 * 对 piece 哈希做头尾抽样。
 *
 * 传进来的如果是完整的 2.5 万元素数组，会在这里先转 hex 再抽样 —— 转换本身
 * 就没有开销可言（parse-torrent 已经转过一次），真正贵的是把它塞进消息通道，
 * 所以**调用方务必只在抽样之后的结果上做消息传递**。
 */
export function samplePieces(
  pieces: string[] | string | undefined | null,
  options: { head?: number; tail?: number; pieceLength?: number } = {},
): IPieceSample | null {
  const head = Math.max(0, options.head ?? DEFAULT_PIECE_SAMPLE_SIZE);
  const tail = Math.max(0, options.tail ?? DEFAULT_PIECE_SAMPLE_SIZE);
  const all = piecesToHexList(pieces);

  if (all.length === 0 || head + tail === 0) {
    return null;
  }

  const sampled = new Set<string>();
  for (let i = 0; i < Math.min(head, all.length); i++) {
    sampled.add(all[i] as string);
  }
  for (let i = Math.max(head, all.length - tail); i < all.length; i++) {
    sampled.add(all[i] as string);
  }

  return {
    hashes: Array.from(sampled).sort(compareStrings),
    piecesNum: all.length,
    pieceLength: options.pieceLength,
    head,
    tail,
  };
}

/**
 * 比对两边的 piece 抽样。
 *
 * - `match`        两边哈希完全一致 —— 内容确定相同
 * - `mismatch`     总数一致但抽样哈希不同 —— 内容确定不同（piece 相同则范围相同）
 * - `inconclusive` 任一边没有抽样，或 piece 总数不一致（piece length 不同，抽样位不对齐）
 */
export function comparePieceSamples(
  a: IPieceSample | null | undefined,
  b: IPieceSample | null | undefined,
): TPieceCompareResult {
  if (!a || !b) {
    return "inconclusive";
  }
  if (a.piecesNum !== b.piecesNum) {
    // piece length 不同 → 头尾抽样的字节范围不同，比了也是白比
    return "inconclusive";
  }
  if (a.pieceLength !== undefined && b.pieceLength !== undefined && a.pieceLength !== b.pieceLength) {
    return "inconclusive";
  }
  if (!a.hashes.length || !b.hashes.length) {
    return "inconclusive";
  }
  return a.hashes.join("|") === b.hashes.join("|") ? "match" : "mismatch";
}