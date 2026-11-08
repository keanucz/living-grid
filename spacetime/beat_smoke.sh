#!/usr/bin/env bash
# Beat the model smoke test: in-memory SpacetimeDB, a 3-call day, a solo game (early reveal, a timed-out call, the end)
# and a two-person lobby game. Checks nothing leaks before a reveal. Needs the spacetime CLI; not part of check.sh.
set -euo pipefail
cd "$(dirname "$0")"
PORT=${PORT:-3299}
H=http://127.0.0.1:$PORT
DB=lg-beat-smoke-$$-$RANDOM

spacetime start --listen-addr "127.0.0.1:$PORT" --in-memory --non-interactive >/dev/null 2>&1 &
SERVER=$!
OUT=$(mktemp)
trap 'kill $SERVER 2>/dev/null || true; rm -f "$OUT"' EXIT
for _ in $(seq 240); do curl -sf -o /dev/null "$H/v1/ping" && break; sleep 0.5; done
(cd module && npm install --no-audit --no-fund --silent && spacetime publish --server "$H" -y "$DB" >/dev/null)

field() { python3 -c 'import sys, json; print(json.loads(sys.argv[1])[sys.argv[2]])' "$1" "$2"; }
new_user() { local j; j=$(curl -sf -X POST "$H/v1/identity"); echo "$(field "$j" token) $(field "$j" identity)"; }
call_as() {
  local tok=$1 code; shift
  code=$(curl -s -o "$OUT" -w '%{http_code}' -X POST "$H/v1/database/$DB/call/$1" -H "Authorization: Bearer $tok" -H 'Content-Type: application/json' -d "$2")
  [ "$code" = "$3" ] || { echo "FAIL $1: expected $3, got $code: $(cat "$OUT")" >&2; exit 1; }
}
sql() { spacetime sql --server "$H" "$DB" "$1" 2>/dev/null; }
count() { sql "$1" | grep -c "$2" || true; }
wait_for() { for _ in $(seq "${WAIT_N:-90}"); do [ "$(count "$1" "$2")" = "$3" ] && return 0; sleep 1; done; echo "FAIL waiting for $3 x $2 in $1: $(sql "$1")" >&2; exit 1; }

read -r PUB PUB_ID < <(new_user)
spacetime call --server "$H" "$DB" add_admin "\"$PUB_ID\"" '"smoke"' >/dev/null 2>&1
read -r ANON _ < <(new_user)

DAY=$(python3 - <<'PY'
import json
def call(i, answer):
    return {"id": f"c{i}", "kind": "price_band", "text": f"Call {i}?", "hour": 12 + i, "unit": "GBP/MWh",
            "options": [{"id": "a", "label": "A"}, {"id": "b", "label": "B"}, {"id": "c", "label": "C"}],
            "answer": answer, "actual_text": f"It was {answer}.",
            "model": {"choice": "a", "confidence": 70, "reason": f"Because of reason {i}"},
            "bots": {"lgbm_q": {"choice": "a", "confidence": 70}, "bot_yesterday": {"choice": "b", "confidence": 60}}}
print(json.dumps(["2026-10-26", "windy", json.dumps([call(0, "a"), call(1, "b"), call(2, "c")])]))
PY
)
call_as "$ANON" beat_day_put "$DAY" 530
call_as "$PUB" beat_day_put '["2026-10-26","stormy","[]"]' 530
call_as "$PUB" beat_day_put '["2026-10-26","windy","[]"]' 530
BAD=$(DAY="$DAY" python3 -c "import json, os; d = json.loads(os.environ['DAY']); c = json.loads(d[2]); c[0]['answer'] = 'zzz'; d[2] = json.dumps(c); print(json.dumps(d))")
call_as "$PUB" beat_day_put "$BAD" 530
BAD2=$(DAY="$DAY" python3 -c "import json, os; d = json.loads(os.environ['DAY']); c = json.loads(d[2]); c[1]['bots']['lgbm_q']['confidence'] = 20; d[2] = json.dumps(c); print(json.dumps(d))")
call_as "$PUB" beat_day_put "$BAD2" 530
call_as "$PUB" beat_day_put "$DAY" 200
anon_sql() { curl -s -o /dev/null -w '%{http_code}' -X POST "$H/v1/database/$DB/sql" -H "Authorization: Bearer $ANON" -d "$1"; }
for t in beat_day beat_pick beat_secret; do [ "$(anon_sql "SELECT * FROM $t")" != 200 ] || { echo "FAIL $t readable by anonymous" >&2; exit 1; }; done

