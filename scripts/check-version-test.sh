#!/bin/sh
# 版本号守卫的行为回归测试：在临时仓库里跑真实 hook，验证 scripts/check-version.mjs 的判定。
# 用法：sh scripts/check-version-test.sh
#
# 用例顺序刻意排过，别顺手调换：
# - 「新开一条却重复用号」会**真的**往历史里留下一个重复号，排在 amend 用例前面的话，
#   后面 amend 的基线（HEAD~1）里仍留着同号，于是报「跳号」——那是历史本身不合法。
# - 「--amend 改号」会把被改那条的号变成死号（见末尾的已知局限），同样会毒化后续用例。
# - 档位用例（feat/fix）依赖「前一条是什么号」，中间插号会把断言变成巧合通过。
# - @next 档单独开一个干净仓库（/tmp/vt5）跑：它每条都会真的推进版本号，
#   混进主序列会让后面依赖「前一条是什么号」的断言变成巧合通过。
set -u
SRC=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)

mkrepo() { # 在 $1 建一个装好三条 hook 的临时仓库并切进去
  rm -rf "$1" && mkdir -p "$1/scripts" "$1/.githooks" && cd "$1" || exit 1
  cp "$SRC/scripts/check-version.mjs" scripts/
  cp "$SRC/.githooks/pre-commit" "$SRC/.githooks/commit-msg" "$SRC/.githooks/prepare-commit-msg" .githooks/
  git init -q -b main . >/dev/null
  git config user.email t@t; git config user.name t; git config core.hooksPath .githooks
  git config commit.gpgsign false
}

REPO=/tmp/vt3
mkrepo $REPO

