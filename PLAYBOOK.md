# PT Assistant — 工程 Playbook

分工：**README.md 只写现状**（架构、目录、命令、守卫清单）；**AGENTS.md 写硬约定**（git / 构建 / 代码规范）；
本文件收**经历** —— 踩过的坑、当时的止痛、查到的根因，以及结论最终落到哪个配置项、哪个脚本上。

- 编号是稳定锚点：代码注释与 AGENTS.md 里存在 `§13` 这类跨文档引用，所以**只追加、不重排、不复用旧号**。
- 每条按「现象 → 根因 → 现在的做法」写。结论已被脚本或 CI 守住的，写明是哪条防线；
  只剩口头约定的标 **⚠️ 无守卫** —— 改那一块的人得自己记得，这类最容易失传。
- 记录日期是当时的实测环境，不代表现在；引用前先对着当前代码核一遍（本仓库三个月内做过一次整体版本重编号，见 §0）。

## 索引

| § | 主题 | 一句话结论 |
|---|---|---|
| 1 | Vite 8 / rolldown | 裸类型导入必须写 `import type`；已翻回 Vite 8，构建 37s → 5.5s |
| 2 | pnpm 12 | `overrides` 只能写进 `pnpm-workspace.yaml` |
| 3 | pnpm 12 布局 | `nodeLinker: hoisted` 是**当前布局**，不是临时绕过 |
| 4 | 未声明依赖 | `tinyexec` 要显式 `pnpm add -D` |
| 5 | tsconfig | 只放宽 `noUncheckedIndexedAccess`；`verbatimModuleSyntax: true` 是 §1 的闸门 |
| 6 | service worker | `defineBackground({ type: "module" })` **必须**；产物 3.52MB → 1.92MB |
| 7 | service worker | 只要数量就用 `import.meta.glob` 取键，pattern 必须是项目根绝对路径 |
| 8 | manifest | `action` 键要在 `wxt.config.ts` 显式声明 |
| 9 | 平台限制 | 确认框一律 `modal.confirm`；⚠️ 无静态守卫 |
| 10 | 包体 | konva 随路由 chunk 懒加载 |
| 11 | 依赖 | 别直接 `import dayjs`；日期区间用 `dateStrings` + `Date` |
| 12 | 布局 | `.content` 必须 `min-width: 0`，`a-table` 必须给 `scroll.y` |
| 13 | 本机环境 | `TEMP=$PWD/.tmp-build` 免重启绕过；⚠️ 杀软相关，不入库 |
| 14 | 多会话协作 | 三层：会话隔离真身 + 固定联接 + 构建互斥锁 |
| 15 | 存储 | 三条 RPC 已删，各上下文直连 `extStore`；互斥只在上下文内部 |
| 16 | UI | 新增 `a-*` 用法后跑一次 `check-dead-props.mjs` |
| 17 | UI | 列渲染只走插槽，没有 `customRender` |
| 18 | UI / 包体 | 加标签先补 `antd-lite.ts` 清单，否则线上静默空白 |
| 19 | 版本号 | 工作区的 `package.json` 是进度信号不是已发布版本，选号只认 `git log` |
| 20 | 版本号 | commit 标了号但 `package.json` 没提交 → CI 读到的是旧号 |
| 21 | 版本号 | amend 顺手改号会造死号；`--no-verify` 曾是唯一出路（现已不需要） |
| 22 | 多会话协作 | `--amend` 前必须确认 HEAD 是你自己的那条，否则会改掉别人的提交 |
| 23 | 发版 | 一次 push 攒多个版本号，只有最顶那版拿到 tag |
| 24 | CI | 曾把 workflow 写成 `build.yml` / `release.yml`，实际只有 `ci.yml` |
| 25 | service worker | 「导入即开库」的共享库接进 SW，只有跑产物才炸出来 |
| 26 | store 水合 | 5 秒 debounce 掩盖竞态：症状没了，代价摊给所有人 |
| 27 | 守卫边界 | 水合守卫首版把纯透传 getter 误报 |
| 28 | i18n 守卫 | 上线即扫出引用了不存在的 `common.noData` |
| 29 | 迁移盘点 | 「文件存在 ≠ 用户能看到」：路由一直挂着调试页 |
| 0 | 读史须知 | 版本重编号：`0.5.x` 已不存在，别按旧号找提交 |

