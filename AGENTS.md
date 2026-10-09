# AGENTS.md — PT Assistant (WXT) 开发约定

> 本文件是**跨会话 / 跨 agent 共享**的硬约定。每个接手本仓库的 AI（含并行会话）动手前必读。
> 与 `README.md`（现状：架构 / 目录 / 命令 / CI 守卫）和 `PLAYBOOK.md`（经历：坑、根因、结论落在哪）配套使用。

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

#### 进位档位：feat 进次版本，其余进修订号

| 提交类型（版本号后面那个词） | 进哪一档 | 例：历史最大 `v0.22.47` |
|---|---|---|
| `feat`（新增功能） | **次版本 +1，修订号归零** | `v0.23.0` |
| `fix` / `refactor` / `docs` / `style` / `perf` / `test` / `build` / `ci` / `i18n` | **修订号 +1** | `v0.22.48` |
| 类型词认不出（`v0.22.48 修了个东西` 这种） | 按修订号放行，不拦 | `v0.22.48` |

- **硬拦**：`feat` 写修订号、`fix` 写次版本，都会被 `commit-msg` 当场拒掉。
  **不要改类型词去凑数** —— 类型词是给 Release 页分组用的真话，不是给守卫对齐的旋钮。
- 一次 feat 进次版本（如表中 `v0.23.0`）之后，**上一个**次版本余下的修订号就刻意作废了，
  那不是死号、不要去补；这与 §1.6「amend 顺手改号造出死号」是两回事。
- 混合改动（既加功能又修 bug）按**主要意图**选档，本仓库一次工作只对应一个版本号（上一条硬规则）。
- 「认不出」也包括中文起头的早期写法（`v0.13.0 平移 Layout 三件套`）—— 它只会按修订号放行。
  所以**新功能要进次版本就必须把 `feat` 写在版本号右边**，光靠描述里那句「新增」不算。
- 档位比对读的是**首行的类型词**，所以 §1.1 的格式（前缀 + 版本号 + 类型词）不是排版偏好，
  是这条判据能工作的前提。

#### 版本号只能从 git log 推导，不要看工作区

**本节最容易违反的一条。** 工作区 `package.json` 的值是「当前工作进度」的信号，不是「已发布版本」，
真相源只有 `git log`。把它当已发布版本用，就会造出没有任何提交用过的死号（事故经过见 PLAYBOOK §19）。

> **读史须知**：本仓库做过 `0.5.x` → `0.2x` 的整体重编号，历史被改写并强推过远端。
> 旧提交消息、旧代码注释、旧文档里出现的 `0.5.xx` **都不再对应任何现存提交**；
> 代码注释里「vX 起改成…」这类版本门（例如 `config.ts` 的 `initTorrentOnEnterDefaultOnSince`）
> 会静默失效，改编号时必须逐个复核。引用某个历史版本号之前先确认它还在：
> `git log --format=%s | grep "v0\.X\.Y\b"`（详见 PLAYBOOK §0）。

选号直接用工具，不要手算，也不要拿工作区的值 +1：

```bash
node scripts/check-version.mjs --next                # 修订号档，例如 v0.22.48
node scripts/check-version.mjs --next --type feat    # 次版本档，例如 v0.23.0
```

#### 更省事：用包装命令，让号不用人算也不用手动 add

```bash
node scripts/versioned-commit.mjs -m "[agent名]-[模型名] @next feat(搜索页): 描述"
```

参数照 `git commit` 原样写，只把首行版本号槽位上的号换成 `@next`。它按类型词从 `git log` 算出该用的号 →
写 `package.json` → **只** `git add -- package.json` → 用展开后的消息调 `git commit`。
于是本节「版本号只能从 git log 推导」和 §1.3「三处一致、别忘了 add」都不再需要人守。

**必须用 `node scripts/...` 直接调，不要包成 `pnpm commit`**：§2.1 记的那条 pnpm 毛病正是
「package.json 一变，下次 `pnpm <script>` 就先重新校验锁文件，连不上注册表时无限转圈」——
而这条流程每次提交都会改 package.json，等于每一次都会踩。所以它故意没有 pnpm 别名。

- 首行写的是显式 `vX.Y.Z` 时它不算号，但仍会把「工作区已经是这个号、只是忘了 add」补上暂存；
  **号不一致时不改写** —— 场上同时有两个号是该由人决定的冲突，交给 `commit-msg` 报「两处不一致」。
- 混合改动想清楚再写类型词：`@next` 不会替你判断这是 feat 还是 fix，它照你写的档位进位。
- `@next` 只认版本号槽位（模型名的 `]` 之后，且后面不接 `[\w./@-]`），所以 `@next/nuxt`、`next@next`
  这类 JS 生态里真会出现的字面量不会触发它；正文里的 `@next` 也不算（只管首行）。
- 只有 `-m` / `--message` 传进来的消息会被展开。`-F <文件>`、编辑器、merge/squash 复用旧消息
  这些形态原样交给 git，随后由 `prepare-commit-msg` 以「占位符没展开」拒收 —— 不会静默提交。

**为什么不是 hook 一把做完**（实测 git 2.45.1，两条断言都在 `check-version-test.sh` 里）：
`pre-commit` 里 `git add` 的东西**能**进提交对象，但那时提交消息还没成形，拿不到 feat 这个类型词；
`prepare-commit-msg` 拿得到消息，此刻再 `git add` 却**进不去** —— tree 用的是更早读进内存的那份索引快照
（索引本身变了，`git show :package.json` 认，提交对象不认）。算号要的两半分别只在两个阶段拿得到，
所以只能放在调 git 之前做。`.githooks/prepare-commit-msg` 因此只当守卫：首行还有没展开的 `@next`
就当场拒收，忘了走包装命令也不会留下「消息带占位符、package.json 还是旧号」的半套状态。

包装命令还顺手补了一条 hook 结构上拿不到的防线：**它看得见自己的 argv，所以 `--amend` 配 `@next`
能在写文件之前就拒收**（钩子判不出 amend，见上一条 §1.2；这正是 §1.6「amend 不许改版本号」
唯一能在事前拦住的地方）。

#### 本地 hook 是主防线，CI 只是兜底

`.githooks/` 下三个钩子在**提交的瞬间**拦截，三条都跑 `scripts/check-version.mjs`：

| 钩子 | 查什么 |
|---|---|
| `pre-commit` | 暂存的 `package.json` 版本号是不是历史最大**相邻的下一档**（修订号 +1 或次版本 +1 都放行，抓跳号）；版本号与 HEAD 相同时按 `--amend` 处理，基线换成 `HEAD~1` |
| `prepare-commit-msg` | 首行还躺着没展开的 `@next` 就**拒收**（说明这次没走 `versioned-commit.mjs`）—— 这个阶段改索引已经进不了本次提交，所以只能拦，不能补 |
| `commit-msg` | **首行**按 `] v` 锚出的版本号 == 暂存的 `package.json`（抓三处不一致），并按首行类型词**定档**（feat 必须次版本、其余必须修订号） |

**每条边界都是实测出来的，不是推的**：`sh scripts/check-version-test.sh` 在临时仓库里装真 hook
跑断言（条数看它自己末尾的输出，别往这里抄），含「feat 写修订号拦住 / fix 写次版本拦住 /
amend 放行 / 跳号拦住 / 首行模型名带三段式数字不抢位 / `@next` 真落库且自动暂存 /
包名里的 `@next` 不触发 / amend 配 `@next` 拒收」。
**改 `check-version.mjs` 的判据必须先跑它** —— 这条守卫自己连续两次误拦 / 漏放，就是它没人守造成的。
现在 CI 的 `build` job 也挂着它（§2.4），但**主防线仍在本地**：CI 只在 push 时跑，本地忘了跑就等于把判据改了没验。

三个钩子的判据都有**结构性够不着的地方**，写提交前得知道：

- `pre-commit` **看不到提交消息**（消息这时还没成形，见 `.githooks/commit-msg` 顶部注释），
  所以它判不出这次是 feat 还是 fix，只能两档都放行；**真正把档位钉死的是 `commit-msg`**，
  仍然在提交当场，漏不进历史。也因此 `pre-commit` 报「版本号相邻」不等于档位对。
- `pre-commit` 判不出「这次是 amend 还是新开一条」。git 不向 hook 暴露任何指示 `--amend`
  的 `GIT_*` 变量，而此刻 `.git/COMMIT_EDITMSG` 里躺的是**上一条**提交留下的旧内容 ——
  实测两条路都堵。所以退一步用版本号本身作信号：暂存号 == HEAD 自己的号就认定为 amend。
  代价是「新开一条却重复用号」当场放过，这条由 CI 事后认（`--committed` 拿 `HEAD~1` 作基线，
  事后历史里 amend 与重复用号可区分）。`commit-msg` 的档位校验用同一个信号跳过 amend，
  否则就违反 §1.6「amend 不许改版本号」。
  （再补一条实测：`prepare-commit-msg` 的第二个参数能认出 `-c/-C`、裸 `--amend` 开编辑器、merge
  这三类，**唯独 `--amend -m` 与普通提交一模一样**（都是 `message`），所以「amend」在钩子这条路上
  仍然只能猜；包装命令不吃这个参数，它直接读自己的 argv。）
- `--amend` 时**顺手改号**会把被改那条的号变成死号，两个钩子和 CI 都拦不住：那一刻
  暂存号 == HEAD 的号 + 1，与一次完全正常的提交无法区分。等下一条提交压上去，缺口就进了
  历史中段，而 `--committed` 只校验 HEAD 一条，中段缺口是盲区（实测见 PLAYBOOK §21）。
  → **amend 只改消息和内容，不改版本号**，见 §1.6。
  钩子拦不住的原因是 git 不把 `--amend` 告诉它们，但**包装命令看得见自己的 argv**：
  `versioned-commit.mjs --amend` 配 `@next` 会在写文件之前就当场拒收，这条终于有了前置防线。
