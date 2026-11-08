#!/usr/bin/env bash
# Solo markets smoke test: in-memory SpacetimeDB, a 2-market day, a solo game through two ticks. Checks the quotes and the
# spread, settlement, that outcomes and the day stay hidden until each market closes, and what anonymous clients can read.
set -euo pipefail
cd "$(dirname "$0")"
PORT=${PORT:-3311}
H=http://127.0.0.1:$PORT
DB=lg-pm-smoke-$$-$RANDOM

spacetime start --listen-addr "127.0.0.1:$PORT" --in-memory --non-interactive >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
for _ in $(seq 240); do curl -sf -o /dev/null "$H/v1/ping" && break; sleep 0.5; done
(cd module && npm install --no-audit --no-fund --silent && spacetime publish --server "$H" -y "$DB" >/dev/null)

field() { python3 -c 'import sys, json; print(json.loads(sys.argv[1])[sys.argv[2]])' "$1" "$2"; }
new_user() { local j; j=$(curl -sf -X POST "$H/v1/identity"); echo "$(field "$j" token) $(field "$j" identity)"; }
call_as() {
  local tok=$1 code; shift
  code=$(curl -s -o /tmp/pm_smoke_out -w '%{http_code}' -X POST "$H/v1/database/$DB/call/$1" -H "Authorization: Bearer $tok" -H 'Content-Type: application/json' -d "$2")
  [ "$code" = "$3" ] || { echo "FAIL $1 $2: expected $3, got $code: $(cat /tmp/pm_smoke_out)" >&2; exit 1; }
}
sql() { spacetime sql --server "$H" "$DB" "$1" 2>/dev/null; }
count() { sql "$1" | tail -n +3 | grep -c "$2" || true; }
wait_for() { for _ in $(seq 90); do [ "$(count "$1" "$2")" = "$3" ] && return 0; sleep 1; done; echo "FAIL waiting for $3 x $2 in $1: $(sql "$1")" >&2; exit 1; }

read -r PUB PUB_ID < <(new_user)
spacetime call --server "$H" "$DB" add_admin "\"$PUB_ID\"" '"smoke"' >/dev/null 2>&1
read -r ANON _ < <(new_user)

DAY=$(python3 - <<'PY'
import json
ms = [
  {"id": "m1", "text": "Will A happen?", "kind": "price", "unit": "GBP/MWh", "close_hour": 13, "model_note": "note 1", "outcome": "yes",
   "actual_text": "Yes: it was 120", "prices": {"12": 40}, "reasons": {"12": "Opening price"}, "bots": {"lgbm_q": 0.9}},
  {"id": "m2", "text": "Will B happen?", "kind": "price", "unit": "GBP/MWh", "close_hour": 14, "model_note": "note 2", "outcome": "no",
   "actual_text": "No: it was 80", "prices": {"12": 60, "13": 70}, "reasons": {"12": "Opening price", "13": "B came in high"}, "bots": {"bot_yesterday": 0.2}},
]
print(json.dumps(["2026-10-26", "windy", 12, 14, json.dumps(ms)]))
PY
)
call_as "$ANON" pm_day_put "$DAY" 530
BAD=$(DAY="$DAY" python3 -c "import json, os; d = json.loads(os.environ['DAY']); m = json.loads(d[4]); m[0]['close_hour'] = 15; d[4] = json.dumps(m); print(json.dumps(d))")
call_as "$PUB" pm_day_put "$BAD" 530
BAD2=$(DAY="$DAY" python3 -c "import json, os; d = json.loads(os.environ['DAY']); m = json.loads(d[4]); m[1]['prices']['13'] = 0; d[4] = json.dumps(m); print(json.dumps(d))")
call_as "$PUB" pm_day_put "$BAD2" 530
call_as "$PUB" pm_day_put "$DAY" 200
anon_status() { curl -s -o /dev/null -w '%{http_code}' -X POST "$H/v1/database/$DB/sql" -H "Authorization: Bearer $ANON" -d "$1"; }
for t in pm_day pm_secret; do [ "$(anon_status "SELECT * FROM $t")" != 200 ] || { echo "FAIL $t readable by anonymous" >&2; exit 1; }; done

