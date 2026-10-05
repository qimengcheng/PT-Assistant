# AGENTS.md — PT Assistant (WXT) 开发约定

> 本文件是**跨会话 / 跨 agent 共享**的硬约定。每个接手本仓库的 AI（含并行会话）动手前必读。
> 与 `README.md`（项目说明）配套使用。

## 0. 项目一句话

PT-Plugin-Plus / PT-depiler 的**重写版**：旧版是 Vue 3 + Vuetify 4 + vite-plugin-web-extension，
本仓库是 **WXT 0.21 + Vue 3 + antdv-next**，产物为 Chrome/Firefox MV3 扩展。
站点包 `packages/site`（340 个站点定义）、`packages/social`、`packages/downloader` 等从旧版**零修改平移**。

---

## 1. Git 约定

### 1.1 commit 消息前缀（硬性）

```
[WorkBuddy]-[Hy4 preview] v0.16.0 feat: xxx
```

- 方括号**各自独立**：`[agent名]` + `-` + `[模型名]`。不是 `[WorkBuddy-Hy4 preview]`。
- **模型名逐字照抄当次会话 system prompt 顶部**「This conversation is powered by X」，
  不缩写、不改大小写、**不沿用上次会话的记忆快照**（模型会中途切换，记忆会过期）。
- 仓库里可能出现别的 agent 写的前缀（如 `[DeepSeek Harness]-[Space Bunny]`），那是别人的，
  不要顺手改写别人的提交。

### 1.2 每个提交都必须带版本号

**硬性规则：没有版本号的 commit 不允许存在。**

- 每条 commit 消息开头必须是 `vX.Y.Z`，且与 `package.json` 的 `version` **一致**。
- 同一次工作只对应**一个**版本号。禁止出现两条 commit 标同一个版本号
  （反例：`v0.16.0 feat: 接线` + `v0.16.0 chore: 版本号对齐` —— 必须合并成一条）。
- bump 版本号时**务必把 `package.json` 一起 `git add`**（它常是多会话共享热点，最容易漏）。
- CI 与 Release 以 `package.json` 为唯一真源，commit 里的 `vX.Y.Z` 是给人看的；
  两者不一致时以 `package.json` 为准，但那就说明提交漏了东西。

#### 版本号只能从 git log 推导，不要看工作区

**这是本仓库真踩过一次的坑，也是本节最容易违反的一条。**

当时另一个 agent 把 `package.json` 预 bump 到某个号 N 但**还没提交**，我把 N 当成了
「已经用掉的版本」，改成 N+1 提交 —— **N 从此成为死号**，历史出现缺口，事后只能靠重写
提交把它补上。

> **读史须知**：2026-10-04 本仓库把版本号方案从 `0.5.x` 整体重编号为 `0.2x`（历史被改写
> 并强推过远端）。因此旧提交消息、旧代码注释、旧文档里出现的 `0.5.xx` **都不再对应任何现存
> 提交**；引用某个历史版本号之前先确认它还在：`git log --format=%s | grep "v0\.X\.Y\b"`。
> 同理，代码注释里「vX 起改成…」这类版本门（例如 `config.ts` 的
> `initTorrentOnEnterDefaultOnSince`）在重编号后会静默失效，改编号时必须逐个复核。

根因不是算错，是**参照物选错**：工作区 `package.json` 的值是「当前工作进度」的信号，
不是「已发布版本」。真相源只有 `git log`。

选号直接用工具，不要手算，也不要拿工作区的值 +1：

```bash
node scripts/check-version.mjs --next     # 输出下一个该用的版本号，例如 v0.22.0
```

#### 本地 hook 是主防线，CI 只是兜底

`.githooks/` 下两个钩子在**提交的瞬间**拦截：

| 钩子 | 查什么 |
|---|---|
| `pre-commit` | 暂存的 `package.json` 版本号 == git 历史最大 + 1（抓跳号） |
| `commit-msg` | 提交消息里的版本号 == 暂存的 `package.json`（抓三处不一致） |

**每个新克隆必须启用一次**（仓库级配置，不入库，所以不在 git 里）：

```bash
git config core.hooksPath .githooks
```

