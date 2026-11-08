// The tours are data. A step names things by id and never by position or markup:
//   section  a section id from shell/sections.js (the engine opens it)        page    a stand-alone page hash, e.g. '#/replay'
//   layers   { layerId: boolean } applied after the section's own preset       at      'now' | '+6' | '-24' | an ISO time
//   event    a world event id (simDock) to run, with an optional magnitude      target  the data-tour id to ring (default: panel)
//   panel    a panel id; it is rung by default                                  say     the caption; {key} is replaced by a live figure
//   live     { key: { path, get(json) -> string, fallback } } figures from the API; the fallback is used offline
//   camera   a map fly-to { longitude, latitude, zoom, pitch?, bearing? }; null flies home
//   duration seconds the step stays up in presenter mode (#tour=name&autoplay)
// A redesign only has to keep the ids; verifyTours() in index.js checks every one of them.
const gbPrice = (j) => {
  const z = j.zones.find((x) => x.zone === 'GB')
  return `£${Math.round(z.price.value)}/MWh`
}
const euPrice = (zone) => (j) => `€${Math.round(j.zones.find((x) => x.zone === zone).price.value)}/MWh`
const money = (v) => `£${(v / 1e6).toFixed(1)} million`
const day = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })

const LIVE = {
  gb: { path: '/state', get: gbPrice, fallback: 'the price on the map' },
  no2: { path: '/state', get: euPrice('NO2'), fallback: 'its own price' },
  bill: {
    path: '/unseen/ghost-wind',
    get: (j) => {
      const c = j.constraint_costs
      return `${money(j.constraint_cost_total_gbp)} over the ${c.length} days published so far, ${day(c[0].date)} to ${day(c.at(-1).date)}`
    },
    fallback: 'millions of pounds over the days published so far',
  },
  // Pooled across zones in £ and €, so a plain number: the caption says "per MWh".
  model: { path: '/scores', get: (j) => j.headline.mae_model.toFixed(1), fallback: 'a few tens' },
  baseline: { path: '/scores', get: (j) => j.headline.mae_persistence.toFixed(1), fallback: 'more' },
  scored: { path: '/scores', get: (j) => String(j.headline.forecasts_scored), fallback: 'many' },
}
const pick = (...keys) => Object.fromEntries(keys.map((k) => [k, LIVE[k]]))

export const TOURS = {
  main: {
    title: 'The 3-minute tour',
    steps: [
      { id: 'prices', section: 'now', at: 'now', target: 'zoneList', duration: 9, camera: null,
        say: "This is the current conditions map for Europe's power grid. Each country is coloured by its price for this hour, set in yesterday's auction. Britain is {gb}; southern Norway is {no2}.", live: pick('gb', 'no2') },
      { id: 'flows', section: 'now', layers: { flows: true }, target: 'layers', duration: 8,
        say: "The lines between countries are power flowing through the cables that link them, many under the sea. Thicker lines are bigger cables. The Layers button switches the other views on and off." },
      { id: 'forecast', section: 'forecast', target: 'zoneChart', duration: 9,
        say: "This is the outlook. The faint block shows our forecast for the next few hours. The fainter it is, the less sure we are." },
      { id: 'history', section: 'forecast', at: '2026-10-26T12:00:00Z', target: 'scrubber', duration: 12,
        say: "The time bar goes back to January 2024. Drag it, pick a date or press play. Orange ticks are big events: this one is the storm on 26 October. Press Live to jump back." },
      { id: 'explain', section: 'forecast', at: '+6', target: 'explain', duration: 8,
        say: "Each forecast says why, in plain words: what pushed the price up and what pulled it down." },
      { id: 'ghostwind', section: 'hidden', at: 'now', target: 'stories', duration: 10, camera: { longitude: -4.0, latitude: 57.0, zoom: 5.0 },
        say: "This is the radar for what you cannot see. When the lines to the south are full, Scottish wind farms get paid to stop generating. The grid's published bills for that come to {bill}. The numbers here are estimates, and we say so.", live: pick('bill') },
      { id: 'hormuz', section: 'whatif', event: { id: 'hormuz' }, target: 'simDock', duration: 12,
        say: "A warning, tested early: close the Strait of Hormuz and watch dearer gas push up electricity prices across Europe. The bill comes out in pounds." },
      { id: 'proof', section: 'proof', at: 'now', target: 'scoreboard', duration: 10,
        say: "Was the forecast right? We've scored {scored} live forecasts so far, each sealed on Solana before the real price was known. On past weeks it never saw, the model was off by {model} per MWh on average. Guessing that the price stays put was off by {baseline}. Where we lose, we show it.", live: pick('scored', 'model', 'baseline') },
      { id: 'play', section: 'play', target: 'tab-play', duration: 7,
        say: "Think you can beat the forecaster? Play a real day from the past, with the date hidden." },
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

// The two judge orders of demo/scripts, built from the same steps, for presenter mode and the fallback videos:
//   #tour=g-research&autoplay   making the unseen seen leads, prediction is the proof
//   #tour=hrt&autoplay          prediction and decisions lead, the unseen is context
const byId = Object.fromEntries(TOURS.main.steps.map((s) => [s.id, s]))
const MORE = {
  carbon: { id: 'carbon', section: 'hidden', layers: { carbon: true, ghostWind: false }, target: 'stories', duration: 10, camera: null,
    say: "On the radar too: carbon crosses borders. A country can look clean at home while running on dirty imports. This view shows the carbon in each country's electricity use, worked out with standard emission figures." },
  battery: { id: 'battery', section: 'whatif', target: 'simDock', duration: 9,
    say: "Every country has a test battery that reacts to the gas shock. One plans with our likely range, the other with our best guess only. The battery card shows how close each gets to perfect hindsight." },
  replay: { id: 'replay', page: '#/replay', target: 'map', duration: 10,
    say: "This replays 26 October with a model trained only on data from before that day, so asking whether we'd have seen it coming is a fair test." },
  reveal: { id: 'reveal', page: '#/reveal', target: 'map', duration: 9,
    say: "Monday's forecast was sealed before the auction. As the real prices arrive, they appear next to it." },
}
const compose = (title, ids) => ({ title, steps: ids.map((i) => byId[i] ?? MORE[i]) })
TOURS['g-research'] = compose('G-Research order', ['prices', 'ghostwind', 'carbon', 'explain', 'hormuz', 'proof'])
TOURS.hrt = compose('HRT order', ['prices', 'forecast', 'hormuz', 'battery', 'proof', 'replay', 'reveal'])
