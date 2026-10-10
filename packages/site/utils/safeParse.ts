/**
 * 站点解析的通用安全取值助手。
 *
 * 为什么需要：这些站点的页面是服务端手写的，一个字段的格式一变（文案里少了冒号、
 * 链接从 `torrents.php?id=123` 改成 `/torrents/123`），本该只是那一条为空，
 * 不该抛 TypeError 把这个站点的**整页**搜索结果带走。
 * schemas 里这些调用大多位于 filters / map 数组内，那里面抛异常等于整页中止 ——
 * 症状正是「一行坏、整页空」。
 */

/**
 * 取**第一个**冒号之后的部分（两侧去空白）。
 *
 * 举例：
 *   "Uploaded: 1.2 GB"  → "1.2 GB"
 *   "Ratio: 1:2"        → "1:2"（原来的 split(":")[1] 只会给 "2"，比例直接算错）
 *   "Uploaded"          → ""    （原来的 split(":")[1] 是 undefined，接着 .trim() 就抛）
 *
 * 冒号只认半角 ":"。中文站点文案里偶尔出现全角「：」，那种一律当「没有冒号」
 * 返回空串 —— 猜着归一化反而会掩盖真正的格式变化。
 */
export function afterColon(text: string | null | undefined): string {
  if (!text) return "";
  const colon = text.indexOf(":");
  return colon >= 0 ? text.slice(colon + 1).trim() : "";
}

/**
 * 取正则第一个捕获组的值；不匹配时返回空串。
 *
 * 用来替掉 `text.match(re)![1]` 那种写法 —— 那个在不匹配时直接抛 TypeError。
 */
export function captureOr(text: string | null | undefined, pattern: RegExp): string {
  return text?.match(pattern)?.[1] ?? "";
}