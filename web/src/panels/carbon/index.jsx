import { CARBON_LEGEND } from '../../layers/carbon/index.js'
import { getCarbon, intensities } from '../../layers/carbon/data.js'
import Story from './Story.jsx'

// Legend and honesty label for the carbon layer; only shown while the layer is switched on.
function CarbonLegend({ ctx }) {
  if (ctx.ui.layers?.carbon !== true) return null
  const by = intensities(ctx.stateByZone, getCarbon().zones)
  const flagged = Object.entries(by).filter(([, v]) => v.flagged).map(([z]) => z)
  const grad = `linear-gradient(90deg, ${CARBON_LEGEND.map((s) => s.c).join(', ')})`
  return (
    <section className="panel fade-in" style={{ width: 560, maxHeight: '70vh', overflowY: 'auto', padding: '14px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontWeight: 600 }}>
        <span>Carbon you actually consume</span>
        <span className="tag hot">Modelled</span>
      </div>
      <div style={{ height: 8, borderRadius: 4, background: grad, margin: '10px 0 4px' }} />
      <div className="faint num" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
        {CARBON_LEGEND.map((s) => <span key={s.v}>{s.v}{s.v === 500 ? '+' : ''} g/kWh</span>)}
      </div>
      <div className="muted" style={{ fontSize: 13, lineHeight: 1.45, marginTop: 8 }}>
        Local generation plus imports at the exporter&apos;s intensity. Emission factors are standard estimates (IPCC lifecycle medians), not measurements.
        {flagged.length ? <> <b style={{ color: '#ff8fb8' }}>{flagged.join(', ')}</b>: grid looks clean, imports are dirty.</> : null}
      </div>
      <Story intensity={by} />
    </section>
  )
}

export default { id: 'carbonLegend', slot: 'bottomRight', order: 30, modes: ['overview'], Component: CarbonLegend }
