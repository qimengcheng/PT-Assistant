/// <reference types="chrome" />
/**
 * content script 的 app 入口（ES module，由引导在命中站点时动态 import）
 *
 * 源码放在 `src/content-script/`，这里只做一层转发 —— WXT 会把
 * `src/entrypoints/` 下的每个文件都当作入口点，app 的实现必须放到外面。
 */
import { mountApp } from "@/content-script/app/init.ts";

export default defineUnlistedScript(() => {
  const props = (globalThis as any).__PTD_CONTENT_PROPS__ ?? {};
  mountApp(document, props);
});
