/**
 * 种子指纹三层逻辑的自检脚本。
 *
 * 为什么需要：指纹算错的方向是不对称的 —— 误判「本地已有」会让 qBittorrent
 * 校验失败并重新下载，在 PT 站直接把分享率打到负数。所以这套纯函数必须有
 * 可重复执行的断言，尤其是「本该不同」的用例（单文件 vs 多文件、根目录不同、
 * 目录层级不同）。
 *
 * 用法：`node scripts/check-fingerprint.mjs`（不需要构建产物）
 */
import {
  autoSelectLocalBase,
  buildFingerprintIndexLookup,
  buildTitleSizeKey,
  comparePieceSamples,
  computeFilesFingerprint,
  decideFingerprintAction,
  matchLocalFingerprint,
  normalizeTitle,
  pickLocalBaseCandidates,
  samplePieces,
  screenByTitleSizeKey,
} from "../src/shared/fingerprint/index.ts";

let failed = 0;
let passed = 0;

function check(name, actual, expected) {
  const ok = typeof expected === "object" ? JSON.stringify(actual) === JSON.stringify(expected) : actual === expected;
  if (ok) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}\n       期望: ${JSON.stringify(expected)}\n       实际: ${JSON.stringify(actual)}`);
  }
}

function group(name) {
  console.log(`\n[${name}]`);
}

// ─────────────────────────────────────────────────────────────
// 第 1 层：标题归一
// ─────────────────────────────────────────────────────────────
group("第 1 层 normalizeTitle");

check(
  "去压制组尾标（方括号）",
  normalizeTitle("Some.Show.S01.1080p.WEB-DL.x264-GROUP[rartv][ABC]"),
  "some show s01",
);
check(
  "整个标题就是一个压制组 → 归一化为空（退化为只按大小比对）",
  normalizeTitle("[Beatrice- incompleti FRDS]"),
  "",
);
check(
  "去压制组尾标（连字符 + 上下文像发布名）",
  normalizeTitle("Some.Movie.2020.1080p.BluRay.x264-FRDS"),
  "some movie 2020",
);
check(
  "普通连字符不被误伤",
  normalizeTitle("Spider-Man.2002.1080p.BluRay.x264"),
  "spider man 2002",
);
check(
  "去分辨率 / 编码 / 片源 / 音频 token",
  normalizeTitle("Some Movie 2021 2160p HEVC WEB-DL Atmos DDP5.1"),
  "some movie 2021",
);
check("全角归一", normalizeTitle("ＭＯＶＩＥ．２０２０"), "movie 2020");
check("空标题", normalizeTitle(""), "");

// 两个站点常见的不同写法应塌缩到同一个 key
check(
  "跨站标题写法差异 → 同一个第 1 层 key",
  buildTitleSizeKey("Some.Movie.2021.1080p.BluRay.x264-GRP", 4194304),
  buildTitleSizeKey("Some Movie (2021) [2160p][WEB-DL][DDP5.1][MaKe]", 4194304),
);
check(
  "大小不同 → key 不同",
  buildTitleSizeKey("Some Movie 2021", 100) === buildTitleSizeKey("Some Movie 2021", 101),
  false,
);

// ─────────────────────────────────────────────────────────────
// 第 2 层：文件清单指纹
// ─────────────────────────────────────────────────────────────
group("第 2 层 文件清单指纹");

const multiSiteA = {
  rootName: "Some.Movie.2021",
  length: 0,
  files: [
    { path: ["Some.Movie.2021.mkv"], length: 3000 },
    { path: ["Extras", "deleted-scene.mkv"], length: 1000 },
    { path: ["Extras", "subtitles.srt"], length: 5 },
  ],
};
// 同一个数据集，另一个站点：根目录名不同、文件顺序不同、多了无关的注释字段（不参与指纹）
const multiSiteB = {
  rootName: "Some Movie (2021) [2160p]",
  length: 0,
  files: [
    { path: ["Extras", "subtitles.srt"], length: 5 },
    { path: ["Some.Movie.2021.mkv"], length: 3000 },
    { path: ["Extras", "deleted-scene.mkv"], length: 1000 },
  ],
};
// 下载器侧（qBittorrent 的 /torrents/files 带根目录，且用 \ 分隔）
const multiFromDownloader = {
  rootName: "Some.Movie.2021",
  length: 0,
  files: [
    { path: "Some.Movie.2021\\Some.Movie.2021.mkv", length: 3000 },
    { path: "Some.Movie.2021\\Extras\\deleted-scene.mkv", length: 1000 },
    { path: "Some.Movie.2021\\Extras\\subtitles.srt", length: 5 },
  ],
};

const fpA = await computeFilesFingerprint(multiSiteA);
const fpB = await computeFilesFingerprint(multiSiteB);
const fpDownloader = await computeFilesFingerprint(multiFromDownloader);

check("根目录名不同 → 指纹相同", fpA.fingerprint, fpB.fingerprint);
check("下载器侧带根目录 → 指纹相同", fpA.fingerprint, fpDownloader.fingerprint);
check("多文件种 kind", fpA.kind, "multi");
check("总大小", fpA.totalSize, 4005);

// 关键防呆：单文件种与多文件种绝不能撞出同一个指纹
const singleFile = await computeFilesFingerprint({ rootName: "Some.Movie.2021.mkv", length: 4005, files: [] });
check("单文件种 kind", singleFile.kind, "single");
check("单文件 vs 同总大小多文件 → 指纹不同", singleFile.fingerprint === fpA.fingerprint, false);
check("单文件种只看长度", (await computeFilesFingerprint({ rootName: "a.mkv", length: 777, files: [] })).fingerprint,
  (await computeFilesFingerprint({ rootName: "完全不同的名字.mkv", length: 777, files: [] })).fingerprint);

// 关键防呆：目录层级不同的两个数据集不能被「剥掉共享顶层目录」这种泛化猜测合并
const nested = await computeFilesFingerprint({
  rootName: "Some.Movie.2021",
  length: 0,
  files: [
    { path: ["Some.Movie.2021", "Extras", "a.mkv"], length: 3000 },
    { path: ["Some.Movie.2021", "Extras", "b.mkv"], length: 1000 },
  ],
});
const flat = await computeFilesFingerprint({
  rootName: "Some.Movie.2021",
  length: 0,
  files: [
    { path: ["Some.Movie.2021", "a.mkv"], length: 3000 },
    { path: ["Some.Movie.2021", "b.mkv"], length: 1000 },
  ],
});
check("多一层目录 → 指纹不同", nested.fingerprint === flat.fingerprint, false);

// 文件大小变化 → 指纹不同
const differentSize = await computeFilesFingerprint({
  ...multiSiteA,
  files: multiSiteA.files.map((f, i) => (i === 0 ? { ...f, length: 3001 } : f)),
});
check("文件大小不同 → 指纹不同", differentSize.fingerprint === fpA.fingerprint, false);

// ─────────────────────────────────────────────────────────────
// 第 3 层：piece 抽样
// ─────────────────────────────────────────────────────────────
group("第 3 层 piece 抽样");

const pieces = Array.from({ length: 40 }, (_, i) => i.toString(16).padStart(40, "0"));
const sample1 = samplePieces(pieces, { head: 4, tail: 4 });
const sample2 = samplePieces([...pieces].reverse(), { head: 4, tail: 4 });

check("抽样数量", sample1.hashes.length, 8);
check("顺序无关 → match", comparePieceSamples(sample1, sample2), "match");
check(
  "pieceLength 不同 → inconclusive",
  comparePieceSamples(
    samplePieces(pieces, { head: 4, tail: 4, pieceLength: 262144 }),
    samplePieces(pieces, { head: 4, tail: 4, pieceLength: 524288 }),
  ),
  "inconclusive",
);

// 总数一致但内容不同 → 可以判 mismatch（piece 数相同就意味着抽样位对齐）
const tampered = [...pieces];
tampered[0] = "f".repeat(40);
tampered[39] = "e".repeat(40);
check("内容不同 → mismatch", comparePieceSamples(sample1, samplePieces(tampered, { head: 4, tail: 4 })), "mismatch");
check("缺一侧 → inconclusive", comparePieceSamples(sample1, null), "inconclusive");

// 原始二进制串输入（每 20 字节一个 SHA1）
const binary = pieces.map((hex) => String.fromCharCode(...hex.match(/../g).map((byte) => parseInt(byte, 16)))).join("");
check("二进制串输入 → 与 hex 数组一致", samplePieces(binary, { head: 4, tail: 4 }).hashes, sample1.hashes);

// piece 总数不同（piece length 不同）→ 不能判 mismatch
const otherPieceLength = samplePieces(pieces.slice(0, 20), { head: 4, tail: 4 });
check("piece 总数不同 → inconclusive", comparePieceSamples(sample1, otherPieceLength), "inconclusive");

// ─────────────────────────────────────────────────────────────
// 匹配与保守决策
// ─────────────────────────────────────────────────────────────
group("本地索引匹配");

const localEntry = {
  hash: "abc",
  name: "Some.Movie.2021",
  size: 4005,
  progress: 100,
  isCompleted: true,
  trackerHosts: ["tracker.moviesite.example"],
  sites: ["sitea"],
  ratioLimit: -2,
  seedingTimeLimit: -2,
  seedsInSwarm: 12,
  titleKey: buildTitleSizeKey("Some.Movie.2021", 4005),
  files: fpA,
};

const lookup = buildFingerprintIndexLookup({
  downloaderId: "d1",
  updatedAt: Date.now(),
  totalTorrents: 1,
  unresolved: 0,
  entries: [localEntry],
});

const identical = matchLocalFingerprint({ files: fpB, titleKey: buildTitleSizeKey("别的标题", 4005) }, lookup);
check("第 2 层命中 → identical", identical.verdict, "identical");
check("identical 的命中来源", identical.matchedBy, "files");

const different = matchLocalFingerprint(
  { files: await computeFilesFingerprint({ length: 0, files: [{ path: ["other.mkv"], length: 999 }] }) },
  lookup,
);
check("第 2 层不匹配 → different", different.verdict, "different");

const candidate = matchLocalFingerprint(
  { titleKey: buildTitleSizeKey("Some.Movie.2021", 4005) },
  lookup,
);
check("只有第 1 层 → candidate", candidate.verdict, "candidate");

const absent = matchLocalFingerprint({ titleKey: buildTitleSizeKey("完全不相干的种子", 123) }, lookup);
check("找不到 → absent", absent.verdict, "absent");

const emptyLookup = buildFingerprintIndexLookup(null);
check("本地无任何可比指纹 → unavailable", matchLocalFingerprint({ files: fpA }, emptyLookup).verdict, "unavailable");
check("客户端不支持第 2 层 → 退化到第 1 层", matchLocalFingerprint({ titleKey: localEntry.titleKey }, emptyLookup).verdict, "unavailable");

group("保守决策");

check(
  "第 2 层命中 → 排除（本地已有）+ 建议抽样验 piece",
  decideFingerprintAction({ match: identical, site: "siteb" }),
  { action: "exclude", reason: "local-identical", suggestPieceVerify: true },
);
check(
  "第 1 层命中 → 人工确认（绝不直接加）",
  decideFingerprintAction({ match: candidate, site: "siteb" }),
  { action: "review", reason: "title-only-candidate", suggestPieceVerify: true },
);
check(
  "同站 tracker 已挂过 → 直接排除",
  decideFingerprintAction({ match: identical, site: "sitea" }),
  { action: "exclude", reason: "same-site-already", suggestPieceVerify: false },
);
check(
  "第 2 层不匹配 → 可辅",
  decideFingerprintAction({ match: different, site: "siteb" }),
  { action: "add", reason: "verified-different", suggestPieceVerify: false },
);
check(
  "本地无任何近似指纹 → 可辅",
  decideFingerprintAction({ match: absent, site: "siteb" }),
  { action: "add", reason: "no-local-fingerprint", suggestPieceVerify: false },
);
check(
  "保守模式：第 2 层命中但无 piece 证据 → 人工确认",
  decideFingerprintAction({ match: identical, site: "siteb", piecesPolicy: "review" }).action,
  "review",
);
// piece 抽样一致 / 不一致时的降级行为（本地条目带 piece 样本的场景）
const lookupWithPieces = buildFingerprintIndexLookup({
  downloaderId: "d1",
  updatedAt: Date.now(),
  totalTorrents: 1,
  unresolved: 0,
  entries: [{ ...localEntry, pieces: sample2 }],
});
const piecesVerified = matchLocalFingerprint({ files: fpB, pieces: sample1 }, lookupWithPieces);
check("piece 抽样比对结果", piecesVerified.pieces, "match");
check(
  "piece 抽样一致 → 排除且无需再验",
  decideFingerprintAction({ match: piecesVerified, site: "siteb" }),
  { action: "exclude", reason: "local-identical", suggestPieceVerify: false },
);
const piecesRejected = matchLocalFingerprint(
  { files: fpB, pieces: samplePieces(tampered, { head: 4, tail: 4 }) },
  lookupWithPieces,
);
check("piece 抽样不一致 → 降级为 different", piecesRejected.verdict, "different");
check(
  "piece 抽样不一致 → 仍然可辅",
  decideFingerprintAction({ match: piecesRejected, site: "siteb" }),
  { action: "add", reason: "verified-different", suggestPieceVerify: false },
);

group("列表页粗筛");

const screened = screenByTitleSizeKey(
  [
    { title: "Some.Movie.2021.1080p.BluRay.x264-GRP", size: 4005 },
    { title: "Completely Unrelated Release", size: 4005 },
    { title: "Some.Movie.2021", size: 999 },
  ],
  lookup,
);
check("第 1 层粗筛命中数", screened.length, 2);
check("命中依据（标题+大小）", screened[0].matchedBy, "titleSize");
check("退化依据（只按大小）", screened[1].matchedBy, "size");

group("下载器里挑基准（只勾中一条时）");

/** 造一条本地索引条目：只填被测逻辑真看的字段，其余给齐类型 */
const mkEntry = (over) => ({
  hash: "h",
  name: "n",
  size: 4005,
  progress: 100,
  isCompleted: true,
  trackerHosts: [],
  sites: [],
  ratioLimit: -2,
  seedingTimeLimit: -2,
  ...over,
});

const otherFp = await computeFilesFingerprint({
  rootName: "Totally.Other",
  length: 0,
  files: [{ path: ["a.mkv"], length: 4000 }, { path: ["b.mkv"], length: 5 }],
});
const targetTitleKey = buildTitleSizeKey("Some.Movie.2021", 4005);
const target = { titleKey: targetTitleKey, files: fpB, pieces: sample1, size: 4005 };

const baseIndex = [
  // 第 2 层命中（根目录名不同也算命中，fpA/fpB 是同一份数据）
  mkEntry({ hash: "same", name: "same", files: fpA, titleKey: buildTitleSizeKey("Some Movie 2021 2160p", 4005) }),
  // 第 2 层算得出且不同 → 确定不是同一份，必须被排除
  mkEntry({ hash: "diff", name: "diff", files: otherFp, titleKey: targetTitleKey }),
  // 第 2 层算不出（客户端不支持导出文件清单）→ 只能靠标题+大小，算候选
  mkEntry({ hash: "nofp-title", name: "nofp-title", files: null, titleKey: targetTitleKey }),
  // 同上，且标题也不同 → 退到「只按大小」
  mkEntry({ hash: "nofp-size", name: "nofp-size", files: null, titleKey: buildTitleSizeKey("Unrelated", 4050), size: 4050 }),
  // 大小差出 2% 容差
  mkEntry({ hash: "far", name: "far", files: null, titleKey: buildTitleSizeKey("Unrelated", 99999), size: 99999 }),
  // 没下完的：拿它当基准就是必爆仓
  mkEntry({ hash: "partial", name: "partial", files: fpA, isCompleted: false, progress: 60 }),
];

const baseCandidates = pickLocalBaseCandidates(target, baseIndex);
check(
  "候选集合：排除「指纹确定不同」「超大小容差」「没下完」",
  baseCandidates.map((c) => c.entry.hash).join(","),
  "same,nofp-title,nofp-size",
);
check("第 2 层命中的排在最前", baseCandidates[0].tier, "files");
check("标题+大小命中的算第 1 层候选", baseCandidates[1].tier, "titleSize");
check("只按大小进来的", baseCandidates[2].tier, "size");
check("大小差按绝对值记下来（界面要提示）", baseCandidates[2].sizeDelta, 45);

check("自动选中落在第 2 层那条", autoSelectLocalBase(baseCandidates)?.entry.hash, "same");
check(
  "只有第 1 层候选时不替用户决定",
  autoSelectLocalBase(baseCandidates.slice(1)),
  null,
);

// piece 抽样反证：文件清单相同也可能是巧合（同目录结构、不同内容）
const mismatchEntry = mkEntry({ hash: "fp-but-pieces", name: "fp-but-pieces", files: fpA, pieces: samplePieces(tampered, { head: 4, tail: 4 }) });
const withMismatch = pickLocalBaseCandidates(target, [mismatchEntry]);
check("piece 不一致的那条仍在候选里（由人判，不静默丢）", withMismatch.length, 1);
check("piece 不一致记在候选上", withMismatch[0].pieces, "mismatch");
check("piece 不一致时不自动选中", autoSelectLocalBase(withMismatch), null);

// 目标侧算不出文件清单（.torrent 下载失败 / 站点没给）→ 谁都不能算第 2 层
const noTargetFp = pickLocalBaseCandidates({ titleKey: targetTitleKey, size: 4005 }, baseIndex);
check("目标算不出指纹时没有第 2 层候选", noTargetFp.every((c) => c.tier !== "files"), true);
check(
  "目标算不出指纹时不拿指纹排除任何条目（没证据就说没证据，不假装确定不是）",
  noTargetFp.map((c) => c.entry.hash).join(","),
  "diff,nofp-title,same,nofp-size",
);
check("目标算不出指纹时一条都不自动选中", autoSelectLocalBase(noTargetFp), null);

console.log(`\n通过 ${passed} 项，失败 ${failed} 项`);
process.exit(failed === 0 ? 0 : 1);