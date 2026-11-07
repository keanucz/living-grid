#!/usr/bin/env bash
# Lobby smoke test: start an in-memory SpacetimeDB, publish the module, load a one-day pool, then run two lobbies
# at once (host + two phones each) through countdown, play, reveal and rematch. Needs the spacetime CLI; not in check.sh.
set -euo pipefail
cd "$(dirname "$0")"
PORT=${PORT:-3198}
H=http://127.0.0.1:$PORT
DB=lg-lobby-smoke-$$-$RANDOM  # a fresh name: the CLI keeps old smoke databases between runs

spacetime start --listen-addr "127.0.0.1:$PORT" --in-memory --non-interactive >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
for _ in $(seq 240); do curl -sf -o /dev/null "$H/v1/ping" && break; sleep 0.5; done
(cd module && npm install --no-audit --no-fund --silent && spacetime publish --server "$H" -y "$DB" >/dev/null)

ident() { curl -sf -X POST "$H/v1/identity"; }
field() { python3 -c 'import sys, json; print(json.loads(sys.argv[1])[sys.argv[2]])' "$1" "$2"; }
new_user() { local j; j=$(ident); echo "$(field "$j" token) $(field "$j" identity)"; }
call_as() {
  local tok=$1 code; shift
  code=$(curl -s -o /tmp/lobby_smoke_out -w '%{http_code}' -X POST "$H/v1/database/$DB/call/$1" \
    -H "Authorization: Bearer $tok" -H 'Content-Type: application/json' -d "$2")
  [ "$code" = "$3" ] || { echo "FAIL $1: expected $3, got $code: $(cat /tmp/lobby_smoke_out)" >&2; exit 1; }
}
sql() { spacetime sql --server "$H" "$DB" "$1" 2>/dev/null; }
# Poll until `sql QUERY | grep -c WORD` equals N (the timers are real time, and the machine may be busy).
wait_count() {
  for _ in $(seq 90); do [ "$(sql "$1" | grep -c "$2")" = "$3" ] && return 0; sleep 1; done
  echo "FAIL waiting for $3 x $2 in: $1 -> $(sql "$1")" >&2; exit 1
}

read -r PUB PUB_ID < <(new_user)
spacetime call --server "$H" "$DB" add_admin "\"$PUB_ID\"" '"smoke"' >/dev/null 2>&1

POOL=$(python3 - <<'PY'
import json
qs = [{"id": f"q{i}", "text": f"Question {i}?", "kind": "price_above", "target_hour": 13, "unit": "GBP/MWh", "threshold": 100.0,
       "model_p": 0.6, "model_note": "n", "bot_p": [{"bot": "lgbm_q", "p": 0.6, "note": "n"}, {"bot": "bot_yesterday", "p": 0.4, "note": "n"}],
       "series": "", "profile_json": ""} for i in (1, 2)]
qs[1]["choices"] = [{"id": "low", "label": "Under 80"}, {"id": "mid", "label": "80 to 120"}, {"id": "high", "label": "Over 120"}]
ans = [{"question_id": "q1", "outcome": True, "actual": 120.0}, {"question_id": "q2", "outcome": "mid", "actual": 100.0}]
feed = {str(h): [{"label": "price", "value": 90.0 + h, "unit": "GBP/MWh"}] for h in range(12, 15)}
print(json.dumps(["2026-10-26", "windy", 12, 13, json.dumps(qs), json.dumps(ans), json.dumps(feed), "{}"]))
PY
)
call_as "$PUB" pool_put "$POOL" 200
# Bad pools are refused, and anonymous callers cannot load one.
read -r ANON_T _ < <(new_user)
call_as "$ANON_T" pool_put "$POOL" 530
call_as "$PUB" pool_put '["2026-10-27","stormy",12,13,"[]","[]","{}","{}"]' 530
BAD=$(POOL="$POOL" python3 -c "import json, os; p = json.loads(os.environ['POOL']); q = json.loads(p[4]); q[0]['target_hour'] = 15; p[0] = '2026-10-28'; p[4] = json.dumps(q); print(json.dumps(p))")
call_as "$PUB" pool_put "$BAD" 530