## 读史须知：版本重编号（§0）

2026-10-04 本仓库把版本号方案从 `0.5.x` 整体重编号为 `0.2x`，**历史被改写并强推过远端**。
因此旧提交消息、旧注释、旧文档里出现的 `0.5.xx` 都不再对应任何现存提交；
代码注释里「vX 起改成…」这类版本门在重编号后会**静默失效**（例如 `config.ts` 的
`initTorrentOnEnterDefaultOnSince`）。引用某个版本号前先确认它还在：

```bash
git log --format=%s | grep "v0\.X\.Y\b"
```

---

## 一、构建内核与依赖

### 1. rolldown 把 TS 裸类型导入变成硬错误

**记录时间**：2026-10-02（环境 pnpm 12.8.1 / Node 22）。

**现象**：WXT 0.21 默认搭 Vite 8（rolldown 内核）。rolldown 从 1.0.0-rc.17 起（rolldown#9197）
把模块间 missing export 从**警告升级为硬错误**，构建直接失败。

**当时的止痛**：`pnpm-workspace.yaml` 里 `overrides: { vite: ^7.0.0 }` 退回 rollup 内核
（WXT 的 peerDeps 允许 `^6.3.4 || ^7 || ^8`）。

**根因不是最初以为的那个**：第一反应是「桶文件（barrel）重导出丢了类型」。用 TypeScript 自身的诊断量了一遍：

- TS1484（裸类型导入）**335 处 / 85 个文件**，全部出在叶子文件自己头上；
- TS1205（桶文件那条路）实测 **0 处**。

**现在的做法**：335 处补 `import type`，把根 tsconfig 的 `verbatimModuleSyntax` 改回 `true` 固化防线
（见 §5），然后翻回 `vite: ^8.0.0`（rolldown 1.2.12）。实测构建耗时 **37s → 5.5s**，
产物 **15.59MB / 1151 文件 → 14.22MB / 1235 文件**。

**回滚方式**：把 `pnpm-workspace.yaml` 的 override 那行改回 `^7.0.0` 并重装依赖。

### 2. pnpm 12 不再读 package.json 的 `pnpm` 字段

**现象**：`overrides` 写在 `package.json` 的 `pnpm` 字段里被无视，安装时报
`would drop pnpm.overrides`。

**现在的做法**：所有 pnpm 配置（`overrides` / `nodeLinker` / `allowBuilds`）写进 `pnpm-workspace.yaml`。
⚠️ **键名坑**：构建白名单的新键名是 `allowBuilds`（对象形式），旧键 `onlyBuiltDependencies` 在 pnpm 12 下**静默失效**，
表现为 `ERR_PNPM_IGNORED_BUILDS`。

### 3. pnpm 12 isolated 布局在本机出现半成品 node_modules

**现象**：scoped 包有链接、非 scoped 全缺，而且状态文件标记「已完成」，后续 `install` 直接跳过，
越修越乱。

**现在的做法**：`pnpm-workspace.yaml` 里 `nodeLinker: hoisted`（npm 式扁平布局）。
这是**长期状态**，不是临时绕过 —— 但它有副作用：未声明的传递依赖会被顺手扁平上来，能跑不代表声明正确，见 §4、§11 和 README「工程化体系」的 `@ant-design/fast-color` 警告。

### 4. WXT 的 cli-utils.mjs 引用 `tinyexec` 但未声明依赖

**现象**：装完 WXT 直接跑构建报模块找不到。

**现在的做法**：显式 `pnpm add -D tinyexec`。升级 WXT 时要复核这类上游漏声明。

### 5. WXT 生成的 tsconfig 比 PT-depiler 严格

WXT 生成的 tsconfig 默认开启 `verbatimModuleSyntax` + `noUncheckedIndexedAccess`。

- `noUncheckedIndexedAccess` 现为 **false**（为了让 site / social 包少改而放宽）。
- `verbatimModuleSyntax` 现为 **true** —— 它是防「裸类型导入在 rolldown 下变硬错误」的闸门（§1），
  **别再顺手关掉**。

### 13. esbuild 大输入写系统 Temp 后自删，被杀软句柄卡住

**现象**：`esbuild` 的 `transform` API 对 >~512KB 的输入会先写系统 Temp 再自删；本机杀软持有句柄导致删除失败
（`remove C:\...\Temp\esbuild-*: Access is denied`），`wxt build` / `wxt dev` 全挂，且**时好时坏**。

