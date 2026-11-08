import { useEffect, useState } from 'react'
import { getRegions } from './data.js'
import { RAMP, regionExtent } from './scale.js'

// Legend row for the GB regions layer (shown inside the map legend while the layer is on).
export default function GbRegionsLegend() {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 2000)
    return () => clearInterval(t)
  }, [])
  const ext = regionExtent(getRegions().data)
  return (
    <div className="gbr-legend" style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: "1px solid var(--line)", paddingTop: 6 }}>
      <span className="legend-title"><span>Household price now, p/kWh</span><span className="muted">Octopus Agile, incl. VAT · GB regions</span></span>
      <div className="bar" style={{ background: `linear-gradient(90deg, ${RAMP.join(',')})` }} />
      <div className="ticks num">{ext ? <><span>{ext[0].toFixed(1)}</span><span>{ext[1].toFixed(1)}</span></> : <span className="muted">loading</span>}</div>
    </div>
  )
}