- `commit-msg` **不扫正文**，提交消息里引用别的版本号绝对安全 —— 并不存在「正文别写版本号」
  这条规则，曾有误记往下传，别再传（PLAYBOOK §21）。
- 首行的锚定规则是「模型名右方括号之后第一个 `vX.Y.Z`」，所以 `[OpenCode]-[Space Bunny Alpha 1.0.0] v0.22.16 …`
  这种模型名自带三段式数字的写法不会抢位（§1.1 要求逐字照抄模型名，撞上是迟早的事）。

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
node scripts/check-version.mjs --next --type fix    # 该用哪个号（feat 换成 --type feat）
git show --stat HEAD | head -3
git show HEAD:package.json | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).version"
```

### 1.3 版本号必须三处一致

| 位置 | 说明 |
|---|---|
| `package.json` → `version` | 唯一真源，CI 与发布都读它 |
| 产物 `manifest.json` → `version` | 构建时从 package.json 注入 |
| commit 消息里的 `vX.Y.Z` | 与上面两者一致 |

**所以 bump 版本号时务必把 `package.json` 一起 `git add`** —— 它是多会话共享热点，最容易漏，
一漏 CI 读到的版本就和提交说明不一致（PLAYBOOK §20）。
走 §1.2 那条 `versioned-commit.mjs` 时这一条不需要你记：它写 `package.json` 并只 add 这一个路径。

档位与跳号同理：本地 `pre-commit` 拦跳号、`commit-msg` 拦错档，提交后还要再核对一次：

```bash
node scripts/check-version.mjs --committed   # HEAD 那条：消息版本号 == package.json，且档位配类型词
git log -10 --format=%s                      # 扫两处：有没有跨档跳号；feat 是不是真进了次版本
```

**扫历史时别把「feat 归零」当成缺口**：`v0.22.47 → v0.23.0` 中间那些修订号是刻意作废的（§1.2），
要看的是「相邻两条之间有没有既不是 +1 修订号也不是 +1 次版本的跳法」。

### 1.4 多 agent 并行下的 git 纪律

本仓库常被**多个会话同时改**。规矩：

1. `git add` **逐文件点名**，永远不用 `git add -A` / `add .`。
2. 提交前 `git diff --cached --stat` 复核：若出现「我没改过」的文件，说明是别的会话的工作，
   三个选择：① 不提交它 ② 一并提交但**在消息里注明**这是谁的未提交改动 ③ 先问用户。
3. **新文件写完立刻 `git add`**，否则可能被别的会话的 `git clean` 删掉。
4. 判断是否有并行会话：`git status` 里有你没动过的文件，或用 node 查 mtime 跟你自己的改动时间对齐
   （bash 的 `ls` 在本机不可用）。
5. 共享热点文件冲突概率最高，改之前先 `git diff` 看别人的在改什么。按近 30 条提交的被改动次数排：
   `package.json`（30 次，每条提交都碰）、`AGENTS.md`、`src/locales/{zh_CN,en}.json`、
   `src/shared/indexdb.ts`、`src/options/plugins/router.ts`、`src/options/stores/config.ts`。
   （仓库里**没有** `CHANGELOG` 文件，也没有 `Footer.tsx` —— 别照着旧名单找。）

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

#### amend 的三条硬约束

1. **amend 前先确认 HEAD 就是你自己的那一条。** 本仓库多会话共用一棵工作树，HEAD 随时可能被
   别人抢先推进；`git commit --amend` 不报错，它会**直接把别人的提交改掉**（真出过一次险情，
   见 PLAYBOOK §22）。只有 `git log -1 --format='%s'` 里的前缀是你自己的，才能动手。
   ```bash
   git log -1 --format='%an %s'      # 先看 HEAD 是谁的
   git log --oneline origin/master..HEAD   # 再看它没推出去
   ```
2. **amend 只改消息和内容，绝不改版本号。** 把 HEAD 从 N 改成 N+1 会让 N 变成没有任何提交
   用过的死号，而那一刻的暂存状态与一次正常提交无法区分，`pre-commit` / `commit-msg` / CI
   三条都拦不住（CI 的 `--committed` 只校验 HEAD 一条，等下一条提交压上去，缺口进了历史中段
   就彻底看不见）。要换号就是新开一条提交，不是 amend。
   走 §1.2 的包装命令时这条有事前防线：`versioned-commit.mjs --amend` 看到首行是 `@next`
   会在动 package.json **之前**就拒收（包装脚本读得到自己的 argv，钩子读不到）。
   **合进上一条时（§1.6 的用法）也不许换档**：把 `fix` 改写成 `feat` 让消息看着更贴切是可以的，
   但号得留着原来的 —— `commit-msg` 认出同号就按 amend 跳过档位校验，正是为了不逼你在此刻造死号。
   真做成了新功能，就新开一条 `feat` 进次版本。
   走 §1.2 的包装命令时这条有了前置防线：`versioned-commit.mjs --amend` 配 `@next` 会在
   **写文件之前**当场拒收（包装脚本看得见自己的 argv，钩子看不见）；绕过包装命令直接
   `git commit --amend -m "...@next..."`，则被 `prepare-commit-msg` 以「占位符没展开」拒收。
3. **不再需要 `--no-verify`。** `pre-commit` 认得 amend 了：暂存版本号 == HEAD 自己的版本号时，
   基线取 `HEAD~1` 而不是 `HEAD`（见 §1.2）。在此之前这条流程只能靠绕钩子走，那等于把它
   从受保护变成不受保护（演变过程见 PLAYBOOK §21）。

---

## 2. 构建与验收

### 2.1 命令

```bash
PTD_SESSION=<会话标识> pnpm build   # 加锁构建 → dist-<会话标识>-<版本号>/chrome-mv3，并把 dist-verify 换指到它
pnpm build                        # 不带变量：本地按 `owner` 会话构建（人自己手跑），同样换指 dist-verify
CI=true pnpm build                # 本地复现 CI 那条路径 → 默认 .output/chrome-mv3，不建联接、不清理
```

**agent 一律带上自己的 `PTD_SESSION`**：不带就被算成 `owner`（用户自己的桶），
构建产物会盖进 `dist-owner-*`、并把用户的 `dist-verify` 联接换指到你这份。

- **构建入口是 `scripts/build-verify.mjs`（`pnpm build` / `pnpm zip` 都指到这里），别绕开它直接调 `wxt`。**
  它负责三件事：拿构建锁、换指 `dist-verify`、清理本会话旧快照。绕开它就等于在多人共用的
  `.wxt/` 与 `node_modules/.vite/` 上打架。锁只管 `build`/`zip`，不管 `pnpm dev`（长跑，占着锁会堵死别人；
  dev 也就**不会换指 `dist-verify`**，用 dev 调试时加载路径得另说）。

- **本地只构建 Chrome**。**不要在本地跑 `pnpm build:firefox` / `dev:firefox`** ——
  纯浪费时间（Firefox 产物由 CI 统一构建，见 §2.4）。
- ⚠️ **「不跑 Firefox 构建」≠「不验证 Firefox 能构建」，也不等于可以不碰产物级检查。**
  CI 的 `build` job 比本地这套多跑两条命令，两条都各有必要性：

  | CI 独有步骤 | 本地为什么也得跑 |
  | --- | --- |
  | `wxt zip -b firefox` | Firefox 分支的产物路径与 Chrome 不同（`firefox-mv2`、manifest 变体），本地只构建 Chrome **覆盖不到**它 |
  | `node scripts/smoke-background.mjs` | 唯一一处**把打包产物真的 import 一次**的地方，抓「模块顶层执行浏览器 API」这类 vue-tsc / 源码审查 / Chrome 构建全都看不见的 SW 崩溃 |

  为什么本地也要跑：这类 SW 崩溃（模块顶层执行浏览器 API）**只有跑产物才抓得到**，
  vue-tsc 和源码审查都看不见；一旦漏到 CI 才暴露，报的是最后一个 push 的人名下
  （一次 push 只打一个 tag，见 §2.4）。实例见 PLAYBOOK §25、§23。
  **推之前跑完这两条，十分钟内能确认自己没往主线扔一颗雷。**
- 构建报 `remove C:\...\Temp\esbuild-*: Access is denied` 时（PLAYBOOK §13，杀软句柄导致，
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

1. **产物加载绝对路径**：`E:\DeepSeek Harness\ptassistant\PT-assistant-wxt\dist-verify`
   —— **永远只有这一个**，用户只往 Chrome 里加载它一次；每次构建成功后它自动指向本次产物。
   注意 `dist-verify` 本身就是指向 `dist-<会话>-<版本>\chrome-mv3` 的 junction，
   **后面不要再加 `\chrome-mv3`**（那是个不存在的路径，加了 Chrome 会报找不到 manifest）。
2. **版本号**（从构建输出或 `dist-verify\BUILDINFO.json` 里读），并说明这份是谁在什么时候建的

只说「改好了」而不给路径 = 未完成。

**为什么是固定路径而不是「这次构建在哪个目录」：** Chrome 给未打包扩展算 id 用的是**加载路径**，
每换一个新目录就要「移除旧的 + 加载新的」，扩展 id 跟着变 → 站点配置、下载器设置全都要重来一遍。
所以目录名带版本号（`dist-<会话>-<版本>`）只用来**归属与排查**，不作为加载入口。

**多 agent 共用一棵工作树，构建的真身仍必须各走各的目录：**

```bash
PTD_SESSION=qwenwork pnpm build     # → dist-qwenwork-<package.json 版本号>/chrome-mv3，再把 dist-verify 换指到它
```

为什么：`wxt` 每次构建都会**先清空 outDir**，并行会话会互相擦掉交付目录（两起事故见 PLAYBOOK §14）。
所以真身按会话隔离，`dist-verify` 只是一层目录联接（junction），换指是瞬时的、不会把对方擦成空目录。

WXT 0.21.4 的 `wxt build` **没有 `--output` 参数**（可用项只有 root/config/mode/browser/
filter-entrypoint/mv3/mv2/analyze/debug/level），隔离靠 `wxt.config.ts` 里的
`outDir: sessionTag ? \`dist-${tag}-${pkgVersion}\` : ".output"` 实现：会话标识取自环境变量
`PTD_SESSION`，版本号取自 `package.json`（与注入 manifest 的是同一个值，不会各说一套）。
`wxt.config.ts` 只看这个变量本身：**没有它就是默认 `.output`**，CI（`ci.yml` 的 build job）依赖
这个默认值取 `.output/*.zip`，别让 CI 带上 PTD_SESSION（CI 也就不会碰 `dist-verify`）。
本地裸 build 的 `owner` 默认值是在 `build-verify.mjs` 里补的（判 CI 用 `CI` / `GITHUB_ACTIONS`），
所以「人自己 build 也拿得到固定加载路径」不需要配环境变量 —— 见 §2.1。

