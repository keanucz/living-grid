import { ColumnLayer } from 'deck.gl'
import { COLORS } from '../../styles/tokens.js'

// Plants as extruded blocks in the simulation view. Locations are approximate.
export default {
  id: 'assets',
  label: 'Plants',
  swatch: '#d8d8d2',
  order: 30,
  modes: ['simulate'],
  defaultOn: true,
  build({ data, scenario }) {
    if (!data.assets) return []
    const hit = scenario?.assetType
    return [
      new ColumnLayer({
        id: 'assets-blocks',
        data: data.assets,
        diskResolution: 4,
        angle: 45,
        radius: 9000,
        extruded: true,
        getPosition: (d) => d.coord,
        getElevation: (d) => 8000 + d.mw * 16,
        getFillColor: (d) => (hit && d.type === hit ? [...COLORS[d.type], 255] : [214, 214, 206, 255]),
        material: { ambient: 0.45, diffuse: 0.7, shininess: 12 },
        pickable: true,
        transitions: { getFillColor: 500 },
        updateTriggers: { getFillColor: [hit] },
      }),
    ]
  },
}
