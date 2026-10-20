/**
 * offscreen 侧共用的 DOM 小工具。
 *
 * 只有三件：响应体 → Document、空白归一、响应正文压成摘要。transcode 的两个抓取
 * （上传页表单、详情页简介）都要用，但不该互相 import —— 一个抓表单的文件里
 * 放「HTML 清洗」会让依赖方向变得别扭。
 */

/**
 * 响应体 → Document。
 *
 * `responseType: "document"` 在浏览器 XHR 里是合法值，站点搜索走的也是这条路；但真拿到字符串
 * （某些 polyfill / 重定向后的 content-type 不对）时不能直接判失败 —— 自己解析一次即可。
 * 判 `instanceof Document` 而不是 `typeof === "object"`：失败页返回的 JSON 也能是 object，
 * 那样后面 `querySelectorAll` 会抛一个跟真实原因无关的 TypeError。
 */
export function toDocument(data: unknown): Document | null {
  if (typeof Document !== "undefined" && data instanceof Document) return data;
  if (typeof data === "string" && data.trim() !== "") {
    return new DOMParser().parseFromString(data, "text/html");
  }
  return null;
}

/** 把一段文字里的空白压成单空格并去首尾 —— 站点文本节点里全是缩进与换行 */
export function normalizeText(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\s+/g, " ").trim();
}

/** 把响应正文压成一段可读摘要：剥标签、压空白、截断 */
export function textSummary(html: string, limit = 400): string {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.length > limit ? `${stripped.slice(0, limit)}…` : stripped;
}

/** 相对地址 → 绝对地址。解析不了就原样返回：一个坏链接不该拖垮整段简介 */
export function absolutize(rawUrl: string, baseUrl: string): string {
  const url = rawUrl.trim();
  if (url === "" || url.startsWith("data:") || url.startsWith("javascript:")) return url;
  try {
    return new URL(url, baseUrl).toString();
  } catch {
    return url;
  }
}