**验收期间用户如果发现界面变了**：说明另一个会话构建完并把联接换走了。让他看
`dist-verify` 目标目录里的 `BUILDINFO.json`（version / session / gitHead / builtAt）即可判定是哪份。

### 2.4 Firefox 产物由 CI 构建

**只有一个 workflow：`.github/workflows/ci.yml`**，三个 job 串起来 `verify → build → release`。
（没有 `build.yml` / `release.yml` 这两个文件，曾有文档写错，见 PLAYBOOK §24。）

- `verify`：只查**提交标题**那三条硬规则（`[agent名]-[模型名]` 前缀、含 `vX.Y.Z`、与 `package.json` 一致），
  不装依赖也不跑守卫（只 checkout，用 runner 自带的 node 读一下 version）—— 别把它当静态检查那一段。
- `build`：`pnpm compile` → **一条 `node scripts/check-all.mjs`**（全部守卫，清单从 `scripts/` 现取，
  与本地 `pnpm check:all` 同一个入口，见 §3.4）
  → `check-version.mjs --committed` → `check-version-test.sh`（版本号守卫自己的断言，
  它不在 `check-all` 的聚合里，所以单独挂一步）→ `wxt zip` + `wxt zip -b firefox`，从 `.output/` 取产物并重命名成
  `PT-Assistant-<version>-{chrome,firefox,sources}.zip` 三个包，外加 `smoke-background.mjs`。
- `release`：`ncipollo/release-action` 按 `package.json` 的 version 打 `v<version>` tag 并挂上
  三个产物，随后是 Publish to Chrome Web Store / Publish to Firefox Add-ons 两步。

**本地只跑 Chrome 构建即可**，不要为了 Firefox 产物在本地重复构建。

**一次 push 只会被打一个 tag**：workflow 检出的是这次 push 的 tip commit，所以把多个版本号
攒在一次 push 里，只有最顶那版会拿到 tag 和 Release，下面的全部静默漏掉（实测见 PLAYBOOK §23）。
所以**每个版本号单独 push**。

---

## 3. 代码约定

### 3.1 别名

`@/` → `src/`，`~/` → `src/`，`@ptd/` → `packages/`。site/social 包可零修改平移就靠这个。

### 3.2 service worker（background）铁律

前三条由 `scripts/check-sw-graph.mjs` 在**构建期硬拦**（本地手跑 / CI 已挂），违反时它会点出上游
文件与完整链路，**不需要背**；改那两个入口、或给它们加导入之后跑一次即可。

- `defineBackground({ type: "module" })` **必须**。classic SW 不支持 `import()`，WXT 会把
  340 个站点定义 + sizzle 全部内联进 background.js，sizzle 顶层访问 `window` → SW 启动即崩、
  消息监听器注册不上、前端表现为「消息永远无响应」。
- **SW / content 引导的静态 import 闭包里不许出现 `sizzle`。** 它的 UMD 工厂在模块顶层就访问
  `window`，而 MV3 SW 无 window。实测发生路径是 `@ptd/site` 根入口 → `packages/site/utils.ts`
  桶 → `utils/filter.ts` → `@ptd/social` → anidb/douban → sizzle。
- 所以**禁止从这两个上下文 `import { xxx } from "@ptd/site"` / `"@ptd/social"`**（根入口 = barrel，
  一个 `export * from "./utils"` 就把整片工具链拖进来）。只需要站点数量时用
  `import.meta.glob("/packages/site/definitions/*.ts")` 取**键**（pattern 必须项目根绝对，
  相对路径在 entrypoint 虚拟模块里会**静默匹配出空 map**，v0.4.0 的 `definitionCount=0` 根因）。
  只要类型就 `import type`。

静态图之所以**判得准**，前提是 tsconfig 开了 `verbatimModuleSyntax`：纯类型导入必须写成
`import type`，Vite 才整条擦除。注意 `import { type A, B } from "x"` 里 B 是活值，整条模块仍会加载。

- **守卫够不着、仍需人看的两点**：① 模块级「导入即执行」的浏览器 API 调用，如果不在通往 sizzle
  的路径上，静态图判不出，仍靠 `scripts/smoke-background.mjs` 真跑产物兜底（PLAYBOOK §25）。
  典型是模块级写 `export const db = openDB(...)` —— 等于「谁 import 谁开库」，哪怕它一次都不碰。
  共享库句柄一律走 `@/shared/indexdb` 的 `ptdIndexDb()`（懒开），别改回模块级 Promise。
  懒开带来的两条不变量（失败不缓存 rejection / 成功必须复用）由 `check-indexdb-retry.mjs`
  用行为断言钉住；改那个函数前先跑它。同理那两行重置代码要写成函数体内的 `try/await/catch`，
  不要写成游离的 `.catch()` —— 后者看着像无用代码，会被顺手删掉。
  ② `@ptd/site/types/base.ts` 无任何 import，是安全的（可运行时取 `EResultParseStatus` 枚举）。

### 3.3 i18n

`app.use(i18nInstance)` —— 必须传 i18n 插件**本体**，传 `i18nInstance.global`（Composer）会抛
`NOT_INSTALLED(27)`，表现为整个页面白屏。

### 3.4 antdv-next 组件用法约定（Vuetify 迁移对照）