read -r U UID_ < <(new_user); read -r V _ < <(new_user)
call_as "$U" pm_buy '[1,"m1","yes",1]' 530                      # no game yet
call_as "$U" pm_start '["Una","solar"]' 200
G=$(sql "SELECT id FROM pm_game" | tail -1 | tr -d ' ')
[ "$(count "SELECT key FROM pm_account WHERE game_id = $G" "^ \"$G|")" = 5 ] || { echo "FAIL accounts (1 person + 4 bots)" >&2; exit 1; }
[ "$(count "SELECT key FROM pm_market WHERE game_id = $G" "^ \"$G|")" = 2 ] || { echo "FAIL markets" >&2; exit 1; }
[ "$(count "SELECT price_yes FROM pm_market WHERE game_id = $G AND market_id = 'm1'" '^ 40 ')" = 1 ] || { echo "FAIL opening price" >&2; exit 1; }
# Hidden until close: no outcome, no actual text, no day.
[ "$(count "SELECT outcome FROM pm_market WHERE game_id = $G AND status = 'open'" '^ "[a-z]')" = 0 ] || { echo "FAIL outcome leaked" >&2; exit 1; }
[ "$(count "SELECT actual_text FROM pm_market WHERE game_id = $G" 'it was')" = 0 ] || { echo "FAIL actual leaked" >&2; exit 1; }
[ "$(count "SELECT day_revealed FROM pm_game WHERE id = $G" '2026')" = 0 ] || { echo "FAIL day leaked" >&2; exit 1; }
[ "$(count "SELECT price_yes FROM pm_price WHERE game_id = $G" '^ [0-9]')" = 2 ] || { echo "FAIL price history starts with the opening prices" >&2; exit 1; }
# The two bots with a belief traded at the open, at the quote.
[ "$(count "SELECT seq FROM pm_trade WHERE game_id = $G" '^ [0-9]')" = 2 ] || { echo "FAIL bot trades: $(sql "SELECT * FROM pm_trade WHERE game_id = $G")" >&2; exit 1; }

# Trading: buy YES at the ask (41), sell it back at the bid (39): the spread costs 0.20 points on 10 shares.
call_as "$U" pm_buy "[$G,\"m1\",\"yes\",10]" 200
[ "$(count "SELECT points FROM pm_account WHERE game_id = $G AND identity = 0x$UID_" '^ 995.9 ')" = 1 ] || { echo "FAIL buy cost: $(sql "SELECT * FROM pm_account WHERE game_id = $G")" >&2; exit 1; }
call_as "$U" pm_sell "[$G,\"m1\",\"yes\",10]" 200
[ "$(count "SELECT points FROM pm_account WHERE game_id = $G AND identity = 0x$UID_" '^ 999.8 ')" = 1 ] || { echo "FAIL spread: $(sql "SELECT * FROM pm_account WHERE game_id = $G")" >&2; exit 1; }
call_as "$U" pm_buy "[$G,\"m2\",\"no\",5]" 200                  # NO ask = 100 - (60 - 1) = 41
[ "$(count "SELECT points FROM pm_account WHERE game_id = $G AND identity = 0x$UID_" '^ 997.75 ')" = 1 ] || { echo "FAIL no cost" >&2; exit 1; }
call_as "$U" pm_buy "[$G,\"m1\",\"yes\",0]" 530
call_as "$U" pm_buy "[$G,\"m1\",\"yes\",501]" 530
call_as "$U" pm_sell "[$G,\"m1\",\"yes\",1]" 530                # holds none
call_as "$U" pm_buy "[$G,\"zzz\",\"yes\",1]" 530
call_as "$U" pm_buy "[$G,\"m1\",\"maybe\",1]" 530
call_as "$V" pm_buy "[$G,\"m1\",\"yes\",1]" 530                 # not their game
call_as "$U" pm_buy "[$G,\"m1\",\"yes\",500]" 200
call_as "$U" pm_buy "[$G,\"m1\",\"yes\",500]" 530               # over the per-market cap
call_as "$U" pm_sell "[$G,\"m1\",\"yes\",500]" 200

# Tick 1: m1 closes (outcome yes revealed), m2 moves to 70 with its reason.
wait_for "SELECT status FROM pm_market WHERE game_id = $G AND market_id = 'm1'" 'closed' 1
[ "$(count "SELECT outcome FROM pm_market WHERE game_id = $G AND market_id = 'm1'" '"yes"')" = 1 ] || { echo "FAIL m1 outcome" >&2; exit 1; }
[ "$(count "SELECT outcome FROM pm_market WHERE game_id = $G AND market_id = 'm2'" '^ ""')" = 1 ] || { echo "FAIL m2 outcome hidden" >&2; exit 1; }
[ "$(count "SELECT price_yes, note FROM pm_market WHERE game_id = $G AND market_id = 'm2'" '70.*came in high')" = 1 ] || { echo "FAIL m2 moved: $(sql "SELECT * FROM pm_market WHERE game_id = $G")" >&2; exit 1; }
[ "$(count "SELECT hour FROM pm_price WHERE game_id = $G AND market_id = 'm2'" '^ 1[23] ')" = 2 ] || { echo "FAIL price history m2" >&2; exit 1; }
call_as "$U" pm_buy "[$G,\"m1\",\"yes\",1]" 530                 # closed
# Tick 2: m2 closes (no), the game ends and the day is revealed. NO shares pay 5 points (997.75 - 10 lost to the spread on the 500-share round trip + 5).
wait_for "SELECT state FROM pm_game WHERE id = $G" 'done' 1
[ "$(count "SELECT points FROM pm_account WHERE game_id = $G AND identity = 0x$UID_" '^ 992.75 ')" = 1 ] || { echo "FAIL settlement: $(sql "SELECT * FROM pm_account WHERE game_id = $G")" >&2; exit 1; }
[ "$(count "SELECT day_revealed FROM pm_game WHERE id = $G" '2026-10-26')" = 1 ] || { echo "FAIL day revealed" >&2; exit 1; }
[ "$(count "SELECT rank FROM game_result WHERE mode = 'pm'" '^ [0-9]')" = 5 ] || { echo "FAIL results" >&2; exit 1; }
[ "$(count "SELECT games FROM profile WHERE name = 'Una'" '^ 1 ')" = 1 ] || { echo "FAIL profile" >&2; exit 1; }
call_as "$U" pm_buy "[$G,\"m2\",\"yes\",1]" 530
call_as "$U" pm_leave "[$G]" 200
[ "$(count "SELECT id FROM pm_game" '^ [0-9]')" = 0 ] || { echo "FAIL leave clears the game" >&2; exit 1; }

# ---- a room plays the markets: two people and the bots share one game and one clock
read -r R1 R1ID < <(new_user); read -r R2 R2ID < <(new_user)
call_as "$R1" lobby_create '["Rhea","turbine","pm"]' 200
L=$(sql "SELECT id FROM lobby WHERE mode = 'pm'" | tail -1 | tr -d ' ')
CODE=$(sql "SELECT code FROM lobby WHERE id = $L" | tail -1 | tr -d ' "')
call_as "$R2" lobby_join "[\"$CODE\",\"Rory\",\"wave\"]" 200
call_as "$R1" lobby_start '[]' 200
wait_for "SELECT state FROM lobby WHERE id = $L" playing 1
RG=$(sql "SELECT game_id FROM pm_room WHERE lobby_id = $L" | tail -1 | tr -d ' ')
[ -n "$RG" ] || { echo "FAIL no pm_room row" >&2; exit 1; }
[ "$(count "SELECT key FROM pm_account WHERE game_id = $RG" "^ \"$RG|")" = 6 ] || { echo "FAIL room accounts (2 people + 4 bots)" >&2; exit 1; }
call_as "$R1" pm_buy "[$RG,\"m1\",\"yes\",10]" 200
call_as "$R2" pm_buy "[$RG,\"m1\",\"no\",7]" 200                # each trades on their own account at the same price
call_as "$U" pm_buy "[$RG,\"m1\",\"yes\",1]" 530                 # a stranger cannot trade in the room's game
call_as "$PUB" pm_buy "[$RG,\"m1\",\"yes\",1]" 530
[ "$(count "SELECT points FROM pm_account WHERE game_id = $RG AND identity = 0x$R1ID" '^ 995.9 ')" = 1 ] || { echo "FAIL R1 points: $(sql "SELECT * FROM pm_account WHERE game_id = $RG")" >&2; exit 1; }
[ "$(count "SELECT points FROM pm_account WHERE game_id = $RG AND identity = 0x$R2ID" '^ 995.73 ')" = 1 ] || { echo "FAIL R2 points" >&2; exit 1; }
call_as "$R1" pm_leave "[$RG]" 200                                 # leaving a room game goes through the lobby, not pm_leave
[ "$(count "SELECT id FROM pm_game WHERE id = $RG" '^ [0-9]')" = 1 ] || { echo "FAIL pm_leave must not clear a room game" >&2; exit 1; }
call_as "$R1" pm_start '["Rhea","turbine"]' 200                     # a solo game next to the room's game leaves the room's alone
[ "$(count "SELECT id FROM pm_game WHERE id = $RG" '^ [0-9]')" = 1 ] || { echo "FAIL pm_start cleared the room game" >&2; exit 1; }
call_as "$R1" pm_leave "[$(sql "SELECT id FROM pm_game WHERE owner = 0x$R1ID" | tail -n +3 | tr -d ' ' | grep -v "^$RG$" | head -1)]" 200
call_as "$ANON" lobby_join "[\"$CODE\",\"Late\",\"flame\"]" 530      # no joining a running room game
wait_for "SELECT state FROM lobby WHERE id = $L" reveal 1
[ "$(count "SELECT rank FROM game_result WHERE mode = 'pm' AND lobby_id = $L" '^ [0-9]')" = 6 ] || { echo "FAIL room results" >&2; exit 1; }
[ "$(count "SELECT day_revealed FROM pm_game WHERE id = $RG" '2026-10-26')" = 1 ] || { echo "FAIL room day revealed" >&2; exit 1; }
call_as "$R2" lobby_rematch '[]' 530
call_as "$R1" lobby_rematch '[]' 200
[ "$(count "SELECT game_id FROM pm_room WHERE lobby_id = $L" '^ [0-9]')" = 0 ] || { echo "FAIL rematch clears the room game" >&2; exit 1; }
[ "$(count "SELECT id FROM pm_game WHERE id = $RG" '^ [0-9]')" = 0 ] || { echo "FAIL room game still there after rematch" >&2; exit 1; }
echo "pm smoke: PASS"