**缓解**：重启机器，或给项目目录 + `%TEMP%` 加杀软排除。
**已验证的免重启绕法**（2026-10-03 实测 45.7s，exit=0）：把临时目录指到仓库内已被 gitignore 的 `.tmp-build/`：

```bash
PTD_SESSION=<会话标识> TEMP="$PWD/.tmp-build" TMP="$PWD/.tmp-build" TMPDIR="$PWD/.tmp-build" pnpm build
```

> ⚠️ 这是本机环境问题，命令本身可以传阅，但**不要把这类私有绕过写进构建脚本或提交进仓库**。

**长期**：控制单 chunk 体积（这也是 §10、§18 那两条体积约束的真实动因之一）。
**另一个坑**：构建失败会先清空 `.output`，别把半成品拷成交付快照。

---

## 二、service worker 与 manifest

### 6. classic SW 内联 sizzle，启动即崩

**现象**：popup 卡在「连接 background 中…」，消息永远无响应。

**根因链**：WXT 的 background 默认编成 classic service worker（IIFE），而 classic SW 不支持 `import()`，
于是 WXT 开启 `inlineDynamicImports` —— `import.meta.glob` 的 340 个站点定义懒加载 chunk 连同 sizzle
被**全部内联进 background.js**；sizzle 的 UMD 工厂在模块顶层访问 `window`，MV3 SW 里没有 `window`
→ `ReferenceError: window is not defined` → SW 启动即崩、消息监听器注册不上。

**现在的做法**：`defineBackground({ type: "module", main() {...} })`，manifest 得到
`"background": { "type": "module" }`。module SW 支持 `import()`，站点定义保持独立懒加载 chunk。
附带收益：background 体积大降，总产物 **3.52MB → 1.92MB**。
**硬约定见 AGENTS.md §3.2**（这条改回去就崩，且崩在启动瞬间）。

**诊断方法（值得复用）**：Node 里 stub `globalThis.chrome` 后
`await import('./.output/chrome-mv3/background.js')` 直接执行产物，可在浏览器外复现顶层崩溃。
CI 的 `scripts/smoke-background.mjs` 守的就是这一类，见 README「工程化体系」。

### 7. background 不能 `import @ptd/site` 根入口

**现象**：只要 `import { definitionList } from "@ptd/site"`，§6 的崩溃就回来了。

**根因**：根入口拉起 eager 链（site index → utils → `@ptd/social` → anidb/douban → sizzle）。

**现在的做法**：只需要站点定义数量时，用 `import.meta.glob` 只取文件名键 + `import type`（构建时擦除）。
⚠️ **pattern 必须是项目根绝对路径** `/packages/site/definitions/*.ts` —— 相对 pattern（如 `../../packages/...`）
在 entrypoint 虚拟模块里会**静默匹配出空 map**，表现为「站点数恒为 0 且无任何报错」（v0.4.1 修掉的事故）。
实际用法见 `src/entrypoints/background/index.ts`。

### 8. 没有 popup 入口时 WXT 把 manifest 的 `action` 键整个删掉

**现象**：工具栏不出现可点击按钮，`action.onClicked` 永不触发。

**现在的做法**：点图标打开完整标签页 = 四件一起齐：
① 无 popup 入口；② `wxt.config.ts` 的 manifest 里显式声明最小 `action: { default_title: ... }`；
③ background 监听 `onClicked` 调 `openOptionsPage()`；
④ options 页 `<meta name="manifest.open_in_tab" content="true">`。

---

## 三、MV3 平台限制与 UI

### 9. MV3 扩展页里原生 `confirm()` / `alert()` 静默失效

**现象**：不弹窗，且返回 `false` —— 于是「确认删除」这类操作变成**默默取消**，看起来像按钮坏了。

**现在的做法**：所有确认框统一走 antdv 的 `modal.confirm`（`App.useApp()`）。
禁止照搬旧项目里的 `confirm()`。**⚠️ 无静态守卫**，靠 code review。

### 10. `vue-konva` 不在 main.ts 全局 `use`

**现象/动因**：全局注册会把 ~190KB 的 konva 卷进 options 主包，每个设置页都背上它。

