# HRT first: prediction and decisions

Three minutes. Spoken lines are in plain text; **clicks are in bold**. Times are cumulative.

## 0:00 Open (25 s)

*Screen: Overview. Forecast ghost chip on.*

"This is Europe's power grid now. **Drag the scrubber six hours ahead.** And this ghost is where it will be in six hours. The further ahead we look, the wider the P10 to P90 band, and the fainter the ghost."

## 0:25 Close the Strait of Hormuz (50 s)

**Click Simulate. Click Strait of Hormuz. Click Run.**

"The Strait of Hormuz closes and gas goes up 40% for two weeks. Who pays?"

*Pound figure counts up to about £143M.*

"About £143 million on European consumers, P10 to P90 £86 million to £200 million. France, Belgium and southern Norway move most. Generators gain what consumers lose, and the winners and losers list shows it."

"Our model has never seen a shock like this, so we do not let it guess. We use a merit-order estimate: a gas plant at 58% efficiency burns 1.72 megawatt hours of gas per megawatt hour of power. The screen labels it as an approximation."

## 1:15 A smaller shock, explained (20 s)

**Click Norway to GB link trips. Click Run.**

"A smaller one: the cable from Norway trips. Britain loses 1.3 gigawatts of cheap hydro, the GB price goes up about £5, and the explanation says exactly that: less from Norway, plus £5."

## 1:35 What a battery does with it (25 s)

**Point at the battery card in Simulate. Click GB.**

"A 1 megawatt, 2 megawatt hour battery in each zone trades on our forecasts. We score it only on real outcomes and compare it with a naive rule and with perfect foresight. On median forecasts it captures most of what perfect foresight could."

*Only if the card shows risk-aware above median-only (task #102 merged):* "and the version that plans across the whole band loses less on the bad hours."

## 2:00 Scoreboard (20 s)

**Click Overview. Click the How right are we? card for the backtest by zone.**

"Every forecast is logged before its outcome exists. Across a six-fold walk-forward backtest our day-ahead error is 31.6, against 43.7 for persistence: 28% better. We lose to persistence on Norwegian prices, and we show that row too."

## 2:20 Replay the 26 October storm (25 s)

**Switch to the #/replay tab. Press play.**

"Would we have seen the storm of 26 October coming? This model saw no data from that day onwards. On a calm day 81% of hours land in our band. On the storm day, 49%. The bands are too narrow when the weather turns, and we know it: that is the next thing we fix."

## 2:45 The reveal (15 s)

**Switch to the #/reveal tab.**

"Last night at midnight we froze our forecast for Monday. Britain's auction result came in this morning and the continent's is landing now. Here is our forecast, timestamped hours before, next to what the market actually did."

## 3:00 Close

"The Living Grid: forecasts you can check, decisions you can price."

## If something breaks

- **Reveal not frozen or no results yet:** say "the continental results land at about midday; the GB result is already in" and stay on the replay.
- **Battery card looks wrong:** skip 1:35 and give the time to the replay.
- **Run hangs:** the card falls back to the pre-computed scenario. Keep talking.