| 坑 | 现象 | 正解 |
|---|---|---|
| `:footer="null"` + `<template #footer>` 并存 | **弹窗底部按钮整个消失** | 别写 `:footer="null"`。antdv-next 源码 `footer: d !== null && ...` 会把 slot 一起吞掉 |
| `a-auto-complete` 的 options 传 `string[]` | 输入框**渲染成空控件**（只剩 label） | 传 `[{ value, label }]` 对象数组 |
| `a-auto-complete` 选中后 | 输入框显示的是 **value**（如下载器随机 id），`option-label-prop` 不生效 | 固定列表选择一律用 `a-select`（单选固定显示 label）+ `show-search` + `option-filter-prop="label"` |
| `a-select` 用 `<a-select-option>` **子节点**列选项 | 下拉打开是**「暂无数据」**。antdv-next 的 Select 完全不读默认插槽：`dist/select/index.js` 里 `children` 与 `slots.default` 各 0 处命中，整个包也找不到旧版那套 `convertChildrenToData`；`ASelectOption` 只是还注册着名字，渲染进去的节点被静默丢掉。2026-10-07 添加备份服务器对话框就是这么空的，而同一条流程的下载器对话框一直用 `:options`，所以只有这一处坏 | 一律 `:options="{ value, label }[]"`，带图标的选项走 `<template #option="{ value }">`（`SetDownloader/AddDialog.vue` 是参照实现）。全仓已扫过，`a-select-option` 现在只剩注释里那一处 |
| `a-table` 的 `sorter: true` | 排序箭头动、**数据不排** | antd `getSortFunction` 静默跳过无 compare 的 sorter，必须给真正 compare 函数 |
| `a-list` 传 `:data-source="[]"` | 渲染内置「暂无数据」占位 | 不用 data-source，直接渲染子项 |
| `<a-step>` 等注册表里不存在的 `a-*` 标签 | 被当原生未知元素，**内容静默丢失**（带对象插槽时整块空白） | antdv-next 全量 install 实测只有 139 个注册名，**没有** `AStep`/`AList`；Steps 只有 `:items` 数组写法。CI 的 check-antd-tags 会拦 |
| 图标 `import * as Icons from "@antdv-next/icons"` | 1760 个图标模块**全进包** | 只具名导入用到的：`import { DeleteOutlined } from "@antdv-next/icons"` |
| 删除类按钮只写 `danger`（红描边 + 红字） | 在白底工具条上跟背景融成一片，看着像没强调；用户 2026-10-06 明确要求改实心 | **删除/清空数据的按钮一律 `type="primary" danger`（实心红）**。判据：动作真是删数据才算 —— 取消、关闭、重置、清空输入框、撤销授权**不算**，它们保留 `danger` 描边或 `variant="text"`。全站 19 颗已按此收口（含表格行内的单条删除、`DeleteDialog` 的确认键、以及原本标成蓝色 primary 的「我的数据 → 历史数据」删除） |
| 列表页给 `a-table` 写 `:scroll="{ y: 'calc(100vh - Npx)' }"` | 面板（`.page-panel`）自己已经是滚动容器，两层滚动会露出一条常驻的滚动条轨道 —— 哪怕只有一行，右边也挂着带箭头的经典滚动条；那个 N 还是目测的，外壳内衬一改就失准 | **不要写视口常数。** 列表页让 `.page-panel` 自己滚就行。真要表头吸顶，走 SearchEntity 那套**实测**容器高度算 `scroll.y`（见 PLAYBOOK，那个公式错过两次：拿会漂的量当基准会自指死循环） |
| 标题列内容太长，把整张表撑出横向滚动条，于是给它写 `max-width: 32vw` | 视口常数两头都不对：窄窗口照样溢出、宽窗口白留一片；本仓库还把它挂在一个默认关闭的开关上，等于没做 | **算式按「这张表实际有多宽」定**：给表格容器标 `container-type: inline-size`，单元格写 `max-width: max(地板, calc(100cqi - 其它列实测预算))`，前面留一条 px 兜底给不支持容器查询的单位（范本 `SearchEntity/Index.vue`：预算 860 = 其它 10 列实测 740 + 英文表头/多一颗按钮的余量，地板 220）。两条实测来的判据：① 表宽压到容器宽，靠的是夹住 `<table>` 上的 `width: max-content`，与 auto/fixed 档位无关；② `overflow: hidden` 不能省，但它挡的不是长标题（那条 max-width 自己压得住），是第二行标签/副标题 —— 标签给到 20 个时表宽仍然等于容器宽，可标签伸出单元格 756px，照样把滚动容器的 `scrollWidth` 顶大、把滚动条带回来 |
| 逐页自己写滚动条样式 | 全站已经有一条：细、无箭头、轨道常驻占位、**滑块平时透明、悬停到滚动区才现形**（`style.css` 一份 + content 的 `app.css` 一份，shadow root 选不到外面那份） | **别再逐页加 `scrollbar-width` / `scrollbar-color` / `::-webkit-scrollbar`。** 要改观感就动那两处。轨道常驻占位是故意的 —— 滑块现形/消失不该让内容横向跳一下 |
| 给 `.ant-modal-body` 写 `max-height: calc(100vh - 常数)`（原先是 220px） | 那个常数要把「顶偏移 + 标题 + 页脚 + 容器内衬」全手数进去，实测真值只有 114px（标题 22 + 下间距 8 + 页脚 32 + 上间距 12 + container 上下内衬 20+20），多扣的 6px 之外，还要整份扣掉 antd 默认的 `top: 100px` —— 高弹窗根本用不起这 100px。结果：内容 786px 的新增下载服务器弹窗在 981px 高的视口下只剩 761px 可用，挂一条拖到底只挪得动 25px 的滚动条（用户口径「有滚动条实际也不滚动」） | **`style.css` 里那五条（wrap 纵向 flex → `.ant-modal` 用 `margin: auto` + `max-height: calc(100% - 48px)` → container 纵向 flex → header/footer `flex-shrink: 0` → body `flex: 1 1 auto; min-height: 0`）是一个整体，别拆回常数写法。** 剩下唯一的常数是上下各 24px 留白。代价要说清：**矮弹窗从此垂直居中**（不再贴顶 100px），换来高弹窗能多出一整屏的空间。`top: auto` 必须挂在 `.ant-modal-wrap .ant-modal`（0,2,0）下 —— 组件那条 `top: 100px` 是 cssinjs 运行时注入的，同特异度抢不过 |
| 新页面建 `a-table` 忘了写 `bordered` | 全站 23 张表有格线的只有一部分，同一页两张表观感不一致 | **所有 `a-table` 一律带 `bordered`**（用户 2026-10-06 要求，已全仓铺齐：23 个标签 / 23 个 `bordered`）。这条目前没有守卫 —— 少写一个布尔属性既不是类型错也不是死 prop，要钉死就往 `check-antd-tags` 那类模板扫描里加，别单开一条 |
| `a-switch` 漏写 `size="small"` | 表格行里两颗开关一大一小（下载器页「启用?」默认档、「自动下载?」small 档就是这样） | **所有 `a-switch` 一律 `size="small"`**（已铺齐 57 处，含 `h(aSwitch, { size: "small" })` 这种渲染函数写法）。唯一已知妥协：带 `checked-children` 文字的开关 —— small 档轨道只有 28×16px、滑块 12px，中文「开/关」放得下，英文 `On`/`Off` 会挤 |
| 工具条按钮 / 输入框写了 `size="small"` | `.page-bar` 那一行是 48px 高，全站 10 个工具条页里 33 颗按钮都是默认档（32px），只有辅种任务 3 颗、我的客户端 2 颗是 small —— 同一档高度差 8px，一眼看得出两页不一样。输入框更混：6 页 small / 2 页默认，small 档 24px 挨着 32px 的按钮，一眼看出不配套 | **`.page-bar` 工具条里的 `a-button` 和输入控件一律默认档**（不写 size，按钮 32px = 输入框 32px）。例外按语境留：**弹层 / popover 面板内**的紧凑控件照旧 small（我的数据 → 筛选面板那 3 颗、我的客户端 → 自动刷新间隔那个 `a-input-number`，它们不在工具条那一行）；alert 状态行里的统计按钮（搜索页那颗）也不算工具条主操作。2026-10-06 用户拍板后已铺齐：6 页的搜索框去掉 `size="small"`。**最后一处漏网在搜索页**（v0.41.1）：结果卡片 `#title` 那一行的「列显隐」`a-select` 与「过滤搜索结果」`a-input` 还是 small 档（24px），挨着同一行 32px 的图标按钮与上面那条 48px 工具条里的 32px 搜索框 —— 它不在 `.page-bar` 里，所以那轮按 class 扫的铺齐没碰到它。**顺带量掉一个顾虑**：`a-card` 的 head 高度由 token 的 `min-height`（该 fontSize 下 54px）钉住，控件从 24 升到 32 **不会**把 head 撑高、也就不会从表体偷走那 8px（台架 `.tmp-build/bench-card` 两档都量到 54）。 |
| 一个 `a-descriptions-item` 里直接摆**两个及以上**子节点 | 非 bordered 的 descriptions 会把这一格当横向排：2026-10-06 量过调试页「插件重置」，警告条右边缘 x=394、第一颗「重置」按钮左边缘 x=397 —— **贴在一起**，而且警告条被挤成 186px 宽的小胶囊（本该占满内容列宽） | **一格只放一个子节点**，多个就包一层 `<div class="…-row">`（Debugger.vue 其余四格都是这么写的，只有那一格漏了）。包的那层自己声明 `display:flex; flex-direction:column; gap:8px`，别指望子节点自带外边距 —— 全站口径是相邻块之间留 8px 缝，**任何界面都不许出现两个控件零间距贴边** |
| 表格里放 32px 的 `SiteFavicon`（组件默认档） | 行高 = 最高单元格内容 + 上下内衬 8+8，small 档内衬 16 → 行 48px，而表头只有 37px（行高 21 + 16）→ **表体行比表头高**，整张表看着头重脚轻。2026-10-06 站点管理页就是这样，全站只有它用 32（其余 16/18/24） | 表格里的图标按**行高预算**选档，不按组件默认：想要行 ≈ 表头，图标 ≤ 24（24+16=40）。改档位改在调用点（`SetSite/Index.vue` 那处已写注释），不要去加高表头 —— antd 没有「只加表头内衬」的 token，`cellPaddingBlockSM` 会连表体一起加 |
| `class="page-bar"` 挂在外层 `<div>` 上，里面再套 `a-flex` | 48px 的高度是 `.page` 网格给**那个网格项**的；`.page-bar` 自己 `padding: 0 8px` 没有上下内衬。包一层 div 后被撑到 48px 的是 div，里面的 a-flex 只有内容高（32px）并贴在白带**上沿**，下半截空着 —— 2026-10-06 媒体服务器页就是这个样子（用户箭头指到标题和按钮：「这两个地方都顶到上面去了」） | **class 直接挂在 `a-flex` 本体上**（全站其余 9 个列表页都是这么写的），居中靠 `align="center"`，不要额外包 div。这条没有守卫：判"是不是包了一层"要看模板结构，静态扫会把 `.page-bar-extra` 那类合法子节点一起误伤 |
| 逐页写 `.ant-table-thead th { background }` 改表头色 | 表头底色是**组件 token**（`headerBg` 默认 `colorFillAlterSolid`≈`#fafafa`，与斑马纹奇数行同色 → 表头和表体糊成一片），CSS 覆盖要抢 cssinjs 的特异度，抢不动就得 `!important` | **底色一律走 ConfigProvider 的 `components.Table`**，两份同改：`entrypoints/options/App.vue` + `content-script/app/App.vue`（shadow root 读不到对面）。`headerSortHoverBg` / `headerSortActiveBg` 必须跟着给同族色 —— 那两档默认是从**白**容器算出的灰色实心色，底色改蓝灰后点排序就看见色差。**圆角**不走 token：antd 只圆顶边两角（`table/style/radius.js`），四角由 `style.css` / `app.css` 各一条 `.ant-table-container.ant-table-container`（0,4,0 顶过它的 0,3,0，不用 `!important`）裁给 10px，与 `.page-bar` / `.page-panel` 同档 |
| 表格行内按钮的图标写成**默认插槽**的子节点（`<a-button :loading="x"><SyncOutlined /></a-button>`） | antd 在没有 `icon` 插槽时，loading 图标是**插在按钮前面**的，还带一段 `width: 0 → N` 的过渡动画（`button/DefaultLoadingIcon.js` 的 `existIcon` 分支 + `.ant-btn-loading-icon-motion`）—— 一点刷新按钮就变宽；而列表页的表列宽跟着内容走（真因是 `<table>` 上的 `width: max-content`，不是布局档位 —— 实测：`scroll.x: 'max-content'` **只有同时存在固定列**时才会让 rc-table 退回 `auto`，没有固定列时设了 `scroll.y` 仍是 `fixed`，见 `antd.esm.js` 里 `tableLayout` 那条 `ge.value ? W.value === "max-content" ? "auto" : "fixed" : …`，`ge` = 有横向滚动 **且** 有 fixed 列），列宽跟着内容走 → **整张表的列一起重排**，刷新时肉眼可见地抖一下 | **图标一律 `<template #icon>`**（SetSite、SearchEntity/ActionTd 都是这么写的，MyData 操作列 2026-10-06 才收口）：loading 变成原地替换同一个 `.ant-btn-icon`，宽度不动。顺带统一尺寸 —— 默认插槽的图标不算 `icon-only`，内衬比 `#icon` 那档宽 4px。**另外给「操作」列写确定 `width`**：rc-table 的 `<col>` 只从 `column.width` 取宽度（`colWidths: flattenColumns.map(({width}) => width)`），不写就没有 col，那一列永远跟着内容走 |
| 列表页**无条件**渲染分页条（只有一条数据也挂着 `1 ‹ 1 › 25 条/页`） | 用户 2026-10-07 指着搜索快照页说「条数少的时候不要启用分页」。原先这条只有站点管理页单独实现（一份抄在页面里的 `chosen/pageSize` 判断），其余 8 页各自为政 | **`toPagination` 传 `extras.totalRows` 就启用「默认档下条目全放得下 → 返回 `false`，整条分页条不出」**，`useTableBehavior` 那边对应 `totalRows` 选项（`MaybeRefOrGetter<number>`）。判"用户挑过一档"= 存下来的正数**不等于本页默认档**：挑过就常驻，否则他挑一档大到放得下全部，分页条连同尺寸选择器一起消失、再也切不回小档。所以每页传给 `toPagination` 的 `fallback` **必须等于 `config.ts` 里那页的 `itemsPerPage` 默认值**，不然「挑没挑过」判错。弹窗里的表格不套这条（`HistoryDataViewDialog` 保持 10 条一页）；行为断言的跑法见 PLAYBOOK |
| 每页条数写死成常数（10 / 25 / 50），高屏下面板下半截全是空白、矮屏下又拖出滚动条 | 用户 2026-10-08：「要根据页面高度自动计算最佳的每页条数，既不能出现滚动条又要把页面铺满」（下载历史 10 条/页、表格下面一大片空白） | **`useAutoFitPageSize`（实测条数）+ `toPagination` 的 `extras.fitSize`**：`useTableBehavior` 传 `autoFit: { container, rows }` 就接上，手写分页的页自己传 `fitSize` / `picked`。判据是「可用高（面板内容高 − 同级块 − 表头 − 分页器 − 横滚条厚度）÷ 实测行高」，行高用**平均定初值、写回后按真实累计高收敛**（只按最高行算会白留将近一行，台架量到 64px；**退行不看「这一页满不满」，加行才看** —— 满页判据是为了不在末页一路加，可挑档被压住时那一页永远不满，照老写法就退不动）。三条别再改回去：① **实测容量是硬上限，他挑的那一档也压得过它**（`pageSize = picked ? min(挑的, 容量) : 容量`；原先写的是「挑过一档就永久让位」，于是存过的 20 条在一屏只放得下 15 时把面板撑出滚动条，他 2026-10-08 指着站点管理页说「没有分页的时候当然是可以有滚动条，但是有分页的时候不要出现滚动条」。**挑得比容量小仍照他的**，那是他觉得好读，不是我们的容量算错了）；② 判「他改了尺寸」只能用「报回来的档 ≠ 界面上显示的那一档」—— 翻页与排序也带着当前档回来，照老写法 `!== itemsPerPage` 会在第一次翻页就把实测档锁成自选档；③ 下限是 **1** 不是 3，「不出滚动条」是硬要求。覆盖面 = 表格挂在 `.page-panel` 直接子节点的那 5 页；**搜索页不做**（它的表体高已由 `scroll.y` 实测铺满），机制与三条边界见 PLAYBOOK §34。**同一条 `toPagination` 上另有一个按页给的硬档 `maxSinglePage`**（v0.44.0 起「我的数据」、v0.44.2 起「站点管理」传 50）：总条数不超过它就直接 `false`（整页放完、由 `.page-panel` 自己滚），**排在 fitSize 前面判**。两条问的不是同一件事 —— fitSize 问「这一屏放得下几条」（那页实高只量到 13，于是 19 个站被切成两页），硬档问「这么点值不值得分页」。**这条只管分页条出不出，压不住他挑的那一档**（挑过一档时分页条留着，他才切得回小档；而那一档本身由上面那条 ① 压到容量以内）。**别把它当成 fitSize 的替代品推广到全仓**：那是按页的取向，不是全站口径 |
| 给一张 fixed 布局的表**每一列**都写 `width` | 容器比列宽合计宽时，浏览器把所有列**按比例一起放大**去填满，写了的宽度一个都不作数（2026-10-07 下载历史实测：容器 1812 CSS px、列宽合计 1026 → 1.77 倍，96 的站点列变 169、120 的状态列变 211），而最该宽的标题列被钉成定值 | **必须留一列不带 `width`** 当自适应列吃剩余宽度（通常是标题列）。判 fixed 的依据是 `@v-c/table` 的 `mergedTableLayout`：`scroll.y` / `sticky` / 有 `resizable` / **任一列带 `ellipsis`** 都会进 fixed —— 带 ellipsis 的表最容易不知不觉踩到 |
| 把 `useBreakpoint()` 的 `sm` 当「窄屏」用（判成 `screens.xs` 或 `screens.sm`） | antd 的断点是**累积式**的：`sm` 是 `(min-width: 576px)` 而不是 576~767 那一档，所以桌面宽度下 `sm` 恒真 → 那个「窄屏才生效」的分支其实永远生效（下载历史的标题列 `width: 260` 就是这么钉死的） | 判「比某档窄」要**取反高档位**：`!screens.lg` / `!screens.md`（参照 `SearchEntity/QuickFilterNotice.vue` 的 `smAndDown = !screens.value?.lg`）。断点表在 `node_modules/antdv-next/dist/_util/responsiveObserver.js` 的 `getResponsiveMap` |
| `a-tag` 里把图标写成**默认插槽**的第一个子节点（`<a-tag><Icon /> {{ text }}</a-tag>`） | Tag 的实现是 `const children = filterEmpty(slots?.default?.())[0]` —— **只取默认插槽的第一个子节点**，图标活着、后面的文字被静默丢掉（2026-10-07 下载历史「下载状态」列只剩个圈）。和 `a-select` 不读默认插槽是同一族 | 图标一律 `<template #icon><Icon /></template>`，文字留作唯一的默认子节点（`MyClient/TorrentStateTd.vue`、`TorrentTitleTd.vue` 就是这个写法）；文字本身有多段（v-if 分支/前后缀）时外面再包一层 `<span>`，否则只有第一段能活下来 |
| 把 `a-alert` 的正文写在**默认插槽**里（`<a-alert>{{ x }}</a-alert>`） | Alert **一个插槽都不读默认插槽**：`dist/alert/Alert.js` 取的是 `getSlotPropsFnRun(slots, props, "message")` → 内部取的是 `slots[key]` 或 `props[key]`，键只有 `title`/`message`/`description`/`action`/`icon`/`closeIcon` 这几个具名，默认插槽从头到尾没被调用 → 整条只剩图标和底色，文字静默丢掉（2026-10-09 台架把两种写法并排挂进真组件实测：默认插槽那条 `.ant-alert` 的 `textContent` 是空串，`#message` 那条正常出字）。仓里曾有 6 处这么写，含「正在发送」「没有可用下载器」和种子详情三张表的空态 | 正文一律 `<template #message>`，要两行说明就再补 `<template #description>`（`MyClient/SpeedLimitDialog.vue` 一直写对，那处的注释就是这条）。用 a-popover / CSS 找它时记一句：**Alert 把 `#message` 渲染成 `.ant-alert-title`，不是 `.ant-alert-message`**。这条目前没有守卫 —— 判"正文在哪个插槽"要看模板结构，静态扫会把注释里的反例一起误伤（台架那份扫描第一版就栽在注释上） |
| 把链接 / 任何**元素**写进 `a-typography-text` 的默认插槽当截断（`<a-typography-text :ellipsis="{tooltip: x}"><a :href="…">{{ x }}</a></a-typography-text>`） | 那个 `:ellipsis` 要把子节点**折成纯文本**去量宽度，元素子节点整个丢掉 —— DOM 上只剩一个 `<!---->` 加一段裸文本，**文字照样显示、不报错、不进 vue-tsc**，只是链接点不动（v0.59.3 之前辅种任务那一列的标题就是这样，界面表现为「标题是黑的」）。同族还有里面写 `<b>`：加粗静默消失 | 截断一律 CSS 的 `.text-truncate` 挂在**块级那一层**（`text-overflow` 只在不换行的块上出省略号），全文揭示走 `<a-popover>` + `#content` 里一个 `max-width:480px; white-space:normal; overflow-wrap:anywhere` 的 div（范本 `TorrentTitleTd.vue`，那处注释写了为什么不用 `:ellipsis`）。纯文本格子里用 `a-typography-text` 仍然没问题（它折的就是文本），只有**里面带元素**时才坏。这条没有守卫：判"插槽里是文本还是元素"要看模板结构 |
| 定时轮询的表也翻 `:loading`（`About/Logger.vue` 每秒一次 `setInterval` + `isLoadingLogger = true`） | `a-table` 的 loading 是**整表套一层 Spin**（`InternalTable.js` 把 `spinProps` 传给 `Spin`），spin 样式 `&-spinning .ant-spin-container` = `opacity: .5` + `pointer-events: none` + 0.3s 过渡（`dist/spin/style/index.js`）。于是每秒整表暗一下再亮一下、遮罩期间还点不动 —— 用户口径「界面一直在闪」。这条**不是**「轮询间隙会闪空态」：`data-source` 从不被清空，`loading` 挡不住任何东西 | `:loading` 只在**首屏那一次**为真（`hasLoadedOnce` 守住），后台刷新静默；回包再做一次「这批有没有变」的比对（条数 + 最后一条 id/time），没新内容就不换数组引用，免得每秒白 diff 一遍整表。用户主动点刷新的那类页面不受此约束 —— 遮罩是他在等的证据 |
| 带 `t()` 的**标签集合**写成 `<script setup>` 顶层常量（表头数组 / tabs / `{value,label}` 选项 / 状态文本映射） | 切语言不重算 —— locale 是 `main.ts` 里 `watchEffect` 同步的**活值**，模板里的 `t()` 跟着变，setup 里求值一次的常量不变。表现比"永远中文"更隐蔽：切过去当场没反应，重开页面才变（2026-10-07 用户就是按"选英文后还有很多没有英文"报的） | **一律 `computed(() => [...])`**（v0.29.8 已铺齐 16 个文件）。模板侧自动解包不用动；脚本侧取值处补 `.value`。**先分清两种失效**：缺 key 不会显示中文，而是渲染**键路径**（`fallbackLocale` 也是 `en`）—— 所以"看到中文"要么是这里的常量，要么是**压根没走 i18n 的硬编码文案**（另一类，见 PLAYBOOK §33 的三档清单）。非组件模块拿不到 `useI18n` 时的写法参照 `DownloadHistory/utils.ts` 的 `i18nLoadErrorText()`：按 `useConfigStore().lang` 选一份 |
| 表格单元格里「图标 + 数字」用 flex 居中（`.cell-icon` / `.level-require-icon` 那批） | 数字的墨迹只有 cap 高 9px，在 21px 行高的 td 里整体偏下，而 `align-items: center` 对齐的是**行盒中心** → 14px 图标看着偏高（台架实测：flex 语境 −0.6px、行内流语境 −0.35px；2026-10-07 用户指着我的数据页截图报"图标和文字没有对齐"） | 全局 `style.css` 已有一条 `.cell-icon, .level-require-icon { transform: translateY(0.5px) }` 收口，**别再逐页加 margin / 改行高**：压 `line-height: 1` 不解决（差值只跟字体度量与字号有关，行高项自己消掉），还会把行高从 58.8 压到 51.8。**按钮里同一件事不要挪** —— 那里跟的是 13px 汉字（墨迹 12px，实测差 0.2px），style.css 里两段注释各说清一边 |
| 右对齐的数字格把**图标放在数字前面**（`.d-flex justify-end` 里 `<Icon /> <span>数字</span>`） | 数字右对齐 ⇒ 右沿是定值、**左沿随位数漂**，图标跟的是左沿，于是同一格两行（或整表各行的）图标排不成一条竖线，看着"歪歪扭扭"（2026-10-08 用户指着我数据页积分列的截图报的；台架拿他截图那几档宽度实测：同格两行图标左沿差最坏 **26.00px**，位数相同的行又是 0 —— 所以是"有的行歪有的不歪"，不是错觉） | **图标一律跟在数字后面**：右沿定值 + 图标同宽同缝 ⇒ 图标自动成一条竖线（离散度实测归 0）。全站本来就是这个写法 —— 上传/下载、真实上传/下载、最近访问都是 `<span>数字</span><Icon/>`，积分列是唯一反着的，v0.43.1 已收口。换序后 `style.css` 那两条照常吃到：`.d-flex > .cell-icon { margin-inline: 4px }`（缝实测 4.00px）、`.bonus-line > .cell-icon { transform: translateY(1px) }`（v0.40.1 那条**纵向**逐行跳的修复，判据是"图标仍是 bonus-line 的直接子元素"，与左右顺序无关）。**这条没有守卫**：判"这格该不该换序"要看它是不是右对齐数字，静态扫会把左对齐的说明性图标一起误伤 |
| 给 `align: "end"` 的列在 `#bodyCell` 里套一层 `.d-flex`（或任何块级 flex 容器） | **数字照样贴左沿**：td 上的 `text-align: end` 管不到 flex 容器的**主轴**，容器自己占满格宽、默认 `justify-content: flex-start`（搜索页「大小」列实测右沿留 35~42px）。同一层包装还有第二个后果：flex 子项按 max-content 收缩，里面 `width: 100%` 的东西算不出确定宽度 —— 那一格下方的 `a-progress` 塌成 **0px**（整行只剩 10px，v0.11.0 那次「进度条太短」的修复被这层包装吃掉） | 要么给那一行补 `justify-end`，要么别包（inline 的 `<span>` 直接继承 td 的 `text-align`；`TorrentProcessTd` 的根自己就是 flex 行，不需要外层）。**判"这列对齐了没有"要量数字的右沿，不是看有没有写 `align`** —— rc-table 确实把 `text-align` 挂到了 td（`@v-c/table/dist/Cell/index.js` 的 `alignStyle.textAlign = align`），所以"没对齐"从来不是 prop 没生效。台架 `.tmp-build/bench-size-align`（v0.56.4 收口） |
| 在 `type="primary"`（实心蓝底 `rgb(22,119,255)`）的按钮上给图标或文字**写死十六进制色** | 蓝底上这些色全部塌掉：搜索页「站点完成情况」那颗时钟写的是 Vuetify 残留 `#607d8b`，台架挂真组件读计算样式量到对比度 **1.07:1**（等于看不见，2026-10-08 用户报「右边的图标看不清」），同栏那颗警告 `#faad14` 也才 2.16:1 —— 都低于非文本图形的 3:1 下限 | **图标/文字一律不写颜色，继承按钮前景**（primary 上是白，实测 4.10:1）。要区分几种计数靠**字形本身**，不靠逐页手挑色。**判据用 WCAG 对比度、不用眼睛判**：非文本图形 ≥3:1、正文 ≥4.5:1。⚠️ 但**别顺手"扫干净"所有 Material 色** —— `UserLevelShowSpan.vue:253-261` 那三处（`#c62828`/`#e65100`/`#1976d2`）落在白底上是 5.62 / 3.79 / 4.60:1，本来就达标，同一个十六进制换到蓝底就只有 1.1–1.4:1（**病底不病色**）。台架那份对照（改前/改后并排挂真组件）在 `.tmp-build/bench-statuschip/` |
| 想用 **scoped 样式**给 `a-select` / `a-auto-complete` 定尺寸（`.f-path { min-width: 220px }` 挂在 `class` 上） | 规则**一条都不生效**：台架实测 class 落到了那个 `.ant-select` 根上，但根元素拿不到本组件的 `data-v-*`（Select 是多根 / 带 portal，Vue 只给单根子组件的根元素补 scope id），于是 `.f-path[data-v-x]` 选不中任何东西，界面表现为「宽度还是那么窄」。同一次量的另一个数：底部那排三颗只写了 `max-width: 200px`、没下限，1024 弹窗里实宽被挤到 **106px**，候选名 `category:华语电影-2024年合集` 要 191px、带宏的长路径要 321px，而下拉面板默认跟输入框同宽 → 面板里也截（v0.58.1） | 尺寸给这类组件写**行内 `style`**（`style="flex: 1 1 300px; min-width: 220px"`），别为它开 scoped class；候选看不全另走 `:popup-match-select-width="false"`（面板按内容定宽，面板 106 → 353、截断 4 → 0）。整排加 `flex-wrap: wrap`：窄窗口换行而不是压扁其中一颗。**量宽度要钉回真实宽度**：台架窗口只有 ~820，antd 的 `max-width: calc(100vw - 32px)` 会把 1024 弹窗夹窄，那种状态下这一排本来就该换行 |
| 列表页空表只占内容高，下面露出一片没有格线的空白 | 空表 = 表头 37.8 + 占位行 149.8（`.ant-empty-normal` 的 `margin-block: 32px` 两份 + 图与字 69 + 单元格上下内衬 16），而面板高是网格 `1fr` 给的确定值 → 提示贴在表头下面、底下整片空白（用户 2026-10-07：「很多页面都有这个问题，都要改哈」） | **`style.css` 已有全站一条**（判据与三条边界都写在那段注释里，改前先读它）：面板 `:has(> .ant-table-wrapper)` 才变 flex，撑高那一串只挂 `:has(.ant-table-empty)`，flex 项写 `flex: 1 0 auto`（**不许**配 `min-height: 0`，那会让超面板的长表被压扁而不是出滚动条）。**新页面把 `a-table` 直接放成 `.page-panel` 的子节点就自动生效，中间再套一层 div 就接不上**；**但一个面板里只该有一张这样的"直接子表"** —— 要加第二张（我的数据 → 「读取异常的站点」，v0.44.0）必须给它包一层 div 当 `.page-panel` 的直接子节点：否则它会一起吃那条 `flex: 1 0 auto`，跟主表抢高度、把主表挤到面板外面去。包的那层按 `.page-panel > :not(.ant-table-wrapper)` 拿 `flex-shrink: 0`，正好是要的自然高（台架量：异常块 106.2px、直接子表数仍为 1）；同面板里的说明条另给 `flex-shrink: 0`。搜索页是例外 —— 它的表体高由 JS 实测算 `scroll.y`（rc-table 写的是内联 `max-height`，flex 链走不到），由页面把 `tableScrollY` 用 `--pt-table-body-h` 递进来 |
| 「固定几选一」的切换写成 `a-segmented`（特别感谢页那排排序按钮原先就是） | segmented 的选中态是浅灰轨道上一块**白**浮标（台架量：轨道 `rgb(245,245,245)`、选中项 `rgb(255,255,255)`、两侧文字都是近黑），落在那条浅灰栏里几乎看不出当前选的是哪个 —— 用户 2026-10-07 指着它问「这个是用 radio button group 做的吗？选中的用 solid 的样式哈」 | **页面/工具条里的这类切换一律 `a-radio-group` + `button-style="solid"`**（选中实心 `rgb(22,119,255)` + 白字），与 `SentToDownloaderDialog`、`SetDownloader` 的候选组同写法；选项数组本来就是 `{value,label}`，改成 `v-for` 的 `<a-radio-button>` 即可。两条实测细节：① radio 那一排比 segmented **宽 16px**（181 vs 165），放在 flex 栏里要给那层 `flex: 0 0 auto`，否则窄窗口下被压成两行（栏高 54 → 86），该让位的是两边文字；② 弹窗 / popover 里那 4 处 segmented（推送下载器、导出用户信息、我的数据筛选面板、统计页日期预设）是 `block` 满宽，白浮标在满宽轨道上判得出来，暂时留着 |
| 超长文本（种子标题 / 副标题 / 保存路径 / 下载器名）靠**原生 `title`** 揭示全文 | 原生那层的底色、字号、行宽、出现延迟都由系统画，页面一点控制不了；用户 2026-10-07 指着一张搜索结果截图说「这个 title 的原生样式很难看，类似这样的全部用 popover 组件替换」 | **`<a-popover trigger="hover" placement="topLeft" :mouse-enter-delay="0.4">` + `#content` 里一个 `max-width:480px; white-space:normal; overflow-wrap:anywhere` 的 div**（范本 `TorrentTitleTd.vue`、`SentToDownloaderDialog/Index.vue`；`overflow-wrap` 是给种子标题里那种无空格长串用的）。三条实测来的细节：① **`v-if` 挂在 `a-popover` 本体上，不挂在它的子节点上** —— 子节点不在时插槽是空的，Popover 会给自己补一个空 `<span>` 当触发元素（台架实测 DOM `<span><!----></span>`），那层空 span 顶掉 flex item 本体、`min-width:0` 就再也算不到了；② 子节点在位时它**不生成包装元素**（`@v-c/trigger/dist/index.js:351` 取 `slots.default()[0]` 再 mergeProps），所以 `text-truncate` / `flex-1-1-0` 都还在原元素上、截断照常（实测 client 389 / scroll 718）；③ 弹窗是 portal，但 scoped CSS 打得进去（量到 `data-v-*` 与 `max-width:480px` 都在），不用为了浮层改全局样式。**不在这族的**：挂在图标 / 短值（日期、数字、id）上的说明性 `title`，以及文字本来就已完整铺开、`title` 只是重复一遍的地方。**已经套在浮层里的元素不许再套 popover**（`TorrentTitleTd` 社交卡那个 h3）：指针移到内层浮层时外层判定 mouseleave 会连触发元素一起销毁，改成让文字在卡里换行。 |

