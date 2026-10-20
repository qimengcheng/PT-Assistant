/**
 * 转载发布前对源站种子做的清洗。
 *
 * ## 为什么要清洗
 *
 * 源站的 `.torrent` 里 `announce` 写的是**源站的 passkey 地址**。直接把它提交给目标站，
 * 目标站的 `takeupload.php` 会用自己的 passkey 重建 announce，所以那几个字段留着只是噪声；
 * 但 `announce-list` / `url-list`（web seed）/ `nodes`（DHT）就不同了 —— 部分站会拿它们判定
 * 「这是外站种子」并直接拒绝上传，或者把它们原样写进新种子里，让下载者的客户端去连源站 tracker
 * （轻则报未注册，重则把自己的 passkey 泄露给第三方 announce）。
 *
 * ## 只动顶层，`info` 段一个字节都不许变
 *
 * `info` 段的 SHA1 就是 infoHash。改了它，目标站认到的就是另一颗种子，和源站的做种关系、
 * 与已有种子的查重（同站重复发布）全部错位。所以这里的做法是：
 * 解码 → 删顶层那几个键 → 重编码，**`info` 原样带过去**，最后再把 infoHash 算出来交给界面显示。
 *
 * 实测（bencode@4，`node --input-type=module`）三条：
 * ① 不传 encoding 解码时 `info.pieces` 拿到的是 20 字节的 `Uint8Array`，二进制没有损失；
 *    **绝不能给 `decode` 传 `"utf-8"`** —— 那会把 pieces 里的非法字节换成 U+FFFD，种子直接废掉。
 * ② 解码再编码的字节与原始输入完全一致（键序按出现顺序保留）。
 * ③ 删掉顶层的 announce / comment 之后，`info` 段重编码与清洗前逐字节相同。
 *
 * ## `info.source` 为什么默认保留
 *
 * 部分站要求种子带自己的站标（`source`），另一些站见到陌生站标会拒收 —— 两边都真实存在，
 * 所以做成选项而不是替用户决定。默认保留（改动最小），界面上给一个「清掉源站站标」的勾。
 */
import bencode from "bencode";

/**
 * 只存在于顶层、且属于「源站私有」的键。
 *
 * `announce` / `announce-list`：源站 tracker（目标站会重建）
 * `url-list`：BEP-19 web seed，会被目标站当成外站资源
 * `nodes` / `httpseeds`：DHT 与旧版 web seed
 * `comment` / `comment.utf-8`：源站简介里的宣传语
 *
 * 刻意**不删** `creation date` / `created by` / `encoding`：它们是中性的，且有些站的
 * 审核脚本会读 `created by` 判断制作工具。
 */
const DROP_TOP_LEVEL = [
  "announce",
  "announce-list",
  "comment",
  "comment.utf-8",
  "url-list",
  "nodes",
  "httpseeds",
] as const;

export interface ICleanTorrentOptions {
  /** 保留 `info.source`（源站站标）。默认 true */
  keepSourceTag?: boolean;
}

export interface ICleanTorrentResult {
  /** 清洗后的种子字节，直接作为上传表单的 file 字段 */
  bytes: Uint8Array;
  /** 清洗前后不变的 infoHash，十六进制小写 */
  infoHash: string;
  /** 实际删掉的键，写进日志用（`info.source` 是这唯一一个非顶层项） */
  removed: string[];
}

/** `crypto.subtle.digest` 只吃 ArrayBuffer，而解码出来的 Uint8Array 可能挂在更大的 buffer 上 */
function exactBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function sha1Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", exactBuffer(bytes));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function isPlainDict(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Uint8Array);
}

/**
 * 清洗一颗种子。
 *
 * 抛错只有两种情况，都是「这不是一颗能上传的种子」：文件不是合法 bencode、或里面没有 `info` 段。
 * 其余一律照常返回，让调用方拿着 `removed` 去显示做了什么。
 */
export async function cleanTorrentBytes(
  raw: Uint8Array,
  options: ICleanTorrentOptions = {},
): Promise<ICleanTorrentResult> {
  const { keepSourceTag = true } = options;

  // ⚠️ 不要传第二个参数（encoding）：pieces 是二进制，按 utf-8 解会把非法字节替换掉。
  const decoded: unknown = bencode.decode(raw);
  if (!isPlainDict(decoded)) {
    throw new Error("不是合法的种子文件：bencode 顶层不是字典");
  }
  if (!isPlainDict(decoded.info)) {
    throw new Error("不是合法的种子文件：缺少 info 段");
  }

  const infoHash = await sha1Hex(bencode.encode(decoded.info));
  /**
   * 清洗后**应该**得到的 infoHash。
   *
   * 默认就是源种子的 infoHash（info 段一个字节没动）。只有用户显式要求清掉 `info.source` 时
   * 它才会变 —— 那种情况下上传的已经不是同一颗种子了（目标站本来也会用自己的规则重建），
   * 这是明确选择的结果，不能当错误拦下来。
   */
  let expectedInfoHash = infoHash;

  const cleaned: Record<string, unknown> = {};
  const removed: string[] = [];
  for (const [key, value] of Object.entries(decoded)) {
    if ((DROP_TOP_LEVEL as readonly string[]).includes(key)) {
      removed.push(key);
      continue;
    }
    cleaned[key] = value;
  }

  if (!keepSourceTag && "source" in decoded.info) {
    const infoRest = { ...decoded.info };
    delete infoRest.source;
    cleaned.info = infoRest;
    removed.push("info.source");
    expectedInfoHash = await sha1Hex(bencode.encode(infoRest));
  }

  // 允许 `cleaned.info` 被上面那段换掉，所以这里重新取，不缓存 decoded.info
  const bytes = bencode.encode(cleaned);

  // 自检：重编码后的 info 段必须还能解出「预期的那颗种子」。这一步拦的是
  // 「重编码本身把结构改坏」（键被合并、数字被转成字符串、二进制被替换）。
  const verify: unknown = bencode.decode(bytes);
  if (!isPlainDict(verify) || !isPlainDict(verify.info)) {
    throw new Error("种子清洗后结构损坏：info 段丢失");
  }
  const verifiedHash = await sha1Hex(bencode.encode(verify.info));
  if (verifiedHash !== expectedInfoHash) {
    throw new Error(`种子清洗后 infoHash 与预期不符（期望 ${expectedInfoHash}，实际 ${verifiedHash}），已中止`);
  }

  return { bytes, infoHash: expectedInfoHash, removed };
}
