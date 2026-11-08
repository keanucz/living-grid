# ELI5 step 4: Where the grid is full (#273)

Checked in headless Chromium under `nice -n 19` (one browser, closed after), against the live API through the Vite dev proxy, 8 Nov 2026. Viewports: desktop 1440x900 and phone 390x844.

- `*-first-visit.png`: "What am I looking at?" is open on a first visit and shows Keanu's two paragraphs verbatim. The cards are titled with the engine's plain names: Scotland to England, Central Scotland, North of Scotland, Northern England, then the countries. Each card shows two lines:
  - "Over the limit in N% of hours" when average use is above 100%, otherwise "N% full";
  - "X GW used of Y GW allowed".
- `*-experts-open-context-closed.png`: "For experts" on a card holds:
  - the NESO code and ETYS boundary;
  - the exact MW and percentages;
  - the method and source.

  Closing the context section is remembered in `localStorage`: after a reload it stays closed. The read and write are wrapped in try/catch.
- `desktop-map-labels.png`: Bottlenecks map labels use the same names and wording, e.g. "Scotland to England: over the limit in 34% of hours" and "Norway: 82% full".
- Directions show only when both ends are known. Cables read "Norway to Britain", never codes and never "null to null". The page text was checked for "null to null" and "NESO boundary X": neither appears.

## Open

- #270 (`Explain`, `Term`, glossary) had not merged when this was built. The page uses local `Term` and `Experts` stand-ins marked `TODO(#270)`, with the same children, so the swap is two imports. `Term` wraps "boundary", "Interconnector" and "constraint costs" where those words appear on the page.
- The context copy itself does not contain those three words, so no glossary terms sit in it. Ask Keanu whether a terms line is wanted there; none was added, so the copy stays verbatim.
