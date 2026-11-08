# Data audit: filled or flat values in actuals (#237)

Read-only audit of the runner's `data/actuals/*.parquet` from 1 September to 7 November 2026. Suspicious points were checked against the raw source APIs on 8 November. Scan script: exact repeats at the same hour on consecutive days, identical whole days, flat runs (the same non-zero value for 3 or more hours), round numbers, and values at market caps or floors.

## Verdict

**No data bugs found.** Every suspicious point matches its raw source. Our pipeline does not forward-fill or interpolate any actual. The only fill is EURUSD carried over weekends in `pipeline/ingest/markets.py`, which is intended. No fix task has been opened.

## The reported case: France at 300.0 EUR/MWh at 17:00 on 31 Oct and 1 Nov

- These are not the same value. Our hourly figures are **300.0000** on 31 Oct and **300.0400** on 1 Nov. Energy-Charts and Nord Pool agree in our cache.
- The raw Energy-Charts 15-minute prices (`/price?bzn=FR`, times in UTC) average to these exactly:

| Hour (UTC) | 15-minute prices (EUR/MWh) | Hourly mean |
|---|---|---|
| 31 Oct 17:00 | 298.26, 299.59, 299.00, 303.15 | 300.00 |
| 1 Nov 17:00 | 300.44, 300.44, 300.00, 299.28 | 300.04 |

- Both evening peaks cleared in a tight band around 300. The next hour on 31 Oct had three quarters at exactly 300.00. So 300 looks like a large block of supply offered at that price in the French evening peak, not a fill.
- The mean happening to land on 300.00 is a coincidence of rounding.

## Other suspicious patterns, all confirmed against the raw source

| Pattern | Our data | Raw source | Verdict |
|---|---|---|---|
| GB system price flat for 3 h: 18 Sep 12:00 (-10.98), 29 Oct 02:00 (230.0) | 3 identical hourly values | Elexon `system-prices`: six consecutive settlement periods at -10.98 and at 230.00, net imbalance volume varying | Real: the same balancing action set the price each half-hour |
| GB system price 241.5 for 3 h, 11 Oct 16:00 | 3 identical hourly values | Half-hours alternate 254.00 and 229.00 (SP35-40). Each hourly mean is 241.5 | Real: an artefact of averaging to hourly |
| Nord Pool GB day-ahead 130.0 for 4 h on 15 Sep, 90.0 for 3 h on 22 Oct | Round numbers | N2EX (`DayAheadPrices`, UK, GBP) returns the same | Real |
| FR -0.01 for 3 h, 13 Sep 11:00 | Flat | Not re-fetched; Energy-Charts and Nord Pool agree in our cache, and -0.01 is a common midday solar clearing price | Very likely real |
| DE-LU maximum 697.31 at 17:00 on 14 Sep | Highest price since September | 15-minute prices 649.11, 700.07, 700.04 and 740.01 average to 697.31 | Real |
| DE-LU geothermal exactly 13.2 MW in every hour (1,632 h) | Flat | Energy-Charts `public_power` publishes a constant 13.2 | Source estimate, not measured. 13 MW is negligible |
| BE nuclear 0 MW every hour, 1-12 Oct | Identical days | Energy-Charts also 0 on 3-4 Oct. From 20 Oct about 970 MW in both | Real per source: Belgian nuclear offline |
| NL-GB (BritNed) flow 0, 7-14 Sep | Identical days | Elexon INTNED also 0 to -2 MW | Real: link offline, two independent sources agree |

## Patterns that are physical and were not chased

- **Interconnectors at their limit for hours.** NSL ±1,400-1,450 MW (20-30% of hours repeat the same hour the day before), IFA about ±4,000 MW, Moyle and EWIC. This is normal: the link is full.
- **All-zero days.** GB coal and oil, ghost-wind BOALF on calm days (4 and 7 Nov), and Norwegian offshore wind near 0 to 2 MW. These are real zeros.
- **Small near-constant Energy-Charts series:** BE run-of-river at 0.1 MW, FR oil at about 37 MW, and DE "others" at about 135 MW. Energy-Charts publishes these as estimates.

## Caps and floors

No price since 1 September is at or near a market cap or floor (SDAC limits, or a GB system price below -500). The ranges since September are:

| Series | Minimum | Maximum |
|---|---|---|
| Continental day-ahead | -19.0 | 697.31 EUR/MWh |
| GB system price | -66.44 | 411.11 GBP/MWh |
| GB MID | -19.37 | 364.32 GBP/MWh |

## Caveats for the UI

- **Energy-Charts estimates.** DE geothermal and similar small flat series are estimates published by Energy-Charts. If the mix card shows them, they come under the "modelled or estimated" label already required by the brief.
- **Hourly averages.** Hourly GB system prices are the mean of two half-hours. A flat-looking hourly run can hide alternating half-hours (11 Oct).
