# Renewables price impact (#174): estimated merit-order slopes

`GET /impact/renewables?zone=&from=&to=` (engine/impact.py). Method: per zone, OLS of the hourly day-ahead price on
wind, solar, load, TTF gas and time of day (sin/cos) over the 180 days before `to`. Slope = price change per extra GW.
Effect of an hour = slope x that hour's output (price against an otherwise identical hour with no wind or sun);
money = effect x the hour's load. Estimated, linear, and extrapolated to zero output, so a guide, not a market result.

Fit run on the VPS data (windows ending 6 Nov 2026). Price change per GW of wind, EUR (GB in GBP):

| Zone | Wind slope /GW | s.e. | Solar slope /GW | R2 | Hours in fit |
|---|---|---|---|---|---|
| GB | -6.9 | 0.20 | not metered | 0.69 | 1463 (Nord Pool GB has ~60 days) |
| FR | -9.8 | 0.19 | -9.9 | 0.77 | 4341 |
| DE-LU | -4.1 | 0.05 | -3.9 | 0.84 | 4342 |
| NL | -12.8 | 0.52 | dropped (series too small) | 0.48 | 4341 |
| BE | -28.6 | 0.57 | -28.6 | 0.71 | 4341 |
| NO2 | -16.3 | 0.70 | dropped | 0.47 | 4340 |

Worked example, 6 Nov 2026, mean over the day: GB wind effect -£19/MWh, about -£14m; DE-LU -€61/MWh, about -€87m.

Caveats: BE, NL and NO2 have weak fits and strongly coupled prices, so their slopes mostly reflect neighbours' wind;
BE's near-identical wind and solar slopes are a sign of that. Standard errors are in-sample OLS, not robust to
autocorrelation, so they are too small. Sources: Energy-Charts and Nord Pool prices, Energy-Charts and Elexon
generation and load, yfinance TTF.
