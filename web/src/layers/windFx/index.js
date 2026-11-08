import { LineLayer, TextLayer } from 'deck.gl'
import { getField } from '../wind/grid.js'
import { createStreaks } from '../wind/streaks.js'

// Wind blowing across the map while a wind simulation is on (Storm over Scotland, or a windless week). The streaks follow the
// modelled 100 m wind field for the hour shown, sped up or slowed by the size of the scenario, and glow brighter over
// the Scottish wind farms, where the ghost wind is. No chip: it appears only with a wind scenario.
// The field is Open-Meteo's (modelled); the change in speed is the scenario's size applied to it, so it is labelled as such.
const WIND_EVENTS = new Set(['scottish_storm', 'wind'])
const SCOTLAND = { lon: [-7.9, -1.5], lat: [55.2, 58.9] }
const streaks = createStreaks(2600)
const inScotland = (lon, lat) => lon > SCOTLAND.lon[0] && lon < SCOTLAND.lon[1] && lat > SCOTLAND.lat[0] && lat < SCOTLAND.lat[1]
const LABEL = [{ at: [-1.5, 60.2] }]

export default {
  id: 'windFx',
  label: 'Wind in the simulation',
  hidden: true,
  order: 58,
  modes: ['simulate'],
  defaultOn: true,
  build({ ui, time }) {
    const run = ui.scenario
    if (!run || !WIND_EVENTS.has(run.id)) return []
    const f = getField(ui.at)
    if (!f) return []
    // Magnitude is a percentage: +% for a storm, negative for a windless spell. Britain's north gets the full change.
    const m = (run.id === 'scottish_storm' ? run.magnitude : run.magnitude ?? 0) / 100
    const north = Math.max(0.08, 1 + m)
    const wide = Math.max(0.08, 1 + 0.5 * m)
    const density = Math.min(1, Math.max(0.2, 0.3 + 0.5 * wide))
    const data = streaks(f, time, {
      density,
      speedAt: (lon, lat) => (inScotland(lon, lat) ? north : wide),
      boostAt: (lon, lat) => (m > 0 && inScotland(lon, lat) ? 1 : 0),
    })
    const synthetic = f.kind === 'synthetic'
    return [
      new LineLayer({ id: 'windfx-streaks', data, widthUnits: 'pixels', getWidth: 1.5, parameters: { depthTest: false }, pickable: false }),
      new TextLayer({
        id: 'windfx-label', data: LABEL, getPosition: (d) => d.at,
        getText: () => (synthetic ? 'Wind: illustrative field, speed change from the scenario' : 'Wind: Open-Meteo 100 m field, speed change from the scenario'),
        getSize: 11, getColor: [230, 230, 224, 190], getTextAnchor: 'end', fontFamily: 'Inter, sans-serif', parameters: { depthTest: false },
      }),
    ]
  },
}
