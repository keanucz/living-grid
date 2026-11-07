#!/usr/bin/env bash
# One-off VPS bootstrap. Run as root from a checkout of this repo:
#   sudo ./scripts/vps-setup.sh [root-dir] [teammate ...]
set -euo pipefail

ROOT="${1:-/srv/hack}"; shift || true
TEAM=("$@")
SRC="$(cd "$(dirname "$0")/.." && pwd)"
GROUP=hack

command -v git >/dev/null || { apt-get update -qq && apt-get install -y -qq git; }
python3 -c 'import sys; assert sys.version_info >= (3, 11)' || { echo "need python 3.11+"; exit 1; }

getent group "$GROUP" >/dev/null || groupadd "$GROUP"
# Unprivileged user for the merge queue: check.sh runs agent-written code, so never as root.
id hub >/dev/null 2>&1 || useradd --system -m -d /var/lib/hub -s /usr/sbin/nologin -g "$GROUP" hub
sudo -u hub git config --global user.name "hackhub integrator"
sudo -u hub git config --global user.email "integrator@hub"
for u in "${TEAM[@]}"; do
  id "$u" >/dev/null 2>&1 || useradd -m -s /bin/bash "$u"
  usermod -aG "$GROUP" "$u"
  sudo -u "$u" git config --global user.name >/dev/null || sudo -u "$u" git config --global user.name "$u"
  sudo -u "$u" git config --global user.email >/dev/null || sudo -u "$u" git config --global user.email "$u@hub"
done

mkdir -p "$ROOT"/{agents,logs}
chgrp -R "$GROUP" "$ROOT"
chmod 2775 "$ROOT" "$ROOT"/agents "$ROOT"/logs

BARE="$ROOT/repo.git"
if [ ! -d "$BARE" ]; then
  git init -q --bare --shared=group -b main "$BARE"
  tmp="$(mktemp -d)"
  git clone -q "$SRC" "$tmp/seed"
  git -C "$tmp/seed" push -q "$BARE" HEAD:refs/heads/main
  rm -rf "$tmp"
fi
install -m 0775 "$SRC/scripts/pre-receive" "$BARE/hooks/pre-receive"

git config --system --add safe.directory '*'
touch "$ROOT/hub.db" && chgrp "$GROUP" "$ROOT/hub.db" && chmod 0664 "$ROOT/hub.db"

clone() {
  [ -d "$1" ] || git clone -q "$BARE" "$1"
  git -C "$1" config hub.db "$ROOT/hub.db"
  git -C "$1" config core.sharedRepository group
  git -C "$1" config pull.rebase true
  git -C "$1" config rerere.enabled true
  chgrp -R "$GROUP" "$1" && chmod -R g+rwX "$1"
  find "$1" -type d -exec chmod g+s {} +
}
clone "$ROOT/integrator"
clone "$ROOT/work"

cat > /etc/profile.d/hackhub.sh <<EOF
umask 0002
export HUB_ROOT=$ROOT
alias hub='$ROOT/work/bin/hub'
EOF

if command -v systemctl >/dev/null; then
  sed "s#@ROOT@#$ROOT#g" "$SRC/scripts/hub-integrator.service" > /etc/systemd/system/hub-integrator.service
  systemctl daemon-reload
  systemctl enable --now hub-integrator
fi

cat <<EOF

Ready.
  bare repo     $BARE        (remote for laptops: ssh://<user>@<vps>$BARE)
  integrator    $ROOT/integrator   (systemd: hub-integrator, logs: journalctl -u hub-integrator -f)
  agent base    $ROOT/work
  task board    $ROOT/hub.db

New agent:   cd $ROOT/work && bin/hub spawn <name>    then  cd $ROOT/agents/<name> && claude
EOF
