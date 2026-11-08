import { fmt } from '../../styles/tokens.js'

// The numbers at the playhead hour, beside the map: each zone's actual price against the as-of forecast (when the day has
// one), the biggest flow, wind switched off so far, and the explanation sentence where the engine wrote one.
const NAMES = { GB: 'Great Britain', FR: 'France', 'DE-LU': 'Germany', NL: 'Netherlands', BE: 'Belgium', NO2: 'S. Norway' }
const SYM = { GBP: '£', EUR: '€' }
const hhmm = (iso) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })

// The replay point for zone's day-ahead price at `at` (same hour), or null.
export function forecastAt(replay, zone, at) {
  const s = replay?.series?.find((x) => x.zone === zone && x.target === 'price_da')
  const t = Date.parse(at)
  return s?.points?.find((p) => Date.parse(p.ts) === t) ?? null
}

export function biggestFlow(state, interconnectors) {
  const f = [...(state?.flows ?? [])].sort((a, b) => Math.abs(b.mw) - Math.abs(a.mw))[0]
  if (!f || !f.mw) return null
  const ic = interconnectors?.find((x) => x.id === f.interconnector)
  const [from, to] = f.mw >= 0 ? [ic?.from, ic?.to] : [ic?.to, ic?.from]
  return { name: ic?.name ?? f.interconnector, mw: Math.abs(f.mw), from, to }
}

export function Readout({ at, state, stateAt, loading, missing, replay, interconnectors, wind, explanation, events }) {
  const rows = (state?.zones ?? []).map((z) => ({ z, fc: forecastAt(replay, z.zone, stateAt ?? at) }))
  const flow = biggestFlow(state, interconnectors)
  return (
    <aside className="rp-side" aria-label="Values at the playhead">
      <div className="rp-stat">
        <span>Playhead</span>
        <b className="num">{hhmm(at)} UTC</b>
        {loading && <small className="rp-load">loading this hour…</small>}
        {missing && <small className="rp-miss">{stateAt ? 'No data for this hour yet, showing the last real one.' : 'No real data for this hour yet (the API is slow or has none).'}</small>}
        {!missing && stateAt && stateAt !== at && !loading && <small className="rp-miss">Map shows {hhmm(stateAt)}.</small>}
      </div>

      {rows.length > 0 && (
        <table className="rp-zones">
          <thead><tr><th>Zone</th><th>Day-ahead price</th>{replay && <th>Forecast P50</th>}</tr></thead>
          <tbody>
            {rows.map(({ z, fc }) => {
              const inside = fc ? z.price >= fc.p10 && z.price <= fc.p90 : null
              return (
                <tr key={z.zone}>
                  <td>{NAMES[z.zone] ?? z.zone}</td>
                  <td className="num">{SYM[z.currency] ?? ''}{Math.round(z.price)}</td>
                  {replay && <td className="num">{fc ? <>{SYM[z.currency] ?? ''}{Math.round(fc.p50)} <i className={inside ? 'in' : 'out'} title={inside ? 'inside the P10 to P90 band' : 'outside the band'}>{inside ? '✓' : '✗'}</i></> : '—'}</td>}
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      {replay && <p className="rp-foot">Forecast: made 12 hours ahead by a model that saw nothing from this day. ✓ means the price landed inside its P10 to P90 band.</p>}

      <div className="rp-stat"><span>Biggest flow</span><b className="num">{flow ? `${Math.round(flow.mw).toLocaleString('en-GB')} MW` : '—'}</b>{flow && <small>{flow.from ? `${NAMES[flow.from] ?? flow.from} to ${NAMES[flow.to] ?? flow.to}` : flow.name}</small>}</div>
      <div className="rp-stat"><span>Wind paid to switch off, that day so far</span><b className="num">{wind == null ? '—' : `${Math.round(wind).toLocaleString('en-GB')} MWh`}</b><small>Estimated from accepted bids on Scottish wind farms</small></div>
      {explanation && <div className="rp-why"><span>Why</span><p>{explanation}</p></div>}
      {events}
    </aside>
  )
}

export { fmt }