为什么不能只靠 CI：CI 只在 push 时触发。本地连提 5 次它一次都不跑，等 push 时历史
已经定型，只能事后告诉你「曾经跳过某个版本」，那时重写 5 条提交远比当场改麻烦。
CI 里那份（`check-version.mjs --committed`）是兜底，因为 clone 出来的仓库没有本地
hook，且 `--no-verify` 能绕过。

```bash
# 提交前自检（不想等 hook 拦，也可以手动先跑）
node scripts/check-version.mjs --next      # 该用哪个号
git show --stat HEAD | head -3
git show HEAD:package.json | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).version"
```

### 1.3 版本号必须三处一致

| 位置 | 说明 |
|---|---|
| `package.json` → `version` | 唯一真源，CI 与发布都读它 |
| 产物 `manifest.json` → `version` | 构建时从 package.json 注入 |
| commit 消息里的 `vX.Y.Z` | 与上面两者一致 |

**踩坑记录 1**：曾出现 commit 标 v0.16.0 但漏提交 `package.json`，`version` 因此一直停在
上一个已提交的号上，CI 读到的版本与提交说明不一致。**bump 版本号时务必把 `package.json` 一起 `git add`。**

**踩坑记录 2（跳号）**：见 §1.2「版本号只能从 git log 推导」。本地 `pre-commit` 会当场拦住，
提交后也要核对一次：`node scripts/check-version.mjs --committed`，
再扫一遍历史连续性 `git log -10 --format=%s` 看有没有缺口。

### 1.4 多 agent 并行下的 git 纪律

本仓库常被**多个会话同时改**。规矩：

1. `git add` **逐文件点名**，永远不用 `git add -A` / `add .`。
2. 提交前 `git diff --cached --stat` 复核：若出现「我没改过」的文件，说明是别的会话的工作，
   三个选择：① 不提交它 ② 一并提交但**在消息里注明**这是谁的未提交改动 ③ 先问用户。
3. **新文件写完立刻 `git add`**，否则可能被别的会话的 `git clean` 删掉。
4. 判断是否有并行会话：`git status` 里有你没动过的文件，或用 node 查 mtime 跟你自己的改动时间对齐
   （bash 的 `ls` 在本机不可用）。
5. 共享热点文件（`package.json`、`Footer.tsx`、`config.ts`、路由表、CHANGELOG）冲突概率最高，
   改之前先 `git diff` 看别人的在改什么。

### 1.5 push

```bash
export PATH="/c/Program Files/Git/bin:$PATH"   # 必须：用系统 git
git push origin master
git ls-remote origin refs/heads/master         # 必须：trust-but-verify
```

- **不要用沙箱自带的 PortableGit**，也不要直接写 `"/c/Program Files/Git/bin/git.exe"` 绝对路径
  （会被环境拦，报 `sandbox-center cmd decisionRecord missing actual resource subject`）。
- push 后**必须** `git ls-remote` 比对远端 hash == 本地 HEAD，不一致要主动告诉用户，不要沉默。
- **不擅自** `reset` / `force push` / 删 tag。需要改写已推送历史时先说明并取得用户同意，
  同意后用 `--force-with-lease`（比 `--force` 安全，会先校验远端未被他人改动），并先拉备份分支。
- 远端：`https://github.com/qimengcheng/PT-Assistant.git`（master 为默认分支）。

### 1.6 未推送的小改动要合进上一条提交，不要新开版本号

**同一前缀（同一个 agent 名）的连续提交**，如果同时满足下面三条，就应该
`git reset --soft HEAD~1` + `git commit --amend` 合进上一条，而不是再开一条新版本号：

1. **同一个前缀**（`[WorkBuddy]-` / `[Trae]-` …），不是别的 agent 的提交；
2. **这个版本号还没推送到远端**（`git log origin/master..HEAD` 里能看到它）；
3. **改动很小**：只碰 ≤ 3 个文件、约 30 行以内，且和上一条改的是同一片地方。

```bash
export PATH="/c/Program Files/Git/bin:$PATH"
git log --oneline origin/master..HEAD          # 确认这些提交都还没推送
git reset --soft HEAD~1                        # 撤销最新一条，内容回到暂存区
# 改回上一条的版本号（package.json），再 amend
git commit --amend -m '<合并后的完整消息>'
```

**为什么**：版本号是给外部看的锚点，一个版本号应对应一组完整、已定型的改动。
还没推送时中间态没人看到，多开一条只会让历史变碎，并且重复触发「同一个版本号出现多条提交」
这个已经被 CI `verify` job 拦下的问题。

