# ELI5 step 9: judge walkthroughs on the plain-English screens

Task #284. Run on 8 November 2026 from 03:30 to 03:50 UTC on the live site https://htb.stefvuck.dev. The deployed web tree was 8c61070, which includes #270, #272, #273, #274, #275 and #276.

Each judge started from a fresh browser with no `lg-welcomed`, at 1440×900 desktop and 390×844 phone (touch), in one Chromium under `nice -n 19` that was closed afterwards. For every section and page, the script waited 10 s, then recorded the visible text and any code name or unit shown before "For experts". It then opened every glossary Term and every disclosure.

**No console errors, no HTTP errors and no fixture fallback during the run. No horizontal overflow on phone.**

The four judges (HRT trading engineer, G-Research quant, Bank of Scotland customer, Metaview product judge) shared one path per viewport: Welcome → Now → Forecast → Hidden grid → What if (run "Gas gets dearer") → Proof → Play → Tonight → Where the grid is full → Replay → Reveal. Their different readings are under each section.

## The 10-second test

| Section | After 10 s, can you say what it shows? | Notes |
|---|---|---|
| Welcome | **Yes** | "A map of Europe's electricity market. We forecast tomorrow's price in six countries, show what normally stays hidden, and prove how good our forecasts are." Six doors, each with a sentence. |
| Now | **Yes** | "Is power cheap right now?" → "Britain £181/MWh wholesale, about 18p per kWh. France and Germany €215/MWh." `wholesale` is a Term. |
| Forecast | **Mostly** | "Where are prices going?" plus a chart. There is no answer sentence, so you have to read the chart. The Terms "Day-ahead price", "Best guess" and "Likely range" are good, but the legend still reads "Best guess **P50** · Likely range **P10–P90**". |
| Hidden grid | **No** | Four tiles show only titles ("Scotland's wind, paid to stop", "Carbon that comes in by cable", "The bottleneck", "A sunny Sunday, negative prices"). There are no numbers until you click, even after 25 s. The opened text starts with BOALF, NESO and B6 (see below). |
| What if | **Yes, after one tap** | Event cards in plain words ("Gas gets dearer", "The cable to Norway breaks"). After Run: "If the Strait of Hormuz closed for two weeks, gas would cost 40% more. Europe's wholesale electricity bill would rise by about £1.77bn, and Britain's wholesale price by about 3.8p per kWh (£38.33 per MWh)." On desktop there is no headline question before you pick an event; the phone shows "What if the world changes?". |
| Proof | **Yes** | "Can we trust the forecast?" → "Our price forecasts are 36% less wrong than guessing the price stays where it is. The real price landed inside our likely range 78% of the time. That is what we aim for." |
| Play | **Yes** | "Play with the room" / Beat the model lobby; one name per game since #276. |
| Tonight | **Yes** | Two cards: "Run the dishwasher · Sun 05:30–06:30 · 31.9p/kWh average", "Charge your car · Sun 04:00–07:00 · 32.3p/kWh average". "Octopus Agile, a tariff whose price changes every half hour" explains Agile. |
| Where the grid is full | **Partly** | The plain cards come first (#273), but the open text still names SSEN-S, SSE-SP, SSHARN and NESO, and has "thermal constraint costs" and "nested boundaries" (see below). |
| Replay | **Partly** | "The 26 October storm" is clear, but "Model asof-20261026", "Forecast P50, P10–P90 band" and "1 of 1 hours inside the band" are visible without opening anything. |
| Reveal | **Yes** | "Monday's forecast, frozen before the auction". "Was the forecast changed after the fact? ✓ Match: this file is exactly what was committed" is excellent. "Frozen P50 range £197–£270" uses a code name, and "P50 range" reads as a contradiction (a single best guess shown as a range across hours). |

## Code names and units visible before "For experts"

| Seen where | Text on screen | Suggested words |
|---|---|---|
| Every map section, price labels on the map | "GB £181 FR €215 **DE-LU** €215 NL €215 BE €215 **NO2** €193" | Germany, Norway (the zone list already says "Southern Norway"). |
| Every map section, legend | "**€/MWh** -50 0 50 … 400" | Legend title "Price, € per MWh" with the `wholesale` or a new `mwh` Term. |
| Forecast legend; Replay legend | "Best guess **P50**", "Likely range **P10–P90**", "Forecast **P50, P10–P90** band" | Drop the codes; the Terms already explain them. |
| Replay | "Model **asof-20261026** saw no data on or after 26 October 2026" | "Our model was trained only on data before 26 October 2026". Also "**1 of 1 hours** inside the band" → "1 of 1 hour". |
| Reveal | "Frozen **P50** range £197–£270" | "Best guess between £197 and £270 across the day". |
| Hidden grid (opened tile) | "Source: Elexon accepted bids (**BOALF**) and **NESO** constraint costs", "**B6**, the Scotland to England boundary, was forecast over its limit in 34% of hours", "(**NESO**, 29 Oct; newest, ~1 week lag)" | Move the sources and B6 under "For experts"; keep "the line from Scotland to England was over its limit a third of the time". |
| Where the grid is full | "The Scottish boundaries are nested (**SSEN-S, SSE-SP and SSHARN** also exceed …)", "**NESO**'s day-ahead flow forecast", "£198.2m of GB **thermal constraint costs**" | Move under "For experts". |
| What if, impact tiles | "**GHOST WIND** 0.0 GWh paid to switch off", "HARDEST HIT GB +38.3 **£/MWh**", "More · **2 panels** · Show" | "Wind paid to switch off"; "+3.8p per kWh"; "More detail". |
| Now, zone list | "GB carbon 345 **g/kWh**", "4.3 GW demand · a day behind" | `carbon-intensity` and `gw` Terms exist in the glossary but are not used here. |

## Glossary

- **Every Term on screen has an entry and a clear definition.** Terms in use: wholesale, Day-ahead price, Best guess, Likely range, auction, fingerprint.
  - Example (Likely range): "The range where we think the real price will land. It should fall inside 8 times out of 10."
- **Defined but not used anywhere visible:** `interconnector`, `constraint`, `boundary`, `persistence`, `backtest`, `carbon-intensity`, `negative-price`, `gw`, `kwh`. Those words appear in plain text on Hidden grid, Replay, Where the grid is full and the zone list without the dotted underline.
- **Missing:** none needed for the visible words, except MWh. It appears on every map section; the `kwh` entry exists but MWh has none.

## Numbers a judge could not explain

- **Now vs Tonight.** Now says Britain is "about 18p per kWh" wholesale, but Tonight's cheapest slots are 31.9p and 32.3p per kWh. The Now card has no Why? to explain that bills add network costs, VAT and margin. The `wholesale` Term does say so, but only on hover.
- **Proof says 78%, but the Proof headline in #228 said 80%,** and the two figures for "less wrong" were 36% now against 24% earlier. Live figures moving overnight is fine, but the card is tagged LIVE while #285 (which adds `headline.basis`) is still open, so a judge cannot tell whether the number is live or from the backtest.
- **What if.** The sentence says £1.77bn and 3.8p per kWh, while the tiles underneath say "£218.9 ▲ 38.3 vs now" and "+38.3 £/MWh". It is the same number in two units on one screen.
- **Hidden grid.** "No wind was paid to switch off in the last 24 hours" next to "The newest published daily constraint bill was £18.8m". Both are true (different days), but with no plain sentence linking them it reads as a contradiction.

## Broken or rough

- **Hidden grid tiles have no numbers until clicked,** on desktop and phone. In #228 they showed "0.0 GWh last 24 h", "+37 g/kWh now", "£57.7m 11 days", "−€414/MWh".
- **What if (desktop) has no headline question** until you pick an event, while the phone shows "What if the world changes?".
- **What if: "Working it out…" showed** for a few seconds after picking an event, before Run.

## Per judge, one line

- **HRT trading engineer:** What if is now a one-sentence answer with a pound figure; the tiles below it still talk in £/MWh and "ghost wind".
- **G-Research quant:** Proof's card is clear. Replay and Reveal still show P50/P10–P90 and a model id before "For experts".
- **Bank of Scotland customer:** Tonight passes. Now's 18p wholesale against Tonight's 32p needs one sentence.
- **Metaview product judge:** Welcome, Now, What if and Proof pass the 10-second test. Hidden grid fails it, and the zone codes on the map are the first thing on every screen.

## Fix tasks added (lane C)

- #292: Hidden grid in plain words.
- #293: Replay and Reveal code names.
- #294: zone codes and the €/MWh legend on the map, plus the Forecast legend.
- #295: What if impact tiles, and the Where the grid is full expert text.

## Round 2 (task #298)

Run on 8 November 2026 from 05:05 to 05:25 UTC on https://htb.stefvuck.dev. The deployed web tree was 2ef6857a, which is the `web/` tree of 9b0ec7b and includes #279, #292, #293, #294 and #295. The method was the same as round 1: one Chromium under `nice -n 19`, closed afterwards; 1440×900 desktop, then 390×844 phone with touch; a fresh Welcome; a 10 s wait on every section; "Gas gets dearer" run on What if. The server load average was about 27 during the run.

**No page errors, no console errors and no HTTP errors. No horizontal overflow on phone.** A deploy landed during the run (#306), so from Forecast onwards every screen shows "New version available · Reload", sitting over the price legend.

### The 10-second test

| Section | Round 1 | Round 2 | Notes |
|---|---|---|---|
| Welcome | Yes | **Yes** | Unchanged. |
| Now | Yes | **Yes** | The map labels now say Britain, Germany and Norway (#294), and the legend reads "Wholesale price, € per MWh". The zone list still shows the badges `NO2` and `DE`, and "GB carbon 341 g/kWh" has no Term. |
| Forecast | Mostly | **Mostly** | The legend is now "Day-ahead price · Already auctioned · Best guess · Likely range", with no P-codes. There is still no answer sentence, so you have to read the chart. The footnote under "Why this price" reads "11-08 11:00 UTC · forecast £197.7/MWh, −£13 against the reference … Attribution of the model’s own number, not a proven cause." |
| Hidden grid | No | **Yes, after one tap** | The tiles still show no numbers (that is #292's choice). One tap gives a plain intro, then "No wind was paid to switch off in the last 24 hours. The latest published daily constraint bill was £18.8m, for 29 Oct." BOALF, NESO and B6 are gone from the open text. Rough edge: "(last 24 h) ESTIMATED" comes after "These bills come out about a week late", so it seems to label the bill. |
| What if | Yes, after one tap | **Yes** | Desktop now opens with "What if the world changes?". The tiles are in pence: "BRITAIN, WHOLESALE 21.7p ▲ 3.8p per kWh vs now", "HIT HARDEST Great Britain +3.8p per kWh". The map callout still reads "Great Britain +38.3 £/MWh" (#301 is open). |
| Proof | Yes | **Yes** | "Can we trust the forecast?" tagged BACKTEST, with "From the backtest: 12,086 hours of past weeks the model never saw, until enough live forecasts are scored." (#285). On desktop the card was not yet on screen at 10 s under this load. |
| Play | Yes | **Yes** | Unchanged. |
| Tonight | Yes | **Yes** | At 05:00 only one card shows ("Run the dishwasher · Sun 05:30–06:30 · 31.9p/kWh average"); "Charge your car" is gone. "Cheapest power tonight" reads oddly at 5 am. Both depend on the data and the time, so no task. |
| Where the grid is full | Partly | **Yes** | Plain cards: "Northern England · Over the limit in 67% of hours · 7.3 GW used of 5.8 GW allowed". The SSEN-S, SSHARN and NESO text is under For experts. Minor: "Scotland to England" is printed twice on its card. |
| Replay | Partly | **Mostly** | The summary is plain ("Our model was trained only on data before 26 October 2026 … 78 of 168 hours landed inside our likely range"), and "1 of 1 hour" is fixed. Two problems: the series chips read "GB GB system price", "DE-LU Day-ahead price" and "NO2 Day-ahead price"; and the map shows **today's** boundary labels and wind circles (see below). |
| Reveal | Yes | **Yes** | "Best guess between £197 and £270 across the day", and the legend reads "Frozen likely range / Frozen best guess". No codes. |

### Code names and units still visible before "For experts"

| Seen where | Text on screen | Suggested words |
|---|---|---|
| Replay, series chips | "GB **GB system price**", "**DE-LU** Day-ahead price", "**NO2** Day-ahead price" | "Britain, system price", "Germany", "Norway" |
| Now, zone list | badges "**NO2**", "**DE**"; "GB carbon 341 **g/kWh**" | Drop the badges, or use the names; wrap carbon in the `carbon-intensity` Term. |
| Forecast, Why this price | "**11-08 11:00 UTC** · forecast £197.7/MWh, −£13 **against the reference** … **Attribution of the model’s own number**, not a proven cause." | Move under For experts; plain: "Compared with a typical hour. These are the model’s reasons, not proof of cause." |
| What if, map callout | "Great Britain +38.3 **£/MWh**" | Already #301. |
| Phone, layer chips | "**Ghost wind**" | Already #301. |
| Replay, side tile | "WIND PAID TO SWITCH OFF, THAT DAY SO FAR **3,256 MWh**" | Fine with a `mwh` Term, or "3.3 GWh" with the `gw` style. Low priority. |

### Broken or rough

- **Hidden grid map layers leak into later sections.** Hidden grid sets `layers.boundaries: true` (`web/src/shell/sections.js:22`), and no other section sets it back to false. So after Hidden grid, Proof and the 26 October Replay map both show "Scotland to England: over the limit in 34% of hours", "Norway: 82% full" and the Scottish wind circles. On the Replay those are **today's** 21-day figures over a 26 October map, which reads as data for that day. A judge following the demo path will always see this.
- **"New version available · Reload" covers the price legend** whenever a deploy lands while the page is open. It is harmless, but it would show during the 12:30 demo if anything merges after the screens are opened.
- **Proof was slow:** the card was not on screen after 10 s on desktop. The load average was 27, so this is mostly the box, not the page.

### Per judge, one line

- **HRT trading engineer:** What if now speaks in pence on every tile; only the map callout still says £/MWh.
- **G-Research quant:** Replay and Reveal are clean in words. Replay's map borrowing today's boundary labels is the one thing that would make them doubt the replay.
- **Bank of Scotland customer:** Now, What if and Tonight pass. Forecast still has no sentence to read.
- **Metaview product judge:** 9 of 11 sections pass the 10-second test (Forecast and Replay are "Mostly"), up from 7 in round 1.

### Fix tasks added (lane C)

None of them changes the selectors used by the fallback recorder (section tabs, `.wi-card`, `#/replay .rp-play`, the `#/reveal` structure).

- #312: reset the Hidden grid map layers when leaving it (Proof and Replay show today’s boundary labels).
- #313: Replay series chips use zone and target names instead of codes.
- #314: Forecast "Why this price" footnote in plain words, with the timestamp and model detail under For experts.
