# Judge walkthroughs after #207 (one navigation)

Task #228. Run on 8 November 2026 from 01:20 to 01:55 UTC on the live site https://htb.stefvuck.dev. The deployed web tree matched 4a6b1aa (#223), which is after #207 (9772ba9).

Each judge used a fresh Chromium context with no `lg-welcomed`, at 1440×900 desktop and 390×844 phone (touch). The script logged the visible text, buttons, console errors, HTTP errors and API calls over 4 s at every step. Read-only.

**This reflects the UI as of #207/#223.** The ELI5 changes merged since (#261, #270, #273, #274, #276) are not covered; the step 9 walkthroughs will cover those screens.

## Top 5

1. **Under load, the live site fell back to sample data mid-walkthrough.**
   - Between 01:25 and 01:35 UTC, `/zones`, `/state` and `/scenarios` took 40 to 56 s, and two calls returned 502.
   - `/timeline?from=2024-01-01&step=day` took 96 to 145 s.
   - The top bar said "Fixture data · Sat 7 Nov 12:00" and the explanation card said "SAMPLE … Sample figures shown because the API could not be reached".
   - At 01:54 the same calls took 0.05 to 0.44 s. Load average was 33 to 36 on 8 cores, mostly headless Chromium.
   - The demo host shares the box with agents' heavy jobs.
2. **The Proof page labels backtest numbers LIVE, and gives two battery figures.**
   - "ERROR VS PERSISTENCE · LIVE −24%" and "INSIDE THE P10–P90 BAND · LIVE 80%" are the walk-forward backtest figures. `/scores` says so in `headline.sentence`: "Headline figures are from the walk-forward backtest (6039 hours)". MAE is 33.0 against 43.2.
   - The web tags them LIVE whenever `forecasts_scored > 0` (`summary.js`).
   - "BATTERY SHARE OF PERFECT 97% risk-aware, median-only 93%" is an unweighted mean of per-zone shares. `/scores` headline says 87% (`battery_share_of_perfect` 0.8729, "pooled over 6 zones and 186 settled hours"), and the user-stories doc says 88%.
3. **Beat the model (solo) is too fast for a first-time player.**
   - A game hour lasts about 12 s, so the whole 12:00 to 18:00 day takes about 75 s across five markets, each with a paragraph of text.
   - On phone the judge opened a trade sheet, but the market moved and the hour changed before the trade could be confirmed. No trade was ever placed.
4. **The wind-switched-off market contradicts itself.**
   - Desktop day: "84% chance" next to "History only, not a forecast: 16 of the previous 30 days went above 25 GWh" (53%). By 13:00, "46.0 GWh switched off so far" was already over the 25 GWh line, yet YES still traded at 88 to 96¢.
   - Phone day: "18% chance" next to "15 of the previous 30 days" (50%).
   - Cause: `engine/market/library.py` `history_market` prices on history conditioned on the opening hour, but writes an unconditional note, and it can set a line that has already been crossed.
5. **Contradictory pound figures on screen:**
   - **Hormuz cost.** Straight after Run, the cost read "Extra wholesale cost over 2 wk −£54.3m" (desktop) and "−£107m" (phone), then settled at £1.77bn. The count-up eases from 0 to the target, so the card first rendered with a different, negative target.
   - **Constraint bill.** Hidden grid says "The newest published daily constraint bill was £18.8m (NESO, 29 Oct)" and, on the same page, "CONSTRAINT BILL £0 · NESO, 29 Oct (newest, ~1 week lag)".

## Judge 1: HRT quant (What if, battery, Proof)

**Path:**
- Desktop: welcome → What if door → Run scenario (Hormuz +40%, 2 weeks) → More (battery, compute) → Proof tab → "Tap for backtest by zone" → More → Replay.
- Phone: the same path, but there is no welcome screen on the phone (see Navigation).

**Numbers that agree:**
- GB price £181.0 now → £219.3 (▲38.3).
- "GB price up £38: gas up 40% (+£38)".
- Zone table GB +£38.33, NL +€42.43, DE-LU +€41.40, BE +€40.81, FR +€30.52, NO2 +€5.87.
- Cost £1.77bn (likely range £1.06bn to £2.47bn).
- Hardest hit GB +38.3.

The +£38 is right for today's gas: TTF is €85 to €104/MWh in the cache, and the conversion is verified against the 2022 peak (€341 vs €339 settled). **The user-stories doc and any demo script that says "about +£10" are out of date.**

Findings:
- **Battery response missing from the Hormuz result.** The card shows only the method sentence ("Battery in GB: Estimate for a 1 MW / 2 MWh battery …"). The API returns `profit_before` 84.2 and `profit_after` 84.5 GBP, but neither is shown.
- **The 2-week cost includes the top-3 winners only.** Winners £655m + £461m + £371m = £1.49bn, against a £1.77bn total; NL, BE and NO2 make up the rest. That is fine, but a quant will ask.
- **What if → More → "Cost of running AI"** said "Loading…" for over 4 s because `/compute` took 9.2 s.
- **`/intervene` took 9.2 to 9.6 s under load.** The Definition of done asks for a result within a second. The map shows the precomputed shape at once.
- **Proof:** the backtest table is clear and honest. "13 of 17 zone-and-target pairs beat both baselines; 2 lose to persistence and 3 to yesterday". NO2 is +12% vs persistence and FR +1% vs yesterday. The page says coverage is 80% against an 80% target.
- **No Diebold-Mariano test anywhere in the UI.** The task asks for it; #121's evaluation is not surfaced (`/evaluation` returns 404).
- **The replay coverage reads very differently from the headline coverage.** The 26 October replay says "78 of 168 hours landed inside the P10 to P90 band" (46%), while the headline says 80%. That is honest (the storm is out of sample), but worth a sentence in the demo.

