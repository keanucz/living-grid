#!/usr/bin/env bash
# Regenerate the TypeScript client bindings in web/src/spacetime/ from the module.
set -euo pipefail
cd "$(dirname "$0")"
(cd module && npm install --no-audit --no-fund --silent && npx tsc --noEmit)
spacetime generate --lang typescript --module-path module --out-dir ../web/src/spacetime --no-config -y
