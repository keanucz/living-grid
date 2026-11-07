#!/usr/bin/env bash
# The gate every task must pass before landing on main.
# Runs only what the change needs: Python tests unless the change is web/demo/docs only, and the web build only
# when web/ changed. CHECK_ALL=1, or a diff that cannot be worked out, runs both.
set -euo pipefail
cd "$(dirname "$0")/.."
export LG_OFFLINE=1

need() { command -v "$1" >/dev/null || { echo "check: '$1' is not installed on this machine" >&2; exit 1; }; }

run_py=1 run_web=1
if [ "${CHECK_ALL:-0}" != "1" ] && base="$(git merge-base HEAD origin/main 2>/dev/null)" \
   && changed="$(git diff --name-only "$base" HEAD 2>/dev/null)" && [ -n "$changed" ]; then
  run_py=0 run_web=0
  # Plain case matching: this server's grep is ugrep, whose -v exit status is unreliable.
  while IFS= read -r f; do
    case "$f" in
      web/*) run_web=1 ;;
      demo/* | *.md) ;;
      *) run_py=1 ;;
    esac
  done <<<"$changed"
fi
echo "check: python=$run_py web=$run_web"

if [ "$run_py" = 1 ]; then
  need uv
  uv sync --quiet
  uv run --quiet pytest -q
fi

if [ "$run_web" = 1 ] && [ -f web/package.json ]; then
  need npm
  (cd web && npm install --no-audit --no-fund --silent)
  (cd web && npm run --silent build)
fi
