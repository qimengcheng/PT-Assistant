#!/bin/sh
# 版本号守卫的行为回归测试：在临时仓库里跑真实 hook，验证 scripts/check-version.mjs 的判定。
# 用法：sh scripts/check-version-test.sh
#
# 用例顺序刻意排过，别顺手调换：
# - 「新开一条却重复用号」会**真的**往历史里留下一个重复号，排在 amend 用例前面的话，
#   后面 amend 的基线（HEAD~1）里仍留着同号，于是报「跳号」——那是历史本身不合法。
# - 「--amend 改号」会把被改那条的号变成死号（见末尾的已知局限），同样会毒化后续用例。
# - 档位用例（feat/fix）依赖「前一条是什么号」，中间插号会把断言变成巧合通过。
set -u
SRC=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
REPO=/tmp/vt3
rm -rf $REPO && mkdir -p $REPO/scripts $REPO/.githooks && cd $REPO || exit 1
cp "$SRC/scripts/check-version.mjs" scripts/
cp "$SRC/.githooks/pre-commit" "$SRC/.githooks/commit-msg" .githooks/
git init -q -b main . >/dev/null
git config user.email t@t; git config user.name t; git config core.hooksPath .githooks
git config commit.gpgsign false

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

echo "--- 已知局限：--amend 顺手改号会造出死号 ---"
# 单独开一个干净仓库演示：本仓库历史已被上面的用例搅过，看不出「号没了」。
R2=/tmp/vt4; rm -rf $R2; mkdir -p $R2/scripts $R2/.githooks; cd $R2
cp "$SRC/scripts/check-version.mjs" scripts/; cp "$SRC/.githooks/pre-commit" "$SRC/.githooks/commit-msg" .githooks/
git init -q -b main . >/dev/null
git config user.email t@t; git config user.name t; git config core.hooksPath .githooks; git config commit.gpgsign false
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