n=0; pass=0; failn=0
report() {
  n=$((n+1)); code=$1; want=$2; name=$3; out=$4
  [ $code -eq 0 ] && got=PASS || got=FAIL
  if [ "$got" = "$want" ]; then pass=$((pass+1)); printf '  ok   %-2s %-44s %s\n' "$n" "$name" "$got"
  else failn=$((failn+1)); printf '  BAD  %-2s %-44s want=%s got=%s\n%s\n' "$n" "$name" "$want" "$got" "$out"; fi
}
t() {  # 新开一条提交：<用例> <期望> <消息> <版本号>
  printf '{"name":"x","version":"%s"}\n' "$4" > package.json
  echo "p$n" > payload.txt
  git add package.json payload.txt >/dev/null 2>&1
  out=$(git commit -q -m "$3" 2>&1); report $? "$2" "$1" "$out"
}
ta() { # --amend HEAD：<用例> <期望> <消息> <版本号>
  printf '{"name":"x","version":"%s"}\n' "$4" > package.json
  echo "p$n" > payload.txt
  git add package.json payload.txt >/dev/null 2>&1
  out=$(git commit -q --amend -m "$3" 2>&1); report $? "$2" "$1" "$out"
}
ci() { # 事后校验 HEAD：<期望> <说明>
  out=$(node scripts/check-version.mjs --committed 2>&1); report $? "$1" "$2" "$out"
}
nx() { # --next：<期望输出> <附加参数> <说明>
  got=$(node scripts/check-version.mjs --next $2)
  [ "$got" = "$1" ] && { n=$((n+1)); pass=$((pass+1)); echo "  ok   $n $3 = $got"; } \
                    || { n=$((n+1)); failn=$((failn+1)); echo "  BAD  $n $3 = $got，期望 $1"; }
}
# 包装命令的入口（判据都在 check-version.mjs 里，这里只调它）
VC="$SRC/scripts/versioned-commit.mjs"
pkghead() { node -e 'const{execSync}=require("child_process");process.stdout.write(JSON.parse(execSync("git show HEAD:package.json",{encoding:"utf8"})).version)'; }
pkgworktree() { node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync("package.json","utf8")).version)'; }
# tm：<用例> <消息>：暂存区里除了 package.json 什么都没有 → 必须拒收，
# 不许留下「只推进版本号」的空壳提交（包装命令自己会 add package.json，git 那条 no changes 兜不住）
tm() {
  git reset -q >/dev/null 2>&1
  before=$(pkghead)
  out=$(node "$VC" -m "$2" 2>&1); code=$?
  after=$(pkghead)
  if [ $code -ne 0 ] && [ "$before" = "$after" ]; then
    report 0 PASS "$1" ""
  else
    report 1 PASS "$1" "  code=$code HEAD 的号=$before→$after（号被推进说明空壳提交真的落了）/ $out"
  fi
}
# tz：<用例> <期望落库版本> <消息> [工作区 package.json 起始版本]
# 走包装命令，而且故意只 git add payload.txt —— 算号、写 package.json、暂存必须全由脚本做完，
# 否则这条测试还在测「人记得 add」那个老前提。
tz() {
  printf '{"name":"x","version":"%s"}\n' "${4:-0.0.0}" > package.json
  echo "p$n" > payload.txt
  git add -- payload.txt >/dev/null 2>&1
  out=$(node "$VC" -m "$3" 2>&1); code=$?
  if [ $code -ne 0 ]; then report $code PASS "$1" "$out"; return; fi
  got=$(pkghead)
  subj=$(git log -1 --format=%s)
  dirty=$(git status --porcelain -- package.json)
  case "$subj" in *"@next"*) left=bad ;; *) left=ok ;; esac
  if [ "$got" = "$2" ] && [ "$left" = ok ] && [ -z "$dirty" ]; then
    report 0 PASS "$1" ""
  else
    report 1 PASS "$1" "  落库版本=$got（期望 $2）/ 首行残留=$left / 未暂存的 package.json=[$dirty] / $out"
  fi
}
# tf：<用例> <消息> [起始版本]：直接 git commit 却写了 @next（忘了走包装）→ 必须当场拒收，
# 且不许留下「消息里有占位符、package.json 还是旧号」的半套状态
tf() {
  printf '{"name":"x","version":"%s"}\n' "${4:-0.0.0}" > package.json
  echo "p$n" > payload.txt
  git add -- payload.txt >/dev/null 2>&1
  before=$(pkghead)
  out=$(git commit -q -m "$2" 2>&1); code=$?
  after=$(pkghead)
  if [ $code -eq 0 ] || [ "$before" != "$after" ]; then
    report 1 PASS "$1" "  code=$code 拒收前 HEAD 的号=$before 之后=$after / 首行=$(git log -1 --format=%s) / $out"
  else
    report 0 PASS "$1" ""
  fi
}
# tv：<用例> <消息>：包装命令带 --amend 又写 @next → 必须拒收且不推进版本号（AGENTS.md §1.6 硬约束 2）
# 工作区那份也要没被碰过：拒收发生在写文件之前，不能留下「号改了但没提交」的中间态。
# 比的是它自己调用前后的工作区，不是 HEAD 的号 —— 前一条用例可能故意把工作区留在别值。
tv() {
  echo "p$n" > payload.txt
  git add -- payload.txt >/dev/null 2>&1
  before=$(pkghead)
  wt_before=$(pkgworktree)
  out=$(node "$VC" --amend -m "$2" 2>&1); code=$?
  after=$(pkghead)
  wt=$(pkgworktree)
  if [ $code -ne 0 ] && [ "$before" = "$after" ] && [ "$wt_before" = "$wt" ]; then
    report 0 PASS "$1" ""
  else
    report 1 PASS "$1" "  code=$code HEAD 的号=$before→$after 工作区=$wt_before→$wt / $out"
  fi
}

