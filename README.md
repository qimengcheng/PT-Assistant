# PT Assistant

PT-depiler（PT-Plugin-Plus 继任者）的 **WXT + Vue 3 全新架构重写版**。

版本号以 `package.json` 的 `version` 为唯一真源（本文不写死，写死就每个版本过期一次）。

功能平移已完成，工程化体系（CI 静态防线 / 版本号守卫 / 自动发版）已上线。

## 架构决策（对比 PT-depiler）

| 维度 | PT-depiler（旧） | 本项目（新） |
|---|---|---|
| 扩展框架 | vite-plugin-web-extension（手写 manifest 构建） | **WXT 0.21**（entrypoints 约定、自动 manifest、跨浏览器） |
| 构建内核 | Vite 6（rollup） | **Vite 8（rolldown 内核）** —— 中途曾退回 Vite 7 止痛，见踩坑记录 1 |
| UI | Vue 3 + **Vuetify 4**（主 chunk ~444KB） | Vue 3 + **antdv-next**（Ant Design Vue 3，CSS-in-JS） |
| 消息层 | @webext-core/messaging + 自建 wrapper（269 行协议） | 同款 wrapper（精简协议，随功能平移扩充） |
| 扩展存储 | @webext-core/storage（经 background 代理读写） | **wxt/storage**（官方推荐，键名/格式不变，见 src/storage.ts）；v0.20.5 起**各上下文直连** `extStore`，不再经 background 代理 |
| 图表/画布 | echarts(vue-echarts) + konva(vue-konva 全局注册) | 同款库，但 **vue-konva 改按需局部导入**（避免 konva 进 options 主包）；echarts 保持模块化注册 + 页面级懒加载 |
| 站点定义 | 340 个 definition，import.meta.glob 按需加载 | **原样平移，零修改**（packages/site） |
| Buffer polyfill | 全局注入（background 464KB） | 不注入 |
| i18n | vue-i18n 双语言全量注册（~118KB） | vue-i18n 双语言全量注册（默认语言静态 import，切换语言动态 import） |
| 测试 | 无 | 类型检查 + 5 条 CI 静态防线 + 产物 smoke test（ESLint / Vitest 尚未引入） |

> **UI 框架已从 Vuetify 换成 antdv-next**（v0.13.1 完成迁移）。
>
> 换框架的附带收益：antdv-next 走 CSS-in-JS **运行时注入样式**，
> 不再有 Vuetify 那种「构建期拆 CSS chunk + 动态 `<link>` 注入」的链路 ——
> 那条链路在扩展页里加载不可靠，表现为懒加载路由的页面完全没有样式。
>
> 迁移期保留 `src/entrypoints/options/vuetify-compat.css`：复刻了已平移视图里
> 用到的 Vuetify 原子类（`pa-0` `text-no-wrap` `d-flex` 等），避免为了换框架
> 去逐个重写纯样式 class 名。模板清理完成后可以整体删除。

## 工程化体系

`.github/workflows/ci.yml` 是单文件流水线（push / PR / 手动触发），
由 `.githooks/` 的本地 hook 与 CI 各守一半：

| 机制 | 位置 | 作用 |
|---|---|---|
| 提交消息守卫 | `.githooks/commit-msg` → `check-version.mjs --message-file` | **只查**标题里的 `vX.Y.Z` 与暂存的 `package.json` 一致；`[agent名]-[模型名]` 前缀是 AGENTS.md §1.1 的约定，没有任何脚本强制它 |
| 版本号连续性 | `scripts/check-version.mjs` | 提交时拦住跳号；CI 用 `--committed` 兜底（clone 出的仓库没有本地 hook，`--no-verify` 也能绕过） |
| 防线 ① | `scripts/check-antd-tags.mjs` | 全仓扫描写错的 `a-*` 标签（antdv-next 没有的组件写错不报错，只是静默丢内容） |
| 防线 ② | `scripts/check-content-antd-lite.mjs` | content 侧 antd 按需注册的覆盖度比对 |
| 防线 ③ | `scripts/check-locale-keys.mjs` | i18n 键在 zh/en 两侧都能解析（取不到时 vue-i18n 不报错，而是把键路径渲染到界面） |
| 防线 ④ | `scripts/check-dead-props.mjs` | 传给 `a-*` 的死 prop / 死插槽（`GlobalComponents` 声明允许任意 attr，vue-tsc 抓不到，运行时不报错） |
| 防线 ⑤ | `scripts/check-store-hydration.mjs` | 挂载钩子里命令式读「`persistWebExt` 异步水合的 store」的地方（水合前那些字段是初始值，界面静默空着，不报错也不进 tsc） |
| 版本号守卫自检 | `scripts/check-version-test.sh` | 在临时仓库里装真 hook 跑 18 项断言，验守卫自己的判定边界（amend 放行 / 跳号拦住 / 模型名带数字不抢位）。改 `check-version.mjs` 前必跑 |
| 开库语义断言 | `scripts/check-indexdb-retry.mjs` | 懒开共享库的两条不变量：开库失败不能被缓存、成功后必须复用同一句柄。静态扫不出来，靠它钉（手写最小 IDB 桩，不引 fake-indexeddb） |
| SW smoke test | `scripts/smoke-background.mjs` | 真的 import 一次构建产物，挡 classic SW 内联 sizzle 导致启动即崩那类问题 |
| 指纹自检 | `scripts/check-fingerprint.mjs` | 种子指纹三层逻辑的纯函数断言（误判「本地已有」会让 qBittorrent 重下、直接打负分享率）。**未挂 CI，手动跑** |
| 自动发版 | `release` job + `scripts/gen-release-notes.mjs` | push 到 master 或手动触发时打 tag + 出 Release（`skipIfReleaseExists`） |

