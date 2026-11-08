# #347: "Coupled market" map layer (off by default)

- **Layer** `web/src/layers/coupled/`: registers itself as "Coupled market (prices only)" in the Layers menu, off by default, overview mode only. It fills DK1, DK2, SE1 to SE4, FI, NO1, NO3, NO4, NO5, EE, LV, LT, AT and PL on the same price colour scale as the six main zones, at lower opacity. Each zone is labelled with its name and price, like "Sweden south €112" (zone codes on a phone). The hover card gives this hour's price and today's range, then "Price only, not forecast. Zone border approximate. Source: Nord Pool."
- **Data:** `GET /api/coupled`, falling back to `web/src/fixtures/coupled.json` once #346 commits it. It is fetched only while the layer is on, and at most every 10 minutes. With neither available, the layer draws nothing.
- **Legend** (desktop): with the layer on, one extra line reads "Prices only, not forecast. Zone borders approximate. Source: Nord Pool."
- **Phone:** a "Coupled market" chip at the end of the scrolling layer chips. Like the other overlays, choosing it turns the others off.
- **Geometry** `web/public/geo/coupled.json` comes from `scripts/make_coupled_geo.py`, which clips the country shapes in `europe.json` with shapely. Every feature is marked approximate.
  - Sweden is split by latitude: SE1 north of 65.5 N, SE2 61.5 to 65.5, SE3 57.5 to 61.5, SE4 south of 57.5.
  - Denmark: DK1 is west of 11.0 E, DK2 is east of it.
  - Norway is split around the NO2 box from #343: NO5 is the west south of 62 N, NO1 the east south of 62 N, NO3 62 to 65 N, NO4 north of 65 N.
  - A few label points are moved by hand so they do not collide.
- **Off:** nothing changes. The six zones, their labels, the tour and the section presets are untouched, and the layer is in no section preset.
- **Known limit:** the NO2 box from #343 (58.0 to 61.2 N, 4.8 to 9.2 E) also covers Bergen, which is really in NO5. So NO5 here is only the strip north of 61.2 N. Fixing that means changing the NO2 shape on the main map, which was out of scope during the freeze.

## Screenshots

`1920x1080-off.png`, `1920x1080-on.png`, `390x844-off.png` and `390x844-on.png`, from a `vite preview` of the branch in headless Chromium.

**The prices on the "on" shots are stub values** served in place of `/api/coupled` in the contract shape, because #346 had not landed yet. They show layout and colour only, not real prices. The 1920 "on" shot is after the label fix. The phone shot is from before it; the phone labels use zone codes and did not collide.
