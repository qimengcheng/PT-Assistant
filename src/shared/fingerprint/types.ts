/**
 * 种子指纹（fingerprint）相关类型定义。
 *
 * ── 为什么需要分层指纹 ──────────────────────────────────────────────
 * `infohash` 一定不同（各站点的 private / comment / created by 字段都不一样），
 * 只用标题又太松。所以指纹分三层，每层的「证据强度」和「获取成本」不同：
 *
 * | 层 | 内容                | 获取成本 | 强度 | 用途           |
 * |----|---------------------|----------|------|----------------|
 * | 1  | 归一化标题 + 大小   | 列表页   | 弱   | 只做粗筛候选   |
 * | 2  | 文件清单指纹        | 需种子   | 强   | 主力判定       |
 * | 3  | piece 哈希抽样      | 需种子   | 权威 | 兜底验证       |
 *
 * 误判「本地已有」的代价是不对称的：把 B 站的种子加进去，qBittorrent 校验发现
 * 数据不对 → 重新下载 → 在 PT 站直接把分享率打到负数。所以判定必须保守：
 * 第 1 层命中只算候选，第 2 层命中才算「本地已有」，第 3 层用来兜底验证。
 */

export type TFingerprintKind = "single" | "multi";

/** 文件清单中的单个条目（规范化后） */
export interface IFingerprintFileEntry {
  /** 规范化后的相对路径（已剥离顶层目录，"/" 分隔，保留大小写） */
  path: string;
  /** 字节数 */
  size: number;
}

/** 计算文件清单指纹的输入 */
export interface IFilesFingerprintInput {
  /**
   * info.name（多文件种的顶层目录名）/ 下载器给出的种子名。
   *
   * 只用来剥离顶层目录，不会参与指纹本体计算 —— 不同人打包可能起不同的根目录名。
   */
  rootName?: string;
  /** info.length（单文件种的字节数），多文件种可传 0 */
  length?: number;
  /** info.files（多文件种），元素形如 `{ path: ["Extras", "a.mkv"], length: 123 }` */
  files?: Array<{ path: string[] | string; length: number }>;
}

/** 第 2 层：文件清单指纹 */
export interface IFilesFingerprint {
  /** 单文件种 / 多文件种（两者指纹格式不同，绝不可混进同一个指纹里） */
  kind: TFingerprintKind;
  fileCount: number;
  /** 字节数总和 */
  totalSize: number;
  /** sha256 十六进制 */
  fingerprint: string;
}

/** piece 哈希抽样（每个 piece 20 字节，hex 后 40 个字符） */
export interface IPieceSample {
  /** 抽样得到的 piece 哈希（hex 升序，按 piece 序号排列） */
  hashes: string[];
  /** piece 总数 */
  piecesNum: number;
  /**
   * piece length（字节）。
   *
   * 注意：piece 哈希依赖 piece length，不同人上传同一份数据可能算出不同的
   * piece length → piece 总数不同 → 抽样位不对齐。所以跨种子比较时，
   * piecesNum 不一致只能判 inconclusive，不能判 mismatch。
   */
  pieceLength?: number;
  /** 抽样规则：前 N 个 */
  head: number;
  /** 抽样规则：后 N 个 */
  tail: number;
}

export type TPieceCompareResult = "match" | "mismatch" | "inconclusive";

/**
 * 可参与匹配的一侧（站点种子或本地种子都归一到这个形状）
 */
export interface IFingerprintComparable {
  /** 第 1 层：`normalizeTitle(title) + "|" + size` */
  titleKey?: string;
  /** 第 2 层 */
  files?: IFilesFingerprint | null;
  /** 第 3 层 */
  pieces?: IPieceSample | null;
  /** 原始标题，用于本地索引 */
  name?: string;
  /** 原始大小（字节） */
  size?: number;
}

/** 下载器中一个本地种子在指纹索引里的条目 */
export interface ILocalTorrentFingerprintEntry extends IFingerprintComparable {
  /** rawTorrent.hash */
  hash: string;
  /** 种子名（同时用于剥离顶层目录） */
  name: string;
  /** rawTorrent.size */
  size: number;
  /** rawTorrent.total_size（含未选择文件） */
  totalSize?: number;
  /** 0-100 */
  progress: number;
  /** 是否已完成（progress === 1） */
  isCompleted: boolean;
  /** 归一化前的原始状态文本 */
  state?: string;
  savePath?: string;
  label?: string;
  /** tracker 主机名（已去掉 www. 与端口） */
  trackerHosts: string[];
  /** 由 tracker 主机名匹配到的站点 id —— 这个种子已经挂在哪些站上 */
  sites: string[];
  /** ratio_limit：-2 = 使用全局限制，-1 = 不限速/不限制 */
  ratioLimit: number;
  /** seeding_time_limit（分钟），-2 = 使用全局限制，-1 = 不限制 */
  seedingTimeLimit: number;
  /** num_complete：swarm 中的做种数，用于判断「已经一堆种的冷门种」 */
  seedsInSwarm?: number;
  /** num_incomplete：swarm 中的下载数 */
  leechersInSwarm?: number;
  category?: string;
  dateAdded?: number;
  /** 已有的 ratio */
  ratio?: number;
}