declare -A TOK ID
for u in a_host a_p1 a_p2 b_host b_p1 b_p2; do read -r TOK[$u] ID[$u] < <(new_user); done
call_as "${TOK[a_host]}" lobby_create '["Hosta","turbine","market"]' 200
call_as "${TOK[b_host]}" lobby_create '["Hostb","pylon","market"]' 200
CODE_A=$(sql "SELECT code FROM lobby WHERE id = 1" | tail -1 | tr -d ' "')
CODE_B=$(sql "SELECT code FROM lobby WHERE id = 2" | tail -1 | tr -d ' "')
[ -n "$CODE_A" ] && [ "$CODE_A" != "$CODE_B" ] && [ ${#CODE_A} = 4 ] || { echo "FAIL codes: $CODE_A $CODE_B" >&2; exit 1; }
call_as "${TOK[a_p1]}" lobby_join "[\"${CODE_A,,}\",\"Ann\",\"solar\"]" 200
call_as "${TOK[a_p2]}" lobby_join "[\"$CODE_A\",\"Ben\",\"flame\"]" 200
call_as "${TOK[b_p1]}" lobby_join "[\"$CODE_B\",\"Cat\",\"wave\"]" 200
call_as "${TOK[b_p2]}" lobby_join "[\"$CODE_B\",\"Dan\",\"battery\"]" 200
call_as "${TOK[a_p1]}" lobby_join '["ZZZZ","Nope","solar"]' 530
call_as "${TOK[a_p1]}" lobby_ready '[true]' 200
# Only the host starts or changes settings.
call_as "${TOK[a_p1]}" lobby_start '[]' 530
call_as "${TOK[a_p1]}" lobby_settings '[5,2,true,"market"]' 530
call_as "${TOK[a_host]}" lobby_settings '[5,2,true,"market"]' 200
call_as "${TOK[b_host]}" lobby_settings '[5,2,true,"market"]' 200
call_as "${TOK[a_host]}" lobby_settings '[1,2,true,"market"]' 530
call_as "${TOK[a_host]}" lobby_start '[]' 200
call_as "${TOK[b_host]}" lobby_start '[]' 200
wait_count "SELECT state FROM lobby" playing 2
# Questions, accounts and bots are scoped per lobby.
[ "$(sql 'SELECT id FROM market_question WHERE lobby_id = 1' | grep -c '1|q')" = 2 ] || { echo "FAIL lobby 1 questions" >&2; exit 1; }
[ "$(sql 'SELECT id FROM market_question WHERE lobby_id = 2' | grep -c '2|q')" = 2 ] || { echo "FAIL lobby 2 questions" >&2; exit 1; }
[ "$(sql 'SELECT key FROM market_account WHERE lobby_id = 1' | grep -c '^ "1|')" -ge 5 ] || { echo "FAIL lobby 1 accounts" >&2; exit 1; }
# A player trades in their own lobby only.
call_as "${TOK[a_p1]}" market_buy '["1|q2","mid",20]' 200
call_as "${TOK[a_p1]}" market_buy '["1|q2","yes",20]' 530
call_as "${TOK[a_p1]}" market_buy '["1|q1","yes",20]' 200
call_as "${TOK[a_p1]}" market_sell '["1|q1","yes",30]' 530
call_as "${TOK[a_p1]}" market_sell '["1|q1","yes",5]' 200
call_as "${TOK[a_p1]}" market_buy '["2|q2","mid",20]' 530
call_as "${TOK[b_p1]}" market_buy '["1|q2","mid",20]' 530
sql "SELECT prices_json FROM market_question WHERE id = '1|q2'" | grep -c 'mid' | grep -qv '^0$' || { echo "FAIL choice prices" >&2; exit 1; }
# The day stays hidden while playing.
sql "SELECT * FROM market_round" | grep -c '2026-10-26' | grep -qv '^0$' && { echo "FAIL day leaked" >&2; exit 1; }
wait_count "SELECT state FROM lobby" reveal 2
sql "SELECT * FROM market_round" | grep -c '2026-10-26' | grep -qv '^0$' || { echo "FAIL day not revealed" >&2; exit 1; }
sql "SELECT outcome FROM market_question WHERE lobby_id = 1" | grep -c yes | grep -qv '^0$' || { echo "FAIL settled" >&2; exit 1; }
sql "SELECT outcome FROM market_question WHERE lobby_id = 1" | grep -c mid | grep -qv '^0$' || { echo "FAIL choice settled" >&2; exit 1; }
# Ratings are zero-sum over everyone who played (3 + 3 + 12 bot rows are not shared across lobbies, but bots are): check the sum is unchanged per game.
python3 - "$(sql 'SELECT rating, games FROM profile')" <<'PY'
import sys, re
rows = [tuple(map(float, m)) for m in re.findall(r"^\s*([\d.]+)\s*\|\s*(\d+)", sys.argv[1], re.M)]
assert rows, sys.argv[1]
assert abs(sum(r for r, _ in rows) - 1000.0 * len(rows)) < 0.5, rows
PY
sql "SELECT * FROM meta_leaderboard" | grep -c 'Ann\|Hosta\|Ben' | grep -qv '^0$' || { echo "FAIL meta leaderboard: $(sql 'SELECT * FROM meta_leaderboard')" >&2; exit 1; }
# One result row per person and bot (3 people + 6 bots), ranked, on round 1.
[ "$(sql 'SELECT rank FROM game_result WHERE lobby_id = 1 AND round_no = 1' | grep -c '^ [0-9]')" = 9 ] || { echo "FAIL game_result rows: $(sql 'SELECT * FROM game_result WHERE lobby_id = 1')" >&2; exit 1; }
sql "SELECT round_no FROM lobby WHERE id = 1" | grep -c '^ 1 ' | grep -qv '^0$' || { echo "FAIL round_no" >&2; exit 1; }
sql "SELECT mode, day FROM game_result WHERE lobby_id = 1" | grep -c 'market.*2026-10-26' | grep -qv '^0$' || { echo "FAIL result mode/day" >&2; exit 1; }
call_as "${TOK[a_p1]}" lobby_rematch '[]' 530
call_as "${TOK[a_host]}" lobby_rematch '[]' 200
sql "SELECT id, state FROM lobby WHERE id = 1" | grep -c waiting | grep -qv '^0$' || { echo "FAIL rematch" >&2; exit 1; }
[ "$(sql 'SELECT id FROM market_question WHERE lobby_id = 1' | grep -c '|')" = 0 ] || { echo "FAIL rematch cleared" >&2; exit 1; }
[ "$(sql 'SELECT key FROM lobby_player WHERE lobby_id = 1' | grep -c '^ "1|')" = 3 ] || { echo "FAIL players kept" >&2; exit 1; }
call_as "${TOK[a_p2]}" lobby_leave '[]' 200
call_as "${TOK[a_host]}" lobby_kick "[\"${ID[a_p1]}\"]" 200
call_as "${TOK[a_host]}" lobby_leave '[]' 200
sql "SELECT id FROM lobby" | grep -c '^ 1 ' | grep -qv '^0$' && { echo "FAIL empty lobby kept" >&2; exit 1; }

# Battery mode: a lobby with two phones and both agents, 3 half-hours, priced low, high, high.
BP=$(python3 - <<'PY'
import json
print(json.dumps(["2026-10-26", "windy", 24, 3, json.dumps([40.0, 200.0, 200.0]),
                  json.dumps({"risk_aware": ["charge", "discharge", "discharge"], "median_only": ["hold", "hold", "hold"]})]))
PY
)
call_as "$PUB" battery_pool_put "$BP" 200
call_as "$PUB" battery_pool_put '["2026-10-27","windy",47,3,"[1,2,3]","{}"]' 530
read -r BT BID < <(new_user); read -r CT CID < <(new_user)
call_as "$BT" lobby_create '["Bea","wave","battery"]' 200
LB=$(sql "SELECT id FROM lobby WHERE mode = 'battery'" | tail -1 | tr -d ' ')
CODE_C=$(sql "SELECT code FROM lobby WHERE id = $LB" | tail -1 | tr -d ' "')
sql "SELECT seconds_per_hour FROM lobby WHERE id = $LB" | grep -c '^ 10 ' | grep -qv '^0$' || { echo "FAIL battery default speed" >&2; exit 1; }
call_as "$CT" lobby_join "[\"$CODE_C\",\"Cy\",\"pylon\"]" 200
call_as "$BT" lobby_settings '[5,2,true,"battery"]' 200
call_as "$BT" lobby_start '[]' 200
wait_count "SELECT state FROM lobby WHERE id = $LB" playing 1
[ "$(sql "SELECT key FROM battery_player WHERE lobby_id = $LB" | grep -c "^ \"$LB|")" = 4 ] || { echo "FAIL battery players + agents" >&2; exit 1; }
call_as "$BT" battery_decide '[0,"charge"]' 200
call_as "$BT" battery_decide '[1,"discharge"]' 200
call_as "$CT" battery_decide '[2,"hold"]' 200
call_as "$CT" battery_decide '[2,"offer:discharge:999:50"]' 200
call_as "$CT" battery_decide '[1,"charge:50"]' 200
call_as "$CT" battery_decide '[1,"charge:500"]' 530
call_as "$CT" battery_decide '[1,"offer:charge:5"]' 530
call_as "$CT" battery_decide '[9,"hold"]' 530
call_as "$CT" battery_decide '[0,"explode"]' 530
call_as "$PUB" battery_decide '[0,"hold"]' 530
wait_count "SELECT state FROM lobby WHERE id = $LB" reveal 1
sql "SELECT * FROM battery_round WHERE lobby_id = $LB" | grep -c '2026-10-26' | grep -qv '^0$' || { echo "FAIL battery day not revealed" >&2; exit 1; }
[ "$(sql "SELECT slot FROM battery_slot WHERE lobby_id = $LB" | grep -c '^ [0-2] ')" = 3 ] || { echo "FAIL battery slots" >&2; exit 1; }
# Bea bought 0.5 MWh at 40 (-21) and sold 0.5 MWh at 200 (+99): 78. The median-only agent held all round: zero.
sql "SELECT name, pnl FROM battery_player WHERE lobby_id = $LB" | grep -E 'Bea|Median' | tr -s ' ' | tr '\n' ';' | grep -q 'Median-only agent" | 0' || { echo "FAIL median agent pnl: $(sql "SELECT name, pnl FROM battery_player WHERE lobby_id = $LB")" >&2; exit 1; }
BEA=$(sql "SELECT pnl FROM battery_player WHERE name = 'Bea'" | tail -1 | tr -d ' ')
python3 -c "import sys; sys.exit(0 if abs(float(sys.argv[1]) - 78.0) < 0.01 else 1)" "$BEA" || { echo "FAIL Bea pnl $BEA" >&2; exit 1; }

# Quick play: first waits, second makes a lobby with a 30 s countdown, third joins it; votes decide.
read -r Q1 Q1ID < <(new_user); read -r Q2 Q2ID < <(new_user); read -r Q3 Q3ID < <(new_user)
call_as "$Q1" quick_play '["Quin","solar","market"]' 200
sql "SELECT name FROM quick_queue" | grep -c Quin | grep -qv '^0$' || { echo "FAIL queued" >&2; exit 1; }
call_as "$Q1" quick_play '["Quin","solar","market"]' 200
call_as "$Q2" quick_play '["Quill","flame","market"]' 200
QL=$(sql "SELECT id FROM lobby WHERE kind = 'quick'" | tail -1 | tr -d ' ')
sql "SELECT state, countdown_s FROM lobby WHERE id = $QL" | grep -c 'countdown" *| 30' | grep -qv '^0$' || { echo "FAIL quick countdown: $(sql "SELECT * FROM lobby WHERE id = $QL")" >&2; exit 1; }
[ "$(sql 'SELECT name FROM quick_queue' | grep -c '^ "')" = 0 ] || { echo "FAIL queue not emptied" >&2; exit 1; }
call_as "$Q3" quick_play '["Quen","wave","market"]' 200
[ "$(sql "SELECT key FROM lobby_player WHERE lobby_id = $QL" | grep -c "^ \"$QL|")" = 3 ] || { echo "FAIL quick joined" >&2; exit 1; }
call_as "$Q1" lobby_vote '["bogus"]' 530
call_as "$PUB" lobby_vote '["start"]' 530
call_as "$Q1" lobby_vote '["wait"]' 200
call_as "$Q2" lobby_vote '["wait"]' 200
sql "SELECT countdown_s FROM lobby WHERE id = $QL" | grep -c '^ 30 ' | grep -qv '^0$' || { echo "FAIL wait reset" >&2; exit 1; }
[ "$(sql "SELECT key FROM lobby_ballot WHERE lobby_id = $QL" | grep -c "^ \"$QL|")" = 0 ] || { echo "FAIL votes cleared on reset" >&2; exit 1; }
call_as "$Q1" lobby_vote '["start"]' 200
call_as "$Q2" lobby_vote '["start"]' 200
sql "SELECT countdown_s FROM lobby WHERE id = $QL" | grep -c '^ 1 ' | grep -qv '^0$' || { echo "FAIL start now" >&2; exit 1; }
wait_count "SELECT state FROM lobby WHERE id = $QL" playing 1
call_as "$Q3" lobby_vote '["start"]' 530
wait_count "SELECT state FROM lobby WHERE id = $QL" reveal 1
[ "$(sql "SELECT rank FROM game_result WHERE lobby_id = $QL" | grep -c '^ [0-9]')" = 9 ] || { echo "FAIL quick results" >&2; exit 1; }
sql "SELECT games FROM profile WHERE name = 'Quin'" | grep -c '^ 1 ' | grep -qv '^0$' || { echo "FAIL quick profile" >&2; exit 1; }
call_as "$Q1" profile_set '["Quin the great","pylon"]' 200
sql "SELECT name FROM profile WHERE name = 'Quin the great'" | grep -c Quin | grep -qv '^0$' || { echo "FAIL profile_set" >&2; exit 1; }
echo "lobby smoke: PASS"