**什么时候不能这么做**：提交**已经推送**过就不要用这招（要改就得 force push，风险高），
那种情况老老实实开新版本号。判断方法就是上面那条 `git log origin/master..HEAD`——
输出为空说明都已推送，接下来的提交都不要再合并了。

**另外**：合并后要检查那条提交的 `package.json` 版本号是否正确（reset 不会帮你改文件内容）。

---

## 2. 构建与验收

### 2.1 命令

```bash
PTD_SESSION=<会话标识> pnpm build   # 产物 → dist-<会话标识>/chrome-mv3（多会话并行时必须带，见 §2.2）
pnpm build                        # 不带变量时落在默认 .output/chrome-mv3（CI 走的就是这条）
```

- **本地只构建 Chrome**。**不要在本地跑 `pnpm build:firefox` / `dev:firefox`** ——
  纯浪费时间（Firefox 产物由 CI 统一构建，见 §2.4）。
- 构建报 `remove C:\...\Temp\esbuild-*: Access is denied` 时（README 踩坑 §13，杀软句柄导致，
  时好时坏），**别重启机器**，把临时目录指到仓库内已 gitignore 的 `.tmp-build/` 即可：
  `PTD_SESSION=<标识> TEMP="$PWD/.tmp-build" TMP="$PWD/.tmp-build" TMPDIR="$PWD/.tmp-build" pnpm build`。
- **不要再绕着调 `./node_modules/.bin/wxt build`**：`pnpm-workspace.yaml` 里已配
  `allowBuilds` 白名单（esbuild / @parcel/watcher），`pnpm build` 现在能正常跑通。
- 类型检查：`pnpm compile`（= `vue-tsc --noEmit`），CI 前后端分别独立跑。
- 若报 `ERR_PNPM_IGNORED_BUILDS`，说明 `pnpm-workspace.yaml` 的白名单被回退了。
  ⚠️ **pnpm 12 的键名是 `allowBuilds`（对象形式），旧键 `onlyBuiltDependencies` 会被静默失效**：

  ```yaml
  allowBuilds:
    esbuild: true
    "@parcel/watcher": true
  ```

### 2.2 验收规矩（用户明确要求）

**每次让用户验收，必须同时给出：**

1. **产物加载绝对路径**：`E:\DeepSeek Harness\ptassistant\PT-assistant-wxt\dist-<会话标识>\chrome-mv3`
   （`<会话标识>` 用本 agent 名的短横线小写形式，例如 `dist-qwenwork`、`dist-workbuddy`）
2. **版本号**

只说「改好了」而不给路径 = 未完成。**不再有「同步到 dist-latest」这一步**，直接加载自己会话的目录。

**多 agent 共用一棵工作树，产物必须各走各的目录：**

```bash
PTD_SESSION=qwenwork pnpm build     # → dist-qwenwork/chrome-mv3
```

为什么：`wxt` 每次构建都会**先清空 outDir**。实测发生过两起互擦事故 ——
① 本会话把 `.output/chrome-mv3` 拷成 `dist-latest` 时，另一会话的构建正好把它清空，
交付目录一度是 0 文件；② 另一会话一次失败的构建把共享的 `.output` 整个留空。

WXT 0.21.4 的 `wxt build` **没有 `--output` 参数**（可用项只有 root/config/mode/browser/
filter-entrypoint/mv3/mv2/analyze/debug/level），隔离靠 `wxt.config.ts` 里的
`outDir: sessionTag ? 'dist-' + tag : '.output'` 实现，值取自环境变量 `PTD_SESSION`。
**不设该变量时仍是默认 `.output`** —— CI（build.yml / release.yml）依赖这个默认值取
`.output/*.zip`，别让 CI 带上 PTD_SESSION。

### 2.4 Firefox 产物由 CI 构建

`.github/workflows/build.yml` 会同时打三个包（Chrome / Firefox / sources），
`release.yml` 据此发 GitHub Release，并可推到 Chrome Web Store 与 Firefox Add-ons。
**本地只跑 Chrome 构建即可**，不要为了 Firefox 产物在本地重复构建。

---

## 3. 代码约定

### 3.1 别名

`@/` → `src/`，`~/` → `src/`，`@ptd/` → `packages/`。site/social 包可零修改平移就靠这个。