/** 某个下载器的本地指纹索引 */
export interface ILocalFingerprintIndex {
  downloaderId: string;
  clientType?: string;
  clientName?: string;
  /** 构建时间（毫秒） */
  updatedAt: number;
  /** 下载器里的种子总数 */
  totalTorrents: number;
  /** 未能算出第 2 层指纹的种子数（客户端不支持 FileList 或请求失败） */
  unresolved: number;
  entries: ILocalTorrentFingerprintEntry[];
}

/**
 * 匹配结论。
 *
 * ⚠️ `absent` 与 `unavailable` 的含义**别照着字面猜**，两者的分界是
 * 「本地有没有可比条目」，不是「能不能算出指纹」：
 *
 * - `identical` 第 2 层命中：本地已有同一份数据（证据强，但仍建议抽样验 piece）
 * - `candidate`  只有第 1 层命中：疑似，绝不能直接采信
 * - `different`  本地有可比条目、第 2 层可比较但不匹配：**确定不是**同一份数据
 * - `absent`     本地**有**可比条目，但一条都没匹配上（且证据只到第 1 层：标题+大小）
 *                 →「本地不存在这份数据」，既不能据此排除，也不构成确定结论
 * - `unavailable`本地**一条可比条目都没有**（`comparedCount === 0`），或目标侧算不出指纹
 *                 → 没有任何证据可用，辅不辅都只能交给人
 *
 * 判据见 match.ts 的 `comparableCount > 0 ? empty("absent") : empty("unavailable")`，
 * 行为由 scripts/check-fingerprint.mjs 钉住（"找不到 → absent" /
 * "本地无任何可比指纹 → unavailable" 两条断言）。改这里前先看那两条。
 */
export type TFingerprintVerdict = "identical" | "candidate" | "different" | "absent" | "unavailable";

/** 结论是由哪一层给出的 */
export type TFingerprintMatchedBy = "none" | "titleSize" | "size" | "files" | "pieces";

export interface IFingerprintMatchResult {
  verdict: TFingerprintVerdict;
  matchedBy: TFingerprintMatchedBy;
  /** 命中的本地种子（verdict 为 identical/candidate 时有值） */
  match?: ILocalTorrentFingerprintEntry;
  /** 参与比对的本地条目数 */
  comparedCount: number;
  /** 做了 piece 抽样比对时的结论 */
  pieces?: TPieceCompareResult;
}

/** 动作 */
export type TFingerprintAction = "add" | "review" | "exclude";

/** 动作依据（供 UI 展示与日志定位，不要直接展示给用户） */
export type TFingerprintActionReason =
  /**
   * 没有可用证据。**同一个 reason 配两种相反动作**，看 verdict 才能区分：
   * - `absent`（本地有条目、只是没匹配上）→ `add`，本地不存在这份数据，可以辅
   * - `unavailable`（本地一条可比条目都没有）→ `review`，没证据时不该自动辅种
   */
  | "no-local-fingerprint"
  /** 第 2 层比对通过：本地已有这份数据，不必再辅 */
  | "local-identical"
  /** 本地同站点的 tracker 已经挂过这份数据，避免把同一站的东西再辅一遍 */
  | "same-site-already"
  /** 只有第 1 层命中：只算候选，既不加也不排除，等人工确认 */
  | "title-only-candidate"
  /** 第 2 层可比对但不匹配：确定不是同一份数据，可以辅 */
  | "verified-different";

export interface IFingerprintPolicyInput {
  /** 目标种子（站点侧）的匹配结论 */
  match: IFingerprintMatchResult;
  /** 目标种子所在站点 */
  site?: string;
  /** 命中条目里已经挂着的站点 */
  existingSites?: string[];
  /**
   * piece 抽样未通过时的处理策略：
   * - `trust-files`（**代码实跑的默认值**）：相信第 2 层，直接按第 2 层结论走
   * - `review`：视为需要人工确认，不自动排除
   *
   * ⚠️ 这里曾经写「review（默认，保守）」，与 decideFingerprintAction 里的
   * `piecesPolicy = "trust-files"` 相反。默认值偏保守还是偏效率，属**产品策略**
   * 尚未拍板；在定下来之前，本注释按代码的实际行为描述，别再写反。
   */
  piecesPolicy?: "review" | "trust-files";
}

export interface IFingerprintPolicyDecision {
  action: TFingerprintAction;
  reason: TFingerprintActionReason;
  /** 是否建议（但不自动执行）做 piece 抽样验证 */
  suggestPieceVerify: boolean;
  /** swarm 做种数过多，辅种收益低（仅提示，不自动排除） */
  lowValue?: boolean;
}