import { Buffer } from "buffer";
import type { AxiosRequestConfig } from "axios";
import parseTorrent, { type Instance as TorrentInstance, type ParsedFile } from "parse-torrent";
import isValidFilename from "valid-filename";

import { axios } from "./utils/adapter";

export * from "./utils/adapter";

/**
 * `parseTorrent()` 的解析结果 + 本项目额外附加的原始字节与文件名。
 *
 * 这里逐个列出（而不是 `extends Instance`）是因为 Instance 继承自 magnet-uri 的
 * `Instance`，那个接口带 `[key: string]: any` 索引签名，一旦继承/映射，未显式
 * 声明的字段全都会被塌缩成 `any`。
 */
export interface ParsedTorrent {
  name: string;
  infoHash: string;
  /** 规范化后的文件清单（多文件种的 path 含顶层目录名，且用平台分隔符） */
  files?: ParsedFile[];
  /** 全局总长度（单文件种的字节数） */
  length?: number;
  pieceLength?: number;
  /** 每个 piece 一个 SHA1，hex 数组 */
  pieces?: string[];
  info: TorrentInstance;
  metadata: {
    arraybuffer: ArrayBuffer;
    buffer: Buffer;
    blob: () => Blob;
    base64: () => string;
  };
}

const utf8FilenameRegex = /filename\*=UTF-8''([\w%\-\.]+)(?:; ?|$)/i;
const asciiFilenameRegex = /^filename=(["']?)(.*?[^\\])\1(?:; ?|$)/i;

/**
 * 解 `content-disposition` 里 `filename="…"` 那种 ASCII 声明的百分号编码文件名。
 *
 * ## 为什么不用 `urlencode` 的 `decode`
 *
 * `urlencode`@2 的 ESM 产物（`node_modules/urlencode/dist/esm/index.js` 的 `decode()`）在
 * 非 UTF-8 分支里有一行**裸 `Buffer`**：
 *
 * ```js
 * import iconv from 'iconv-lite';   // ← 顶部只 import 了 iconv
 * const buf = Buffer.from(bytes);    // ← 假定 Buffer 是 Node 全局，没有任何 import
 * ```
 *
 * 扩展环境没有 `Buffer` 全局，走到这行就是 `ReferenceError: Buffer is not defined`。
 * 而 content-disposition 的解析是 `getRemoteTorrentFile()` 的必经步骤，**所有走本地中转的
 * 下载器推送、以及「扩展方式」本地下载都会踩到**，且条件只是站点用 `filename="…"` 形态
 * 返回文件名（中文名种子几乎都是这种形态）—— 表现为下载历史里这两类任务全挂。
 *
 * 三条常见的绕法都不成立，别再重试：
 * - `resolve.alias` 指到 buffer 包：alias 只作用于**有 import 语句**的模块，这里是自由变量；
 * - `define: { Buffer: … }`：纯文本替换、不建作用域绑定，只是把一个 ReferenceError 换成另一个；
 * - 挂 `globalThis.Buffer`：纯副作用导入会被 rolldown 当成无导出被消费而 tree-shake。
 *
 * 原版 PT-depiler 靠 `vite-plugin-node-polyfills` 的 `globals: { Buffer: true }` 兜住，本仓
 * 没有该插件。与其为这一个函数 fork 整个包 + 加一条模块解析插件，不如就地自实现。
 *
 * ## 与原行为的等价性
 *
 * 原路径是 `iconv.decode(Buffer.from(bytes), "ascii")`，按字节对齐即可：
 * - `%XX` 取该字节；其余字符取 `charCodeAt` 并按 `Buffer.from` 的语义截断成 8 位（`& 0xff`）；
 * - iconv-lite 的 `ascii` 是 **7-bit** 编码，`> 127` 的字节解成 `?`（它的 `defaultCharSingleByte`），
 *   而不是 latin1 的原值直通。这条必须照抄，否则站点在 `filename="…"` 里塞 GBK 原始字节时行为会变。
 *
 * `filename*=UTF-8''…` 那条分支不需要这一步：`urlencode.decode(x)` 单参时内部就是
 * `decodeURIComponent(x)`，直接用内置函数即可。
 */
function decodePercentAscii(str: string): string {
  let out = "";
  for (let i = 0; i < str.length; ) {
    let byte: number;
    if (str[i] === "%") {
      byte = parseInt(str.substring(i + 1, i + 3), 16);
      i += 3;
    } else {
      byte = str.charCodeAt(i) & 0xff;
      i += 1;
    }
    out += byte < 0x80 ? String.fromCharCode(byte) : "?";
  }
  return out;
}

const magnetUriV1Pattern = /xt(?:\.1)?=urn:btih:(?<hash>[a-z0-9]{32}(?:[a-z0-9]{8})?)/i;
const magnetUriV2Pattern = /xt(?:\.1)?=urn:btmh:1220(?<hash>[a-z0-9]{64})/i;

export function extractMagnetHash(magnetUri: string): string | null {
  // 先尝试使用 v1 模式匹配
  const v1Match = magnetUri.match(magnetUriV1Pattern);
  if (v1Match) {
    return v1Match.groups?.hash || null;
  }
  // 若 v1 匹配失败，再尝试使用 v2 模式匹配
  const v2Match = magnetUri.match(magnetUriV2Pattern);
  return v2Match?.groups?.hash || null;
}

export async function getRemoteTorrentFile(options: AxiosRequestConfig = {}): Promise<ParsedTorrent> {
  const req = await axios.request({
    ...options,
    responseType: "arraybuffer", // 统一以 ArrayBuffer 形式获取，方便后面转化
  });

  /**
   * 如果服务器设置了 content-type 响应头，
   * 但响应头值不是 application/x-bittorrent 或 application/octet-stream，
   * 则我们认为非正常的种子：
   */
  if (req.headers["content-type"] && !/octet-stream|x-bittorrent/gi.test(<string>req.headers["content-type"])) {
    throw new Error("Invalid Torrent From Server");
  }

  // 将获取到的 ArrayBuffer 转成 Buffer
  const metaDataBuffer = Buffer.from(req.data, "binary");
  const parsedInfo = (await parseTorrent(metaDataBuffer)) as TorrentInstance;

  /**
   * 设置种子名字
   * 如果服务器显式设置 content-disposition 头，则我们尊重服务器设置
   * 不然，文件名会被设置为解析后的种子名，缺省为 `1.torrent`
   */
  let torrentName = parsedInfo.name || "1.torrent";

  const disposition: string | null = req.headers["content-disposition"];
  if (disposition && disposition.includes("filename")) {
    let dispositionName = "";
    if (utf8FilenameRegex.test(disposition)) {
      dispositionName = decodeURIComponent(utf8FilenameRegex.exec(disposition)![1]);
    } else {
      // prevent ReDos attacks by anchoring the ascii regex to string start and
      // slicing off everything before 'filename='
      const filenameStart = disposition.toLowerCase().indexOf("filename=");
      if (filenameStart >= 0) {
        const partialDisposition = disposition.slice(filenameStart);
        const matches = asciiFilenameRegex.exec(partialDisposition);
        if (matches != null && matches[2]) {
          dispositionName = decodePercentAscii(matches[2]); // 按照规范使用 ascii 转换，见 decodePercentAscii 注释
        }
      }
    }

    /**
     * hdsky 返回 filename="xxxxxxx.torrent" ; charset=utf-8 需要额外处理，同时此处包含了 trim
     * 注意，由于上面对该情况使用 ascii 转换，这样仍然会导致文件名出现异常
     */
    dispositionName = dispositionName.replace(/^[ "']+/, "").replace(/[ "']+$/, "");
    // 检查 dispositionName 是否合法
    if (isValidFilename(dispositionName)) torrentName = dispositionName;
  }

  if (!/\.torrent$/i.test(torrentName)) {
    torrentName = `${torrentName}.torrent`;
  }

  return {
    name: torrentName,
    /**
     * 下面这几项必须从 `parsedInfo` 上取。原先这里只返回 name/metadata/info，
     * 而接口把 infoHash / files / pieces / pieceLength / length 都声明好了 —— 那句 `as ParsedTorrent`
     * 把「一个都没返回」这件事在类型上糊掉了，所以既不进 vue-tsc 也不进构建，纯静默。
     *
     * 后果有两条（都在 Node 里拿自造的 torrent 量过，见 .tmp-build/probe-remote-torrent-shape.mjs）：
     * ① 辅种任务里每条的 hash 记成空串 → 「回查做种状态」一条都对不上账；
     * ② 清单和 piece 全空 → 多文件种的第 2 层指纹退化成「单文件 · 总大小」那一份常量。
     *    这一条比"算不出来"更糟：任何一颗**总大小相同**的种子都会和它判成相等，
     *    误判方向正好是 files.ts 顶部写明的最危险那一边（判成"本地已有"→ 校验失败重下）。
     *
     * 末尾那个 `as ParsedTorrent` 已删：留着它，下次少返回任何字段仍然只是"类型上过得了"。
     */
    infoHash: parsedInfo.infoHash,
    files: parsedInfo.files,
    length: parsedInfo.length,
    pieceLength: parsedInfo.pieceLength,
    pieces: parsedInfo.pieces,
    metadata: {
      arraybuffer: req.data,
      buffer: metaDataBuffer,
      base64: () => metaDataBuffer.toString("base64"),
      blob: () => new Blob([req.data], { type: "application/x-bittorrent" }),
    },
    info: parsedInfo,
  };
}