**现在的做法**：只在时间线页具名导入 `Stage` / `Layer` / …，konva 随路由 chunk 懒加载。
图表同理：echarts 保持模块化注册 + 页面级懒加载。

### 11. `dayjs` 是未声明的传递依赖

**现象**：它只是 antdv-next 的传递依赖，没写进 `package.json`，能跑全靠 hoisted 布局（§3）。

**现在的做法**：不要直接 `import dayjs`。日期区间用 range-picker `@change` 的第二参数 `dateStrings` + 原生 `Date`。

### 12. 宽表格溢出要双修

**现象**：表格一宽整页被撑出视口；或者横向滚动条看不见、滚不动。

**现在的做法**：`.content`（flex 子项）必须 `min-width: 0`；`a-table` 需 `:scroll="{ x, y }"`
—— `y` 固定后横向滚动条才常驻可见，antd 不像 `v-data-table` 那样自带滚动。

### 16. antdv-next 的 prop 名与 ant-design-vue 旧版不一致，且写错不报错

**现象**：`check-dead-props.mjs` 上线时一次扫出 6 处真 bug，形态全是「组件根本不认这个 prop」：

- `Collapse` / `CollapsePanel` 没有 `disabled`（真开关是 `collapsible: 'disabled'`）；
- `CollapsePanel` 的插槽叫 `#header` 而非 `#label`（写错则整个标题不显示）；
- `AutoComplete` 没有 `readonly`（透传成裸 HTML 属性，**锁定状态下其实还能打字**）。

**根因**：`a-*` 的类型来自 `GlobalComponents` 声明，允许任意 attr，`vue-tsc` 抓不到；运行时是
`inheritAttrs` 默认行为 —— 没声明的 prop 被当普通 attr 塞进根 DOM，不报错、不警告、生产环境完全静默。

**现在的做法**：防线 ④ `scripts/check-dead-props.mjs`（CI 已挂）。**新增 `a-*` 用法后跑一次**。
更多 antdv 迁移坑（footer、auto-complete、a-table sorter、未注册标签）的成文规则见 AGENTS.md §3.4。

### 17. antdv-next 没有 `customRender` 这个列 API

**现象**：照搬 `v-data-table` / 旧 antd 的 `customRender`，整列**静默退化成原始值**。

**现在的做法**：`a-table` 的列渲染只走插槽（`#bodyCell` 等）。

### 18. content 侧用 `a-*` 组件要先过「按需注册」这道闸

**动因**：全量 install 会让 content-app 单 chunk 涨到 4.3MB（占全部产物 JS 的 65%），
每个 PT 站点都要加载一遍。

**现在的做法**：`src/content-script/antd-lite.ts` 只装模板真正用到的组件。
在 content 侧模板里新增 `a-*` 标签时，**必须同步那张表**并跑 `check-content-antd-lite.mjs`（防线 ②）复核。
漏注册的表现是 Vue 把标签当原生元素渲染（无样式、slot 失效），线上静默；DEV 构建下才升级成 `console.error`。

**补注册前先看体积**：按「实际注册名数」算 —— 有些组件（如 `a-empty`）实现早已在 chunk 里、只是没注册，
补注册 Δ0 KB；但 `a-float-button` / `a-descriptions` / `a-typography` 这类是实打实的新增体积，换之前先掂量。

---

## 四、存储

### 15. 存储读写不再经 background 代理（2026-10-03）

**做了什么**：`getExtStorage` / `setExtStorage` / `setExtStoragePath` 三条 RPC 与 background 侧的三个 handler 已删除，
57 处调用点（offscreen 43、options 9、content 引导 2、site 包 adapter 3）改为直连 `extStore`。

**为什么可以直连**：原 PT-depiler 的「extStore 不能在 offscreen 中使用」是**继承来的旧约束**，不是技术限制 ——
offscreen 文档是有 `storage` 权限的扩展页，content script 也有 storage 权限，两边都能直接读写。

**现在的 API**：`extStore` 提供 `getItem` / `setItem` / `patchItem(key, path, value)`，并按 key 排队串行化写入。

**必须知道的边界**：这个队列是补上原先 background 单写者顺带提供的读-改-写保护，
但**只在各上下文内部互斥，不跨上下文**（改造前 options 的 pinia 持久化也同样绕过了 background）。
跨上下文的读-改-写竞态仍然要自己考虑。

