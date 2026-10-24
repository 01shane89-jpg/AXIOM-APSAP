#!/usr/bin/env bash
# Push this run's commits to a branch that other jobs push to as well, from the one-commit-deep checkout the workflows use.
#   bash tools/push_rebase.sh <branch> [theirs] [tries]
# A plain `git pull` into a depth-1 checkout can run for over 15 minutes (24 Oct 2026: the news lane timed out on every
# try for 3.5 hours, the AI job spent 12 minutes in one pull). So only the branch's newest commit is fetched (seconds) and
# this run's commits are replayed onto it. "theirs" keeps this run's side of a clashing hunk, as `-X theirs` did before.
# The run's commits are the ones after origin/<branch> as the checkout left it; after each fetch that ref is the new tip.
set -u
b="${1:?branch}"; x=(); [ "${2:-}" = theirs ] && x=(-X theirs); tries="${3:-5}"
for i in $(seq 1 "$tries"); do
  base=$(git rev-parse -q --verify "refs/remotes/origin/$b" || git rev-parse HEAD~1)
  if timeout 180 git fetch -q --depth=1 origin "$b" && git rebase -q "${x[@]}" --onto FETCH_HEAD "$base"; then
    git update-ref "refs/remotes/origin/$b" FETCH_HEAD
    timeout 120 git push -q origin "HEAD:$b" && exit 0
  else
    git rebase --abort 2>/dev/null || true
    git update-ref "refs/remotes/origin/$b" "$base"
  fi
  sleep $((i * 5))
done
exit 1
