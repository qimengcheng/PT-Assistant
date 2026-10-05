/**
 * `buffer`（Node 内建名）在浏览器目标下的出口，指向 npm `buffer` 包（Node 官方移植版）。
 *
 * ## 为什么需要这个中转文件
 *
 * rolldown 在浏览器构建里把 Node 内建名（含 `buffer`）按 external 处理，产出名为
 * `__vite-browser-external-<hash>.js` 的模块。两种后果都真实踩过（v0.22.38 实测）：
 *
 * 1. 产出到**扩展根目录**。Chrome 规定解包加载的扩展里不能有以 `_` 开头的文件，
 *    表现为整个扩展「无法加载」——与 browserPath.ts 顶部记的是同一个坑。
 * 2. 内容是 `exports = {}` 的空 stub，于是 `packages/downloader/utils.ts` 的
 *    `import { Buffer } from "buffer"` 拿到 undefined，`Buffer.from(...)` 抛 TypeError。
 *
 * 所以 `wxt.config.ts` 用 alias 把 `buffer` 接到本文件，再由这里转发真正的 Buffer：
 * 模块 id 从 "buffer" 变成一个正常的仓库路径，rolldown 就会把**真实实现**打进产物，
 * 上面两条都不再发生。与 browserPath.ts / browserNodeCrypto.ts 是同一套处理。
 *
 * 实测（v0.22.39 产物）两点仍需留意，别误判：
 * - 该 chunk 在产物里仍叫 `__vite-browser-external-<hash>.js`，且仍**懒加载** —— 导出里带一个
 *   初始化 thunk，消费方要先调用它，具名 `Buffer` 才从 undefined 变成实值。文件名带 `_` 而
 *   内容是完整 buffer 实现，这事确实反直觉，但内容正确可用，别再当成 stub 去"修"一遍。
 * - 它落在 `chunks/` 子目录下而不在扩展根目录，所以不触发 Chrome 那条「根目录下文件名不能
 *   以 `_` 开头」的拒载（同 browserPath.ts 记的情况）。
 *
 * ## 本文件只解决「有 import 语句」的 Buffer
 *
 * `urlencode`@2 的 `decode()` 里有一行**没有 import** 的自由变量 `Buffer`（浏览器里必然
 * ReferenceError），alias 对自由变量无效 —— 那处由 `packages/downloader/utils.ts` 的
 * `decodePercentAscii` 就地解决。两处是同一个症状的两个来源，要分别处理，别只改一处。
 *
 * ## 为什么 re-export 的是 `buffer/index.js` 而不是 `buffer`
 *
 * alias 是 `/^buffer$/` 精确匹配，带子路径的 specifier 不受影响，仍按普通包解析，
 * 从而绕开内建名判定。
 */
export { Buffer } from "buffer/index.js";