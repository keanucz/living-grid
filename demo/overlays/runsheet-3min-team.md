# Run sheet: 3 minute team demo

Desktop browser at https://htb.stefvuck.dev, full screen, welcome screen already dismissed. The section tabs run along the top: Now, Forecast, Hidden grid, What if, Proof, Play.

Keanu opens and does Hidden grid, What if and the ESP32 meter. Manu does Now, Tonight and Play. Stefan does Forecast, Proof and the reveal. Each person's lower third goes on their first appearance.

| Time | On camera | On screen (clicks) | Say | Overlay |
|---|---|---|---|---|
| 0:00 to 0:04 | Nobody | Title card | (silence or music) | `Title` |
| 0:04 to 0:12 | Keanu | The app on **Now**. | "Electricity is invisible. We built The Living Grid to make Europe's power system visible, and to predict where it goes next." | `LowerThird-Keanu` at 0:04 |
| 0:12 to 0:30 | Manu, then screen | Click **Now**. Hover Great Britain, then France. | "This is the grid right now. Each country is coloured by its power price, and the moving lines are electricity crossing borders." | `LowerThird-Manu` at 0:12, `Beat-now` at 0:17 |
| 0:30 to 0:54 | Keanu, then screen | Click **Hidden grid**, then the tile **Scotland's wind, paid to stop**. Then the tile **Carbon that comes in by cable**. | "Some of it is normally hidden. On stormy days, Scottish wind farms are paid to switch off because the grid is full. On 26 October that cost this much. And a country can look clean while it imports dirtier power." | `Beat-hidden-grid` at 0:31, `Callout-constraint-bill` at 0:38 |
| 0:54 to 1:14 | Screen | Click **What if**, then the card **Gas gets dearer** (the Strait of Hormuz closes). Wait for the result. | "Now change the world. Close the Strait of Hormuz and gas gets dearer. The shock spreads across Europe, and this is the extra bill, with an honest range." | `Beat-what-if` at 0:55, `Callout-hormuz` at 1:02 |
| 1:14 to 1:28 | Keanu, holding the ESP32 meter up to the camera | Press the top button to step through Price now, Next 24 hours and Run it later. | "We also put the forecast on a little screen at home: is power cheap right now, when is it cheapest tonight, and what to run later to save money." | `Beat-meter` at 1:15 |
| 1:28 to 1:46 | Stefan, then screen | Click **Forecast**. Scrub a few hours ahead. | "This is our forecast for every country. The bands widen when we are less sure, and the panel says why the price moves." | `LowerThird-Stefan` at 1:28, `Beat-forecast` at 1:33 |
| 1:46 to 2:10 | Stefan, then screen | Click **Proof**. Show the scoreboard. | "Every forecast is logged before the outcome, then scored. Against a simple baseline we are much less wrong, and our band catches most real prices." | `Beat-proof` at 1:47, `Callout-less-wrong` at 1:52, `Callout-in-range` at 1:58, `Callout-scored` at 2:04 (or `Callout-battery`: about 94% of perfect foresight) |
| 2:10 to 2:22 | Screen | On Proof, click **Day-ahead reveal**. | "Monday's forecast was frozen hours ago. Here it meets the real auction result." | `Beat-reveal` at 2:11 |
| 2:22 to 2:34 | Manu, then screen | Click **Forecast**, then **Tonight: cheapest hours**. | "For a household, it boils down to this: the cheapest hours tonight to charge your car or run the dishwasher." | `Beat-tonight` at 2:23 |
| 2:34 to 2:54 | Manu, then screen | Click **Play**, then **Beat the model**. | "And you can play against it. Call a real, hidden day and see if you beat our model. Scan the code to join." | `Beat-play` at 2:35 |
| 2:54 to 3:00 | Nobody | End card | (all three) "Thank you." | `EndCard` |
