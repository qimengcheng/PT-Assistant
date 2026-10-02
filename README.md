# PT-assistant-wxt

PT-depiler（PT-Plugin-Plus 继任者）的 **WXT + Vue 3 全新架构重写版**（骨架阶段）。

## 架构决策（对比 PT-depiler）

| 维度 | PT-depiler（旧） | 本项目（新） |
|---|---|---|
| 扩展框架 | vite-plugin-web-extension（手写 manifest 构建） | **WXT 0.21**（entrypoints 约定、自动 manifest、跨浏览器） |
| 构建内核 | Vite 6（rollup） | **Vite 7（rollup）** —— 见下方踩坑记录 |
| UI | Vue 3 + Vuetify 4（主 chunk ~444KB） | Vue 3 + 手写轻量 CSS（无重 UI 库） |
| 消息层 | @webext-core/messaging + 自建 wrapper（269 行协议） | 同款 wrapper（精简协议，随功能平移扩充） |
| 站点定义 | 340 个 definition，import.meta.glob 按需加载 | **原样平移，零修改**（packages/site） |
| Buffer polyfill | 全局注入（background 464KB） | 不注入 |
| konva | 全局注册（主 chunk ~200KB） | 不引入 |
| i18n | vue-i18n 双语言全量注册（~118KB） | 骨架阶段 zh_CN 内联，后期单语言注册+动态合并 |
| 测试 | 无 | 预留（WXT 自带 Vitest 集成，roadmap） |

## 目录结构

```
PT-assistant-wxt/
├── packages/
│   ├── site/        ← 自 PT-depiler 原样平移（340 定义 + schemas + types + utils）
│   └── social/      ← 同上（bangumi/douban/imdb/anidb）
├── src/
│   ├── entrypoints/         # WXT 入口
│   │   ├── background.ts    # MV3 SW：cookies/DNR/extStorage 消息处理
│   │   ├── popup/           # 弹窗（ping + 打开设置页）
│   │   └── options/         # 设置页（站点定义浏览器，演示按需加载）
│   ├── extends/axios/       # unsafe header 替换 + Cloudflare 重试拦截器（原样平移）
│   ├── shared/types/        # 存储类型（骨架版）
│   ├── messages.ts          # 精简版消息协议 + wrapper（移植自 PT-depiler）
│   ├── storage.ts           # 扩展存储 schema
│   └── helper.ts            # 全局助手（原样平移）
└── wxt.config.ts
```

## 别名约定（与 PT-depiler 一致，保证包零修改平移）

- `~/*` → `src/*`
- `@/*` → `src/*`
- `@ptd/*` → `packages/*`

## 命令

```bash
pnpm install        # 安装 + wxt prepare（生成 .wxt 类型）
pnpm dev            # 开发模式（自动开浏览器，HMR）
pnpm build          # 生产构建 → .output/chrome-mv3
pnpm build:firefox  # Firefox 构建
pnpm compile        # vue-tsc 类型检查
pnpm zip            # 商店发布包
```

## 踩坑记录（2026-10-02，环境：pnpm 12.8.1 / Node 22）

1. **WXT 0.21 默认搭 vite 8（rolldown 内核）**：rolldown 从 1.0.0-rc.17 起（rolldown#9197）把 TS 模块间 missing export 从警告升级为硬错误。site 包大量 `import { ITorrent } from "../types"`（barrel 重导出的类型，无 `type` 修饰）在 rollup+esbuild 下会被自动擦除，在 rolldown 下直接构建失败。
   **解法**：`pnpm-workspace.yaml` 里 `overrides: { vite: ^7.0.0 }` 退回 rollup 内核（WXT peerDeps 允许 ^6.3.4 || ^7 || ^8）。后续若要上 rolldown，需对 site 包做 codemod 把类型导入改为 `import type`。
2. **pnpm 12 不再读 package.json 的 `pnpm` 字段**，overrides 必须写进 `pnpm-workspace.yaml`，否则报 "would drop pnpm.overrides"。
3. **pnpm 12 isolated 布局在本机出现半成品 node_modules**（scoped 包有链接、非 scoped 全缺，且状态文件标记完成导致后续 install 跳过）。**解法**：`pnpm-workspace.yaml` 里 `nodeLinker: hoisted`（npm 式扁平布局）。
4. **WXT 的 cli-utils.mjs 引用 `tinyexec` 但未声明依赖**，需显式 `pnpm add -D tinyexec`。
5. WXT 生成的 tsconfig 默认开启 `verbatimModuleSyntax` + `noUncheckedIndexedAccess`（比 PT-depiler 严格），为使 site/social 包零修改通过类型检查，在 tsconfig 中放宽回旧项目水平。
6. **WXT background 默认编成 classic service worker（IIFE），并因 classic SW 不支持 `import()` 而开启 `inlineDynamicImports`**——后果是 `import.meta.glob` 的 340 个站点定义懒加载 chunk 连同 sizzle 被**全部内联进 background.js**，而 sizzle 的 UMD 工厂在模块顶层访问 `window`，MV3 SW 无 window → `ReferenceError: window is not defined` → SW 启动即崩、消息监听器注册不上，前端表现为消息永远无响应（popup 卡「连接 background 中…」）。
   **解法**：`defineBackground({ type: "module", main() {...} })`（manifest 得到 `"background": {"type": "module"}`），module SW 支持 `import()`，站点定义保持独立懒加载 chunk。附带收益：background 体积大降、总产物 3.52MB → 1.92MB。
   **诊断方法**：Node 里 stub `globalThis.chrome` 后 `await import('./.output/chrome-mv3/background.js')` 直接执行产物，可在浏览器外复现顶层崩溃。
7. **background 只需要站点定义数量时，不要 `import { definitionList } from "@ptd/site"`**：那会拉起 site index 的 eager 链（→ utils → @ptd/social → anidb/douban → sizzle）。用 `import.meta.glob("../../packages/site/definitions/*.ts")` 只取文件名键 + `import type`（构建时擦除）。
8. **移除 popup 入口后 WXT 会把 manifest 的 `action` 键整个删掉**——没有 `action` 键，工具栏不出现可点击按钮，`action.onClicked` 永不触发。需在 `wxt.config.ts` 的 manifest 里显式声明最小 `action: { default_title: ... }`。点图标打开完整标签页 = 无 popup 入口 + manifest `action` 键 + background 监听 `onClicked` 调 `openOptionsPage()` + options 页 `<meta name="manifest.open_in_tab" content="true">`。

## Roadmap

- [x] ~~mediaServer / backupServer 包平移~~（v0.2.0）
- [x] ~~offscreen 入口（页面解析宿主）+ 搜索流程~~（v0.3.0，含 Vuetify/vue-router 接入）
- [x] ~~数据备份/导入：本地导出(zip)+文件恢复 + WebDAV/S3/B2 远程备份（加密/保留策略/历史）~~（v0.4.0）
- [ ] downloader 配置页与种子推送流程 UI（downloader 包本体已随 v0.2.0 平移）
- [ ] content script（siteHostMap 预匹配，去掉无条件 matchSocialPage 往返）
- [ ] 站点图标资源目录平移（__RESOURCE_SITE_ICONS__ 目前为空数组）
- [ ] i18n：默认语言静态注册 + 切换语言动态 import 合并
- [ ] ESLint (eslint-plugin-vue + typescript-eslint) + Vitest
- [ ] axios → ofetch 迁移评估（新代码先行）