**这条故意没有守卫脚本**：判"是不是删除动作"要看 `@click` 的语义，静态扫只会把 `showDialog = false` 这类
带 `danger` 的取消键一起误伤。新加删除按钮时按上表写，改错了靠肉眼验收。

原子类兼容层：`src/entrypoints/options/vuetify-compat.css` 复刻的 Vuetify 原子类
（`pa-0` `d-flex` `text-no-wrap` 等）**继续用、不用重写**，只换组件标签。

#### content script 侧是按需注册，不是全局 install

设置页模板直接写 `a-xxx` 即可（全局 install）；content script 是独立入口，全量 install 会把
139 个组件打进每个站点都要加载的 content chunk（实测 4.3MB，占全部产物 JS 的 65%）。
按需清单在 `src/content-script/antd-lite.ts`（父组件数与实际注册名数**以
`check-content-antd-lite.mjs` 的输出为准，别手抄进文档** —— 抄一次就过期一次），
接线在 `src/content-script/app/init.ts`。**往 content 的模板加新 `a-*` 标签必须先补清单**，
否则线上是静默空白。

CI 与本地跑的是**同一条**聚合命令（`build` job 里 `pnpm compile` 之后、构建之前那一步就是
`node scripts/check-all.mjs`，不再是逐条 step —— 手抄 8 条 step 时新守卫进得来本地却进不来 CI）：