Verdict: the numbers can be found and mostly agree. The LIVE labels on backtest figures and the 97% vs 87% battery are the two things a quant will catch.

## Judge 2: G-Research (Forecast and Proof)

**Path:** welcome → Forecast door → (no zone list in Forecast, so the judge cannot pick France) → Hidden grid → Proof → backtest by zone → Now. Phone: the same, from the tabs.

Findings:
- **During the slowdown, Forecast showed the fixture.** It read "Great Britain · €/MWh" with a 0 to 100 axis and "SAMPLE GB price up £18 …", so units and values changed on reload once the API came back (£/MWh, 150 to 400).
- **The forecast and the published price differ, and the page explains why.** The explanation card says "forecast £213.5/MWh" for 07:00, while "The map shows £177 for this hour (published result)". That is clearly worded and fine.
- **Forecast has no zone picker.** The section has no zone list, so the chart and explanation stay on GB unless the judge clicks the map.
- **Hidden grid:** the £18.8m vs £0 constraint bill (Top 5, item 5). "Scotland's wind, paid to stop: 0.0 GWh" sits next to "Weather gap 1.1 GWh". Both are labelled as different estimates, but read side by side they look contradictory.
- **Calibration story:** coverage 80% against a target of 80%, per zone 74 to 90%. That is clear, but see the LIVE label issue in Top 5, item 2.

Verdict: the forecast-against-baseline story is there and honest. The LIVE/backtest labelling and the two constraint-bill numbers undermine it.

## Judge 3: Bank of Scotland customer (Tonight)

**Path:**
- Desktop: welcome → Forecast door → "Tonight: cheapest hours →" (#/household) → North Scotland → scroll.
- Phone: Forecast tab → "Tonight: cheapest hours".

The page did not load until about 30 s: "Working out the cheapest hours…", during the slowdown.

**Numbers (North Scotland, 01:30 UTC):**
- "Tonight Agile is dearer than the price cap: the cheapest slot is 39p a kWh against 26p on the cap. Shifting still beats the 6 pm peak (40p)."
- Car: "Sun 03:00–06:00 · published −£2.70 dearer than cap (−£2.70 to −£2.70) £0.07 vs 6 pm peak". Lower on the same page: "£0.07 £0.07–£0.07 saved vs now".

Findings:
- **Three baselines on one page:** vs cap, vs 6 pm peak, vs now. A customer cannot tell which saving is "the" saving.
- **"−£2.70 dearer than cap" is a double negative.** The band "(−£2.70 to −£2.70)" is empty on published prices (`web/src/views/household/Savings.jsx:75`).
- **Savings are pennies.** 7p for a car charge, 1p for the dishwasher, because tonight's Agile is flat at 39 to 40p. That is honest, but the headline story is weak tonight; consider leading with "Tonight Agile is dearer than the cap" (already there).
- **Units and VAT are fine.** Prices are in p/kWh. "No VAT on electricity" matches the sourced 2026–27 fact in `engine/reference/facts/household.json`, and Agile is labelled "including VAT", consistently.
- **Each task appears twice** (cap cards and the older window cards), with the washing machine in only the first set.

Verdict: the answer (03:00 to 06:00) is easy to find. The savings framing is confusing and, tonight, tiny.

## Judge 4: Metaview (Play)

**Path:**
- Desktop: welcome → Play door → Play solo → Yes 49¢ → "Buy Yes · 51 shares" → wait → end of day. Then a fresh context: lobby → Quick play.
- Phone: Play tab → Beat the model card → Play solo → …

What works:
- No console errors.
- The feed reads like Polymarket: question, % chance with its move, sparkline, Yes/No in cents, and each market's reason ("Britain's system price at 13:00 came in £20 below our forecast (£22 against £42), so the odds moved").
- The resolved cards show what happened and each bot's profit.
- Equity and cash update after a buy (1,000 → 994, cash 975).
- Quick play matched two players into "Game KGZX starts in 20" with Start now / Wait for more votes.
- The rehearsal day (`?demo=1`) is clearly labelled "invented … Not real data".

Findings:
- **Too fast** (Top 5, item 3).
- **Wind market contradiction** (Top 5, item 4).
- **The model has P&L before anyone trades.** At 12:00, "Our model −3.0" (the model is the market maker, so it shows a loss from its opening trades). A first-timer will not understand why.
- **The welcome door and the lobby describe the game differently.** The door says "call the grid on a real, hidden day"; the lobby says "Trade yes/no markets" (#207 noted this).
- **The phone Play hub briefly showed "Fixture · Sat 12:00"** during the slowdown.

Verdict: someone who reads quickly can get it within 30 s. Someone new to it will be overtaken by the clock before their first trade.

## Navigation (#207)

- The same six sections appear in the same order on the desktop tabs, the phone tabs and the welcome doors.
- **There is no welcome on the phone.** `App.jsx` returns `MobileShell` before reaching `<Welcome />`, so a first phone visit lands on the map. (The QR route to #/household skipping it is intended.)
- The doors named in this task ("market-call", "save-on-my-bill") no longer exist. Judges 1 and 3 used What if and Forecast → Tonight.
- **"New version available · Reload" appeared mid-session** on both viewports (a deploy during the run).

## Follow-ups

- **Lane B tasks added: #285 and #286.**
  - #285: `/scores` headline should say whether its figures are live or from the backtest, so the web can label them.
  - #286: the market history question: the note must match the price, and the line must not already be crossed at the open.
- **Sent to lane C on the bus** (the files have changed a lot since #207): LIVE labels and the 97% vs 87% battery figure, the Hormuz negative count-up, £18.8m vs £0, the household double negative and three baselines, the game pace, and the missing phone welcome.
