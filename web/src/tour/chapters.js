// The tour as data: seven chapters, and the order each audience sees them in. Nothing here is a screen. A step names
// where to be by id: a section (shell/sections.js), layers to switch (layers/*), a panel (panels/*), a stand-alone
// page, and a time. A redesign only has to keep those ids. Captions are plain British English, one or two sentences,
// and {tokens} are live figures filled in by tour/numbers.js; when a figure is missing the step shows `fallback`
// instead, so a caption never prints a dash or a made-up number.
//
// Step fields
//   id        unique, 'chapter.step'
//   section   a section id; the map state the step needs
//   layers    {layerId: bool} switched on top of the section's preset
//   panel     a panel id to point at (must be one of the section's panels or its `more`)
//   page      a hash path for a stand-alone page ('/replay', '/reveal', '/household', '/infrastructure')
//   view      what to show inside a page ('movies:storm')
//   at        map time: 'now', or '+6' hours
//   action    something to do: 'run:hormuz'
//   caption   what the presenter says; {tokens} are live
//   fallback  used when any token is missing
//   ms        how long the step stays up
//   for       which orders include the step; default all
export const ORDERS = {
  story: { label: 'The story', chapters: ['now', 'forecast', 'hidden', 'storm', 'whatif', 'trust', 'turn'] },
  // CLAUDE.md demo script, G-Research first: electricity is invisible, then ghost wind and carbon, why a price moved,
  // close the Strait of Hormuz, end on the scoreboard as proof the picture is accurate.
  gresearch: { label: 'G-Research first', chapters: ['now', 'hidden', 'forecast', 'whatif', 'trust'] },
  // HRT first: Europe now and the ghost six hours ahead, Hormuz with the pound figure and battery response,
  // scoreboard against persistence, the 26 October replay, then the Monday reveal.
  hrt: { label: 'HRT first', chapters: ['now', 'forecast', 'whatif', 'trust', 'storm'] },
}
export const DEFAULT_ORDER = 'story'