```bash
pnpm check:all                 # 不 fail-fast：全部跑完再汇总，任一条非零则该命令非零
node scripts/check-all.mjs     # 同样内容，绕开 pnpm（见下方警告）
```

> ⚠️ **改过 `package.json` 之后，`pnpm <script>` 可能挂死**：pnpm 12 会在 package.json
> 变更后的首次脚本运行前重新校验锁文件（本机 462 条，走网络），注册表连不上时它只留一个
> `? Verifying lockfile against supply-chain policies...` 转圈、**不超时也不报错**。
> 实测同一状态下 `pnpm check:all` 卡满 240s 无输出，而 `node scripts/check-all.mjs` 14.4s 跑完。
> 构建同理——卡住时直接 `node scripts/build-verify.mjs`（仍是 §2.1 指定的那个入口，只是不经 pnpm）。

**清单不手抄**：`scripts/check-all.mjs` 是去 `scripts/` 目录现取 `check-*.mjs` 的，
新增一条守卫自动进聚合（它排除了自身与 `check-version.mjs` —— 后者读暂存区版本号、
属于 `.githooks` 的职责，混进来会让结果取决于「此刻暂存了什么」）。
所以本文件不再维护逐条命令列表；各条防什么看下面的编号说明，或看失败时打印的详情。
CI 的 `build` job 现在也调这条聚合命令（不再逐条挂 step），于是「本地有、CI 没有」这种
漂移从结构上没了。**但现取清单不懂顺序**：那一步在构建之前，将来若有守卫需要构建产物
（`dist/`）才能判，它会被自动收进来在构建前假报错 —— 那种守卫要单独给一步排到
`Build and package` 之后，并加进 `check-all.mjs` 的 `EXCLUDED`。

