/**
 * Vitest 的配置（`pnpm test` / CI 的防线 ⑭ 都读这一份）。
 *
 * 为什么要一份独立的 vite/vitest 配置而不是复用 `wxt.config.ts`：WXT 那份是扩展构建入口，
 * 里面挂着 entrypoint 扫描、manifest 生成和会话产物目录（AGENTS §2.1），测试要的只是
 * **别名解析**这一件事。
 *
 * 别名必须与 `wxt.config.ts` 逐条同构：判据文件里写的是仓库真名（`@/…`、`@ptd/…`），
 * 测试不许为了跑得起来而把 import 改成相对路径 —— 那等于测另一份代码。
 * Node 侧过去只能验「自身没有任何 import 的纯模块」（`.tmp-build` 里那些一次性脚本就是这么写的），
 * 有了这层别名 + vite 的转译，带 `@/` 依赖的判据也能直接 import 真源码。
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      // 三条 Node 内建替身与 wxt.config.ts 同源（顺序也要一致：@ptd 必须排在 @ 前面）
      { find: /^buffer$/, replacement: path.resolve(rootDir, "src/extends/browserBuffer.ts") },
      { find: /^path$/, replacement: path.resolve(rootDir, "src/extends/browserPath.ts") },
      { find: /^crypto$/, replacement: path.resolve(rootDir, "src/extends/browserNodeCrypto.ts") },
      { find: "@ptd", replacement: path.resolve(rootDir, "packages") },
      { find: "@", replacement: path.resolve(rootDir, "src") },
      { find: "~", replacement: path.resolve(rootDir, "src") },
    ],
  },
  test: {
    // 用例只认 tests/ 这一个目录：src 下的 .ts 是判据本身，不是测试。
    include: ["tests/**/*.test.ts"],
    // 被测的全是判据（纯函数 / 纯模块），不需要 DOM；需要 DOM 的那一天再按文件开 environment。
    environment: "node",
  },
});
