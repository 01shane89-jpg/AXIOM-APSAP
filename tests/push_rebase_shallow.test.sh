#!/usr/bin/env bash
# tools/push_rebase.sh from a depth-1 checkout whose origin/main ref was moved by an earlier fetch must not roll the branch
# back. On 24 Nov 2026 refresh-ai.yml ran `git fetch origin main` before pushing; the replay then took the checkout's whole
# tree with "theirs" and undid three code PRs merged after the run had checked out (#920, #921, #922).
# Also checks that the fetch refresh-ai.yml now uses (--refmap=) leaves origin/main alone.
# Run from the repo root: bash tests/push_rebase_shallow.test.sh
set -u
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
root=$(pwd); t=$(mktemp -d); fails=0
ok() { if [ "$1" = 0 ]; then echo "PASS $2"; else echo "FAIL $2"; fails=$((fails + 1)); fi; }
g() { git -c user.name=t -c user.email=t@t -c init.defaultBranch=main "$@"; }
g init -q --bare "$t/origin.git"
g clone -q "$t/origin.git" "$t/seed" 2>/dev/null
cd "$t/seed" && echo v1 > code.js && echo d1 > data.txt && g add . && g commit -qm A && g push -q origin HEAD:main
run() {  # $1 = how the run fetches main before pushing
  rm -rf "$t/run" && g clone -q --depth=1 "file://$t/origin.git" "$t/run" 2>/dev/null
  cd "$t/seed" && g pull -q origin main && echo "v$2" > code.js && g commit -qam "code $2" && g push -q origin HEAD:main
  cd "$t/run" && echo "d$2" > data.txt && g commit -qam "data $2"
  local before; before=$(git rev-parse refs/remotes/origin/main)
  eval "$1" >/dev/null 2>&1
  moved=$([ "$(git rev-parse refs/remotes/origin/main)" = "$before" ] && echo no || echo yes)
  GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t bash "$root/tools/push_rebase.sh" main theirs 1 >/dev/null 2>&1
  pushed=$?
  cd "$t/seed" && g pull -q origin main 2>/dev/null
  code=$(cat code.js); data=$(cat data.txt)
}
run 'git fetch -q origin main' 2
ok $pushed "the push goes through after a fetch moved origin/main (moved: $moved)"
[ "$code" = v2 ] && [ "$data" = d2 ]; ok $? "main keeps its newer code and gets the run's data (code $code, data $data)"
run 'git fetch -q --depth=1 --refmap= origin main' 3
[ "$moved" = no ]; ok $? "fetch with --refmap= leaves origin/main where the checkout put it"
[ "$code" = v3 ] && [ "$data" = d3 ]; ok $? "and the push keeps main's code (code $code, data $data)"
rm -rf "$t"
exit $fails
