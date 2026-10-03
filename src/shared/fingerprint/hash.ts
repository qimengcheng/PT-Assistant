/**
 * 指纹用到的哈希工具。
 *
 * 只依赖 WebCrypto：扩展的 service worker / offscreen / options 页都是
 * secure context，crypto.subtle 一定存在（Node ≥ 20 也有全局 crypto，
 * 便于用 node 直接跑自测脚本）。
 */

const textEncoder = new TextEncoder();

/** 十六进制输出 */
export function bytesToHex(bytes: Uint8Array | ArrayBuffer): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let out = "";
  for (let i = 0; i < view.length; i++) {
    out += (view[i] as number).toString(16).padStart(2, "0");
  }
  return out;
}

/** hex 字符串转字节数组（忽略非法字符） */
export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, "");
  const bytes = new Uint8Array(Math.floor(clean.length / 2));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return bytes;
}

/** 计算文本的 sha256 十六进制摘要 */
export async function sha256Hex(input: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("[fingerprint] crypto.subtle 不可用，无法计算指纹");
  }
  const digest = await subtle.digest("SHA-256", textEncoder.encode(input));
  return bytesToHex(digest);
}

/** 稳定排序用的比较函数（不能用 localeCompare —— 结果依赖运行时 locale） */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}