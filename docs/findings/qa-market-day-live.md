# QA: one Market day played live after the #286 and #291 reload

Task #302. Played on 8 November 2026 between 03:58 and 04:04 UTC on https://htb.stefvuck.dev/#/play, after the 03:45 pm day reload. Each run used Playwright Chromium under `nice -n 19`, one browser at a time, closed afterwards.

| Run | Viewport | Player name |
|---|---|---|
| Market day, solo | 1440×900 desktop | `QA keanu-4 desktop` |
| Market day, solo | 390×844 phone (touch) | `QA keanu-4 phone` |
| Beat the model, Quick play | Desktop | `QA keanu-4 beat` |

In each Market day I bought 50 points of YES on the first market and 50 points of NO on the second at the open, then let the day run to the end. The script recorded every card every 6 s. Screenshots are in `docs/findings/qa-market-day-live/`.

**Verdict:** both Market days played end to end on desktop and phone, with no console or page errors. Every check in the task passes, except one inconsistency in the wind market's closing hour. That is opened as #303, together with Beat the model's wind call. The Beat the model round also played end to end.

## Checklist

| Check | Result |
|---|---|
| Some markets ask "below" | **Pass.** Two of four price markets ask "below": Britain's system price below £250 at 15:00, and Britain's day-ahead below £240 at 18:00. |
| No market opens at 3c or 97c | **Pass.** The opens were 68, 32, 73, 50 and 30. |
| No line already crossed at the open | **Pass.** The price markets ask about future hours. The wind line (10 GWh) is above the 0.0 GWh already switched off by 12:00. |
| Each note agrees with its opening price | **Pass.** See the table below. |
| Prices move each hour | **Pass.** One exception is by design: France at 13:00 has only one game hour, so it never moves (known from #236). |
| Resolve and end screen | **Pass.** Each resolved card shows YES or NO, "What happened", "Why the model said …" and profit per player. The end screen reveals the day (2026-11-06), profit, rank, who beat whom, and the overall rank and rating. |
| Wording uses Market day (#276) | **Pass.** The landing says "Market day" and "Play Market day solo"; the end screen says "Market day over". |

## The day as played (2026-11-06, the same day on both runs)

| Market | Asks | Open | Note at the open | Price by hour | Outcome |
|---|---|---|---|---|---|
| France day-ahead, 13:00 | above €220 | 68 | median €223; "above our median 65% of the time" on 60 earlier hours | 68 | YES (€261) |
| Britain system price, 15:00 | **below** £250 | 32 | median £246; "above our median 72%" | 32, 92, 45 | YES (£223.9) |
| Germany day-ahead, 17:00 | above €300 | 73 | median €301; "above our median 75%" | 73, 58, 59, 72, 73 | YES (€357.1) |
| GB wind switched off, midnight to 18:00 | above 10 GWh | 50 | "0.0 GWh already switched off by 12:00, and on 15 of the previous 30 days at least 10.0 GWh more followed by 18:00" | 50, 47, 40, 30, 20 | NO (0.0 GWh) |
| Britain day-ahead, 18:00 | **below** £240 | 30 | median £242; "above our median 70%" | 30, 26, 21, 3 | NO (£307) |

- **#291 calibration is live and consistent.** For each "above" market the open sits near the share stated in its note (68 against 65%, 73 against 75%). Each "below" market opens near 100 minus it (32 against 72%, 30 against 70%). The note states the "above" share even on "below" markets. That is correct, but a player has to invert it in their head.
- **#286 is live.** The wind note now states the conditioned basis ("0.0 GWh already … at least 10.0 GWh more followed"), and its open matches it (15 of 30 = 50).
- **The GB system price still over-reacts:** "below £250" went 32, 92, 45 before settling YES. That is the over-reaction noted in #236, still open.
- **Bots at the open:** they show small losses at 12:00 (−7 to −12), which is the spread on their opening trades marked to market.
- **Result:** I finished second of five on −27.4. The Committee made +361; Our model and The Engineer made −75; Yesterday made −227.

## Bug opened

**#303: the wind market closes an hour before its window ends.**

- The question says "between midnight and 18:00" and settles on the total up to 18:00. But `engine/pm/build.py` sets `close_hour = end - 1`.
- So the card says "Closes 17:00", the last price is at 16:00, and at 17:00 it reveals the 17:00 to 18:00 hour before the clock has played it.
- Trading has stopped by then, so it cannot be exploited, but it reads as inconsistent.

## Beat the model, one Quick play round

- **Flow:** Quick play, then "Start now", then five calls: a price band at 18:00, a battery choice at 17:00, imports or exports at 13:00, the highest zone at 17:00, and wind switched off by 18:00. Each was answered and revealed, then the standings showed with "Play again". No errors.
- **Players:** another player ("Player 908") was in the quick lobby.
- **Wind call (also in #303):**
  - The model's reason was "History only, not a forecast: 15 of the previous 30 days went above 50 GWh" at 50%. That is the unconditional basis #286 replaced in Market day. The actual was 0.8 GWh.
  - The reveal heading said "Why the model said YES" for a 50% call.

## Not checked

- **Mystery day choice:** both solo runs were dealt 2026-11-06. I did not check whether solo always deals the same day.
- **Test players:** the runs leave three test players (`QA keanu-4 desktop`, `QA keanu-4 phone` and `QA keanu-4 beat`) in the live game tables.