**代价 / 收益**：content 引导把 wxt/storage 的 StorageItem 机制打了进去，7,969 B → 20,309 B；
换来「不再为了读一次 config 就在每个网页上冷启动 MV3 service worker」。

---

## 五、多 agent 并行与交付

### 14. 多 agent 并行构建会互相擦产物（2026-10-03 实测两起）

**动因**：用户提的「目录太多、验证很麻烦」根因就在这里 —— 每换一个产物目录，Chrome 那边的扩展
就等于新装一个，站点配置和下载器设置全得重录一遍。所以最终形态是「真身各走各的目录 + 加载入口只留一个」。

**现象**：`wxt` 每次构建**先清空 outDir**，于是

1. 一个会话把 `.output/chrome-mv3` 拷成交付快照时，另一个会话正在清空它 → 交付目录直接 0 文件；
2. 另一个会话一次失败的构建把共享的 `.output` 整个留空。

**解法（三层，实现见 `scripts/build-verify.mjs` + `wxt.config.ts` 的 `outDir`）**：

1. **真身按会话隔离** —— `PTD_SESSION=<标识> pnpm build` → `dist-<标识>-<版本号>/chrome-mv3`，
   谁也不再往共享目录拷贝。（WXT 0.21.4 的 `wxt build` 没有 `--output` 参数，只能走配置。）
2. **加载入口收成一个固定路径** —— 构建成功后把目录联接 `dist-verify` 换指到本次产物，
   用户永远只加载它。为什么必须固定：Chrome 给未打包扩展算 id 用的是**加载路径**，
   每换一个目录就要「移除旧的 + 加载新的」，站点配置全得重来。
   联接用 Node 原生 junction（`fs.symlinkSync(..., "junction")`，不需要管理员权限；
   真符号链接需要，`cmd /c mklink` 则会被仓库路径里的空格咬掉）。
3. **构建串行** —— `pnpm build` / `pnpm zip` 都经 `scripts/build-verify.mjs`，先拿 `.build-lock/` 互斥锁再建。
   真正会打架的不是产物目录（已经隔离了），而是三份共享状态：`.wxt/`（全仓唯一一份生成类型）、
   `node_modules/.vite/`（依赖预打包缓存）、系统 Temp 里 esbuild 的自删（§13，并行时概率翻倍）。
   锁只管 `build` / `zip`，**不管 `pnpm dev`**（长跑会堵死别人，所以 dev 也不换指 `dist-verify`）。

**CI 依赖的默认行为**：没有 `PTD_SESSION` 时产物在 `.output`、且不碰联接，CI 按 `.output/*.zip` 取包。
所以别让 CI 带上这个变量。

**后续（2026-10-05）**：这条默认分支把**用户自己**的构建也一起挡掉了 —— 他在 WebStorm 里跑
`pnpm build`，看到的是一句「未设 PTD_SESSION…跳过联接与清理」，`dist-verify` 还指着某个 agent 的产物。
他没有会话标识，也不该为了拿固定加载路径去配环境变量。
现在的做法：`build-verify.mjs` 在「没给会话名 **且** 不在 CI（看 `CI` / `GITHUB_ACTIONS`）」时按
`owner` 这个会话走，产物落 `dist-owner-<版本号>/chrome-mv3`、照常换指联接；CI 分支原样不动。
为什么不是「把联接直接指到 `.output`」：`.output` 每次构建都被清空，那样等于把用户正在加载的目录
擦成 0 文件 —— 就是本节上面第 ① 起事故的形状。代价是 agent 裸跑 `pnpm build` 也会写进 `owner` 桶并
抢走联接，所以 AGENTS.md §2.1 明确要求 agent 一律带自己的标识。

验收流程与固定路径的现状陈述见 README「命令」；跨会话纪律见 AGENTS.md §2.2。

---

## 六、版本号与提交纪律

规则本身在 AGENTS.md §1，这里只留「为什么长这样」的事故。

### 19. 工作区的 package.json 不是「已发布版本」（死号事故）

**现象**：另一个 agent 把 `package.json` 预 bump 到某个号 N 但**还没提交**，我把 N 当成了
「已经用掉的版本」，改成 N+1 提交 —— **N 从此成为没有任何提交用过的死号**，历史出现缺口，
事后只能靠重写提交把它补上。

