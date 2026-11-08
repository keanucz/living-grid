import { label, money, tonnes, useCountUp } from './format.js'

const MAX_MW = 300
const COLS = 12
const ROWS = 5

// A building that fills with racks as the GPU count grows (illustrative, not to scale), a power gauge in MW (from the model)
// and a cooling dial for PUE: the fans on the roof spin faster as the overhead rises.
export function Building({ gpuPos, gpus, pue, mw, reduced }) {
  const cells = COLS * ROWS
  const filled = Math.max(1, Math.round((gpuPos / 100) * cells))
  const f = mw == null ? 0 : Math.min(1, mw / MAX_MW)
  const spin = (3 - (pue - 1) * 2.4).toFixed(2)
  const needle = -70 + (pue - 1) * 140
  return (
    <figure className="dcv-bld" aria-label={`${gpus.toLocaleString('en-GB')} GPUs${mw != null ? `, ${mw.toFixed(1)} megawatts on average` : ''}, cooling overhead ${pue.toFixed(2)}`}>
      <svg viewBox="0 0 320 178" role="img">
        <title>A data centre that fills with racks as the GPU count grows</title>
        <rect x="8" y="46" width="210" height="116" rx="6" fill="#1a1a19" stroke="#3a3a37" />
        <rect x="8" y="38" width="210" height="12" rx="3" fill="#2a2a28" />
        {[60, 160].map((x) => (
          <g key={x} transform={`translate(${x} 30)`}>
            <circle r="13" fill="#10100f" stroke="#3a3a37" />
            <g className="dcv-fan" style={{ animationDuration: `${spin}s` }}>
              {[0, 90, 180, 270].map((a) => <path key={a} d="M0 0 C 3 -4 3 -9 0 -11 C -3 -9 -3 -4 0 0" transform={`rotate(${a})`} fill="#6bc8f0" opacity=".85" />)}
            </g>
          </g>
        ))}
        {Array.from({ length: cells }, (_, i) => {
          const r = Math.floor(i / COLS)
          const c = i % COLS
          const on = i < filled
          return <rect key={i} x={18 + c * 16.4} y={54 + (ROWS - 1 - r) * 20} width="13.5" height="16" rx="2" className={on ? 'dcv-rack on' : 'dcv-rack'}
            style={{ transitionDelay: reduced ? '0s' : `${(i % COLS) * 12}ms` }} />
        })}
        <path d="M 236 108 A 36 36 0 0 1 308 108" pathLength="100" fill="none" stroke="#2a2a28" strokeWidth="9" strokeLinecap="round" />
        <path d="M 236 108 A 36 36 0 0 1 308 108" pathLength="100" fill="none" stroke="#c5f06b" strokeWidth="9" strokeLinecap="round"
          strokeDasharray={`${f * 100} 100`} style={{ transition: reduced ? 'none' : 'stroke-dasharray .5s' }} />
        <text x="272" y="104" textAnchor="middle" className="dcv-mw">{mw == null ? '…' : mw.toFixed(1)}</text>
        <text x="272" y="119" textAnchor="middle" className="dcv-unit">MW on average</text>
        <g transform="translate(272 164)">
          <path d="M -34 0 A 34 34 0 0 1 34 0" fill="none" stroke="#2a2a28" strokeWidth="5" />
          <g style={{ transform: `rotate(${needle}deg)`, transition: reduced ? 'none' : 'transform .4s' }}>
            <line x1="0" y1="0" x2="0" y2="-28" stroke="#ff8a1f" strokeWidth="2.5" strokeLinecap="round" />
          </g>
          <circle r="3" fill="#ff8a1f" />
          <text x="-34" y="-5" className="dcv-unit" textAnchor="middle">1.0</text>
          <text x="34" y="-5" className="dcv-unit" textAnchor="middle">2.0</text>
        </g>
      </svg>
      <figcaption>{gpus.toLocaleString('en-GB')} GPUs. Racks drawn are illustrative, not to scale. Cooling dial: PUE {pue.toFixed(2)} (1.0 is no overhead). Gauge scale 0 to {MAX_MW} MW.</figcaption>
    </figure>
  )
}

const hourOf = (iso) => new Date(iso).getUTCHours()

