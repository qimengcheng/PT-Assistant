# PT-assistant-wxt

PT-depiler（PT-Plugin-Plus 继任者）的 **WXT + Vue 3 全新架构重写版**（v0.13.1，功能平移基本完成，剩收尾与工程化项）。

## 架构决策（对比 PT-depiler）

| 维度 | PT-depiler（旧） | 本项目（新） |
|---|---|---|
| 扩展框架 | vite-plugin-web-extension（手写 manifest 构建） | **WXT 0.21**（entrypoints 约定、自动 manifest、跨浏览器） |
| 构建内核 | Vite 6（rollup） | **Vite 7（rollup）** —— 见下方踩坑记录 |
| UI | Vue 3 + **Vuetify 4**（主 chunk ~444KB） | Vue 3 + **antdv-next**（Ant Design Vue 3，CSS-in-JS） |
| 消息层 | @webext-core/messaging + 自建 wrapper（269 行协议） | 同款 wrapper（精简协议，随功能平移扩充） |
| 扩展存储 | @webext-core/storage | **wxt/storage**（官方推荐，键名/格式不变，见 src/storage.ts） |
| 图表/画布 | echarts(vue-echarts) + konva(vue-konva 全局注册) | 同款库，但 **vue-konva 改按需局部导入**（避免 konva 进 options 主包）；echarts 保持模块化注册 + 页面级懒加载 |
| 站点定义 | 340 个 definition，import.meta.glob 按需加载 | **原样平移，零修改**（packages/site） |
| Buffer polyfill | 全局注入（background 464KB） | 不注入 |
| i18n | vue-i18n 双语言全量注册（~118KB） | vue-i18n 双语言全量注册 |
| 测试 | 无 | 预留（WXT 自带 Vitest 集成，roadmap） |

> **UI 框架已从 Vuetify 换成 antdv-next**（v0.13.1）。迁移规范见
> [`ANTD-MIGRATION.md`](./ANTD-MIGRATION.md)，含完整标签映射表。
>
> 换框架的附带收益：antdv-next 走 CSS-in-JS **运行时注入样式**，
> 不再有 Vuetify 那种「构建期拆 CSS chunk + 动态 `<link>` 注入」的链路 ——
> 那条链路在扩展页里加载不可靠，表现为懒加载路由的页面完全没有样式。
>
> 迁移期保留 `src/entrypoints/options/vuetify-compat.css`：复刻了已平移视图里
> 用到的 Vuetify 原子类（`pa-0` `text-no-wrap` `d-flex` 等），避免为了换框架
> 去逐个重写纯样式 class 名。模板清理完成后可以整体删除。

## 目录结构

```
PT-assistant-wxt/
├── packages/
│   ├── site/          ← 自 PT-depiler 原样平移（340 定义 + schemas + types + utils）
│   ├── social/        ← 同上（bangumi/douban/imdb/anidb）
│   ├── downloader/    ← 下载器协议适配（qBittorrent/Transmission/aria2/Deluge…）
│   ├── mediaServer/   ← EMBY/Jellyfin/Plex/fnOS 适配
│   └── backupServer/  ← WebDAV/S3/B2 远程备份适配
├── public/
│   ├── icons/site/    ← 站点 favicon 资源（~249 个，__RESOURCE_SITE_ICONS__）
│   └── lib/mdi/       ← Material Design Icons 子集字体（时间线 konva 字形用）
├── src/
│   ├── entrypoints/
│   │   ├── background/    # MV3 module SW：cookies/DNR/alarms/消息路由
│   │   ├── content.ts     # 页面内引导脚本（轻量，命中站点才动态 import app）
│   │   ├── content-app.ts # content script 应用本体（ES 输出，懒加载）
│   │   ├── offscreen/     # 页面解析宿主（搜索/用户信息/备份）
│   │   └── options/       # 设置页（侧边栏 + 全部功能视图）
│   ├── options/           # 设置页内部：views/ stores/ components/ plugins/ directives/ services/
│   ├── content-script/app # content 浮窗 UI
│   ├── extends/           # axios 拦截器（unsafe header + Cloudflare 重试）、pinia webext 持久化
│   ├── locales/           # zh_CN / en 双语言 JSON
│   ├── shared/types/      # 存储与领域类型
│   ├── styles/            # 全局样式（Vuetify 已移除）
│   ├── messages.ts        # 消息协议（@webext-core/messaging）
│   ├── storage.ts         # 扩展存储（wxt/storage defineItem 适配层）
│   └── helper.ts          # 全局助手（原样平移）
├── dist-latest/           # 交付快照（.output/chrome-mv3 的拷贝，供加载验收）
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

交付验收流程：`pnpm build` 通过后把 `.output/chrome-mv3` 拷贝为 `dist-latest/`，
浏览器扩展以「加载已解压的扩展程序」指向其一，改完代码需重新 build + 在
`chrome://extensions` 点重载。

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