### 3.2 service worker（background）铁律

- `defineBackground({ type: "module" })` **必须**。classic SW 不支持 `import()`，WXT 会把
  340 个站点定义 + sizzle 全部内联进 background.js，sizzle 顶层访问 `window` → SW 启动即崩、
  消息监听器注册不上、前端表现为「消息永远无响应」。
- **禁止 `import { xxx } from "@ptd/site"`**（根入口）。它会拉进 eager 链
  （→ utils → @ptd/social → sizzle）导致上面那个崩溃。只需要站点数量时用
  `import.meta.glob("/packages/site/definitions/*.ts")` 取**键**（注意必须是项目根绝对 pattern，
  相对 pattern 在 entrypoint 虚拟模块里会静默匹配出空 map）。只要类型就 `import type`。
- `@ptd/site/types/base.ts` 无任何 import，是安全的（可运行时取 `EResultParseStatus` 枚举）。

### 3.3 i18n

`app.use(i18nInstance)` —— 必须传 i18n 插件**本体**，传 `i18nInstance.global`（Composer）会抛
`NOT_INSTALLED(27)`，表现为整个页面白屏。

### 3.4 antdv-next 踩过的坑（Vuetify → antdv 迁移必读）

| 坑 | 现象 | 正解 |
|---|---|---|
| `:footer="null"` + `<template #footer>` 并存 | **弹窗底部按钮整个消失** | 别写 `:footer="null"`。antdv-next 源码 `footer: d !== null && ...` 会把 slot 一起吞掉 |
| `a-auto-complete` 的 options 传 `string[]` | 输入框**渲染成空控件**（只剩 label） | 传 `[{ value, label }]` 对象数组 |
| `a-auto-complete` 选中后 | 输入框显示的是 **value**（如下载器随机 id），`option-label-prop` 不生效 | 固定列表选择一律用 `a-select`（单选固定显示 label）+ `show-search` + `option-filter-prop="label"` |
| `a-table` 的 `sorter: true` | 排序箭头动、**数据不排** | antd `getSortFunction` 静默跳过无 compare 的 sorter，必须给真正 compare 函数 |
| `a-list` 传 `:data-source="[]"` | 渲染内置「暂无数据」占位 | 不用 data-source，直接渲染子项 |
| `<a-step>` 等注册表里不存在的 `a-*` 标签 | 被当原生未知元素，**内容静默丢失**（带对象插槽时整块空白） | antdv-next 全量 install 实测只有 139 个注册名，**没有** `AStep`/`AList`；Steps 只有 `:items` 数组写法。CI 的 check-antd-tags 会拦（v0.18.2 踩过） |
| 图标 `import * as Icons from "@antdv-next/icons"` | 1760 个图标模块**全进包** | 只具名导入用到的：`import { DeleteOutlined } from "@antdv-next/icons"` |

原子类兼容层：`src/entrypoints/options/vuetify-compat.css` 复刻的 Vuetify 原子类
（`pa-0` `d-flex` `text-no-wrap` 等）**继续用、不用重写**，只换组件标签。

#### content script 侧是按需注册，不是全局 install

设置页模板直接写 `a-xxx` 即可（全局 install）；content script 是独立入口，全量 install 会把
139 个组件打进每个站点都要加载的 content chunk（曾达 4.3MB，占全部产物 JS 的 65%）。
按需清单在 `src/content-script/antd-lite.ts`（21 个父组件 → 实际注册 44 个名字；
这两个数以 `check-content-antd-lite.mjs` 的输出为准，别手抄进文档），
接线在 `src/content-script/app/init.ts`。**往 content 的模板加新 `a-*` 标签必须先补清单**，
否则线上是静默空白。

四条 CI 静态防线（本地改完也要跑，FAIL 非零退出，挂在 ci.yml 的 `pnpm compile` 之后、构建之前）：

```bash
node scripts/check-antd-tags.mjs          # 全仓扫「antdv-next 里不存在的 a-* 标签」
node scripts/check-content-antd-lite.mjs  # content 按需清单是否覆盖其依赖闭包用到的每个标签
node scripts/check-locale-keys.mjs        # 每个字面 t("a.b.c") 在 zh/en 两侧都可解析、两份键集合对称
node scripts/check-dead-props.mjs         # 传给 a-* 的属性 / 插槽里，哪些是该组件根本不认的死项
```