**根因**：不是算错，是**参照物选错**。工作区 `package.json` 的值是「当前工作进度」的信号，
不是「已发布版本」；真相源只有 `git log`。

**现在的做法**：选号一律 `node scripts/check-version.mjs --next`，不手算、不拿工作区的值 +1（AGENTS.md §1.2）。

### 20. commit 标了版本号，但 package.json 漏提交

**现象**：commit 标 v0.16.0，`version` 却一直停在上一个已提交的号上，CI 读到的版本与提交说明不一致。

**根因**：`package.json` 是多会话共享热点，bump 时最容易漏 `git add`。

**现在的做法**：bump 必须同一笔提交带上 `package.json`；提交后 `check-version.mjs --committed` 核一次（AGENTS.md §1.3）。

### 21. amend 与版本号：三条实测出来的边界

1. **`--amend` 时顺手改号会造出死号**，两个钩子和 CI 都拦不住：那一刻暂存号 == HEAD 的号 + 1，
   与一次完全正常的提交无法区分；等下一条提交压上去，缺口进了历史中段，而 `--committed` 只校验 HEAD 一条，
   中段缺口是盲区。v0.5.1 在测试仓库里就是这么没的（该号已随 §0 的重编号失效，别再去找它）。
   → 结论：**amend 只改消息和内容，不改版本号**。
2. **`pre-commit` 认出 amend 之前，AGENTS.md §1.6 的合并流程会被当成跳号拦死**，
   当时唯一的出路是 `--no-verify` —— 那等于把这条流程从受保护变成不受保护。
   现在的判据：暂存号 == HEAD 自己的号时认定为 amend，基线取 `HEAD~1`。
   代价是「新开一条却重复用号」当场放过，由 CI 事后认。
3. **「提交消息正文别写别的版本号」是一条不存在、曾被误记并往下传的规则。**
   `commit-msg` 只锚首行、不扫正文，引用别的版本号绝对安全。

> 这三条边界都是实测出来的，不是推的。改 `check-version.mjs` 的判据前必须跑
> `sh scripts/check-version-test.sh`（18 项断言，临时仓库里装真 hook）—— 这条守卫自己没人守，
> 就是它连续两次误拦 / 漏放的原因。

### 22. 多会话共用工作树：HEAD 会被别人抢先推进

**现象（差点出事的那次）**：本会话提交之后，`[OpenCode]` 立刻落了一条 v0.22.17；
随后那次试手性的 `git commit --amend` **不报错**，改的会是他的提交而不是我的。

**现在的做法**：amend 前两条命令缺一不可 —— `git log -1 --format='%an %s'` 确认 HEAD 是自己的，
`git log --oneline origin/master..HEAD` 确认它没推出去（AGENTS.md §1.6）。

### 23. 一次 push 攒多个版本号，只有最顶那版拿到 tag

**实测**：v0.22.7 / .8 / .9 / .10 攒在一次 push 里，远端只多了 v0.22.11，下面四个静默漏掉。

**根因**：workflow 检出的是这次 push 的 tip commit，`release` job 只按它的 `package.json` 打一个 tag。

**现在的做法**：**每个版本号单独 push**（AGENTS.md §2.4）。

### 24. workflow 文件名曾被文档写错

旧文档写的 `build.yml` / `release.yml` **两个文件都不存在**，v0.22.13 那轮文档订正漏掉了这处。
真源只有一个：`.github/workflows/ci.yml`，三个 job 串起来 `verify → build → release`。

---

## 七、service worker 与产物级验证

### 25. background 引到「导入即开库」的共享库（v0.22.16）

**现象**：`fixer.ts` 引了按天存档模块，把模块级 `export const db = openDB(...)` 接进 SW 的导入图，
构建产物在 Node 里 import 直接 `indexedDB is not defined`。

**为什么难抓**：真浏览器里有 `indexedDB`，线上不报；vue-tsc、源码审查、Chrome 构建**全看不见**。
唯一抓到它的是 `scripts/smoke-background.mjs` —— 那里把打包产物真的 import 一次。
崩溃点在模块顶层，而 background 只是**恰好 import 到了**。

**更难看的一层**：它当时没被发现，是因为那批提交里没人跑过 `wxt zip -b firefox` 和 smoke 这两条；
等 CI 报出来，责任落在最后一个 push 的人身上（一次 push 只打一个 tag，见 §23）——
查出病灶的是他，CI 报在名下的是我。**推之前跑完这两条，十分钟内能确认自己没往主线扔一颗雷。**