# ---- solo game
read -r U UID_ < <(new_user)
call_as "$U" beat_answer '[1,0,"a",70]' 530   # no game yet
call_as "$U" beat_start '["Una","solar"]' 200
G=$(sql "SELECT id FROM beat_game" | tail -1 | tr -d ' ')
[ "$(count "SELECT key FROM beat_player WHERE game_id = $G" "^ \"$G|")" = 5 ] || { echo "FAIL players (1 person + 4 bots)" >&2; exit 1; }
[ "$(count "SELECT key FROM beat_call WHERE game_id = $G" "^ \"$G|")" = 3 ] || { echo "FAIL calls" >&2; exit 1; }
# Nothing revealed yet: no answer, reason or bot call in the public rows, and no results.
[ "$(sql "SELECT answer, model_reason, bots_json, actual_text FROM beat_call WHERE game_id = $G" | tail -n +3 | grep -c 'reason\|It was\|lgbm_q')" = 0 ] || { echo "FAIL leak before reveal" >&2; exit 1; }
[ "$(count "SELECT key FROM beat_result WHERE game_id = $G" "^ \"")" = 0 ] || { echo "FAIL results before reveal" >&2; exit 1; }
call_as "$U" beat_answer "[$G,1,\"a\",70]" 530      # not the open call
call_as "$U" beat_answer "[$G,0,\"z\",70]" 530      # not an option
call_as "$U" beat_answer "[$G,0,\"a\",40]" 530      # below 50
call_as "$U" beat_answer "[$G,0,\"a\",101]" 530
call_as "$PUB" beat_answer "[$G,0,\"a\",70]" 530    # not in this game
call_as "$U" beat_answer "[$G,0,\"a\",80]" 200      # the only person answered: reveals at once
wait_for "SELECT revealed FROM beat_call WHERE game_id = $G AND idx = 0" true 1
sql "SELECT model_reason FROM beat_call WHERE game_id = $G AND idx = 0" | grep -c 'reason 0' | grep -qv '^0$' || { echo "FAIL reason revealed" >&2; exit 1; }
[ "$(sql "SELECT model_reason FROM beat_call WHERE game_id = $G AND idx = 1" | tail -n +3 | grep -c 'reason')" = 0 ] || { echo "FAIL call 1 leaked" >&2; exit 1; }
[ "$(count "SELECT key FROM beat_result WHERE game_id = $G AND idx = 0" "^ \"")" = 5 ] || { echo "FAIL 5 results" >&2; exit 1; }
# Una was right at 80% on a 3-option call: Brier 0.0600 relative to 0.6667 -> 91.0. A wrong bot at 60% scores negative.
sql "SELECT score FROM beat_result WHERE game_id = $G AND idx = 0 AND correct = true" | grep -c '91' | grep -qv '^0$' || { echo "FAIL score: $(sql "SELECT * FROM beat_result WHERE game_id = $G AND idx = 0")" >&2; exit 1; }
[ "$(count "SELECT key FROM beat_pick WHERE game_id = $G" "^ \"$G|")" = 0 ] || { echo "FAIL picks not cleared" >&2; exit 1; }
# Call 1 opens after the reveal pause; leave it unanswered: it times out with 0.
wait_for "SELECT state, call_no FROM beat_game WHERE id = $G" 'answering" *| 1' 1
wait_for "SELECT revealed FROM beat_call WHERE game_id = $G AND idx = 1" true 1
[ "$(sql "SELECT score FROM beat_result WHERE game_id = $G AND idx = 1 AND choice = '' AND identity = 0x$UID_" | grep -c '^ 0')" = 1 ] || { echo "FAIL timed-out call scores 0" >&2; exit 1; }
wait_for "SELECT state, call_no FROM beat_game WHERE id = $G" 'answering" *| 2' 1
call_as "$U" beat_answer "[$G,2,\"c\",95]" 200
wait_for "SELECT state FROM beat_game WHERE id = $G" done 1
# Sweep (#249): right after the end the answer rows are still there.
[ "$(count "SELECT key FROM beat_call WHERE game_id = $G" "^ \"$G|")" = 3 ] || { echo "FAIL calls gone right after the end" >&2; exit 1; }
[ "$(count "SELECT key FROM beat_result WHERE game_id = $G" "^ \"$G|")" = 15 ] || { echo "FAIL results gone right after the end" >&2; exit 1; }
sql "SELECT day_revealed FROM beat_game WHERE id = $G" | grep -c '2026-10-26' | grep -qv '^0$' || { echo "FAIL day revealed" >&2; exit 1; }
[ "$(count "SELECT rank FROM game_result WHERE mode = 'beat'" "^ [0-9]")" = 5 ] || { echo "FAIL game_result" >&2; exit 1; }
sql "SELECT games FROM profile WHERE name = 'Una'" | grep -c '^ 1 ' | grep -qv '^0$' || { echo "FAIL profile" >&2; exit 1; }
call_as "$U" beat_answer "[$G,2,\"c\",95]" 530      # game over