## 踩坑记录（2026-10-03 增补）

9. **MV3 扩展页里原生 `confirm()`/`alert()` 静默失效**（返回 false 且不弹窗）。所有确认框统一走 antdv 的 `modal.confirm`（`App.useApp()`），禁止照搬旧项目的 `confirm()`。
10. **`vue-konva` 不要在 main.ts 全局 `use(VueKonva)`**：会把 ~190KB 的 konva 卷进 options 主包，每个设置页都背上它。改在时间线页具名导入 `Stage/Layer/…`，konva 随路由 chunk 懒加载。
11. **不要直接 `import dayjs`**：它只是 antdv-next 的传递依赖，未声明进 package.json，能跑全靠 hoisted 布局。日期区间用 range-picker `@change` 的第二参数 `dateStrings` + 原生 `Date` 即可。
12. **宽表格溢出双修**：`.content`（flex 子项）必须 `min-width: 0`，否则整页被撑出视口；`a-table` 需 `:scroll="{ x, y }"`（y 固定后横向滚动条才常驻可见，antd 不会像 v-data-table 那样自带滚动）。
13. **esbuild `transform` API 对 >~512KB 的输入会写系统 Temp 再自删**，本机杀软句柄会导致删除失败（`remove esbuild-*: Access is denied`），`wxt build`/`wxt dev` 全挂。缓解：重启机器或给项目目录 + `%TEMP%` 加杀软排除；长期：控制单 chunk 体积。构建失败会先清空 `.output`，注意别把半成品拷进 `dist-latest`。

## Roadmap

- [x] ~~mediaServer / backupServer 包平移~~（v0.2.0）
- [x] ~~offscreen 入口（页面解析宿主）+ 搜索流程~~（v0.3.0，含 Vuetify/vue-router 接入）
- [x] ~~数据备份/导入：本地导出(zip)+文件恢复 + WebDAV/S3/B2 远程备份（加密/保留策略/历史）~~（v0.4.0）
- [x] ~~UI 框架迁移 Vuetify → antdv-next 全量收尾~~（v0.7.0，规范见 ANTD-MIGRATION.md）
- [x] ~~下载器配置页与种子推送流程 UI（SetDownloader + MyClient）~~（v0.13.1）
- [x] ~~content script（引导 + 懒加载 app，站点浮窗/推送）~~（v0.13.1）
- [x] ~~站点图标资源目录平移（public/icons/site，__RESOURCE_SITE_ICONS__）~~（v0.13.1）
- [x] ~~我的数据三件套：概览表格 + echarts 统计页 + konva 时间线页~~（v0.13.1）
- [ ] SetSite 路由注册与 SiteManageView 骨架页去重（见根目录 wxt-pending-registration.md）
- [ ] `reDownloadTorrent` 延时调度（站点最小重下载间隔，job-scheduler 已就位）
- [ ] i18n：默认语言静态注册 + 切换语言动态 import 合并
- [ ] ESLint (eslint-plugin-vue + typescript-eslint) + Vitest
- [ ] axios → ofetch 迁移评估（新代码先行）
