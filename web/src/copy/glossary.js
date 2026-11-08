// Plain-English definitions behind <Term id="...">: `term` is the word as defined, `text` the definition.
// Final copy from Keanu (drafted, edited, fact-checked by hand); keep it verbatim.
export const GLOSSARY = {
  "day-ahead": { term: "Day-ahead price", text: "Electricity for tomorrow is bought and sold in an auction the day before. The day-ahead price is what that auction sets, and it's what we forecast." },
  "likely-range": { term: "Likely range", text: "The range where we think the real price will land. It should fall inside 8 times out of 10." },
  "best-guess": { term: "Best guess", text: "Our single most likely price. The real price should come in above it about half the time and below it about half the time." },
  kwh: { term: "Kilowatt-hour (kWh)", text: "The unit on your electricity bill. An average British home uses about 2,700 kWh a year. A megawatt-hour (MWh) is 1,000 kWh." },
  gw: { term: "Gigawatt (GW)", text: "How much power something produces at one moment. A gigawatt is roughly what a big power station puts out. A megawatt (MW) is a thousandth of that." },
  interconnector: { term: "Interconnector", text: "A cable under the sea or underground that links Britain's grid to another country's, so electricity can be traded across the border." },
  constraint: { term: "Constraint cost", text: "When a power line is full, the grid pays generators on one side to make less and generators on the other side to make more. That bill is the constraint cost, and it ends up on everyone's bills." },
  boundary: { term: "Boundary", text: "A group of power lines carrying electricity between two areas, such as Scotland and England. Its limit is how much can safely cross at once." },
  wholesale: { term: "Wholesale price", text: "What energy suppliers pay for electricity in the market. A household bill adds network costs, other charges and the supplier's margin, and only follows wholesale changes later." },
  persistence: { term: "Persistence", text: "The simplest forecast there is: assume the price stays where it was when the forecast was made. A useful model has to beat it." },
  backtest: { term: "Backtest", text: "Testing the model on past weeks it never saw while it was being built, as if it were forecasting them live." },
  "carbon-intensity": { term: "Carbon intensity", text: "How many grams of carbon dioxide were released to make each kilowatt-hour of electricity." },
  "negative-price": { term: "Negative price", text: "Sometimes there's more electricity than people want. Some power stations then pay to keep running rather than switch off, and the price drops below zero." },
  fingerprint: { term: "Fingerprint", text: "A short code calculated from our forecast file. Change one digit and the code changes completely. We published it on a public blockchain before the auction, so anyone can check the forecast wasn't changed afterwards." },
}
