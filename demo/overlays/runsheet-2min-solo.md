# Run sheet: 2 minute solo demo (Keanu)

Desktop browser at https://htb.stefvuck.dev, full screen, welcome screen already dismissed. The section tabs run along the top: Now, Forecast, Hidden grid, What if, Proof, Play.

Overlay files are in `out/mov/` (or `out/webm/`, `out/png/`). "Callout" cards sit top right, so keep the map's busy part away from that corner if you can.

| Time | On camera | On screen (clicks) | Say | Overlay |
|---|---|---|---|---|
| 0:00 to 0:04 | Nobody | Title card | (silence or music) | `Title` |
| 0:04 to 0:16 | Keanu | Click **Now**. The map of Europe with prices and moving flows. | "Electricity is invisible. This is Europe's power grid right now: what each country pays, and the power flowing between them." | `LowerThird-Keanu` at 0:04, `Beat-now` at 0:08 |
| 0:16 to 0:34 | Keanu, then screen | Click **Hidden grid**, then the tile **Scotland's wind, paid to stop**. | "Some of it is normally hidden. On stormy days, Scottish wind farms are paid to switch off because the grid can't carry the power south. On 26 October that bill was this big." | `Beat-hidden-grid` at 0:17, `Callout-constraint-bill` at 0:24 |
| 0:34 to 0:52 | Screen | Click **What if**, then the card **Gas gets dearer** (the Strait of Hormuz closes). Wait for the result. | "Now change the world. Close the Strait of Hormuz, gas gets dearer, and the shock travels across Europe. Here is the extra bill, with an honest range." | `Beat-what-if` at 0:35, `Callout-hormuz` at 0:42 |
| 0:52 to 1:04 | Keanu, holding the ESP32 meter up to the camera | Press the top button to step through Price now, Next 24 hours and Run it later. | "And we put the same forecast on a little screen at home: is power cheap right now, and when is it cheapest tonight." | `Beat-meter` at 0:53 |
| 1:04 to 1:16 | Screen | Click **Forecast**. Scrub a few hours ahead. | "This is where prices are heading, with bands that widen when we are less sure." | `Beat-forecast` at 1:05 |
| 1:16 to 1:26 | Screen | Click **Tonight: cheapest hours**. | "And for a household: the cheapest hours tonight to charge a car." | `Beat-tonight` at 1:17 |
| 1:26 to 1:44 | Keanu, then screen | Click **Proof**. Show the scoreboard. | "Can you trust it? Every forecast is logged before the outcome and scored against a simple baseline. We are much less wrong than it, and the band catches most real prices." | `Beat-proof` at 1:27, `Callout-less-wrong` at 1:31, `Callout-in-range` at 1:37 |
| 1:44 to 1:52 | Screen | On Proof, click **Day-ahead reveal**. | "Monday's forecast was frozen hours ago. This is where it meets the real auction." | `Beat-reveal` at 1:45 |
| 1:52 to 1:56 | Keanu | Click **Play**. | "And you can try to beat our model yourself." | `Beat-play` at 1:52 (cut it at 1:56) |
| 1:56 to 2:00 | Nobody | End card | "Scan the code and try it." | `EndCard` (trim to 4 s) |

Spare overlays if you have time: `Callout-scored` or `Callout-battery` on the Proof beat (for the battery, click **What if**, then **More detail**: a battery trading on our forecasts makes about 94% of what perfect foresight would).