> ⚠️ **防线 ② 依赖一个未声明的传递依赖**：`antdv-next@1.5.6` 内部用到
> `@ant-design/fast-color`，它没写进 `package.json`，现在能跑全靠 `pnpm-workspace.yaml`
> 的 `nodeLinker: hoisted` 把它扁平装上来了（本机实装 3.0.1，脚本 PASS）。
> 一旦改回 isolated 布局，这条防线会直接 `ERR_MODULE_NOT_FOUND` —— 见 Roadmap 待办。

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
│   ├── icons/site/         ← 站点 favicon 资源（249 个，__RESOURCE_SITE_ICONS__）
│   ├── icons/downloader/   ← 8 个下载器图标，文件名 == packages/downloader/entity 的类型名
│   ├── icons/backupServer/ ← 8 个备份服务器图标（同上，靠 getBackupServerIcon 拼路径）
│   ├── icons/mediaServer/  ← 4 个媒体服务器图标
│   ├── icons/social/       ← 7 个社交站图标（TorrentTitleTd 用 /icons/social/${key}.png）
│   └── lib/mdi/            ← Material Design Icons 子集字体（时间线 konva 字形用）
├── scripts/           ← CI 静态防线 + 发版辅助（见「工程化体系」）
├── src/
│   ├── entrypoints/
│   │   ├── background/    # MV3 module SW：cookies/DNR/alarms/消息路由
│   │   ├── content.ts     # 页面内引导脚本（轻量，命中站点才动态 import app）
│   │   ├── content-app.ts # content script 应用本体（ES 输出，懒加载）
│   │   ├── offscreen/     # 页面解析宿主（搜索/用户信息/备份）
│   │   └── options/       # 设置页（侧边栏 + 全部功能视图）
│   ├── options/           # 设置页内部：views/ stores/ components/ plugins/ directives/ services/
│   ├── content-script/    # content 浮窗 UI + antd-lite.ts（按需注册，见防线 ②）
│   ├── extends/           # axios 拦截器（unsafe header + Cloudflare 重试）、pinia webext 持久化
│   ├── locales/           # zh_CN / en 双语言 JSON
│   ├── shared/types/      # 存储与领域类型
│   ├── styles/            # 全局样式（Vuetify 已移除）
│   ├── messages.ts        # 消息协议（@webext-core/messaging）
│   ├── storage.ts         # 扩展存储（wxt/storage defineItem 适配层）
│   └── helper.ts          # 全局助手（原样平移）
├── dist-<会话>/         # 各会话独立的产物目录（PTD_SESSION 驱动，见「命令」）
└── wxt.config.ts
```

## 别名约定（与 PT-depiler 一致，保证包零修改平移）

- `~/*` → `src/*`
- `@/*` → `src/*`
- `@ptd/*` → `packages/*`

## 命令

```bash
pnpm install        # 安装 + wxt prepare（生成 .wxt 类型）
PTD_SESSION=<会话标识> pnpm dev    # 开发模式（产物 → dist-<会话标识>/chrome-mv3）
PTD_SESSION=<会话标识> pnpm build  # 生产构建（产物 → dist-<会话标识>/chrome-mv3）
pnpm build          # 不带变量 → .output/chrome-mv3（CI 走这条，别改）
pnpm zip            # 打包 zip（Chrome 产物 + Firefox 强制要求的 -sources.zip）
pnpm compile        # vue-tsc 类型检查
pnpm version:next   # 算出下一个该用的版本号（check-version.mjs --next）
pnpm version:check  # 校验 HEAD 那条的版本号 == package.json == 父提交 +1
```

> `pnpm version:next` / `version:check` 背后是 `scripts/check-version.mjs`，
> **它同时是 `.githooks/` 的 pre-commit / commit-msg 钩子**。
> clone 出的仓库没有本地 hook，需 `git config core.hooksPath .githooks` 手动启用；
> CI 侧的 `verify` job 是兜底，两者互不替代。

交付验收流程：本仓库常有**多个 agent 会话并行改同一棵工作树**，而 `wxt` 每次构建都会先清空
输出目录 —— 共享目录会被互相擦掉（踩过：拷贝 `dist-latest` 时抓到另一会话构建中途的空目录）。
所以构建时必须带 `PTD_SESSION=<会话标识>`，产物直接落在 `dist-<会话标识>/chrome-mv3`，
浏览器「加载已解压的扩展程序」指**自己这个目录**，不再往共享目录拷贝。
改完代码需重新 build + 在 `chrome://extensions` 点重载。

## 踩坑记录（2026-10-02，环境：pnpm 12.8.1 / Node 22）

1. **WXT 0.21 默认搭 vite 8（rolldown 内核）**：rolldown 从 1.0.0-rc.17 起（rolldown#9197）把 TS 模块间 missing export 从警告升级为硬错误。site 包大量 `import { ITorrent } from "../types"`（裸类型导入，无 `type` 修饰）在 rollup+esbuild 下会被自动擦除，在 rolldown 下直接构建失败。
   **当时的止痛**：`pnpm-workspace.yaml` 里 `overrides: { vite: ^7.0.0 }` 退回 rollup 内核（WXT peerDeps 允许 ^6.3.4 || ^7 || ^8）。
   **但病因不是 barrel 重导出**：用 TypeScript 自身诊断量得 TS1484 共 335 处 / 85 文件，出在**叶子文件自己的裸类型导入**；桶文件那条路（TS1205）实测 **0 处**。335 处全部补 `import type`、并把根 tsconfig 的 `verbatimModuleSyntax` 改回 `true` 固化防线之后，**已经翻回 `vite: ^8.0.0`（rolldown 1.2.12）在用**，构建耗时 37s → 5.5s，产物 15.59MB/1151 文件 → 14.22MB/1235。回滚 = 把 override 那行改回 `^7.0.0` 并重装依赖。
2. **pnpm 12 不再读 package.json 的 `pnpm` 字段**，overrides 必须写进 `pnpm-workspace.yaml`，否则报 "would drop pnpm.overrides"。
3. **pnpm 12 isolated 布局在本机出现半成品 node_modules**（scoped 包有链接、非 scoped 全缺，且状态文件标记完成导致后续 install 跳过）。**解法**：`pnpm-workspace.yaml` 里 `nodeLinker: hoisted`（npm 式扁平布局）。
4. **WXT 的 cli-utils.mjs 引用 `tinyexec` 但未声明依赖**，需显式 `pnpm add -D tinyexec`。
5. WXT 生成的 tsconfig 默认开启 `verbatimModuleSyntax` + `noUncheckedIndexedAccess`（比 PT-depiler 严格）。现在只放宽了 **`noUncheckedIndexedAccess: false`**（为了让 site/social 包少改）；`verbatimModuleSyntax` 已改回 **`true`** —— 它是防「裸类型导入在 rolldown 下变硬错误」的闸门，别再顺手关掉。
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
    **已验证的免重启绕法**：把临时目录指到仓库内已被 gitignore 的 `.tmp-build/`，构建即通过（2026-10-03 实测 45.7s，exit=0）：

    ```bash
    PTD_SESSION=<会话标识> TEMP="$PWD/.tmp-build" TMP="$PWD/.tmp-build" TMPDIR="$PWD/.tmp-build" pnpm build
    ```

14. **多 agent 并行构建会互相擦产物**（2026-10-03 实测两起）：`wxt` 每次构建先清空 outDir，
    于是 ① 一个会话把 `.output/chrome-mv3` 拷成交付快照时，另一个会话正在清空它，交付目录直接变 0 文件；
    ② 另一个会话一次失败的构建把共享的 `.output` 整个留空。
    **解法**：产物目录按会话隔离 —— `PTD_SESSION=<标识> pnpm build` → `dist-<标识>/chrome-mv3`，
    谁也不再往共享目录拷贝（实现见 `wxt.config.ts` 的 `outDir`；WXT 0.21.4 的 `wxt build` 没有 `--output` 参数）。
    不设变量时仍是 `.output`，CI 依赖这个默认值取 `.output/*.zip`。

15. **存储读写不再经 background 代理**（2026-10-03）：`getExtStorage` / `setExtStorage` /
    `setExtStoragePath` 三条 RPC 与 background 侧的三个 handler 已删除，57 处调用点（offscreen 43、
    options 9、content 引导 2、site 包 adapter 3）改为直连 `extStore`。
    原 PT-depiler 的「extStore 不能在 offscreen 中使用」是继承来的旧约束：offscreen 文档是有
    `storage` 权限的扩展页，content script 也有 storage 权限，两边都能直接读写。
    直连后 `extStore` 提供 `getItem` / `setItem` / `patchItem(key, path, value)`，
    并按 key 排队串行化写入 —— 这是补上原先 background 单写者顺带提供的读-改-写保护，
    但**只在各上下文内部互斥**，不跨上下文（改造前 options 的 pinia 持久化也同样绕过了 background）。
    代价：content 引导把 wxt/storage 的 StorageItem 机制打了进去，7,969 B → 20,309 B；
    收益：不再为了读一次 config 就在每个网页上冷启动 MV3 service worker。

## 踩坑记录（2026-10-04 增补）

16. **antdv-next 的 prop 名与 ant-design-vue 旧版不一致，且写错不报错**。
    `check-dead-props.mjs` 上线时一次扫出 6 处真 bug，形态全是「组件根本不认这个 prop」：
    `Collapse` / `CollapsePanel` 没有 `disabled`（真开关是 `collapsible: 'disabled'`）、
    `CollapsePanel` 的插槽叫 `#header` 而非 `#label`（写错则整个标题不显示）、
    `AutoComplete` 没有 `readonly`（透传成裸 HTML 属性，**锁定状态下其实还能打字**）。
    根因：`a-*` 的类型来自 `GlobalComponents` 声明，允许任意 attr，`vue-tsc` 抓不到；
    而运行时是 `inheritAttrs` 默认行为 —— 没声明的 prop 被当普通 attr 塞进根 DOM，
    不报错、不警告、生产环境完全静默。**新增 `a-*` 用法后应跑一次该脚本。**
17. **`antdv-next` 没有 `customRender` 这个列 API**：`a-table` 的列只能过插槽
    （`#bodyCell` 等）。照搬 `v-data-table` / 旧 antd 的 `customRender` 会让整列
    静默退化成原始值。
18. **content 侧用 `a-*` 组件要先过「按需注册」这道闸**：
    `src/content-script/antd-lite.ts` 只装模板真正用到的组件（全量 install 会让 content-app 单 chunk
    涨到 4.3MB，占全部产物 JS 的 65%）。在 content 侧模板里新增 `a-*` 标签时，
    必须同步那张表并跑 `check-content-antd-lite.mjs` 复核 —— 漏注册的表现是 Vue 把标签
    当原生元素渲染（无样式、slot 失效），线上静默。DEV 构建下会升级成 `console.error`。
    体积按「实际注册名数」算：有些组件（如 `a-empty`）实现早已在 chunk 里、只是没注册，
    补注册 Δ0 KB；但 `a-float-button` / `a-descriptions` / `a-typography` 这类是实打实的新增体积，
    换之前先掂量。

## Roadmap

**功能平移与工程化主体已完成**：

- [x] ~~mediaServer / backupServer 包平移~~（v0.2.0）
- [x] ~~offscreen 入口（页面解析宿主）+ 搜索流程~~（v0.3.0）
- [x] ~~数据备份/导入：本地导出(zip)+文件恢复 + WebDAV/S3/B2 远程备份（加密/保留策略/历史）~~（v0.4.0）
- [x] ~~UI 框架迁移 Vuetify → antdv-next 全量收尾~~（v0.7.0）
- [x] ~~下载器配置页与种子推送流程 UI（SetDownloader + MyClient）~~（v0.13.1）
- [x] ~~content script（引导 + 懒加载 app，站点浮窗/推送）~~（v0.13.1）
- [x] ~~站点图标资源目录平移（public/icons/site，__RESOURCE_SITE_ICONS__）~~（v0.13.1）
- [x] ~~我的数据三件套：概览表格 + echarts 统计页 + konva 时间线页~~（v0.13.1）
- [x] ~~面向用户文案全站接入 i18n~~（v0.20.0，默认语言静态注册 + 切换语言动态 import）
- [x] ~~CI 流水线 + 4 条静态防线 + 版本号守卫 + 自动发版~~（v0.20.1 ~ v0.22.2）
- [x] ~~防线 ⑤：挂载钩子里命令式读异步水合 store 的守卫，并修掉它扫出的 5 处真问题~~（v0.22.19）

**待办**：

- [ ] 把 `@ant-design/fast-color` 显式声明进 `package.json`（现在靠 hoisted 布局传递装上，改回 isolated 就会 `ERR_MODULE_NOT_FOUND`，见「工程化体系」）
- [ ] `reDownloadTorrent` 延时调度（站点最小重下载间隔，job-scheduler 已就位）
- [ ] ESLint (eslint-plugin-vue + typescript-eslint) + Vitest
- [ ] axios → ofetch 迁移评估（新代码先行）
