#!/usr/bin/env bash
# One-time per machine (laptop or VPS): installs PARALLEL_API_KEY and your own hivemind
# credentials into ~/.config/living-grid/env and sources it from your shell rc.
# Secrets come from /srv/hack/secrets on the VPS (only the hack group can read the Parallel key;
# each hivemind token file is readable by its owner only).
# Usage: coord/setup.sh <keanu|stefan|manu>
set -euo pipefail
name="${1:?usage: coord/setup.sh <keanu|stefan|manu>}"
grep -qx "$name" "$(dirname "$0")/agents.txt" || { echo "unknown agent '$name' (see coord/agents.txt)" >&2; exit 1; }
vps="${LG_VPS:-2.31.112.114}"
dest="$HOME/.config/living-grid"
umask 077
mkdir -p "$dest"
fetch() {
  if [ -r "/srv/hack/secrets/$1" ]; then cat "/srv/hack/secrets/$1"
  else ssh -o BatchMode=yes "$name@$vps" cat "/srv/hack/secrets/$1"; fi
}
{ fetch parallel.env; fetch "hivemind-$name.env"; } > "$dest/env.tmp"
if ! grep -q '^export PARALLEL_API_KEY=' "$dest/env.tmp" || ! grep -q '^export HIVEMIND_TOKEN=' "$dest/env.tmp"; then
  rm -f "$dest/env.tmp"; echo "could not fetch secrets from $name@$vps" >&2; exit 1
fi
mv "$dest/env.tmp" "$dest/env"
line='[ -f "$HOME/.config/living-grid/env" ] && . "$HOME/.config/living-grid/env"'
for rc in "$HOME/.zshenv" "$HOME/.bashrc"; do
  case "$rc" in *.bashrc) [ -f "$rc" ] || continue ;; esac
  grep -qF 'living-grid/env' "$rc" 2>/dev/null || printf '\n# The Living Grid hackathon (PARALLEL_API_KEY, HIVEMIND_*)\n%s\n' "$line" >> "$rc"
done
echo "installed for $name. Open a new shell (or run: . $dest/env), then restart Claude Code in the repo."
