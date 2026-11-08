# ELI5 step 8: one name per game (#276)

"Beat the model" is the five-call game. The buy-and-sell yes/no game is "Market day" everywhere. Each game has one line of copy, used verbatim:

- **Beat the model:** "Five quick calls about a real, hidden day. Say how sure you are; see if you beat our model."
- **Market day:** "Buy and sell yes/no bets on a hidden day while our model sets the prices."

## Where the names changed

| Place | Change |
|---|---|
| Lobby landing (`*-lobby.png`) | A name card first, then one card per game with its line. Beat the model has Quick play, which was already the five-call game. Market day has "Play Market day solo", which was already the solo market. Before, the solo market sat under a "Beat the model" heading with a market description. "Play with others" and "Join with a code" are unchanged apart from the moved Quick play. |
| Host form (`desktop-host-form.png`) | The game options read Market day, Beat the model, Battery, with the same lines. A doubled full stop is fixed. |
| Phone Play hub (`phone-playhub.png`) | Two cards, one per game, both opening the lobby. |
| Big screen for a market room | Reads "The Living Grid · Market day" / "Market day". It used to say "Markets" and "Beat the model’s prices". |
| Market end screen | The kicker reads "Market day over". |
| Tour step 9 (`turn.play`) | The caption names both games using the two lines: "Your turn. Beat the model: five quick calls about a real, hidden day. Market day: buy and sell yes/no bets on a hidden day while our model sets the prices." |

## Checks and caveats

- Checked in headless Chromium under `nice -n 19`, one browser, closed after.
  - Viewports: desktop 1440x900 and phone 390x844.
  - No page errors.
  - "Markets" no longer appears as a game name on the lobby.
- Left as is: "mystery day" where it describes the hidden day rather than naming a game ("The mystery day was…").
- Left as is: the Play section's door line in `shell/sections.js` ("Beat the model: call the grid…"). That file is outside this task; say if it should name both games.