第三条防的是 vue-i18n 的静默失效：键取不到时**不抛异常、不进 vue-tsc、不进构建**，而是把键路径
本身当文案渲染到界面上（内部标识符进 UI 是 §3.5 的零容忍项）。v0.20.0 整站接入就是靠它扫出
`ExportUserInfoDialog.vue` 引用了不存在的 `common.noData`。`t("前缀" + x)` 这类动态拼接会被放过
（静态不可判定），所以**改了动态键这条守卫拦不住，仍要人工核**。

第四条防的是 antdv-next 的 `inheritAttrs` 默认行为：没声明的 prop 被当普通属性原样塞进根 DOM，
不报错、不警告、生产环境完全静默；没匹配的命名插槽则直接渲染成空。`vue-tsc` 抓不到它
（`a-*` 的类型来自 `GlobalComponents`，允许任意 attr），`check-antd-tags.mjs` 也抓不到
（那条只看标签名存不存在）。判定依据同样是在 Node 里实跑 `install()` 取 props、读 `dist` 下的
`.d.ts` 取插槽映射。它的放行口径是「宁可漏报也不误报」：取不到 props/slots 声明的整组件跳过、
自定义组件是否转发插槽静态不可判定跳过、`:[x]` 动态参数不查 —— 所以**它报干净不等于真干净**。

注册表是脚本在 Node 里**实跑** `install()` 得到的，不抄文档。

### 3.5 面向用户的一切显示用名称

内部 id / 存储键 / 消息名**一律不进 UI**。下拉、列表、徽标、提示里出现用户看不懂的
随机串（如 `osuUCsnW_d8SPoyIOXTJ-`）视为 bug —— 这是零容忍项。

### 3.6 删除文件

- **删除不需要人工确认的 agent**：直接删（`git rm` / 平台删除工具），不要移入 `tobedeleted/`
  再等人点确认 —— 中间目录会卡住后续流程。
- **删除必须人工确认的 agent**：先移入 `tobedeleted/<批次日期>/` 缓冲，用户确认后再统一删除。
  该目录已在 .gitignore，不入库。
- 不管哪种 agent，删错文件都要能找回：已被 git 跟踪的文件靠 git 历史恢复；
  未跟踪的新文件本来就不该用删除处理。

---

## 4. 迁移进度判断陷阱

**文件存在 ≠ 用户能看到。** 迁移完的页面必须核对**路由表是否真的挂上**（`src/options/plugins/router.ts`）。
曾出现「站点管理页 490 行早已迁移完成，但路由一直挂着一个简易调试页」的情况，
还有「三个组件平移了但从没接线进任何页面」。盘点迁移进度时除了 diff 文件清单，
**必须 grep 路由表 + grep 组件的实际引用点**。

排查手法：

```bash
# 新旧视图文件差集
find <旧项目>/src/entries/options/views -name "*.vue" | sed 's|.*/views/||' | sort > /tmp/old.txt
find src/options/views -name "*.vue" | sed 's|.*/views/||' | sort > /tmp/new.txt
comm -23 /tmp/old.txt /tmp/new.txt   # 旧有新无 = 未迁移
comm -13 /tmp/old.txt /tmp/new.txt   # 新有旧无 = 新增

# 迁移残留排查
grep -rln 'footer="null"' src/ | xargs -I{} sh -c 'grep -l "template #footer" {}'   # footer 冲突
grep -rn "SiteManageView\|旧文件名" src/options/plugins/router.ts                    # 路由是否指向正确页
```

---

## 5. 沟通约定（用户偏好）

- **全程简体中文**。代码/标识符/API 字段名可保留英文，解释性文字必须是中文。
- **结论先行**：bullet 式说清「做了什么 / 关键决策 / 验证结果 / 已知问题」。
- 报错反馈时用户常附截图或日志 —— 要**回源码核对根因**，不要凭假设作答，不要只给症状修补。
- 涉及取舍（选型、格式、时区、备选方案）先给选项让用户挑，不替用户用技术默认值。
- 承诺了「做完了」就要真做完；**没做完必须说清还差什么**，不许含糊。
- 不要求用户自己兜底：给命令、路径、配置前先自己核对一遍，别让用户去官网纠错。
