import { LineLayer } from 'deck.gl'
import { getField } from './grid.js'
import { createStreaks } from './streaks.js'

export { WIND_STOPS, windColor } from './streaks.js'

// Wind as drifting streaks: particles carried by the modelled 100 m wind field, coloured and brightened by speed. Follows the
// scrubber hour. Modelled, not measured. (The engine is shared with the wind in a What if simulation, layers/windFx.)
const streaks = createStreaks(2200)

export default {
  id: 'wind',
  label: 'Wind',
  swatch: '#7fd0f0',
  order: 46,
  modes: ['overview'],
  defaultOn: false,
  build({ ui, time }) {
    const f = getField(ui.at)
    if (!f) return []
    return [
      new LineLayer({
        id: 'wind-streaks',
        data: streaks(f, time),
        widthUnits: 'pixels',
        getWidth: 1.4,
        parameters: { depthTest: false },
        pickable: false,
      }),
    ]
  },
}