echo "--- 提交瞬间（pre-commit + commit-msg）---"
t  "首条提交，历史无版本号"              PASS "[A]-[M] v0.5.0 fix root" 0.5.0
t  "fix 进修订号 N+1"                    PASS "[A]-[M] v0.5.1 fix(x): y" 0.5.1
t  "refactor 也算修订号"                 PASS "[A]-[M] v0.5.2 refactor: 拆组件" 0.5.2
t  "feat 进次版本，修订号归零"           PASS "[A]-[M] v0.6.0 feat: 新页面" 0.6.0
t  "feat 却写修订号（硬拦）"             FAIL "[A]-[M] v0.6.1 feat: 又一个新页面" 0.6.1
t  "fix 却写次版本（硬拦）"              FAIL "[A]-[M] v0.7.0 fix: 顺手改错号" 0.7.0
t  "类型词认不出时按修订号放行"          PASS "[A]-[M] v0.6.1 root" 0.6.1
ta "--amend 改成 feat 措辞也不逼你换号"  PASS "[A]-[M] v0.6.1 feat amended" 0.6.1
ta "--amend 时首行没有版本号"            FAIL "[A]-[M] feat no version" 0.6.1
ta "--amend 首行模型名含三段式数字"      PASS "[OpenCode]-[Space Bunny Alpha 1.0.0] v0.6.1 anchored" 0.6.1
t  "真跳号"                              FAIL "[A]-[M] v0.6.99 jump" 0.6.99
t  "回退用旧号"                          FAIL "[A]-[M] v0.5.1 back" 0.5.1
t  "正文含其他版本号，不参与判定"        PASS "[A]-[M] v0.7.0 feat

修掉 v0.6.0 引出的回归，并兼容 v0.9.9 的旧格式。" 0.7.0
ci PASS "HEAD 进位正确且三处一致"
t  "消息号与 package.json 不一致"        FAIL "[A]-[M] v0.8.0 fix" 0.7.1

echo "--- 本地放过的重复用号，由 CI 兜住 ---"
t  "新开一条却重复用号（本地放过）"      PASS "[A]-[M] v0.7.0 dup-real" 0.7.0
ci FAIL "事后 --committed 认出重复用号"

echo "--- --next ---"
nx "v0.7.1" ""            "--next 默认给修订号"
nx "v0.8.0" "--type feat" "--next --type feat 给次版本"

echo "--- @next 自动写入（scripts/versioned-commit.mjs + prepare-commit-msg 守卫）---"
# 独立仓库：这里每条都真的推进版本号，且**故意不** git add package.json
R3=/tmp/vt5
mkrepo $R3
t  "铺垫：手写号的首条 v0.5.0"                 PASS "[A]-[M] v0.5.0 fix seed" 0.5.0
tz "@next+fix → 0.5.1 落库，package.json 由脚本写入并暂存" 0.5.1 "[A]-[M] @next fix: 自动修订号" 0.0.0
tz "@next+feat → 进次版本 0.6.0"               0.6.0 "[A]-[M] @next feat: 自动次版本" 0.0.0
tz "@next 但类型词认不出 → 按修订号 0.6.1"      0.6.1 "[A]-[M] @next root" 0.0.0
ci PASS "自动写入后 HEAD 三处一致"
tz "工作区被别的会话预 bump 成 9.9.9，@next 只信 git log" 0.6.2 "[A]-[M] @next fix: 不信工作区" 9.9.9
tz "显式号走包装命令：漏 add 也照样落库"         0.6.3 "[A]-[M] v0.6.3 fix: 手写号也走包装" 0.6.3
t  "正文里的 @next 不触发（只管首行）"          PASS "[A]-[M] v0.6.4 fix: 显式号

