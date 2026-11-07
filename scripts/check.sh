#!/usr/bin/env bash
# The gate every task must pass before landing on main: Python tests, then the web build.
set -euo pipefail
cd "$(dirname "$0")/.."
export LG_OFFLINE=1

need() { command -v "$1" >/dev/null || { echo "check: '$1' is not installed on this machine" >&2; exit 1; }; }

need uv
uv sync --quiet
uv run --quiet pytest -q

if [ -f web/package.json ]; then
  need npm
  (cd web && npm install --no-audit --no-fund --silent)
  (cd web && npm run --silent build)
fi
