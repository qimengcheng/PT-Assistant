# PT Assistant

PT-depiler（PT-Plugin-Plus 继任者）的 **WXT + Vue 3 全新架构重写版**。

版本号以 `package.json` 的 `version` 为唯一真源（本文不写死，写死就每个版本过期一次）。

功能平移已完成，工程化体系（7 条 CI 守卫 / 版本号守卫 / 自动发版）已上线。

**三份文档各管一件事**，别在这里找经历：

| 文件 | 内容 |
|---|---|
| `README.md`（本文） | **现状** —— 架构选型、目录、命令、CI 守卫清单、待办 |
| `AGENTS.md` | **硬约定** —— git / 版本号 / 构建验收 / 代码规范，跨会话共享 |
| `PLAYBOOK.md` | **经历** —— 踩过的坑、当时的止痛、根因、结论落在哪个配置或脚本上（本文各处 `§N` 指它） |

## 架构决策（对比 PT-depiler）

| 维度 | PT-depiler（旧） | 本项目（新） |
|---|---|---|
| 扩展框架 | vite-plugin-web-extension（手写 manifest 构建） | **WXT 0.21**（entrypoints 约定、自动 manifest、跨浏览器） |
| 构建内核 | Vite 6（rollup） | **Vite 8（rolldown 内核）**，靠 `import type` + `verbatimModuleSyntax` 过 missing-export 硬错误（§1） |
| UI | Vue 3 + **Vuetify 4**（主 chunk ~444KB） | Vue 3 + **antdv-next**（Ant Design Vue 3，CSS-in-JS） |
| service worker | — | **module SW**：`defineBackground({ type: "module" })` 是硬要求，改回 classic 即启动即崩（§6，规则见 AGENTS.md §3.2） |
| 消息层 | @webext-core/messaging + 自建 wrapper（269 行协议） | 同款 wrapper（精简协议，随功能平移扩充） |
| 扩展存储 | @webext-core/storage（经 background 代理读写） | **wxt/storage**（官方推荐，键名/格式不变，见 src/storage.ts），**各上下文直连 `extStore`**，不经 background 代理（决策与边界见 §15） |
| 图表/画布 | echarts(vue-echarts) + konva(vue-konva 全局注册) | 同款库，**vue-konva 按需局部导入**（konva 随路由 chunk 懒加载，不进 options 主包）；echarts 模块化注册 + 页面级懒加载 |
| 站点定义 | 340 个 definition，import.meta.glob 按需加载 | **原样平移，零修改**（packages/site） |
| Buffer polyfill | 全局注入（background 464KB） | 不注入 |
| i18n | vue-i18n 双语言全量注册（~118KB） | vue-i18n 双语言全量注册（默认语言静态 import，切换语言动态 import） |
| 测试 | 无 | 类型检查 + 7 条 CI 守卫（5 静态扫描 + 2 行为断言）+ 产物 smoke test（ESLint / Vitest 尚未引入） |

> **UI 栈是 antdv-next**，走 CSS-in-JS **运行时注入样式**，
> 没有「构建期拆 CSS chunk + 动态 `<link>` 注入」那条链路 ——
> 后者在扩展页里加载不可靠，表现为懒加载路由的页面完全没有样式。
>
> 兼容层 `src/entrypoints/options/vuetify-compat.css` **仍在使用**：复刻已平移视图里
> 用到的 Vuetify 原子类（`pa-0` `text-no-wrap` `d-flex` 等），所以换框架没有重写纯样式 class 名。
> 模板清理完成后可整体删除。

## 工程化体系

`.github/workflows/ci.yml` 是单文件流水线（push / PR / 手动触发），
由 `.githooks/` 的本地 hook 与 CI 各守一半。守卫共 **7 条**（① ~ ⑤ 静态扫描，⑥ ⑦ 行为断言），
都挂在 `verify` job 的 `pnpm compile` 之后；本地改完也要跑，FAIL 非零退出。
每条的成因与「报干净 ≠ 真干净」的边界见 AGENTS.md §3.4 与 PLAYBOOK。机制清单：

| 机制 | 位置 | 作用 |
|---|---|---|
| 提交消息守卫 | `.githooks/commit-msg` → `check-version.mjs --message-file` | **只查**标题里的 `vX.Y.Z` 与暂存的 `package.json` 一致；`[agent名]-[模型名]` 前缀是 AGENTS.md §1.1 的约定，没有任何脚本强制它 |
| 版本号连续性 | `scripts/check-version.mjs` | 提交时拦住跳号；CI 用 `--committed` 兜底（clone 出的仓库没有本地 hook，`--no-verify` 也能绕过） |
| 防线 ① | `scripts/check-antd-tags.mjs` | 全仓扫描写错的 `a-*` 标签（antdv-next 没有的组件写错不报错，只是静默丢内容） |
| 防线 ② | `scripts/check-content-antd-lite.mjs` | content 侧 antd 按需注册的覆盖度比对 |
| 防线 ③ | `scripts/check-locale-keys.mjs` | i18n 键在 zh/en 两侧都能解析（取不到时 vue-i18n 不报错，而是把键路径渲染到界面） |
| 防线 ④ | `scripts/check-dead-props.mjs` | 传给 `a-*` 的死 prop / 死插槽（`GlobalComponents` 声明允许任意 attr，vue-tsc 抓不到，运行时不报错） |
| 防线 ⑤ | `scripts/check-store-hydration.mjs` | 挂载钩子里命令式读「`persistWebExt` 异步水合的 store」的地方（水合前那些字段是初始值，界面静默空着，不报错也不进 tsc） |
| 防线 ⑥（行为断言） | `scripts/check-indexdb-retry.mjs` | 懒开共享库的两条不变量：开库失败不能被缓存、成功后必须复用同一句柄。静态扫不出来，靠它钉（手写最小 IDB 桩，不引 fake-indexeddb） |
| 防线 ⑦（行为断言） | `scripts/check-fingerprint.mjs` | 种子指纹三层逻辑的纯函数断言（误判「本地已有」会让 qBittorrent 重下、直接打负分享率） |
| 版本号守卫自检 | `scripts/check-version-test.sh` | 在临时仓库里装真 hook 跑 18 项断言，验守卫自己的判定边界（amend 放行 / 跳号拦住 / 模型名带数字不抢位）。改 `check-version.mjs` 前必跑 |
| SW smoke test | `scripts/smoke-background.mjs` | 真的 import 一次构建产物，挡 classic SW 内联 sizzle 导致启动即崩那类问题 |
| 自动发版 | `release` job + `scripts/gen-release-notes.mjs` | push 到 master 或手动触发时打 tag + 出 Release（`skipIfReleaseExists`） |

