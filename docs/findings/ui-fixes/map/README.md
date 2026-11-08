# Map fixes (#307)

Checked in Chromium on 8 November 2026 against the live API, at 1440×900, 1280×720, 1920×1080 and 390×844.

## 1. The square box behind the countries

**Cause:** the Sun layer (`web/src/layers/solar/`). It draws the modelled sunshine as one image over the whole 0.5 degree weather grid, which is a rectangle, and includes sea cells. So by day, with Sun on (Forecast, or the sunny story in Hidden grid), a block with stepped edges showed behind Britain, Norway and the continent. At night the image is empty, which is why it comes and goes.

**Fix:** the image is now clipped to the outlines of our six zones before it is drawn. No sea and no rectangle remain.

Screenshots: `before-sun-1440x900.png`, then `after-sun-*.png`, all at 10:00 UTC (Forecast, +6 h) with Sun on.

## 2. What if, 3D: circles, dots and pins you could not tie to a country

**Cause:** in What if each country is a bar whose height is its price (up to about 300 km). The effects and plant pins were drawn at ground level, so they showed up under the raised bars of other countries. Pembroke and Grain (Britain) and Eemshaven (Netherlands) appeared over France.

**Fixes:**
- **Raised to the right country.** Every effect and pin now sits on the top of its own country's bar. The country comes from the zone outlines, falling back to the nearest zone for coastal sites.
- **Smaller glow on gas plants.** The large pale glow is now a small one (9 to 15 px instead of 26 to 44 px), so it no longer hides borders.
- **Named terminals.** Each LNG terminal is named on its own dark label (Isle of Grain, Dunkirk, Zeebrugge, Rotterdam (Gate), Wilhelmshaven), instead of one "LNG terminals" label.
- **"Illustrative effect" readable.** It sits on a dark label on top of France.
- **Pin names on hover.** Hovering a plant pin shows its name and size, e.g. "Pembroke · 2,200 MW" (`after-pinhover-1280x720.png`).

Screenshots: `before-whatif-1440x900.png`, then `after-whatif-*.png`.

**Left as is:** the "Great Britain +38.3 £/MWh" callout can cover one or two terminal names, most on the phone. It is outside this task's paths.