# ---- lobby game, two people, no bots
read -r H1 H1ID < <(new_user); read -r H2 H2ID < <(new_user)
call_as "$H1" lobby_create '["Hosta","turbine","beat"]' 200
L=$(sql "SELECT id FROM lobby WHERE mode = 'beat'" | tail -1 | tr -d ' ')
CODE=$(sql "SELECT code FROM lobby WHERE id = $L" | tail -1 | tr -d ' "')
call_as "$H2" lobby_join "[\"$CODE\",\"Hosto\",\"wave\"]" 200
call_as "$H1" lobby_settings '[30,6,false,"beat"]' 200
call_as "$H1" lobby_start '[]' 200
wait_for "SELECT state FROM lobby WHERE id = $L" playing 1
G2=$(sql "SELECT id FROM beat_game WHERE lobby_id = $L" | tail -1 | tr -d ' ')
[ "$(count "SELECT key FROM beat_player WHERE game_id = $G2" "^ \"$G2|")" = 2 ] || { echo "FAIL lobby players (bots off)" >&2; exit 1; }
call_as "$H1" beat_answer "[$G2,0,\"b\",90]" 200
call_as "$H1" beat_answer "[$G2,0,\"a\",60]" 200   # changed my mind before the other answered
[ "$(count "SELECT revealed FROM beat_call WHERE game_id = $G2 AND idx = 0" true)" = 0 ] || { echo "FAIL revealed before everyone answered" >&2; exit 1; }
call_as "$H2" beat_answer "[$G2,0,\"b\",90]" 200
wait_for "SELECT revealed FROM beat_call WHERE game_id = $G2 AND idx = 0" true 1
wait_for "SELECT call_no FROM beat_game WHERE id = $G2" '^ 1 ' 1
for i in 1 2; do
  call_as "$H1" beat_answer "[$G2,$i,\"a\",60]" 200
  call_as "$H2" beat_answer "[$G2,$i,\"a\",60]" 200
  [ "$i" = 2 ] || wait_for "SELECT call_no FROM beat_game WHERE id = $G2" "^ $((i+1)) " 1
done
wait_for "SELECT state FROM lobby WHERE id = $L" reveal 1
call_as "$H1" lobby_rematch '[]' 200
[ "$(count "SELECT id FROM beat_game WHERE lobby_id = $L" "^ [0-9]")" = 0 ] || { echo "FAIL rematch clears the game" >&2; exit 1; }
# Sweep (#249): 180 s after the end the solo game keeps its game, players and standings but loses calls, results and picks.
WAIT_N=240 wait_for "SELECT key FROM beat_call WHERE game_id = $G" "^ \"$G|" 0
[ "$(count "SELECT key FROM beat_result WHERE game_id = $G" "^ \"$G|")" = 0 ] || { echo "FAIL sweep left beat_result" >&2; exit 1; }
[ "$(count "SELECT key FROM beat_pick WHERE game_id = $G" "^ \"$G|")" = 0 ] || { echo "FAIL sweep left beat_pick" >&2; exit 1; }
[ "$(count "SELECT id FROM beat_game WHERE id = $G" "^ $G ")" = 1 ] || { echo "FAIL sweep removed the game" >&2; exit 1; }
[ "$(count "SELECT key FROM beat_player WHERE game_id = $G" "^ \"$G|")" = 5 ] || { echo "FAIL sweep removed the players" >&2; exit 1; }
[ "$(count "SELECT rank FROM game_result WHERE mode = 'beat'" "^ [0-9]")" -ge 5 ] || { echo "FAIL sweep removed game_result" >&2; exit 1; }
echo "beat smoke: PASS"
