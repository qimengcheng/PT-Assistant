# AGENTS.md — PT Assistant (WXT) 开发约定

> 本文件是**跨会话 / 跨 agent 共享**的硬约定。每个接手本仓库的 AI（含并行会话）动手前必读。
> 与 `README.md`（项目说明）、`ANTD-MIGRATION.md`（UI 迁移进度）配套使用。

## 0. 项目一句话

PT-Plugin-Plus / PT-depiler 的**重写版**：旧版是 Vue 3 + Vuetify 4 + vite-plugin-web-extension，
本仓库是 **WXT 0.21 + Vue 3 + antdv-next**，产物为 Chrome/Firefox MV3 扩展。
站点包 `packages/site`（340 个站点定义）、`packages/social`、`packages/downloader` 等从旧版**零修改平移**。

---

## 1. Git 约定

### 1.1 commit 消息前缀（硬性）

```
[WorkBuddy]-[Hy4 preview] v0.5.2 feat: xxx
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
  （反例：`v0.5.2 feat: 接线` + `v0.5.2 chore: 版本号对齐` —— 必须合并成一条）。
- bump 版本号时**务必把 `package.json` 一起 `git add`**（它常是多会话共享热点，最容易漏）。
- CI 与 Release 以 `package.json` 为唯一真源，commit 里的 `vX.Y.Z` 是给人看的；
  两者不一致时以 `package.json` 为准，但那就说明提交漏了东西。

```bash
# 提交前自检
git show --stat HEAD | head -3
git show HEAD:package.json | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).version"
```

### 1.3 版本号必须三处一致

| 位置 | 说明 |
|---|---|
| `package.json` → `version` | 唯一真源，CI 与发布都读它 |
| 产物 `manifest.json` → `version` | 构建时从 package.json 注入 |
| commit 消息里的 `vX.Y.Z` | 与上面两者一致 |

**踩坑记录**：曾出现 commit 标 v0.5.2 但漏提交 `package.json`，仓库停在 0.5.1，CI 读到的版本与
提交说明不一致。**bump 版本号时务必把 `package.json` 一起 `git add`。**

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

---

## 2. 构建与验收

### 2.1 命令

```bash
pnpm build          # 产物 → .output/chrome-mv3
```

- **本地只构建 Chrome**。**不要在本地跑 `pnpm build:firefox` / `dev:firefox`** ——
  纯浪费时间（Firefox 产物由 CI 统一构建，见 §2.4）。
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

1. **产物加载绝对路径**：`E:\DeepSeek Harness\ptassistant\PT-assistant-wxt\dist-latest`
2. **版本号**

只说「改好了」而不给路径 = 未完成。产物改动后需把 `.output/chrome-mv3` 同步到 `dist-latest`。

### 2.3 同步产物的坑

`.output/chrome-mv3` / `dist-latest` 各有 ~750+ 文件，**wxt 每次构建会先清空输出目录**，
触发本环境的批量删除守卫（`SAFE_DELETE_BULK_CONFIRM_REQUIRED`，阈值 50）导致构建中断。

✅ 正确做法：**先改名挪开，不要删**：

```js
fs.renameSync(".output/chrome-mv3", ".output/chrome-mv3_prev");  // 挪开
// 构建完再 fs.cpSync(".output/chrome-mv3", "dist-latest", { recursive: true });
```

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

### 3.5 面向用户的一切显示用名称

内部 id / 存储键 / 消息名**一律不进 UI**。下拉、列表、徽标、提示里出现用户看不懂的
随机串（如 `osuUCsnW_d8SPoyIOXTJ-`）视为 bug —— 这是零容忍项。

### 3.6 删除文件

先移入 `tobedeleted/<批次日期>/`，**全部做完再统一删除**。不要直接 `rm`。

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
