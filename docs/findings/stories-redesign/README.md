# Hidden grid: compact story picker and wind-farm circles (#261)

Checked in headless Chromium against the live API through the Vite dev proxy, 8 Nov 2026 about 02:30 UTC, desktop 1440x900 and phone 390x844.

## Before

- `before-desktop.png`, `before-phone.png`: four large cards, each with a headline number. The wind story and the full wind panel (constraint bill, boundary bars) were open by default.

## After

- `after-desktop.png`, `after-phone.png`: a small 2x2 picker, each tile a line icon and its title, with no numbers. Nothing is open underneath until a tile is chosen; the map still enters the wind story's layers.
- `after-*-wind-open.png`: an open story reads in this order:
  1. Keanu's intro sentence, verbatim.
  2. At most two live facts from `cards.js`, labelled Estimated or Sample data.
  3. For the wind story, a one-line circle legend.
  4. The source line, links, and a "More detail" toggle.
- `after-*-wind-more.png`: "More detail" shows the existing deeper panel (`constraintBill`).
- `after-*-bottleneck-open.png`, then `after-*-closed-again.png`: choosing the open tile again closes it. The map keeps that story's layers.
- `after-desktop-hover.png`: hovering a wind-farm circle shows a tooltip with:
  - the farm's name and capacity;
  - the estimated wind switched off in the window, labelled with the window;
  - "Estimated from its region's total".

  Farms with nothing switched off are drawn as a small teal dot with no halo, and they are still hoverable.

## Notes

- Circle size comes from accepted bids plus half the weather-implied gap, split by capacity. That is how the circles were already computed in `web/src/layers/ghostWind/`. So on a day with no paid bids the circles can still show size, from the weather gap alone. The legend and tooltip say this rather than "paid to switch off".
- One run fell back to sample data for ghost wind because the live API timed out under server load. Those screenshots show the "Sample data" tag, which is the intended behaviour.
- `MapView.jsx`: one generic line lets any layer supply its own tooltip through a `tooltip` prop. The tooltip style also gains `zIndex` so it draws above the side panel.
