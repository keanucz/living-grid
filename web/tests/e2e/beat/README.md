# Beat the model: end-to-end test

Playwright (playwright-core, any Chromium) against a running stack, the live site by default.

    BASE=https://htb.stefvuck.dev PLAYWRIGHT_MODULE=/path/to/node_modules/playwright-core \
      OUT=/tmp/beat-e2e ROUNDS=3 nice -n 10 node web/tests/e2e/beat/beat.e2e.cjs solo room

- `solo`: the Polymarket-style markets game on iPhone 13 emulation. Checks the feed (price 1 to 99%, Yes and No asks one
  cent either side, close time), the trade sheet's shares and cost, the position list, buy then sell (the 2-cent
  spread, read exactly from `pm_trade` and `pm_account`), per-market reveals (outcome, what happened, reason, profit rows
  for you and four bots), the end screen (date, profit equal to the recorded result, four bots, rank), and times a round.
  `ROUNDS=3` plays Play again and checks the rounds are dealt different days.
- `room`: a desktop host, the big screen and two phones in a lobby playing the 5-call Beat the model game (needs Beat the model days loaded).
- `roompm`: the same room playing the markets: shared prices, each phone trading on its own account, standings with the other person, the big screen (players, trade ticker, date and podium at the end) and the recorded results. Needs `pm_day` loaded and the module with lobby mode `pm`; to test before a republish, run a local SpacetimeDB under the database name `living-grid`, build the web with `VITE_LG_STDB_URL=ws://127.0.0.1:PORT` and set `STDB_HTTP=http://127.0.0.1:PORT`.
- Leak checks, both modes: anonymous SQL must not read `pm_day`, `pm_secret`, `beat_day`, `beat_pick`; open markets carry
  no outcome or actual text; no price ahead of the game clock; the date and each reveal string must not appear in any
  WebSocket frame before its reveal (frames are decompressed and searched).
- Output: `report.json` and screenshots in `OUT`. Problems are recorded, not thrown, so one failure does not hide the next.
  Each real problem is filed as its own hub task; the screenshots of the first run are in `findings/`.

Not covered: Quick play and the meta leaderboard screen, the battery mode, desktop layouts of the solo game.
Known limits: the screen rounds to one decimal (above 100 to whole points), so display checks allow that; a trade placed
in the same second the hour ticks can fill at the new price, which the script logs instead of flagging.