**现在的做法**：共享库句柄一律走 `@/shared/indexdb` 的 `ptdIndexDb()`（懒开），不许改回模块级 Promise；
懒开的两条不变量（失败不缓存 rejection / 成功必须复用）静态扫不出来，由防线 ⑥
`check-indexdb-retry.mjs` 用行为断言钉住。那两行重置代码要写成函数体内的 `try/await/catch`，
不要写成游离的 `.catch()` —— 后者看着像无用代码，会被顺手删掉。

---

## 八、守卫的实测案例与边界

### 26. 「我的数据」页等 5 秒多才出表：竞态被 debounce 掩盖

**现象**：首屏表格要等 5 秒多。

**根因**：`persistWebExt` 的 store 取数走 `chrome.storage.local.get`，水合完成前字段是**初始值**
（对象 `{}`、数组 `[]`），不是 `undefined` —— 所以 `onMounted(() => 读 metadataStore.sites)`
这类写法不报错、不进 vue-tsc、不进构建，只是首屏静默空着。

**当时的处理**：有人为了绕开它手搓了一个 5 秒 debounce 轮询存储，症状被掩盖，代价摊给所有人。

**现在的做法**：两条出路 —— `$onReady`，或改成派生（`computedAsync` / `computed`，**首选**，
不需要等待，水合一到自动重算）。防线 ⑤ `check-store-hydration.mjs` 拦挂载钩子里的命令式读取。

### 27. 水合守卫首版的误报

getter 到底读没读 `state` 静态判不出来 —— 首版把纯透传的 `getSiteMetadata` 误报成了一处，
靠人工核对源码才排除。所以**这条守卫报出来的每一条都要回源码看一眼**，
它的口径同样是「宁可漏报也不误报」（AGENTS.md §3.4）。

### 28. i18n 守卫上线即扫出真问题

v0.20.0 整站接入 i18n 时，`check-locale-keys.mjs` 扫出 `ExportUserInfoDialog.vue` 引用了不存在的
`common.noData`。这条防的是 vue-i18n 的静默失效：键取不到时**不抛异常、不进 vue-tsc、不进构建**，
而是把键路径本身当文案渲染到界面上 —— 内部标识符进 UI 是零容忍项（AGENTS.md §3.5）。

---

## 九、迁移盘点

### 29. 文件存在 ≠ 用户能看到

**实例**：站点管理页 490 行早已迁移完成，但路由表一直挂着一个简易调试页；
另有三个组件平移了，却从没接线进任何页面。

**现在的做法**：盘点迁移进度除了 diff 文件清单，**必须 grep 路由表 + grep 组件的实际引用点**，
排查手法见 AGENTS.md §4。

---

## 附录：功能平移与工程化的完成轨迹

真源是 `git log` 与 GitHub Releases（`scripts/gen-release-notes.mjs` 按提交前缀分组生成），
这份清单只是「当时哪些算做完了」的快照，读它请同时确认结论还在代码里。

- mediaServer / backupServer 包平移（v0.2.0）
- offscreen 入口（页面解析宿主）+ 搜索流程（v0.3.0）
- 数据备份/导入：本地导出(zip) + 文件恢复 + WebDAV/S3/B2 远程备份（加密/保留策略/历史）（v0.4.0）
- UI 框架迁移 Vuetify → antdv-next 全量收尾（v0.7.0）
- 下载器配置页与种子推送流程 UI（SetDownloader + MyClient）（v0.13.1）
- content script（引导 + 懒加载 app，站点浮窗/推送）（v0.13.1）
- 站点图标资源目录平移（`public/icons/site`，`__RESOURCE_SITE_ICONS__`）（v0.13.1）
- 我的数据三件套：概览表格 + echarts 统计页 + konva 时间线页（v0.13.1）
- 面向用户文案全站接入 i18n（v0.20.0，默认语言静态注册 + 切换语言动态 import）
- CI 流水线 + 4 条静态防线 + 版本号守卫 + 自动发版（v0.20.1 ~ v0.22.2）
- 防线 ⑤：挂载钩子里命令式读异步水合 store 的守卫，并修掉它扫出的 5 处真问题（v0.22.19）
- 种子指纹自检挂进 CI（v0.22.25）
