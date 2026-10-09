/**
 * 种子指纹：跨站识别「同一份数据」的三层方案。
 *
 * 为什么不直接用 infohash：各站点的 private / comment / created by 字段都不一样，
 * 同一份数据在不同站点的 infohash 一定不同；只比标题又太松。所以分层：
 *
 *   第 1 层 normalizeTitle(title) + "|" + size  → 列表页就能算，只做粗筛候选
 *   第 2 层 sha256(排序后的 相对路径:字节数)     → 主力判定，跨站稳
 *   第 3 层 piece 哈希头尾抽样                  → 权威，但贵，按需抽样
 *
 * 详细类型见 ./types.ts。
 */

export * from "./types.ts";
export * from "./hash.ts";
export * from "./title.ts";
export * from "./files.ts";
export * from "./pieces.ts";
export * from "./match.ts";
export * from "./localBase.ts";