前六条是**静态扫描**，7、8、10 是**行为断言**（直接 import `src/` 下的源码，不需要构建产物、
不需要 loader、不引入新依赖），9 是**数据快照自检**：

| # | 脚本 | 防的静默失效 |
|---|---|---|
| 1 | `check-antd-tags` | antdv-next 里不存在的 `a-*` 标签（内容静默丢失） |
| 2 | `check-content-antd-lite` | content 按需清单没覆盖依赖闭包里的标签（线上静默空白） |
| 3 | `check-locale-keys` | 字面 `t("a.b.c")` 在某侧解析不到（键路径被当文案渲染） |
| 4 | `check-dead-props` | 传给 `a-*` 的死 prop / 死插槽（`inheritAttrs` 原样塞进 DOM） |
| 5 | `check-store-hydration` | 挂载钩子里命令式读异步水合的 store（首屏静默空） |
| 6 | `check-sw-graph` | SW / content 引导的 import 图（§3.2 那三条铁律） |
| 7 | `check-indexdb-retry` | 共享库懒开的两条不变量：失败不缓存、成功必复用 |
| 8 | `check-fingerprint` | 种子指纹三层逻辑自检（含「本该不同」的用例） |
| 9 | `check-recent-updates` | 首页「最近更新」那份快照被裁掉条目、时间戳写成只有日期、或 `date` 对不上那次提交的真实时间（§3.7） |
| 10 | `check-category-map` | 搜索结果「分类」折类判据（§3.8）：同一内容的各种写法必须折到同一类、**别名顺序敏感的那几对不许互撞**、站点覆盖必须压过规则，外加 `common.categoryKind.*` 这批**动态拼出来**的 i18n 键两侧都在（防线 ③ 看不见这种键） |

第六条守的是 §3.2：从两个无 DOM / 必须轻量 的上下文出发，静态 import 闭包不许走到 `sizzle`、
不许命中 `@ptd/site` / `@ptd/social` 根入口，entrypoint 的 `import.meta.glob` 必须根绝对，
`defineBackground` 必须显式 `type: "module"`。它跟 `smoke-background.mjs` 是同一问题的前后两道：
这条在源码阶段点出上游文件和完整链路，那条真跑产物、抓静态图够不着的部分。
**它自带 `--selftest`（9 条断言），改判据前必须先跑** —— 这个仓库的守卫已经错过两次
「判据被注释里的反例喂成假 PASS」（实测 `type: 'module'` 写在注释里就能骗过 D 条），
而 `check-version.mjs` 的判据更是连续两次误拦 / 漏放。

第三条防的是 vue-i18n 的静默失效：键取不到时**不抛异常、不进 vue-tsc、不进构建**，而是把键路径
本身当文案渲染到界面上（内部标识符进 UI 是 §3.5 的零容忍项，它上线时扫出的真问题见 PLAYBOOK §28）。
`t("前缀" + x)` 这类动态拼接会被放过（静态不可判定），所以**改了动态键这条守卫拦不住，仍要人工核**。

第四条防的是 antdv-next 的 `inheritAttrs` 默认行为：没声明的 prop 被当普通属性原样塞进根 DOM，
不报错、不警告、生产环境完全静默；没匹配的命名插槽则直接渲染成空。`vue-tsc` 抓不到它
（`a-*` 的类型来自 `GlobalComponents`，允许任意 attr），`check-antd-tags.mjs` 也抓不到
（那条只看标签名存不存在）。判定依据同样是在 Node 里实跑 `install()` 取 props、读 `dist` 下的
`.d.ts` 取插槽映射。它的放行口径是「宁可漏报也不误报」：取不到 props/slots 声明的整组件跳过、
自定义组件是否转发插槽静态不可判定跳过、`:[x]` 动态参数不查 —— 所以**它报干净不等于真干净**。

第五条防的是 `persistWebExt` store 的**异步水合竞态**：取数走 `chrome.storage.local.get`，
水合完成前 store 里是初始值（对象 `{}`、数组 `[]`），不是 `undefined` —— 所以
`onMounted(() => 读 metadataStore.sites)` 这类写法不报错、不进 vue-tsc、不进构建，只是首屏静默空着
（这个竞态曾被 5 秒 debounce 掩盖，代价摊给所有人，见 PLAYBOOK §26）。
两条出路：`$onReady`，或改成派生（`computedAsync` / `computed`）—— 后者不需要等待，
水合一到自动重算，是首选。

