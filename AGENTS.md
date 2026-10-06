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
**改 `check-version.mjs` 的判据必须先跑它** —— 这条守卫本身没人守，就是它连续两次误拦 / 漏放的原因。

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

- `verify`：`pnpm compile` + 七条守卫 + `check-version.mjs --committed`。
- `build`：`wxt zip` + `wxt zip -b firefox`，从 `.output/` 取产物并重命名成
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
| `a-table` 的 `sorter: true` | 排序箭头动、**数据不排** | antd `getSortFunction` 静默跳过无 compare 的 sorter，必须给真正 compare 函数 |
| `a-list` 传 `:data-source="[]"` | 渲染内置「暂无数据」占位 | 不用 data-source，直接渲染子项 |
| `<a-step>` 等注册表里不存在的 `a-*` 标签 | 被当原生未知元素，**内容静默丢失**（带对象插槽时整块空白） | antdv-next 全量 install 实测只有 139 个注册名，**没有** `AStep`/`AList`；Steps 只有 `:items` 数组写法。CI 的 check-antd-tags 会拦 |
| 图标 `import * as Icons from "@antdv-next/icons"` | 1760 个图标模块**全进包** | 只具名导入用到的：`import { DeleteOutlined } from "@antdv-next/icons"` |

原子类兼容层：`src/entrypoints/options/vuetify-compat.css` 复刻的 Vuetify 原子类
（`pa-0` `d-flex` `text-no-wrap` 等）**继续用、不用重写**，只换组件标签。

#### content script 侧是按需注册，不是全局 install

设置页模板直接写 `a-xxx` 即可（全局 install）；content script 是独立入口，全量 install 会把
139 个组件打进每个站点都要加载的 content chunk（实测 4.3MB，占全部产物 JS 的 65%）。
按需清单在 `src/content-script/antd-lite.ts`（父组件数与实际注册名数**以
`check-content-antd-lite.mjs` 的输出为准，别手抄进文档** —— 抄一次就过期一次），
接线在 `src/content-script/app/init.ts`。**往 content 的模板加新 `a-*` 标签必须先补清单**，
否则线上是静默空白。

CI 上挂在 `pnpm compile` 之后、构建之前的守卫共 8 条，本地一条命令全跑：

```bash
pnpm check:all                 # 不 fail-fast：8 条全跑完再汇总，任一条非零则该命令非零
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

前六条是**静态扫描**，后两条是**行为断言**（直接 import `src/` 下的源码，不需要构建产物、
不需要 loader、不引入新依赖）：

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

---

## 4. 迁移进度判断陷阱

**文件存在 ≠ 用户能看到。** 迁移完的页面必须核对**路由表是否真的挂上**（`src/options/plugins/router.ts`）。
盘点迁移进度时除了 diff 文件清单，**必须 grep 路由表 + grep 组件的实际引用点** ——
「490 行的页面一直被挂在调试页位置上」「三个组件平移了却从没接线」这两起误判见 PLAYBOOK §29。

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
