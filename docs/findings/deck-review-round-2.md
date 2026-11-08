# Deck review: round 2 (judge: stefan-4)

Reviewed from `review/round-2/` (contact sheet, 24 stills, `frames.md`), snapshot of 2026-11-08 08:19 UTC, and `docs/findings/weather-v2.md`. Test: "forecast-first: one honest forecast, many uses, proven in public".

**Panel average: 6.5 / 10. Ship: NOT YET. Ship once changes 1 to 3 are done; they are small and do not need a new round.**

Round 1 was 5.0. What improved: no blank frame, units fixed ("33.3 per MWh, six zones, pooled £ and €"), numbers re-snapshotted (33.3 vs 52.3 = 36% smaller, coverage 78.5% against an 80% aim, 991 scored live, battery 94% over 5 zones; all match the snapshot), "right now" replaced with "08:00 UTC", the forecast misses are shown (14 of 24 hours outside the range, red rings), the Proof slide now says "It wins, and it ties", and Play is merged into the close.

## Scores (1-10)

| Criterion | G-Research quant | HRT engineer | Presentation coach |
|---|---|---|---|
| Thesis clarity | 7 | 6 | 7 |
| Evidence | 8 | 6 | 6 |
| Honesty about uncertainty | 8 | 6 | 7 |
| Visual clarity and legibility | 6 | 6 | 5 |
| Pacing | 6 | 6 | 6 |
| Memorability | 6 | 6 | 7 |
| Accuracy against snapshot and README | 6 | 6 | 7 |
| **Mean** | **6.7** | **6.0** | **6.4** |

Overall 6.4. Quant: the Proof slide is now credible (baseline, coverage vs aim, tie stated, miss shown); the weather line overclaims by one word. HRT: still no scene where a trader or battery owner sees a decision; the product scene is two small screenshots and a card. Coach: the story is now hook, problem, forecast, proof, call to action; but the text is still small and the product scene is a slideshow of thumbnails.

## Blocking: factual errors

1. **Proof slide says "adding gusts, cloud, rain and ensemble weather cut day-ahead price error 5.6% and wind error 14.7%". "Ensemble" is wrong.** `weather-v2.md` tested six columns: gust max, cloud mean, precipitation, 100 m wind at farms and two alert shares, all from the historical-forecast kind. Ensembles could not be used as a trained feature (kept about 3 days). Delete the word (`Scenes.tsx:199`). The two figures themselves match the doc (price_da -5.6%, wind -14.7% MAE, pooled, 6 folds, 27 Sep to 7 Nov 2026) and the "not live yet" label is present. Good.
2. **"17 interconnectors" on the What-we-built scene.** The snapshot lists 17, of which 13 are in v1 (`in_v1`); the other four are not modelled or drawn (Viking, Greenlink, East-West and one more). Say 13, or "13 cables". Do not put a total that is not on the map.

## Not blocking, but the weather line is incomplete (honesty)

The same doc says price intervals got narrower (P10 to P90 coverage 76.6% to 73.7%), GB day-ahead price got worse (+1.9% MAE), and the window is six weekly folds with one seed and no significance test. One short clause fixes it: "...; 5 of 6 zones for price; narrower ranges; not live yet". The French wind result (-46%) should not be quoted.

## Five highest-value changes (ranked)

1. **Product scene: show each segment as a full-width screenshot, not a thumbnail in a box, and never a card.** In the stills, "Cheapest hours tonight" and "Where to put a data centre" are 5 cm screenshots on a black slide with a 30 px caption, and Hormuz is still a grey card showing "£1.8bn" with low-contrast text (Keanu's shot says £1.75bn: use the figure on the screenshot or `/scenarios`, not two). Use the 1920x1080 shots full frame with one overlaid number each. Why: a third of the deck, and it is where the HRT track looks.
2. **Fix the two wrong figures above ("ensemble", "17"), and add the weather caveats in one clause.** Why: it is a 10-minute change and the quant panel marks accuracy first.
3. **Legibility: all labels at least 28 px.** The Proof slide carries a two-bar chart, three stats, a four-line weather note and a caption; chart axes, stat labels ("Inside our likely range. Aim: 80%") and footers are still tiny and will not read from 10 m. Cut the weather note to one line and move it under the proof stats at 30 px, or drop the "Scored live" sub-caption.
4. **Close on the result, not the QR.** The reveal lands about 10:00 (GB) to 12:10 (continental). Re-render the final scene after the auction with "Monday's forecast vs the real price: within the band in N of 6 zones", and keep the QR smaller. If the result is not in before submission, keep this slide but say "result lands at 12:00, check live". Why: the thesis is "proven in public"; the proof should land, not be promised.
5. **Pacing: give the 8 s "How we built it" slide a real argument or cut it to 5 s.** It is two big numbers and 70% empty space. One line ("331 tasks, each tested before it merged") is enough, and the 3 s go to the product scene so each of its five segments gets at least 12 s.

## Other notes

- Battery 94% rests on 155 settled hours in 5 zones (snapshot note); the slide says 5 zones, fine, but add "in 155 hours" or the quant will ask.
- The hook's "Coupled markets often clear at one price" fixes the four €220 values; keep it.
- Vision test now: See yes, Understand yes, Test weak (Hormuz is a card), Trust yes, Use weak (tonight screenshot is too small to read).
- Strong moments to keep: the red-ring 26 Oct chart ("We show it") and "It wins, and it ties".