export const CHAPTERS = [
  { id: 'now', title: 'Europe right now', steps: [
    { id: 'now.price', section: 'now', at: 'now', layers: { flows: true }, panel: 'zoneList', ms: 12000,
      caption: 'Electricity is invisible, so we drew it. Right now Britain pays {gb_price} a megawatt-hour and southern Norway {no2_price}.',
      fallback: 'Electricity is invisible, so we drew it. Each country is coloured by what its power costs this hour.' },
    { id: 'now.flows', section: 'now', at: 'now', layers: { flows: true }, ms: 10000,
      caption: 'That gap is why power moves. {flows_gw} is crossing borders at this moment, and every bar on the map is a real cable.',
      fallback: 'That gap is why power moves. Every bar on the map is a real cable, and its speed is how much is flowing.' },
  ] },
  { id: 'forecast', title: 'Where it is heading', steps: [
    { id: 'forecast.ghost', section: 'forecast', at: '+6', panel: 'zoneChart', ms: 13000,
      caption: 'The ghost is our forecast. In six hours we expect Britain at about {gb_p6}, and four times in five between {gb_band}.',
      fallback: 'The ghost is our forecast. It fades as the range widens, because we would rather be honest than precise.' },
    { id: 'forecast.why', section: 'forecast', at: '+6', panel: 'explain', ms: 13000,
      caption: '{explain_sentence}',
      fallback: 'Every forecast comes with its reasons: wind, demand, gas, imports and the time of day, each with what it added or took away.' },
  ] },
  { id: 'hidden', title: 'What you cannot see', steps: [
    { id: 'hidden.ghostwind', section: 'hidden', at: 'now', layers: { ghostWind: true }, panel: 'stories', ms: 14000, for: ['story', 'gresearch'],
      caption: 'Scotland often makes more wind than the grid can carry south, so wind farms are paid to switch off. From {ghost_from} to {ghost_to} NESO’s constraint bill came to {ghost_bill}.',
      fallback: 'Scotland often makes more wind than the grid can carry south, so wind farms are paid to switch off. We estimate it two ways and label both as estimates.' },
    { id: 'hidden.carbon', section: 'hidden', at: 'now', layers: { carbon: true, ghostWind: false }, ms: 13000, for: ['story', 'gresearch'],
      caption: 'Britain’s own power emits {gb_prod} grams of carbon per kilowatt-hour. Count what comes in through the cables and what it consumes is {gb_cons}. Modelled, from standard emission factors.',
      fallback: 'A grid can look clean and still import dirty power. This layer counts the carbon in what a country actually consumes. Modelled, from standard emission factors.' },
    { id: 'hidden.bottleneck', section: 'hidden', at: 'now', layers: { boundaries: true, carbon: false }, ms: 12000, for: ['story', 'gresearch'],
      caption: '{b6_line}', fallback: 'The grid has limits on how much power can cross Scotland. When the wind outruns a limit, farms are paid to stop.' },
    { id: 'hidden.weather', section: 'hidden', at: 'now', layers: { wind: true, solar: true, boundaries: false }, ms: 9000, for: ['story', 'gresearch'],
      caption: 'Turn on wind and sun to see where the weather is making power right now. It is the reason prices move before anyone presses a button.' },
  ] },
  { id: 'storm', title: 'It has happened before', steps: [
    { id: 'storm.replay', page: '/replay', section: 'proof', ms: 14000,
      caption: 'On 26 October a storm cost the grid {storm_cost} in constraint payments, NESO’s figure. A model that had seen nothing from that day on kept {storm_inside} hours inside its band.',
      fallback: 'On 26 October a storm cost the grid £36.5m in constraint payments, NESO’s figure. This replay uses a model that had seen nothing from that day onwards.' },
    { id: 'storm.movie', page: '/replay', view: 'movies:storm', section: 'proof', ms: 14000, for: ['story', 'hrt'],
      caption: 'Here is the day as a short film: the wind peaks, the turn-down bids pile up, and the bill follows.' },
  ] },
  { id: 'whatif', title: 'Change the world', steps: [
    { id: 'whatif.hormuz', section: 'whatif', at: 'now', action: 'run:hormuz', panel: 'simDock', ms: 15000,
      caption: 'Close the Strait of Hormuz and gas rises by 40%. Over two weeks that is about {hormuz_cost} more for the wholesale market, and Britain’s price goes up {hormuz_gb}.',
      fallback: 'Close the Strait of Hormuz and gas rises by 40%. The pound figure counts up as the price shock spreads from the LNG terminals.' },
    { id: 'whatif.battery', section: 'whatif', at: 'now', panel: 'more', ms: 12000, for: ['hrt', 'story'],
      caption: 'A one-megawatt battery that plans for our uncertainty earns {battery_risk} of what perfect foresight would; one that trusts our median alone earns {battery_median}. Shares are averaged over the five zones we score (southern Norway is too flat to score).',
      fallback: 'We run two batteries on the same forecasts, one that plans for our uncertainty and one that trusts the median, against perfect foresight.' },
    { id: 'whatif.datacentre', section: 'whatif', at: 'now', panel: 'simDock', ms: 11000, for: ['story'],
      caption: 'Or drop in a data centre. {dc_line}',
      fallback: 'Or drop in a data centre: choose the GPUs, the site and how much work can move, and see the energy bill and the carbon.' },
  ] },
  { id: 'trust', title: 'Why trust us', steps: [
    { id: 'trust.scores', section: 'proof', at: 'now', panel: 'scoreboard', ms: 14000,
      caption: '{forecasts_scored} forecasts are logged before their outcome is known. Over the backtest our error is {mae_model} against {mae_persistence} for simply repeating the last price, and {coverage} of outcomes land in the band.',
      fallback: 'Every forecast is logged before its outcome is known and scored against simple baselines, including where we lose.' },
    { id: 'trust.reveal', page: '/reveal', section: 'proof', ms: 13000,
      caption: 'Monday’s day-ahead forecast was frozen at {frozen_at} and its fingerprint posted on Solana, so it cannot be quietly changed. {reveal_line}',
      fallback: 'Monday’s day-ahead forecast was frozen before the auction and its fingerprint posted on Solana, so it cannot be quietly changed.' },
  ] },
  { id: 'turn', title: 'Your turn', steps: [
    { id: 'turn.tonight', page: '/household', section: 'forecast', ms: 13000,
      caption: '{tonight_line}',
      fallback: 'Tonight’s cheapest hours for your region, and what they save against the price cap.' },
    { id: 'turn.play', section: 'play', ms: 11000,
      caption: 'Your turn. Beat the model: five quick calls about a real, hidden day. Market day: buy and sell yes/no bets on a hidden day while our model sets the prices.' },
  ] },
]

export const chapterById = Object.fromEntries(CHAPTERS.map((c) => [c.id, c]))

// The steps of an order, in order. A step with a `for` list only appears in those orders.
export function stepsFor(order = DEFAULT_ORDER) {
  const o = ORDERS[order] ?? ORDERS[DEFAULT_ORDER]
  const name = ORDERS[order] ? order : DEFAULT_ORDER
  return o.chapters.flatMap((id) => (chapterById[id]?.steps ?? []).filter((s) => !s.for || s.for.includes(name)).map((s) => ({ ...s, chapter: id })))
}

export const seconds = (order) => stepsFor(order).reduce((a, s) => a + s.ms, 0) / 1000
