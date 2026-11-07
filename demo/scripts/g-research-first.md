# G-Research first: making the unseen seen

Three minutes. Spoken lines are in plain text; **clicks are in bold**. Times are cumulative.

## 0:00 Open (20 s)

*Screen: Overview, map coloured by price, flows moving between countries.*

"Electricity is invisible. You cannot see what it costs to waste, or where its carbon comes from. This is Europe's grid right now: six zones coloured by price, and the arcs are power flowing through undersea cables."

## 0:20 Ghost wind over Scotland (45 s)

**Click the Ghost wind chip.** **In the constraint card, click 26 Oct storm.**

"On 26 October a storm hit Scotland. The grid could not carry the wind power south, so farms were paid to switch off. The glow is that wind: about 72 gigawatt hours in one day."

*Wait for the pound figure to count up.*

"NESO puts that day's constraint costs at £36.5 million. Nobody sees it on their bill, but everybody pays it. The wind figure is our estimate from accepted balancing bids, and it is labelled as one."

## 1:05 Carbon through the cables (30 s)

**Click Ghost wind off. Click the Carbon chip on.**

"Second hidden thing: carbon. A grid can look clean while importing dirty power, or the other way round. We trace carbon through every import. Right now Britain generates at about 370 grams per kilowatt hour but consumes at about 347, because the cables bring in French nuclear and Norwegian hydro. Those are standard estimates, and the screen says so."

## 1:35 Why a price moved (20 s)

**Hover GB on the map (or click it in the zone list) to show the explanation card.**

"Every forecast tells you why, in plain causes: wind, demand, gas, imports. It is the model explaining itself, not a proven cause, and it says so."

## 1:55 A shock nobody can see coming (40 s)

**Click Simulate. Click Strait of Hormuz. Click Run.**

"Now close the Strait of Hormuz. Gas goes up 40% for two weeks, and the shock travels through those same cables. France, Belgium and southern Norway rise most, because gas sets their price more often."

*Pound figure counts up to about £143M.*

"About £143 million on consumers, somewhere between £86 million and £200 million. The model has never seen a shock like this, so this part is a merit-order estimate, and the screen says so."

## 2:35 Proof (25 s)

**Click Overview. Point at the How right are we? card.**

"Why trust any of it? Every forecast is logged before its outcome exists and scored against simple guesses. In our backtest we are 28% more accurate than persistence. Our bands are still too narrow, 63% against a target of 80%, and we show that too."

## 3:00 Close

"The Living Grid: the hidden grid, made visible, and honest about what it does not know."

## If something breaks

- **Ghost wind shows 0:** the storm window failed to load. Say "on the storm day" and switch to the `#/replay` tab, which also states the £36M figure.
- **Run hangs:** the card falls back to the pre-computed scenario after the timeout. Keep talking; the numbers are the same within rounding.
- **Top-right chip says Fixture data:** the API is down. Everything above still renders from fixtures. Say "this is running offline from our cache".
