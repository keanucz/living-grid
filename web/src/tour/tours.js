// The tours are data. A step names things by id and never by position or markup:
//   section  a section id from shell/sections.js (the engine opens it)        page    a stand-alone page hash, e.g. '#/replay'
//   layers   { layerId: boolean } applied after the section's own preset       at      'now' | '+6' | '-24' | an ISO time
//   event    a world event id (simDock) to run, with an optional magnitude      target  the data-tour id to ring (default: panel)
//   panel    a panel id; it is rung by default                                  say     the caption; {key} is replaced by a live figure
//   live     { key: { path, get(json) -> string, fallback } } figures from the API; the fallback is used offline
//   duration seconds the step stays up in presenter mode (#tour=name&autoplay)
// A redesign only has to keep the ids; verifyTours() in index.js checks every one of them.
const gbPrice = (j) => {
  const z = j.zones.find((x) => x.zone === 'GB')
  return `£${Math.round(z.price.value)}/MWh`
}
const euPrice = (zone) => (j) => `€${Math.round(j.zones.find((x) => x.zone === zone).price.value)}/MWh`
const money = (v) => `£${(v / 1e6).toFixed(1)} million`

const LIVE = {
  gb: { path: '/state', get: gbPrice, fallback: 'the price on the map' },
  no2: { path: '/state', get: euPrice('NO2'), fallback: 'far cheaper' },
  bill: { path: '/unseen/ghost-wind', get: (j) => money(j.constraint_cost_total_gbp), fallback: 'millions of pounds' },
  mae: { path: '/scores', get: (j) => `${j.headline.mae_model.toFixed(1)} against ${j.headline.mae_persistence.toFixed(1)}`, fallback: 'lower than the baseline' },
  scored: { path: '/scores', get: (j) => String(j.headline.forecasts_scored), fallback: 'many' },
}
const pick = (...keys) => Object.fromEntries(keys.map((k) => [k, LIVE[k]]))

export const TOURS = {
  main: {
    title: 'The 3-minute tour',
    steps: [
      { id: 'prices', section: 'now', at: 'now', target: 'zoneList', duration: 9,
        say: 'Electricity is invisible. This is every country’s day-ahead price right now: Great Britain is {gb}, southern Norway {no2}.', live: pick('gb', 'no2') },
      { id: 'flows', section: 'now', layers: { flows: true }, target: 'layers', duration: 8,
        say: 'The arcs are power flowing through the cables between countries, thicker for bigger links. The Layers menu turns the other views on and off.' },
      { id: 'forecast', section: 'forecast', target: 'zoneChart', duration: 9,
        say: 'The translucent ghost is our forecast for the next hours. It fades as the P10 to P90 band widens: honest uncertainty, not a single line.' },
      { id: 'history', section: 'forecast', at: '2026-10-26T12:00:00Z', target: 'scrubber', duration: 12,
        say: 'The time bar reaches back to January 2024. Drag it, pick a date or press play; orange marks on the strip are big events. This is 26 October, the storm day. Live brings you back.' },
      { id: 'explain', section: 'forecast', at: '+6', target: 'explain', duration: 8,
        say: 'Every forecast comes with a reason in plain words, from the model’s own feature contributions.' },
      { id: 'ghostwind', section: 'hidden', at: 'now', target: 'stories', duration: 10,
        say: 'What normally stays hidden: Scottish wind that was paid to switch off. NESO’s constraint costs in the latest window come to {bill}. Wind and carbon figures here are estimates, and labelled so.', live: pick('bill') },
      { id: 'hormuz', section: 'whatif', event: { id: 'hormuz' }, target: 'simDock', duration: 12,
        say: 'Close the Strait of Hormuz and watch the gas shock ripple across Europe, with the bill in pounds. Gas pass-through approximates market coupling.' },
      { id: 'proof', section: 'proof', at: 'now', target: 'scoreboard', duration: 10,
        say: 'Proof: {scored} forecasts logged before their outcome, with an average error of {mae}. Where we lose to the baseline, we say so.', live: pick('scored', 'mae') },
      { id: 'play', section: 'play', target: 'tab-play', duration: 7,
        say: 'Think you can read the grid better than the model? Play a real, hidden day against our forecasters.' },
    ],
  },
  // A short tour used to test the engine on desktop and phone.
  test: {
    title: 'Engine test',
    steps: [
      { id: 'a', section: 'now', at: 'now', target: 'tab-now', say: 'Step one: the Now tab. Great Britain is {gb}.', live: pick('gb'), duration: 4 },
      { id: 'b', section: 'forecast', target: 'scrubber', say: 'Step two: the time bar.', duration: 4 },
      { id: 'c', section: 'proof', target: 'layers', say: 'Step three: the Layers menu.', duration: 4 },
    ],
  },
}
