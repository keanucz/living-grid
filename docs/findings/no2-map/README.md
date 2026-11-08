# #343: only southern Norway carries the NO2 price

- `web/public/geo/europe.json`: the `Norway` feature now has `zone: null`, so it is not painted, hovered or labelled with a price (like Sweden). A new `Southern Norway` feature (`zone: NO2`, `approximate: true`) uses the polygon from `data/static/bidding_zones.geojson`: Natural Earth clipped by hand to roughly 58.0 to 61.2 N, 4.8 to 9.2 E, not the official bidding-zone border.
- `web/src/map/MapView.jsx`: the map label for NO2 reads "S. Norway". "Southern Norway" stays everywhere else (hover card, lists).
- All three NO2 links end inside the new shape: North Sea Link (6.62, 59.5), NorNed (6.8, 58.2), NordLink (7.0, 58.3). The label point (7.5, 59.0) is inside it too.
- `before-after.svg` draws both versions of the geometry with the arcs and the label point. It is drawn from the files, not a browser screenshot: there was no time for a 1920x1080 and 390x844 browser pass before the 09:00 freeze under the current load, so please glance at both sizes on live.
