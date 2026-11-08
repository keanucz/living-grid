# Hidden grid map: Channel cable labels (#325)

Checked in Chromium on 8 November 2026 against the live API, on Hidden grid with The bottleneck open, at 1280×720, 1440×900 and 1920×1080.

**Before:** the "France: 25% full" and "Belgium: 26% full" labels sat on top of each other near the Channel, with "Netherlands: 32% full" just above. The Belgium and Netherlands lines were also drawn in the wrong place: on the France to Belgium and Belgium to Netherlands borders, not on the cables from Britain. Each country took its largest link, from any country.

**Fix** (`web/src/layers/boundaries/index.js`):
- Each country's line is now its largest cable from Britain (France: IFA, Belgium: Nemo Link, Netherlands: BritNed).
- The three Channel labels sit where each cable reaches the continent, fanned out north to south with a fixed gap of 24 px. They cannot overlap at any zoom. Netherlands reads to the left, over the North Sea, so the story panel does not cover it at 1280×720.
- Other labels (Norway, Scotland to England) are unchanged.

Screenshots: `before-*.png`, then `after-*.png`.