// 24 hours of the day (UTC). Off: the movable work is spread over the working day. On: it slides into the cheapest hours of
// the next 24 h in our forecast, and the yearly saving counts up. The yearly figure is from the trailing year's prices.
export function FlexDay({ on, share, site, reduced }) {
  const n = share === 0 ? 0 : Math.max(1, Math.round(share / 5))
  const job = site?.next_job
  const win = job ? Array.from({ length: Math.max(1, Math.min(job.hours ?? 6, 12)) }, (_, i) => (hourOf(job.start) + i) % 24) : [1, 2, 3, 4, 5, 6]
  const spread = Array.from({ length: n }, (_, i) => Math.floor(8 + (i * 14) / Math.max(1, n)))
  const goal = Array.from({ length: n }, (_, i) => win[i % win.length])
  const stackOf = (hs) => { const seen = {}; return hs.map((h) => (seen[h] = (seen[h] ?? -1) + 1)) }
  const s0 = stackOf(spread)
  const s1 = stackOf(goal)
  const W = 24
  const saving = useCountUp(on && site?.energy ? site.energy.saving_flex_eur : 0, reduced)
  return (
    <div className="dcv-flex">
      <svg viewBox="0 0 288 96" role="img" aria-label={on ? 'The flexible work moved into the cheapest hours' : 'The flexible work spread over the working day'}>
        {win.map((h) => <rect key={h} x={h * 12} y="6" width="12" height="62" fill="#c5f06b" opacity=".13" />)}
        {Array.from({ length: W }, (_, h) => <line key={h} x1={h * 12} x2={h * 12} y1="62" y2="68" stroke="#3a3a37" />)}
        <line x1="0" x2="288" y1="68" y2="68" stroke="#3a3a37" />
        {[0, 6, 12, 18].map((h) => <text key={h} x={h * 12 + 1} y="82" className="dcv-tick">{String(h).padStart(2, '0')}:00</text>)}
        {spread.map((h, i) => {
          const x = (on ? goal[i] : h) * 12 + 1
          const y = 54 - (on ? s1[i] : s0[i]) * 11
          return <rect key={i} x="0" y="0" width="10" height="10" rx="2" fill="#ff8a1f"
            style={{ transform: `translate(${x}px, ${y}px)`, transition: reduced ? 'none' : `transform .9s cubic-bezier(.4,0,.2,1) ${i * 55}ms` }} />
        })}
      </svg>
      <p className="dcv-flexline">
        {share === 0 ? 'Set some work that can wait to see it move.' : on
          ? <>Moved into the cheapest hours (shaded): <b className="num acc">{money(saving)}</b> a year less. {job ? `Hours shown are the cheapest window in our forecast for the next 24 h (UTC); ` : ''}the yearly saving uses the past year’s prices.</>
          : <>Today the movable work runs through the day. Switch it on to move it to the cheapest hours.</>}
      </p>
    </div>
  )
}

// Cost, carbon and a grid flag for each pin as bars; the cheapest site is highlighted. The grid flag is a yes or no from our
// notes (a boundary-limit warning for the Scottish regions), not a measurement: connection queues are not in our data.
export function Compare({ pins, places, sites, best, flexOn, colours, active, onPick }) {
  const rows = pins.map((p, i) => {
    const place = places[i]
    const s = sites.find((x) => x.location === place?.location)
    return { i, place, s, cost: s?.energy ? (flexOn ? s.energy.cost_flex_eur : s.energy.cost_eur) : null, co2: s?.carbon ? (flexOn ? s.carbon.tonnes_flex : s.carbon.tonnes) : null,
      flag: s?.grid_notes?.some((n) => n.topic === 'Scottish wind constraints') }
  })
  const maxCost = Math.max(1, ...rows.map((r) => r.cost ?? 0))
  const maxCo2 = Math.max(1, ...rows.map((r) => r.co2 ?? 0))
  const cheapest = rows.filter((r) => r.cost != null).sort((a, b) => a.cost - b.cost)[0]?.i
  return (
    <div className="dcv-cmp">
      {rows.map((r) => (
        <button key={r.i} className={`dcv-site ${r.i === active ? 'on' : ''} ${r.i === cheapest && rows.length > 1 ? 'best' : ''}`} onClick={() => onPick(r.i)} aria-pressed={r.i === active}>
          <span className="dcv-tag" style={{ background: colours[r.i] }}>{'ABC'[r.i]}</span>
          <span className="dcv-sname">{r.place ? label(r.place.location) : 'Outside the six zones'}{r.i === cheapest && rows.length > 1 ? ' · cheapest' : ''}</span>
          {r.s?.energy ? (
            <span className="dcv-bars">
              <Bar k="Cost" v={money(r.cost)} f={r.cost / maxCost} cls="cost" />
              <Bar k="Carbon" v={tonnes(r.co2)} f={r.co2 / maxCo2} cls="co2" />
              <Bar k="Grid flag" v={r.flag ? 'Boundary limits' : 'None in our data'} f={r.flag ? 1 : 0.18} cls={r.flag ? 'flag' : 'ok'} />
            </span>
          ) : <span className="dcv-muted">No prices for this place.</span>}
        </button>
      ))}
      {best && rows.length > 1 && <p className="dcv-muted">Lowest energy cost wins here. Grid connection and local network capacity are not in our data, so a cheap site is not a ready one.</p>}
    </div>
  )
}

function Bar({ k, v, f, cls }) {
  return (
    <span className="dcv-bar"><em>{k}</em><span className="dcv-track"><i className={cls} style={{ width: `${Math.max(3, Math.min(100, f * 100))}%` }} /></span><b className="num">{v}</b></span>
  )
}