提到 @next/nuxt 这个包也只当正文处理。" 0.6.4
tz "前缀带三段式数字的模型名 + @next 仍能展开"  0.6.5 "[OpenCode]-[Space Bunny Alpha 1.0.0] @next fix: anchored" 0.0.0
tf "直接 git commit 用 @next（忘了走包装）→ 守卫当场拒收" "[A]-[M] @next fix: 没走包装"
tv "包装命令 + --amend + @next → 拒收且不推进版本号"  "[A]-[M] @next fix: 把 amend 当成新提交"
tm "什么都没暂存就走包装 → 拒收，不留只改版本号的空壳提交" "[A]-[M] @next fix: 忘了 git add 自己的文件"
tf "包名 @next/nuxt 不在版本号槽位 → 不展开，按无号拦下" "[A]-[M] @next/nuxt 里有 bug"
tf "next@next 当普通词 → 不展开，按无号拦下"     "[A]-[M] 用 next@next 试了 fix: 无号"

echo "  · 热点文件：package.json 有版本号以外的未暂存改动时必须出声（AGENTS.md §1.4）"
printf '{"name":"x","extra":1,"version":"0.0.0"}\n' > package.json
echo dirty >> payload.txt; git add -- payload.txt >/dev/null 2>&1
out=$(node "$VC" -m "[A]-[M] @next fix: 带别的依赖改动" 2>&1); code=$?
case "$out" in *"版本号以外的改动"*) warned=ok ;; *) warned=no ;; esac
got=$(pkghead)
[ $code -eq 0 ] && [ "$warned" = ok ] && [ "$got" = 0.6.6 ] \
  && report 0 PASS "未暂存的其他改动 → 警告但仍然放行" "" \
  || report 1 PASS "未暂存的其他改动 → 警告但仍然放行" "  code=$code warned=$warned 落库=$got / $out"

echo "--- 已知局限：--amend 顺手改号会造出死号 ---"
# 单独开一个干净仓库演示：本仓库历史已被上面的用例搅过，看不出「号没了」。
R2=/tmp/vt4
mkrepo $R2
printf '{"name":"x","version":"0.5.0"}\n' > package.json; echo a > f.txt
git add -A >/dev/null 2>&1; out=$(git commit -q -m "[A]-[M] v0.5.0 one" 2>&1); report $? PASS "铺垫：首条 v0.5.0" "$out"
printf '{"name":"x","version":"0.5.1"}\n' > package.json; echo b >> f.txt
git add -A >/dev/null 2>&1; out=$(git commit -q -m "[A]-[M] v0.5.1 two" 2>&1); report $? PASS "铺垫：推进到 v0.5.1" "$out"
# 把 v0.5.1 那条 amend 成 v0.5.2 —— pre-commit 只看「staged 是否等于 HEAD 的号」，
# 这里不相等，走普通分支，candidates = max(历史)+1 = 0.5.2，于是放过；0.5.1 从此成为死号。
printf '{"name":"x","version":"0.5.2"}\n' > package.json; echo c >> f.txt
git add -A >/dev/null 2>&1; out=$(git commit -q --amend -m "[A]-[M] v0.5.2 amended away" 2>&1); report $? PASS "amend 改号，本地放过（拦不住）" "$out"
out=$(node scripts/check-version.mjs --committed 2>&1); report $? FAIL "缺口在 tip 时，CI 认得出" "$out"
printf '{"name":"x","version":"0.5.3"}\n' > package.json; echo d >> f.txt
git add -A >/dev/null 2>&1; out=$(git commit -q -m "[A]-[M] v0.5.3 three" 2>&1); report $? PASS "再进一条把缺口顶成中段" "$out"
out=$(node scripts/check-version.mjs --committed 2>&1); report $? PASS "缺口进了历史中段，CI 也看不见" "$out"
echo "    实际历史：$(git log --reverse --format='%s' | sed 's/\[[^]]*\]-\[[^]]*\] //' | tr '\n' ' ')"
echo "    ← 0.5.1 再没有任何提交用过。--committed 只校验 HEAD 一条，所以中段缺口是结构性的盲区。"
cd "$REPO"

echo "--- 最终历史（自上而下）---"
git log --format='  %s'
echo
echo "通过 $pass / 失败 $failn"
[ $failn -eq 0 ]
