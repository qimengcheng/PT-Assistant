/**
 * `crypto`（Node 内建）在浏览器目标下的空替身。
 *
 * 为什么要有这个文件：crypto-js/core.js 里有 `crypto = require('crypto')`，虽然它前面已经
 * 优先取 `globalThis.crypto`（Web Crypto 在扩展页面里必然存在），那条 require 分支在浏览器里
 * 永远走不到，但打包器仍会静态地把 `crypto` 外部化成 browser-external stub。
 * rolldown（Vite 8）会把该 stub 作为 `__vite-browser-external-*.js` 产出到**扩展根目录**，
 * 而 Chrome 禁止解包加载的扩展里存在以 `_` 开头的文件 —— 表现为整个扩展「无法加载扩展」。
 *
 * 用本文件顶掉那个 stub：运行时行为不变（走的是同一个死分支），但产物里不再出现 `_` 开头的文件。
 */
const nodeCryptoUnavailableInBrowser = {};
export default nodeCryptoUnavailableInBrowser;