> ⚠️ **防线 ② 依赖一个未声明的传递依赖**：`antdv-next@1.5.6` 内部用到
> `@ant-design/fast-color`，它没写进 `package.json`，现在能跑全靠 `pnpm-workspace.yaml`
> 的 `nodeLinker: hoisted` 把它扁平装上来了（本机实装 3.0.1，脚本 PASS）。
> 一旦改回 isolated 布局，这条防线会直接 `ERR_MODULE_NOT_FOUND` —— 见文末 Roadmap。

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
├── scripts/           ← 7 条 CI 守卫 + 构建入口 build-verify.mjs + 发版辅助（见「工程化体系」）
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
│   ├── messages.ts        # 消息协议（@webext-core/messaging）
│   ├── storage.ts         # 扩展存储（wxt/storage defineItem 适配层）
│   └── helper.ts          # 全局助手（原样平移）
├── dist-<会话>-<版本>/   # 各会话构建的真身目录（PTD_SESSION + package.json 版本号驱动，见「命令」）
├── dist-verify/          # 唯一验收加载路径：构建成功后换指到上面的 chrome-mv3（目录联接）
└── wxt.config.ts
```

## 别名约定（与 PT-depiler 一致，保证包零修改平移）

- `~/*` → `src/*`
- `@/*` → `src/*`
- `@ptd/*` → `packages/*`

## 命令

```bash
pnpm install        # 安装 + wxt prepare（生成 .wxt 类型）
pnpm build          # 本地默认：按 `owner` 会话构建 → dist-owner-<版本号>/chrome-mv3，并把 dist-verify 换指到它
PTD_SESSION=<会话标识> pnpm build  # 同上，只是换个会话桶（多个 agent 并行时各占一个）
CI=true pnpm build  # 本地复现 CI 那条路径 → .output/chrome-mv3，不建联接、不清理（CI 自己就是这么跑的）
PTD_SESSION=<会话标识> pnpm dev    # 开发模式（产物 → dist-<会话标识>-<版本号>/chrome-mv3；不加构建锁、不换指 dist-verify）
pnpm dev            # 裸 dev 不经构建脚本，仍是 .output，且不碰 dist-verify
pnpm zip            # 打包 zip（Chrome 产物 + Firefox 强制要求的 -sources.zip）
pnpm compile        # vue-tsc 类型检查
pnpm version:next   # 算出下一个该用的版本号（check-version.mjs --next）
pnpm version:check  # 校验 HEAD 那条的版本号 == package.json == 父提交 +1
```

> `pnpm version:next` / `version:check` 背后是 `scripts/check-version.mjs`，
> **它同时是 `.githooks/` 的 pre-commit / commit-msg 钩子**。
> clone 出的仓库没有本地 hook，需 `git config core.hooksPath .githooks` 手动启用；
> CI 侧的 `verify` job 是兜底，两者互不替代。

交付验收流程：本仓库常有**多个 agent 会话并行改同一棵工作树**，`wxt` 每次构建又会先清空输出目录，
所以真身按会话隔离在 `dist-<会话标识>-<版本号>/chrome-mv3`（agent 必须带 `PTD_SESSION=<自己的标识>`；
人不带就落进 `owner` 这个桶，见上面的命令表）；构建脚本随后把 **`dist-verify`** 这个目录联接换指到
本次产物 —— 浏览器里**只加载 `dist-verify` 这一个路径**（联接本身就指到 `chrome-mv3` 了，
后面不要再加一层，那是个不存在的路径；Chrome 未打包扩展的 id 按加载路径算，
换目录等于换个新扩展、配置全丢）。改完代码重新 build，再去 `chrome://extensions` 点重载即可，不用换加载路径。
`pnpm build` / `pnpm zip` 都先取 `.build-lock/` 互斥锁；三层机制的成因见 PLAYBOOK §14，规矩见 AGENTS.md §2.2。

## Roadmap（待办）

- [ ] 把 `@ant-design/fast-color` 显式声明进 `package.json`（现在靠 hoisted 布局传递装上，改回 isolated 就会 `ERR_MODULE_NOT_FOUND`，见「工程化体系」）
- [ ] `reDownloadTorrent` 延时调度（站点最小重下载间隔，job-scheduler 已就位）
- [ ] ESLint (eslint-plugin-vue + typescript-eslint) + Vitest
- [ ] axios → ofetch 迁移评估（新代码先行）
- [ ] 模板清理完成后删掉 `src/entrypoints/options/vuetify-compat.css`（见「架构决策」的兼容层说明）

已完成的部分不在这里列（那是历史）：轨迹见 `PLAYBOOK.md` 附录，逐项细节见 `git log` 与 GitHub Releases。
