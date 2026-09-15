#!/usr/bin/env bash
# Push the current branch to every configured remote, and report honestly.
#
# The repository is mirrored because one host has already refused this account
# once. Losing a remote should cost a command, not a migration.
#
#   ./scripts/mirror-push.sh              push the current branch
#   ./scripts/mirror-push.sh --tags       push tags as well
#
# A remote that fails does not stop the others. The exit code is non-zero if
# any remote failed, so CI and your shell both know the mirror is incomplete.

set -uo pipefail

branch=$(git rev-parse --abbrev-ref HEAD)
remotes=$(git remote)
failed=()

# macOS still ships bash 3.2, where expanding an empty array under `set -u`
# is an error. Keep the extra arguments as a plain string instead.
extra_args="$*"

if [ -z "$remotes" ]; then
  echo "No remotes configured." >&2
  exit 1
fi

echo "Pushing ${branch} to: $(echo "$remotes" | tr '\n' ' ')"
echo

for remote in $remotes; do
  printf '── %s ── ' "$remote"
  if output=$(git push $extra_args "$remote" "$branch" 2>&1); then
    echo "ok"
  else
    echo "FAILED"
    echo "$output" | sed 's/^/    /'
    failed+=("$remote")
  fi
done

echo
if [ ${#failed[@]} -eq 0 ]; then
  echo "All remotes up to date with ${branch}."
else
  echo "Incomplete mirror. Failed: ${failed[*]}" >&2
  exit 1
fi
