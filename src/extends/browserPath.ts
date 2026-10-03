/**
 * 浏览器环境的 `path` 最小实现（POSIX 语义）。
 *
 * 为什么要有这个文件：parse-torrent 用 `import path from "path"`，而打包器在浏览器目标下会把
 * Node 内建模块替换成一个 `exports = {}` 的空 stub（vite 的 browser-external）。于是
 * `path.join.apply(null, [path.sep].concat(parts))` 里的 `path.join` 是 undefined，
 * 解析**任何**种子都会抛 TypeError —— 因为 parse-torrent 取的是
 * `torrent.info.files || [torrent.info]`，单文件种子同样走这条路。
 *
 * 另一个后果更致命：rolldown（Vite 8）会把这个 stub 作为 `__vite-browser-external-*.js`
 * 产出到**扩展根目录**，而 Chrome 规定解包加载的扩展里不能有以 `_` 开头的文件，
 * 表现为「无法加载扩展：Filenames starting with "_" are reserved for use by the system」，
 * 整个扩展装不上。（Vite 7/rollup 把它放在 chunks/ 子目录，Chrome 容忍，所以一直没暴露。）
 *
 * 这里只实现 parse-torrent 实际用到的 `sep` 与 `join`，不做通用 polyfill。
 */
export const sep = "/";

export function join(...parts: unknown[]): string {
  const segments: string[] = [];
  for (const raw of parts) {
    if (raw === undefined || raw === null || raw === "") continue;
    for (const seg of String(raw).split(sep)) {
      if (seg === "" || seg === ".") continue;
      if (seg === "..") {
        if (segments.length > 0) segments.pop();
        continue;
      }
      segments.push(seg);
    }
  }
  const absolute = parts.length > 0 && String(parts[0]).startsWith(sep);
  const trailingSep = parts.length > 0 && String(parts[parts.length - 1]).endsWith(sep) && segments.length > 0;
  const body = segments.join(sep);
  return `${absolute ? sep : ""}${body}${trailingSep ? sep : ""}`;
}

const path = { sep, join };
export default path;