**但 `watch(…, { immediate: true })` 这一类它拦不住**：判据把「观察器」当异步边界一律放过，
可 `immediate` 的回调是在组件 setup 那一帧**同步**跑的，和 `onMounted` 里读 store 完全同类。
冷启动跳搜索页必弹「请至少添加一个站点」（站点其实有几十个）就是这么来的，见 PLAYBOOK §32。
跨文件的命令式读取（页面 watcher → `utils/search.ts` 的 `doSearch` → store getter）也不在它追的
3 层里 —— 所以收口点在**入口函数自己** `$onReady`，不是指望守卫替你找出所有调用方。

它的边界同样是「宁可漏报」，**报干净不等于真干净**：store 清单靠扫源码得到（`persistWebExt`
为 true/对象的才算，`runtime` 走 sessionStorage 同步水合所以排除）；只跟同文件内的词法调用展开
3 层，跨文件转发的不追；观察器 / 定时器 / 事件监听这类**异步边界**里的读取一律放过（那些不在
挂载路径上执行）。反过来 getter 到底读没读 `state` 静态判不出来（首版就误报过一处纯透传 getter，
见 PLAYBOOK §27）。所以它报出来的每一条都要回源码看一眼。

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

### 3.7 首页「最近更新」文案：agent 手写，禁止脚本生成

`src/options/data/recentUpdates.json` 是首页那块「最近更新」的唯一数据源。
**它由读提交历史的会话逐条改写，不许再写生成脚本**（原先的
`scripts/gen-recent-updates.mjs` 已于 v0.29.1 删除，别再照它的思路补一个）。

**为什么**：脚本能做的只有「取提交首行 + 按类型词过滤」，而提交首行是写给仓库读者看的
内部口吻 ——「表体高度被自己的公式冻住」「contain 只给真滚得动的面板」「删除按钮收口成实心红」。
用户在界面上读到的是这些句子，读不出跟自己有什么关系。哪些改动值得写、怎么换成用户视角，
是要读正文和上下文才能判的，这正是代码做不到的部分。

**写法**（每次发版往最前面加一条）：

- 只写**用户看得见**的：新增能力、行为修正、观感统一。工程内部的事一律不列 ——
  守卫/CI/版本号/依赖/死码/文档/脚本，哪怕它的类型词是 `feat`（`feat(版本号守卫)` 是 feat，
  但用户看不见提交时算号这件事）。这样的版本**不占条目**，界面上直接从下一条跳过即可
  （全仓 159 个版本列进档案的是 111 个，空着的 48 个全是 docs / ci / 守卫 /
  依赖 / 死码 / 构建脚本这一类，那不是漏，是 §3.7 的口径）。
- 一条一句话，主语是用户能感知的东西（「左侧导航不再出现…」而不是「navItems 过滤 dev 标记」）。
- 一个版本里同类改动可以并成一句，但**别把三件事写成一句流水账**；宁可多列两条。
- 字段：`added[]` = 新增能力（界面渲染成「新增」），`improved[]` = 修正与观感（渲染成「优化」）；
  `addedTotal` / `improvedTotal` 目前与数组长度一致，只有刻意省略条目时才大于长度
  （界面按差值显示「另有 N 条未列出」）。
- `headSha` / `generatedAt` 是页面底部那行「截至提交」的出处。**指向上一条已经定型的提交**，
  不要指本次这条 —— 自己这条的 sha 在写文件时还不存在，事后 amend 补上去只会把它换成
  另一个号、把那串字符变成仓库里查无此人的死引用（作者日期反倒稳：`--amend` 保留 `%ad`，
  所以 `date` 可以先照 `git log -1 --date=iso-local --format=%ad` 写死，再 amend 内容）。

**`date` 是完整时间戳，从 git log 取，不许凭印象写**：格式 `YYYY-MM-DD HH:mm:ss`，
值就是那条带这个版本号的提交的**作者当地**时间：

```bash
git log -1 --date=iso-strict --format="%ad" <sha>   # 得到 2026-10-07T15:21:55+08:00
# 取中间那一段写进 JSON（去掉 T 和尾部偏移），别的都别改
```

**必须用 `iso-strict`，不能用 `iso-local`** —— `iso-local` 打的是**读的人**的时区，
CI 的 runner 是 UTC，同一提交它会打 07:21:55（v0.32.0 那次 build 就是被这个判红的，
本地九条守卫全绿）。`iso-strict` 打的是作者当时那个偏移，与机器时区无关。

只写年月日不够：同一天连发五六个版本（当天各自 09:17 / 09:24 / 09:33…），
光看日期分不出先后，用户想确认「我装的那份到底含不含某一条」时无从对号。

**这份是累积档案，不是滚动窗口 —— 只许加，不许删**（用户 2026-10-07 定的口径，
此前那句「条数建议 6~9 版，更早的删掉」作废）。理由：删掉的条目只能凭提交主题重写成
一段新文案，原措辞永久回不来；而留着不动，下一次会话就只需要写新出的那一条。
v0.29.1→v0.31.0 那五轮每轮裁掉最旧一条、五天丢了 5 条，就是这个滚动窗口造成的；
v0.32.0 把档案从 9 条补到 112 条（含它自己那条），覆盖 v0.1.0 起每个有用户可感知内容的版本。

判据在 `scripts/check-recent-updates.mjs`（自动进 `check-all` 聚合）：形状与时间戳格式、
从新到旧排、版本号不重、比 HEAD 少一条就 FAIL、同一版本号的 `date` 有任何改动就 FAIL
（时间是那次提交的事实，不是措辞，重写文案不许顺手挪它），以及每条 `date` 必须等于该版本
那次提交的真实时间。最后一条在浅克隆里自动降级（CI 的 build job 是 depth 1，
只核对得上 tip 那一条），不会假报错。

界面默认只铺最新 10 个版本，其余走「展开全部 N 条更新记录」（`HomeView.vue` 的
`PREVIEW_COUNT`）—— 档案长到一百多条之后仍然只占首页那一栏的高度，不会把面板拉成几十屏。

**特别感谢页的 `agentStats.json` 不受这条约束** —— 那是提交计数与行数的**数字**，
没有口吻问题，仍然靠 `scripts/gen-agent-stats.mjs` 重算入库（见 §2.1 与 README 的界面数据快照行）。

### 3.8 搜索结果「分类」的折类口径

同一种内容在各站点的叫法不一样：一部电影在 21 个站点上写作 `Movies` / `Movies/电影` /
`电影/Movies` / `电影` / `Movies(电影)` / `Movie(電影)`，直接按原字符串排出来是散的，
用户按「分类」排序等于没用。判据统一在 `src/shared/category.ts`（`RULES` /
`categorizeCategory` / `compareCategory`），**页面里不许再自己写一份字符串判断**。

- **为什么不是一张「本站叫法 → 统一名」的全量表**：245 个站点定义里去重后有 **3281 种**
  写法，枚举表没人维护得动。所以做成两半 —— 绝大多数走规则折类，个别站点走站点级覆盖。
- **站点例外**存 `ISiteUserConfig.categoryMap`（`Record<原始叫法, 规范类别>`，站点设置 →
  其他设置 → 分类映射 可编辑）。**故意不挂 `ISiteMetadata`**：读它的只有搜索结果页，而站点
  定义的 metadata 要 `getDefinedSiteMetadata()` 异步 import 才拿到，挂在定义类型上就是
  「写了也没人读」的死配置。覆盖与规则冲突时**覆盖赢**；覆盖值写了非法类别时退回规则结果，
  不会把界面搞成空白。
- **`RULES` 是按序 first-match，所以别名顺序是判据的一部分**：`纪录片` 必须排在 `电视剧`
  之前（"纪录片"里含"剧"），`anime` 在 `movie` / `tv` 之前（`Anime Movies`），`variety`
  在 `tv` 之前。ASCII 别名只在**词首**匹配，否则 `HDTV` 会被当成 `tv`、`av` 会命中
  `Adventure`。改顺序、加别名、删别名都要先跑 `node scripts/check-category-map.mjs`
  —— 它把这四对互撞用例和「同一别名被两个 kind 认领」都断言死了。
- **折类不能把原始数据藏起来**：表格里显示统一名，站点原文走 `a-tooltip` 悬停；
  折类结果与原文相同时**不挂这层 tooltip**（一行里出现两个一样的词是新 bug）。
- 折类名是动态拼出来的 i18n 键（`common.categoryKind.<kind>`），防线 ③ 看不见这种键，
  所以两侧齐全由防线 ⑩ 验。加 kind 时四处都要动：`TCategoryKind` / `CATEGORY_KINDS`（它
  就是排序档位）/ 两侧 locale / 防线 ⑩ 的期望表。

---

## 4. 迁移进度判断陷阱

**文件存在 ≠ 用户能看到。** 迁移完的页面必须核对**路由表是否真的挂上**（`src/options/plugins/router.ts`）。
盘点迁移进度时除了 diff 文件清单，**必须 grep 路由表 + grep 组件的实际引用点** ——
「490 行的页面一直被挂在调试页位置上」「三个组件平移了却从没接线」这两起误判见 PLAYBOOK §29。

**接线对了 ≠ 语义对了。** 设置项报"打开了没生效"时，先拿**引擎里那一行算式**反查标签与控件，
别先怀疑调度：`interval * 60 * 60 * 1000` 配着「刷新间隔（分钟）」，填 3 就是等 3 小时 ——
而 state 里的注释（`// hours`）和上游那份 `range(1, 24)` 下拉早就写明了是小时。同一批要一起核的：
`afterTime` 是 `"HH:mm"` 字符串却被 `a-input-number` 绑着（点一下步进器就变数字，
引擎 `split(":")` 当场抛错、整个后台任务静默死掉）、`retryInterval` 按分钟算却标着秒。
改默认值时照 §1 那几条先例加**版本门**（`xxxDefaultOnSince` + `afterRestore` 里
「值 == 旧默认 且 version 更旧 → 纠正一次」），只改 state 默认值对老用户无效 ——
`persistWebExt` 会把存量原样盖回来。

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
