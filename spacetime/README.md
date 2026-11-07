# SpacetimeDB module

SpacetimeDB 2.14 TypeScript module: the live shared state every screen subscribes to. Owned by lane B.

```
module/src/tables.ts            all tables
module/src/schema.ts            schema() (case conversion off: wire names are exactly as written)
module/src/views.ts             latest_forecast, leaderboard
module/src/reducers/publish.ts  upsert_* reducers for the Python publisher, set_intervention, prune_before
module/src/reducers/game.ts     room game: join, claim_zone, decide (settlement lands in #64)
generate.sh                     type-check and regenerate web/src/spacetime/ bindings
```

## Run it locally

```
cd spacetime/module && npm install && spacetime build
spacetime start --listen-addr 127.0.0.1:3000 --in-memory          # separate terminal
spacetime publish --server local -y living-grid                    # from spacetime/module
./generate.sh                                                      # after any schema change
```

The generated bindings in `web/src/spacetime/` are committed; never edit them by hand.

## Calling reducers over HTTP (Python publisher)

```
POST {host}/v1/identity                               -> {"identity": "...", "token": "..."}
POST {host}/v1/database/{db}/call/{reducer}
     Authorization: Bearer {token}
     Content-Type: application/json
     body: JSON array of the reducer's arguments, positional
```

200 means committed. A rejected call (validation) returns 530 with the error text as the body; 400 means the JSON did not match the argument types.

Conventions:

- All names are snake_case on the wire, identical to the parquet columns.
- Timestamps go in as integers, microseconds since the Unix epoch, UTC, in fields ending `_us`. They are stored as SpacetimeDB timestamps.
- Every `upsert_*` reducer takes one argument, `rows`, an array of objects, so the body is `[[{...}, {...}]]`. Rows are upserted on their natural key, so resending is safe. Keep each call to a few thousand rows.
- Floats must be finite (no NaN). Integers are plain JSON numbers.

| Reducer | Arguments | Natural key |
|---|---|---|
| `upsert_zones` | `rows: [{code, name, currency, lat, lon}]` | `code` |
| `upsert_actuals` | `rows: [{ts_us, zone, series, value, unit}]` | zone, series, ts |
| `upsert_forecasts` | `rows: [{made_at_us, zone, target, ts_us, horizon_h (i32), p10, p50, p90, model_version}]`; rejects a batch unless p10 <= p50 <= p90 | zone, target, ts, made_at |
| `upsert_scores` | `rows: [{window_start_us, window_end_us, zone, target, metric, model, value, n (u32)}]` | zone, target, metric, model |
| `upsert_ghost_wind` | `rows: [{ts_us, region, method, mwh, cost_gbp}]`; `method` is `boalf` or `weather_gap` | region, method, ts |
| `upsert_carbon` | `rows: [{ts_us, zone, production_gco2_kwh, consumption_gco2_kwh, imports_share}]` | zone, ts |
| `upsert_batteries` | `rows: [{zone, strategy, soc_mwh, profit, currency, share_of_perfect}]`; `strategy` is `median`, `risk_aware`, `naive` or `perfect` | zone, strategy |
| `upsert_battery_actions` | `rows: [{ts_us, zone, strategy, action, mw, soc_mwh, price}]`; `action` is `charge`, `hold` or `discharge` | zone, strategy, ts |
| `set_intervention` | `slot, type, target, magnitude, hours (u32), triggered_by, cost_total, currency, explanation, result_json` (10 positional args) | `slot` (use `main`) |
| `clear_intervention` | `slot` | |
| `prune_before` | `before_us` (i64): deletes actual, forecast, ghost_wind, carbon and battery_action rows with `ts` before it | |

`set_intervention` replaces the slot's row, bumps `seq` and stamps `triggered_at` with server time; `result_json` is the full `POST /intervene` response as a JSON string, so screens show exactly what the API returned.

Examples:

```
curl -X POST $H/v1/database/living-grid/call/upsert_actuals -H "Authorization: Bearer $TOK" \
  -H 'Content-Type: application/json' \
  -d '[[{"ts_us":1794571200000000,"zone":"GB","series":"price_da","value":82.5,"unit":"GBP/MWh"}]]'

curl -X POST $H/v1/database/living-grid/call/set_intervention -H "Authorization: Bearer $TOK" \
  -H 'Content-Type: application/json' \
  -d '["main","hormuz","EU",30,168,"main-screen",1.2e9,"GBP","Gas up 30%: GB price +£41","{}"]'
```

## Tables (all public)

Rows of every publishable table carry a string `key` (primary key) built from the natural key.

| Table | Columns |
|---|---|
| `zone` | code (pk), name, currency, lat, lon, updated_at |
| `actual` | key, ts, zone, series, value, unit |
| `forecast` | key, made_at, zone, target, ts, horizon_h, p10, p50, p90, model_version |
| `score` | key, window_start, window_end, zone, target, metric, model, value, n |
| `intervention` | slot (pk), seq, type, target, magnitude, hours, triggered_at, triggered_by, cost_total, currency, explanation, result_json |
| `ghost_wind` | key, ts, region, method, mwh, cost_gbp |
| `carbon` | key, ts, zone, production_gco2_kwh, consumption_gco2_kwh, imports_share |
| `battery` | key, zone, strategy, soc_mwh, profit, currency, share_of_perfect, updated_at |
| `battery_action` | key, ts, zone, strategy, action, mw, soc_mwh, price |
| `player` | identity (pk), name, zone, score, joined_at |
| `player_decision` | key, identity, zone, slot, action, settled, pnl, decided_at |

Views: `latest_forecast` (newest `forecast` row per zone, target and ts) and `leaderboard` (rank, name, zone, score).

## Room game reducers (called by phones through the web client)

`join(name)`, `claim_zone(zone)` (zone must exist in `zone`), `decide(slot_us, action)` with action `charge | hold | discharge`; re-deciding an unsettled slot overwrites it.

## Known gaps

- The publish reducers are not restricted to the publisher's identity; any client could call them. Fine for the demo; tighten if time allows.

## Access control

Publish reducers (`upsert_*`, `set_intervention`, `clear_intervention`, `prune_before`) and `add_admin` /
`remove_admin` reject any caller that is not an admin (`module/src/auth.ts`). Game reducers stay open.

- Admins are the identity that first published the module (seeded in `init`), the live database owner
  (`BOOTSTRAP_ADMINS`, because a migrate does not re-run `init`), and anyone added with `add_admin`.
- The Python publisher needs a token for an admin identity: `LG_STDB_TOKEN`, or `LG_STDB_TOKEN_FILE` pointing
  at a mode-600 file. Without one, `engine.publisher.from_env()` returns None and logs a warning.
- Give each service its own identity rather than the owner token:

```
curl -s -X POST http://127.0.0.1:3000/v1/identity > id.json        # {"identity": ..., "token": ...}
spacetime call --server http://127.0.0.1:3000 living-grid add_admin '"<identity hex>"' '"engine publisher"'
```

`./smoke.sh` checks that anonymous calls get 530 and a promoted identity gets 200.
