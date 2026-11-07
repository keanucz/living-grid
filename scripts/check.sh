#!/usr/bin/env bash
# The gate every task must pass before landing on main. Replace with your project's build and tests.
set -euo pipefail

if [ -f package.json ]; then
  npm ci --silent && npm test --silent
elif [ -f pyproject.toml ] || [ -f requirements.txt ]; then
  python3 -m pytest -q
elif [ -f Cargo.toml ]; then
  cargo test --quiet
elif [ -f go.mod ]; then
  go test ./...
elif [ -f CMakeLists.txt ]; then
  cmake -S . -B build -G Ninja >/dev/null && cmake --build build && ctest --test-dir build --output-on-failure
else
  echo "no project detected yet, passing"
fi
