# HRT first: prediction and decisions

Three minutes. Spoken lines are in plain text; **clicks are in bold**. Times are cumulative.

## 0:00 Open (25 s)

*Screen: Overview. Forecast ghost chip on.*

"This is Europe's power grid now. **Drag the scrubber six hours ahead.** And this ghost is where it will be in six hours. The further ahead we look, the wider the P10 to P90 band, and the fainter the ghost."

## 0:25 Close the Strait of Hormuz (50 s)

**Click Simulate. Click Strait of Hormuz. Click Run.**

"The Strait of Hormuz closes and gas goes up 40% for two weeks. Who pays?"

*Pound figure counts up to about £1.75bn.*

"About £1.75 billion on consumers across the six zones, P10 to P90 £1.05 billion to £2.46 billion. The Netherlands, Germany and Belgium move most; southern Norway, on hydro, barely moves. Generators gain what consumers lose, and the winners and losers list shows it."

"Our model has never seen a shock like this, so we do not let it guess. We use a merit-order estimate: a gas plant at 58% efficiency burns 1.72 megawatt hours of gas per megawatt hour of power. The screen labels it as an approximation."

## 1:15 A smaller shock, explained (20 s)

**Click Norway to GB link trips. Click Run.**

"A smaller one: the cable from Norway trips. Britain loses the 980 megawatts it was importing, the GB price goes up about £4, and the explanation says exactly that: less from Norway, plus £4."

## 1:35 What a battery does with it (25 s)

**Point at the battery card in Simulate. Click GB.**

"A 1 megawatt, 2 megawatt hour battery in each zone trades on our forecasts. We score it only on real outcomes and compare it with a naive rule and with perfect foresight. So far it has made about 98% of what perfect foresight could, against under 90% for the naive rule. The version that plans across the whole band is as good or better in four of five zones."

## 2:00 Scoreboard (20 s)

**Click Overview. Click the How right are we? card for the backtest by zone.**

"Every forecast is logged before its outcome exists. Across a twelve-fold walk-forward backtest our day-ahead error is 33.3, against 52.3 for persistence: 36% better. In Norway we are only level with persistence, and we show that row too."

## 2:20 Replay the 26 October storm (25 s)

**Switch to the #/replay tab. Press play.**

"Would we have seen the storm of 26 October coming? This model saw no data from that day onwards. On an ordinary day, 2 November, 92% of hours land in our band. On the storm day, 46%. The bands hold on normal days and are too narrow when the weather turns, and we know it: that is the next thing we fix."

## 2:45 The reveal (15 s)

**Switch to the #/reveal tab.**

"Last night at midnight we froze our forecast for Monday. Britain's auction result came in this morning and the continent's is landing now. Here is our forecast, timestamped hours before, next to what the market actually did."

## 3:00 Close

"The Living Grid: forecasts you can check, decisions you can price."

## If something breaks

- **Reveal not frozen or no results yet:** say "the continental results land at about midday; the GB result is already in" and stay on the replay.
- **Battery card looks wrong:** skip 1:35 and give the time to the replay.
- **Run hangs:** the card falls back to the pre-computed scenario. Keep talking.
