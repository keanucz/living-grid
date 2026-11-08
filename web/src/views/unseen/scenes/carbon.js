// Scene 2, carbon that comes in by cable. Built from loaded data: d = { tonnes } (tonnes of CO2 an hour arriving in GB at the
// current flows, modelled; see tonnesPerHour in layers/carbonPuffs). The camera starts on the neighbours and pans along the
// cables into Britain while grey puffs ride the flow lines (layers/carbonPuffs) with their g/kWh tags; the counter climbs to
// the hourly total. Format: the runner's (see runner.jsx).
const NEIGHBOURS = { longitude: 4.5, latitude: 51.2, zoom: 4.6, pitch: 0, bearing: 0 }
const CABLES = { longitude: 0.5, latitude: 52.4, zoom: 5.1 }
const BRITAIN = { longitude: -1.5, latitude: 53.6, zoom: 5.6 }
const BASE = { ghostWind: false, boundaries: false, wind: false, solar: false, carbon: true, flows: true }

export default function carbonScene(d = {}) {
  return {
    id: 'carbon',
    duration: 10500,
    caption: 'Power does not stop at the coast.',
    counter: { label: 'Carbon arriving by cable, tonnes of CO2 an hour (modelled)', from: 0, to: 0, format: 'int' },
    steps: [
      { at: 0, layers: { ...BASE, carbonPuffs: false } },
      { at: 100, camera: NEIGHBOURS, dur: 1200 },
      { at: 2200, layers: { ...BASE, carbonPuffs: true } },
      { at: 2300, caption: 'Every cable carries the carbon of the grid it left. The tags are grams of CO2 per kilowatt-hour.' },
      { at: 2500, camera: CABLES, dur: 3000 },
      { at: 5600, camera: BRITAIN, dur: 2600 },
      { at: 6000, caption: 'Added up at today’s flows, this is the carbon Britain imports every hour.' },
      { at: 6200, count: { to: d.tonnes ?? 0, dur: 3200 } },
    ],
  }
}
