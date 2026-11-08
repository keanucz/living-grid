# Presentation facts

Every number the deck shows (scenes in `demo/presentation/src/scenes/Scenes.tsx`), where it comes from, and a check against the live API. Snapshot: `demo/presentation/data/snapshot.json`, generated 2026-11-08 01:45 UTC. Live column fetched 2026-11-08 about 03:00 UTC with the same requests. The numbers on screen are the snapshot's, and a render re-runs the snapshot first, so a render picks up the live values.

| Scene | Figure | Endpoint | Snapshot | Live | Status |
|---|---|---|---|---|---|
| Hook | GB price now | `/state` | 181 | 179 | moved since snapshot |
| Hook | FR price now | `/state` | 215 | 216 | moved since snapshot |
| Hook | DE-LU price now | `/state` | 215 | 216 | moved since snapshot |
| Hook | NL price now | `/state` | 215 | 216 | moved since snapshot |
| Hook | BE price now | `/state` | 215 | 216 | moved since snapshot |
| Hook | NO2 price now | `/state` | 195 | 193 | moved since snapshot |
| Problem | GB lowest hour, 26 Oct | `/replay?event=2026-10-26` | £19 | £19 | same |
| Problem | GB highest hour, 26 Oct | `/replay?event=2026-10-26` | £200 | £200 | same |
| Problem | GB constraint bill, 26 Oct | `/replay?event=2026-10-26` | £36,530,869 | £36,530,869 | same |
| Problem | Largest import gap: zone | `/unseen/carbon` | BE | BE | same |
| Problem | that zone, made at home g/kWh | `/unseen/carbon` | 342 | 345 | moved since snapshot |
| Problem | that zone, used g/kWh | `/unseen/carbon` | 379 | 383 | moved since snapshot |
| Problem | that zone, imported share % | `/unseen/carbon` | 19 | 24 | moved since snapshot |
| Built | zones | `/zones` | 6 | 6 | same |
| Built | interconnectors | `/zones` | 17 | 17 | same |
| Built | GB forecast p10 | `/state` | £186 | £175 | moved since snapshot |
| Built | GB forecast p50 | `/state` | £213 | £201 | moved since snapshot |
| Built | GB forecast p90 | `/state` | £219 | £209 | moved since snapshot |
| Product | Hormuz cost, central | `/scenarios` | £1,754,592,000 | £1,754,592,000 | same |
| Product | Hormuz cost, low (P10) | `/scenarios` | £1,052,755,000 | £1,052,755,000 | same |
| Product | Hormuz cost, high (P90) | `/scenarios` | £2,456,428,000 | £2,456,428,000 | same |
| Product | Hormuz sentence | `/scenarios` | GB price up £38: gas up 40% (+£38) | GB price up £38: gas up 40% (+£38) | same |
| Product | Household window 1: start-end | `/household` | 03:00-06:00 | 03:00-06:00 | same |
| Product | Household window 1: p/kWh | `/household` | 33.9 | 33.9 | same |
| Product | Household window 2: start-end | `/household` | 05:30-06:30 | 05:30-06:30 | same |
| Product | Household window 2: p/kWh | `/household` | 33.7 | 33.7 | same |
| Product | Data centre GPUs | `/datacentre` | 1,000 | 1,000 | same |
| Product | Data centre movable share % | `/datacentre` | 20 | 20 | same |
| Proof | MAE, our model | `/scores` | 33.0 | 33.3 | moved since snapshot |
| Proof | MAE, persistence | `/scores` | 43.2 | 52.3 | moved since snapshot |
| Proof | Smaller error % | `/scores` | 24 | 36 | moved since snapshot |
| Proof | Backtest hours | `/scores` | 6,039 | 12,086 | moved since snapshot |
| Proof | Coverage P10-P90 % | `/scores` | 80 | 78 | moved since snapshot |
| Proof | Forecasts scored | `/scores` | 301 | 379 | moved since snapshot |
| Proof | Battery share of perfect % | `/scores` | 91 | 95 | moved since snapshot |
| Proof | Monday delivery date | `/reveal` | 2026-11-09 | 2026-11-09 | same |
| Proof | Frozen at | `/reveal` | 2026-11-07T23:59:02Z | 2026-11-07T23:59:02Z | same |
| Proof | Solana commitments | `/commitments` | 9 | 10 | moved since snapshot |
| Proof | Latest commitment hash (first 12) | `/commitments` | 3e938fc199f4 | 3e938fc199f4 | same |
| Play | Our MAE to beat | `/scores` | 33.0 | 33.3 | moved since snapshot |
| How | Tasks merged | hub.db | 234 | (counted at render) | n/a |
| How | Agents that merged them | hub.db | 15 | (counted at render) | n/a |

Prices in the Hook are £/MWh for GB and €/MWh for the rest. Hormuz costs are the central estimate and its P10 to P90 range for the consumer cost over the scenario period.

## Reading the table

- **same**: the live API returns exactly what the snapshot holds. The 26 October replay, the Hormuz result, the household windows, the data centre defaults and the frozen Monday forecast do not move.
- **moved since snapshot**: expected for live figures (today's prices, forecast, carbon, scores). Not a mismatch: the deck always shows the snapshot's value with its time in the footer.
- **How we built it**: the hub counts (merged tasks, agents) come from `hub.db` at snapshot time and grow while the team merges; the dot grid and counter show the snapshot's count.

## Things to check by eye on the render

- **Proof scores moved a lot.** Live `/scores` now reports 12,086 backtest hours, persistence error 52.3 and 36% smaller error (snapshot: 6,039 hours, 43.2, 24%), so the backtest was extended or re-run after the snapshot. A render takes the live numbers; if the Mac render shows different values from this table's Snapshot column, that is why.
- **Derived values.** "£19 to £200" is the lowest and highest actual GB hour in the replay; "improvement" is 1 minus model error over persistence error; the carbon scene picks the zone with the largest gap between used and made-at-home carbon (currently BE).
- **Not shown on purpose.** Diebold-Mariano p-values (no endpoint), so the caption states the result in words only.
- **Hormuz cost.** `F.hormuzCostGbp` in `src/data.ts` reads an object and shows a dash; the scenes use `hormuzCost` in `src/figs.ts` (the P50) instead.
