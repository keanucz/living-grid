#!/usr/bin/env bash
# Smoke test: start an in-memory SpacetimeDB, publish the module, call reducers over HTTP the way
# the Python publisher will, and check the rows landed. Needs the spacetime CLI; not part of check.sh.
set -euo pipefail
cd "$(dirname "$0")"
PORT=${PORT:-3199}
H=http://127.0.0.1:$PORT
DB=lg-smoke

spacetime start --listen-addr "127.0.0.1:$PORT" --in-memory --non-interactive >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
for _ in $(seq 30); do curl -sf -o /dev/null "$H/v1/ping" && break; sleep 0.5; done

(cd module && npm install --no-audit --no-fund --silent && spacetime publish --server "$H" -y "$DB" >/dev/null)

# Anonymous identity (any browser) and a publisher identity promoted by the module owner (this CLI).
ANON=$(curl -sf -X POST "$H/v1/identity")
TOK=$(python3 -c 'import sys, json; print(json.loads(sys.argv[1])["token"])' "$ANON")
PUBJ=$(curl -sf -X POST "$H/v1/identity")
PUB=$(python3 -c 'import sys, json; print(json.loads(sys.argv[1])["token"])' "$PUBJ")
PUB_ID=$(python3 -c 'import sys, json; print(json.loads(sys.argv[1])["identity"])' "$PUBJ")
call_as() {
  local tok=$1 code; shift
  code=$(curl -s -o /dev/stderr -w '%{http_code}' -X POST "$H/v1/database/$DB/call/$1" \
    -H "Authorization: Bearer $tok" -H 'Content-Type: application/json' -d "$2")
  [ "$code" = "$3" ] || { echo "FAIL $1: expected $3, got $code" >&2; exit 1; }
}
call() { call_as "$PUB" "$@"; }
anon() { call_as "$TOK" "$@"; }
sql() { spacetime sql --server "$H" "$DB" "$1" 2>/dev/null; }

# Locked: anonymous callers cannot publish, clear, prune or promote themselves.
anon upsert_zones '[[{"code":"XX","name":"Nope","currency":"EUR","lat":0,"lon":0}]]' 530
anon set_intervention '["main","hormuz","EU",30,168,"evil",1,"GBP","x","{}"]' 530
anon clear_intervention '["main"]' 530
anon prune_before '[9999999999999999]' 530
anon add_admin "[\"$PUB_ID\",\"self\"]" 530
call upsert_zones '[[{"code":"GB","name":"Great Britain","currency":"GBP","lat":54.0,"lon":-2.0}]]' 530
spacetime call --server "$H" "$DB" add_admin "\"$PUB_ID\"" '"smoke publisher"' >/dev/null 2>&1

call upsert_zones '[[{"code":"GB","name":"Great Britain","currency":"GBP","lat":54.0,"lon":-2.0}]]' 200
call upsert_actuals '[[{"ts_us":1794571200000000,"zone":"GB","series":"price_da","value":82.5,"unit":"GBP/MWh"}]]' 200
call upsert_actuals '[[{"ts_us":1794571200000000,"zone":"GB","series":"price_da","value":83.5,"unit":"GBP/MWh"}]]' 200
call upsert_forecasts '[[{"made_at_us":1794567600000000,"zone":"GB","target":"price_da","ts_us":1794571200000000,"horizon_h":1,"p10":70,"p50":80,"p90":95,"model_version":"smoke"},{"made_at_us":1794564000000000,"zone":"GB","target":"price_da","ts_us":1794571200000000,"horizon_h":2,"p10":60,"p50":75,"p90":99,"model_version":"smoke"}]]' 200
call upsert_forecasts '[[{"made_at_us":1,"zone":"GB","target":"price_da","ts_us":1,"horizon_h":1,"p10":90,"p50":80,"p90":95,"model_version":"smoke"}]]' 530
call set_intervention '["main","hormuz","EU",30,168,"smoke",1.2e9,"GBP","Gas up 30%","{}"]' 200
# The room game stays open to anyone.
anon join '["Ada"]' 200
anon claim_zone '["GB"]' 200
anon decide '[1794571200000000,"charge"]' 200
sql "SELECT * FROM zone" | grep -q XX && { echo "FAIL anonymous write landed" >&2; exit 1; }

sql "SELECT * FROM actual" | grep -q '83.5' || { echo "FAIL actual upsert" >&2; exit 1; }
[ "$(sql "SELECT * FROM latest_forecast" | grep -c smoke)" = 1 ] || { echo "FAIL latest_forecast" >&2; exit 1; }
sql "SELECT * FROM intervention" | grep -q hormuz || { echo "FAIL intervention" >&2; exit 1; }
sql "SELECT * FROM leaderboard" | grep -q Ada || { echo "FAIL leaderboard" >&2; exit 1; }
echo "smoke: PASS"
