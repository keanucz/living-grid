import { actions } from '../../store/store.js'

// One "unseen" overlay at a time on a phone; Price is the base map with none of them on.
const OPTIONS = [
  { id: null, label: 'Price' },
  { id: 'ghostWind', label: 'Ghost wind' },
  { id: 'carbon', label: 'Carbon' },
  { id: 'gbRegions', label: 'GB regions' },
  { id: 'wind', label: 'Wind' },
  { id: 'solar', label: 'Sun' },
]
const OVERLAYS = OPTIONS.map((o) => o.id).filter(Boolean)

export default function LayerSwitch({ layers }) {
  const active = OVERLAYS.find((id) => layers[id]) ?? null
  const choose = (id) => {
    for (const o of OVERLAYS) {
      const want = o === id
      if (!!layers[o] !== want) actions.toggleLayer(o)
    }
  }
  return (
    <div className="m-layers" role="group" aria-label="Map layer">
      {OPTIONS.map((o) => (
        <button key={o.label} className={o.id === active ? 'on' : ''} aria-pressed={o.id === active} onClick={() => choose(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}
